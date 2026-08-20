import { db, type License } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { generateHMAC, verifyHMAC } from '../utils/encryption';
import { effectiveExpiry } from '../utils/licenseTime';
import { publishLicenseCheck } from './readOnly';

export type LicenseStatus =
  | 'VALID'
  | 'EXPIRED'
  | 'BLOCKED'
  | 'DATE_MANIPULATED'
  | 'SYNC_REQUIRED'
  | 'TAMPERED'
  | 'NO_LICENSE';

export interface LicenseCheck {
  status: LicenseStatus;
  daysRemaining: number;
  /**
   * Set only while the shop is inside the end-of-day tail — the licence
   * timestamp has passed but the trading day has not. Writes still work; the
   * banner counts down to this moment.
   */
  graceEndsAt?: number | null;
  /**
   * The exact moment writes stop (23:59:59 on the expiry day), so the UI can
   * lock on a timer rather than waiting for the next poll to notice.
   */
  expiresAt?: number | null;
}

export { effectiveExpiry } from '../utils/licenseTime';

type RemoteLicenseRow = {
  id?: string;
  shop_id: string;
  status: string;
  expiry_date: string;
  created_at?: string;
  updated_at?: string;
};

const MAX_CLOCK_DRIFT_MS = 60 * 60 * 1000;       // 1 hour
const DATE_ROLLBACK_TOLERANCE_MS = 2 * 60 * 1000; // 2 minutes
const LOCAL_STATUS_CACHE_MS = 5_000;
const LICENSE_SYNC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
// Maximum time the app will run on a cached license without re-verifying with the server.
// After this period offline the app blocks until it can reach the server.
// 30 days accommodates genuinely offline users; syncs happen every 12h when online.
const MAX_OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class LicenseService {
  private static syncPromise: Promise<void> | null = null;
  private static lastSyncStartedAt = 0;
  private static lastStatusCache: { checkedAt: number; status: LicenseCheck } | null = null;
  /** Floor on forced syncs, so app-switching can't fire a network call per flip. */
  private static lastForcedSyncAt = 0;
  private static readonly FORCED_SYNC_FLOOR_MS = 30_000;
  private static lastAutoInitAt = 0;
  private static readonly INIT_RETRY_THROTTLE_MS = 2 * 60 * 1000; // don't spam init-license

  private static getLicensePayload(license: Partial<License>): string {
    return `${license.deviceId}-${license.startDate}-${license.expiryDate}-${license.isActive}`;
  }

  // Returns the locally cached license record, or null if none exists.
  // NEVER creates a trial — only the superadmin app can issue licenses via Supabase.
  static async getLocalLicense(): Promise<License | null> {
    return (await db.license.get(1)) ?? null;
  }

  static async checkStatus(): Promise<LicenseCheck> {
    const now = Date.now();
    if (this.lastStatusCache && now - this.lastStatusCache.checkedAt < LOCAL_STATUS_CACHE_MS) {
      // Republished even on a cache hit: the store may have been reset since
      // (a different user signing in), and publishing is a no-op when the
      // verdict is unchanged.
      publishLicenseCheck(this.lastStatusCache.status);
      return this.lastStatusCache.status;
    }

    const user = useStore.getState().user;
    if (!user?.shopId) {
      // No shop yet (setup-shop flow) — allow through
      const result: LicenseCheck = { status: 'VALID', daysRemaining: 9999 };
      this.lastStatusCache = { checkedAt: now, status: result };
      publishLicenseCheck(result);
      return result;
    }

    const license = await this.getLocalLicense();
    if (!license) {
      // No cached license at all — must connect to server to receive one
      const result: LicenseCheck = { status: 'SYNC_REQUIRED', daysRemaining: 0 };
      this.lastStatusCache = { checkedAt: now, status: result };
      publishLicenseCheck(result);
      return result;
    }

    // Offline grace period: stop trusting a cached licence if too long since the
    // last server verification. This prevents perpetual offline use after a
    // license expires or is revoked.
    const lastSyncStr = localStorage.getItem('last_license_sync_success_at');
    const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;
    if (now - lastSync > MAX_OFFLINE_GRACE_MS) {
      const result: LicenseCheck = { status: 'SYNC_REQUIRED', daysRemaining: 0 };
      this.lastStatusCache = { checkedAt: now, status: result };
      publishLicenseCheck(result);
      return result;
    }

    // Everything downstream measures against the end of the expiry day, not the
    // raw timestamp — see effectiveExpiry().
    const expiresAt = license.expiryDate > 0 ? effectiveExpiry(license.expiryDate) : 0;
    const daysRemaining = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));

    // HMAC integrity check (defense-in-depth against IndexedDB tampering)
    const currentPayload = this.getLicensePayload(license);
    if (!license.signature || !verifyHMAC(currentPayload, license.signature)) {
      const result: LicenseCheck = { status: 'TAMPERED', daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      publishLicenseCheck(result);
      return result;
    }

    // Explicitly blocked by superadmin
    if (!license.isActive) {
      const result: LicenseCheck = { status: 'BLOCKED', daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      publishLicenseCheck(result);
      return result;
    }

    // Superadmin has not issued any license for this shop
    if (license.expiryDate === 0) {
      const result: LicenseCheck = { status: 'NO_LICENSE', daysRemaining: 0 };
      this.lastStatusCache = { checkedAt: now, status: result };
      publishLicenseCheck(result);
      return result;
    }

    // Device clock was rolled back
    if (now < license.lastVerifiedAt - DATE_ROLLBACK_TOLERANCE_MS) {
      const result: LicenseCheck = { status: 'DATE_MANIPULATED', daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      publishLicenseCheck(result);
      return result;
    }

    if (now > expiresAt) {
      const result: LicenseCheck = { status: 'EXPIRED', daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      publishLicenseCheck(result);
      return result;
    }

    // Update the local lastVerifiedAt timestamp
    if (now > license.lastVerifiedAt) {
      await db.license.update(1, { lastVerifiedAt: now });
    }

    // Inside the tail: the licence moment has passed but the trading day has
    // not. Still fully writable — the banner just counts down to 23:59.
    const inTail = now > license.expiryDate;

    const result: LicenseCheck = {
      status: 'VALID',
      daysRemaining,
      graceEndsAt: inTail ? expiresAt : null,
      expiresAt,
    };
    this.lastStatusCache = { checkedAt: now, status: result };
    publishLicenseCheck(result);
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
  static async verifyOnline(opts: { forceInit?: boolean } = {}): Promise<LicenseCheck> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return this.checkStatus();
    }

    let res = await this.checkStatus();

    // Already valid — just a cheap, throttled background refresh.
    if (res.status === 'VALID' && !opts.forceInit) {
      await this.syncLicense();
      // That refresh may have pulled a NEW expiry date, and checkStatus caches
      // its verdict for a few seconds — so without dropping the cache here the
      // stale VALID is returned and the change only lands on a later tick.
      this.clearStatusCache();
      return this.checkStatus();
    }

    // Not valid (or an explicit manual re-check): confirm the truth with the server
    // before deciding to block. A manual re-check skips the 30s floor — someone who
    // has just paid should not be told to wait.
    await this.syncLicense(true, { bypassFloor: !!opts.forceInit });
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

  static async syncLicense(force = false, opts: { bypassFloor?: boolean } = {}) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const now = Date.now();

    // A lapsed shop force-syncs on every foreground event, so a user flipping
    // between apps would otherwise fire one network round-trip per flip. The
    // manual "Hakiki sasa" button passes bypassFloor — when someone has just
    // paid, they get an immediate answer.
    if (force && !opts.bypassFloor && now - this.lastForcedSyncAt < this.FORCED_SYNC_FLOOR_MS) {
      return;
    }

    if (force) {
      this.lastForcedSyncAt = now;
      this.clearStatusCache();
      this.syncPromise = null;
    }

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

      if (remote) {
        // Server has a license issued by superadmin — write it locally.
        // This app NEVER creates or modifies the remote license record.
        const updated: Partial<License> = {
          id: 1,
          deviceId,
          startDate: existingLocal?.startDate ?? serverTime,
          expiryDate: new Date(remote.expiry_date).getTime(),
          isActive: remote.status?.toLowerCase() === 'active',
          lastVerifiedAt: serverTime,
        };
        updated.signature = generateHMAC(this.getLicensePayload(updated));
        await db.license.put(updated as License);
      } else {
        // No license found for this shop — superadmin has not issued one yet
        // (or it was revoked). Write a blocked state so the guard blocks even offline.
        const blocked: Partial<License> = {
          id: 1,
          deviceId,
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

  static clearStatusCache() {
    this.lastStatusCache = null;
  }
}
