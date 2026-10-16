import { db, type License } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { generateHMAC, verifyHMAC } from '../utils/encryption';
import { publishLicenceToHub } from './hub';
import { nowMs } from './clock';

export type LicenseStatus =
  | 'VALID'
  | 'EXPIRED'
  | 'BLOCKED'
  | 'DATE_MANIPULATED'
  | 'SYNC_REQUIRED'
  | 'TAMPERED'
  | 'NO_LICENSE';

type RemoteLicenseRow = {
  id?: string;
  shop_id: string;
  status: string;
  expiry_date: string;
  created_at?: string;
  updated_at?: string;
};

const MAX_CLOCK_DRIFT_MS = 60 * 60 * 1000;        // 1 hour
const DATE_ROLLBACK_TOLERANCE_MS = 2 * 60 * 1000;  // 2 minutes
const LOCAL_STATUS_CACHE_MS = 5_000;
const LICENSE_SYNC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
// Maximum time the app will run on a cached license without re-verifying with the server.
// After this period offline the app blocks until it can reach the server.
const MAX_OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class LicenseService {
  private static syncPromise: Promise<void> | null = null;
  private static lastSyncStartedAt = 0;
  private static lastStatusCache: { checkedAt: number; status: { status: LicenseStatus; daysRemaining: number } } | null = null;
  private static lastAutoInitAt = 0;
  private static readonly INIT_RETRY_THROTTLE_MS = 2 * 60 * 1000; // don't spam init-license

  private static getLicensePayload(license: Partial<License>): string {
    return `${license.deviceId}-${license.startDate}-${license.expiryDate}-${license.isActive}`;
  }

  // Returns the locally cached license record, or null if none exists.
  // NEVER creates a trial — only the superadmin Edge Function can issue licenses.
  static async getLocalLicense(): Promise<License | null> {
    return (await db.license.get(1)) ?? null;
  }

  static async checkStatus(): Promise<{ status: LicenseStatus; daysRemaining: number }> {
    const now = Date.now();
    if (this.lastStatusCache && now - this.lastStatusCache.checkedAt < LOCAL_STATUS_CACHE_MS) {
      return this.lastStatusCache.status;
    }

    const user = useStore.getState().user;
    if (!user?.shopId) {
      // No shop yet (setup-shop flow) — allow through
      const result = { status: 'VALID' as LicenseStatus, daysRemaining: 9999 };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    const license = await this.getLocalLicense();
    if (!license) {
      // No cached license at all — must connect to server to receive one
      const result = { status: 'SYNC_REQUIRED' as LicenseStatus, daysRemaining: 0 };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    // Offline grace period: block if too long since last server verification.
    // This prevents perpetual offline use after a license expires or is revoked.
    const lastSyncStr = localStorage.getItem('last_license_sync_success_at');
    const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;
    if (now - lastSync > MAX_OFFLINE_GRACE_MS) {
      const result = { status: 'SYNC_REQUIRED' as LicenseStatus, daysRemaining: 0 };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    const daysRemaining = Math.ceil((license.expiryDate - now) / (24 * 60 * 60 * 1000));

    // HMAC integrity check — defense against IndexedDB tampering via DevTools
    const currentPayload = this.getLicensePayload(license);
    if (!license.signature || !verifyHMAC(currentPayload, license.signature)) {
      const result = { status: 'TAMPERED' as LicenseStatus, daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    // Explicitly blocked by superadmin
    if (!license.isActive) {
      const result = { status: 'BLOCKED' as LicenseStatus, daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    // Superadmin has not issued any license for this shop yet
    if (license.expiryDate === 0) {
      const result = { status: 'NO_LICENSE' as LicenseStatus, daysRemaining: 0 };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    // Device clock was rolled back
    if (now < license.lastVerifiedAt - DATE_ROLLBACK_TOLERANCE_MS) {
      const result = { status: 'DATE_MANIPULATED' as LicenseStatus, daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    if (now > license.expiryDate) {
      const result = { status: 'EXPIRED' as LicenseStatus, daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    if (now > license.lastVerifiedAt) {
      await db.license.update(1, { lastVerifiedAt: now });
    }

    const result = { status: 'VALID' as LicenseStatus, daysRemaining };
    this.lastStatusCache = { checkedAt: now, status: result };
    return result;
  }

  // Full online verification used by LicenseGuard BEFORE it ever blocks the user.
  //   1. Confirms the license with the server, so we never show "expired / no license"
  //      from a stale or empty local cache.
  //   2. If the shop has NEVER been issued a license (a brand-new shop), provisions
  //      the entitled trial via the server's init-license function, then re-syncs.
  //
  // Security: init-license is server-authoritative and idempotent — it refuses to
  // issue a second trial whenever ANY license (active, expired or blocked) already
  // exists for the shop, so this can never grant extra free time or be farmed by
  // clearing local data. On the client we ALSO only trigger it when the server truly
  // has no license row for this shop (local expiryDate === 0), never for expired/blocked.
  static async verifyOnline(opts: { forceInit?: boolean } = {}): Promise<{ status: LicenseStatus; daysRemaining: number }> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return this.checkStatus();
    }

    let res = await this.checkStatus();

    // Already valid — just a cheap, throttled background refresh.
    if (res.status === 'VALID' && !opts.forceInit) {
      await this.syncLicense();
      return this.checkStatus();
    }

    // Not valid (or an explicit manual re-check): confirm the truth with the server
    // before deciding to block.
    await this.syncLicense(true);
    res = await this.checkStatus();

    // Provision a trial ONLY for a genuinely new shop. syncLicense writes a record
    // with expiryDate === 0 when the server returned no license row at all; an expired
    // or blocked shop keeps its real (non-zero) expiry, so it is never re-provisioned.
    const local = await this.getLocalLicense();
    const shopHasNoServerLicense = !local || local.expiryDate === 0;
    const throttleOk = opts.forceInit || Date.now() - this.lastAutoInitAt > this.INIT_RETRY_THROTTLE_MS;

    if (shopHasNoServerLicense && throttleOk) {
      this.lastAutoInitAt = Date.now();
      try {
        await supabase.functions.invoke('init-license');
        await this.syncLicense(true);
        res = await this.checkStatus();
      } catch (e) {
        console.warn('[License] Auto-provision via init-license failed:', e);
      }
    }

    return res;
  }

  static async syncLicense(force = false) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    if (force) {
      this.clearStatusCache();
      this.syncPromise = null;
    }

    const now = Date.now();
    if (this.syncPromise) return this.syncPromise;

    if (!force) {
      const lastSyncStr = localStorage.getItem('last_license_sync_success_at');
      const lastSyncTime = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;
      if (now - lastSyncTime < LICENSE_SYNC_MIN_INTERVAL_MS) return;
    }

    if (!force && now - this.lastSyncStartedAt < 60000) return;
    this.lastSyncStartedAt = now;

    this.syncPromise = this.doSyncLicense(force);
    try {
      await this.syncPromise;
      localStorage.setItem('last_license_sync_success_at', Date.now().toString());
      // This device has just proved the shop's licence with the server. Leave
      // the proof on the shop hub so the tills and phones that never reach the
      // internet are not locked out at thirty days — see acceptVouchedLicense.
      void this.publishToHub();
      if (force) {
        this.clearStatusCache();
      }
    } finally {
      this.syncPromise = null;
    }
  }

  private static async doSyncLicense(force = false) {
    const user = useStore.getState().user;
    if (!user?.shopId) return;

    const shopId = user.shopId;

    try {
      const cachedOffsetStr = localStorage.getItem('server_time_offset');
      const offsetExpiryStr = localStorage.getItem('server_time_offset_expiry');
      let offset = 0;
      let shouldFetchServerTime = true;
      const now = Date.now();

      if (!force && cachedOffsetStr && offsetExpiryStr) {
        const expiry = parseInt(offsetExpiryStr, 10);
        if (now < expiry) {
          offset = parseInt(cachedOffsetStr, 10);
          shouldFetchServerTime = false;
        }
      }

      const licenseQuery = supabase
        .from('licenses')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let licenseRes;
      let serverTimeRes = null;

      if (shouldFetchServerTime) {
        const [r1, r2] = await Promise.all([licenseQuery, supabase.rpc('get_server_time')]);
        licenseRes = r1;
        serverTimeRes = r2;
      } else {
        licenseRes = await licenseQuery;
      }

      if (licenseRes.error) {
        console.error('Error fetching license from Supabase:', licenseRes.error);
        return;
      }

      let serverTime = now + offset;
      if (shouldFetchServerTime && serverTimeRes?.data) {
        const fetchedServerTime = new Date(serverTimeRes.data).getTime();
        offset = fetchedServerTime - now;
        localStorage.setItem('server_time_offset', offset.toString());
        localStorage.setItem('server_time_offset_expiry', (now + 24 * 60 * 60 * 1000).toString());
        serverTime = fetchedServerTime;
      }

      if (Math.abs(serverTime - Date.now()) > MAX_CLOCK_DRIFT_MS) {
        console.warn('[License] Significant clock drift detected between server and device');
      }

      const existingLocal = await db.license.get(1);
      const deviceId = existingLocal?.deviceId ?? uuidv4();
      const remote = (licenseRes.data ?? null) as RemoteLicenseRow | null;
      // The query came back: the server was reached, and this is its time.
      this.lastServerVerifiedAt = serverTime;

      if (remote) {
        // Server has a license issued by superadmin — write it locally.
        // This app NEVER creates or modifies the remote license record.
        const updated: Partial<License> = {
          id: 1,
          deviceId,
          shopId,
          startDate: existingLocal?.startDate ?? serverTime,
          expiryDate: new Date(remote.expiry_date).getTime(),
          isActive: remote.status?.toLowerCase() === 'active',
          lastVerifiedAt: serverTime,
        };
        updated.signature = generateHMAC(this.getLicensePayload(updated));
        await db.license.put(updated as License);
      } else {
        // No license found for this shop — superadmin has not issued one yet
        // (or it was revoked). Write a hard-blocked state so the guard blocks even offline.
        const blocked: Partial<License> = {
          id: 1,
          deviceId,
          shopId,
          startDate: 0,
          expiryDate: 0,
          isActive: false,
          lastVerifiedAt: serverTime,
        };
        blocked.signature = generateHMAC(this.getLicensePayload(blocked));
        await db.license.put(blocked as License);
      }

      if (force) {
        this.clearStatusCache();
      }
    } catch (e) {
      console.error('[License] Sync failed:', e);
    }
  }

  /**
   * When this device last actually READ the licence from the server.
   *
   * Not the same as "a sync was attempted": doSyncLicense returns quietly when
   * the server cannot be reached, and `lastVerifiedAt` on the row is bumped by
   * every local check (it is there to catch a clock rolled back, not to prove
   * anything). Neither can date the proof left on the hub, because every other
   * device's thirty days is measured from that date — a device that has been
   * offline for a month must not be able to vouch for the shop.
   */
  private static lastServerVerifiedAt = 0;

  /** Hand this device's freshly verified licence to the shop hub. */
  private static async publishToHub(): Promise<void> {
    try {
      const verifiedAt = this.lastServerVerifiedAt;
      if (!verifiedAt) return;            // nothing was verified with the server
      const license = await this.getLocalLicense();
      if (!license?.shopId || !license.isActive) return;
      await publishLicenceToHub({
        shopId: license.shopId,
        startDate: license.startDate,
        expiryDate: license.expiryDate,
        isActive: license.isActive,
      }, verifiedAt);
    } catch {
      /* the hub is off, or this shop has none */
    }
  }

  /**
   * Take the licence a sibling device verified online, when this one cannot.
   *
   * WHY: the app stops trusting a cached licence thirty days after the last
   * check with the server. That is right for a device that could have checked
   * and did not — and wrong for a shop with no internet at all, where a
   * counter phone would go read-only while the shop is paid up and the boss's
   * phone knows it.
   *
   * WHAT IT IS NOT: a way around paying. The clock it sets is the OTHER
   * device's verification time, not now, so this cannot be chained — thirty
   * days after the boss last had signal, every device in that shop stops,
   * exactly as one device would. It never reaches past the licence's own
   * expiry date, and it only ever applies to this device's own shop.
   */
  static async acceptVouchedLicense(vouch: { licence: any; verifiedAt: number } | null): Promise<boolean> {
    const shopId = useStore.getState().user?.shopId;
    const licence = vouch?.licence;
    if (!shopId || !licence || licence.shopId !== shopId) return false;

    const verifiedAt = Number(vouch!.verifiedAt) || 0;
    const now = nowMs();
    // A verification from the future, or older than the grace period it would
    // have to grant, is no use.
    if (verifiedAt <= 0 || verifiedAt > now + 60 * 60 * 1000) return false;
    if (now - verifiedAt > MAX_OFFLINE_GRACE_MS) return false;
    if (!licence.isActive) return false;
    const expiryDate = Number(licence.expiryDate) || 0;
    if (expiryDate <= 0 || expiryDate < now) return false;

    const existingLocal = await db.license.get(1);

    // Only fill a gap, never overwrite something this device knows better.
    // The gap that matters is a phone with NO licence of its own — a new
    // counter phone in a shop that has never had internet — or one holding a
    // licence older than the one the boss's phone just proved.
    const mineForThisShop = existingLocal && existingLocal.shopId === shopId ? existingLocal : null;
    const mineIsFresher = !!mineForThisShop
      && Number(mineForThisShop.lastVerifiedAt || 0) >= verifiedAt
      && Number(mineForThisShop.expiryDate || 0) >= expiryDate;
    if (mineIsFresher) return false;
    const deviceId = existingLocal?.deviceId ?? uuidv4();
    const updated: Partial<License> = {
      id: 1,
      deviceId,
      shopId,
      startDate: existingLocal?.shopId === shopId && existingLocal.startDate ? existingLocal.startDate : Number(licence.startDate) || verifiedAt,
      expiryDate,
      isActive: true,
      lastVerifiedAt: verifiedAt,
    };
    // Re-sealed with THIS device's id: the seal is a tamper check on this
    // device's own storage, and one made for another device would never verify.
    updated.signature = generateHMAC(this.getLicensePayload(updated));
    await db.license.put(updated as License);

    // The grace period runs from the ORIGINAL verification, never from now —
    // so this cannot be chained from device to device to run for ever. It also
    // never moves this device's own clock backwards.
    const ownLast = Number(localStorage.getItem('last_license_sync_success_at') ?? 0);
    localStorage.setItem('last_license_sync_success_at', String(Math.max(ownLast, verifiedAt)));
    localStorage.setItem('license_vouched_at', String(verifiedAt));
    this.clearStatusCache();
    return true;
  }

  static clearStatusCache() {
    this.lastStatusCache = null;
  }
}
