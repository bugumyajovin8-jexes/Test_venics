import { db, type License } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { generateHMAC, verifyHMAC } from '../utils/encryption';

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

const MAX_CLOCK_DRIFT_MS = 60 * 60 * 1000;       // 1 hour
const DATE_ROLLBACK_TOLERANCE_MS = 2 * 60 * 1000; // 2 minutes
const LOCAL_STATUS_CACHE_MS = 5_000;
const LICENSE_SYNC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
// Maximum time the app will run on a cached license without re-verifying with the server.
// After this period offline, the app blocks until it can reach the server.
const MAX_OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export class LicenseService {
  private static syncPromise: Promise<void> | null = null;
  private static lastSyncStartedAt = 0;
  private static lastStatusCache: { checkedAt: number; status: { status: LicenseStatus; daysRemaining: number } } | null = null;

  private static getLicensePayload(license: Partial<License>): string {
    return `${license.deviceId}-${license.startDate}-${license.expiryDate}-${license.isActive}`;
  }

  // Returns the locally cached license record, or null if none exists.
  // NEVER creates a trial — only the superadmin app can issue licenses via Supabase.
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

    // HMAC integrity check (defense-in-depth against IndexedDB tampering)
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

    // Superadmin has not issued any license for this shop
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

    // Update the local lastVerifiedAt timestamp
    if (now > license.lastVerifiedAt) {
      await db.license.update(1, { lastVerifiedAt: now });
    }

    const result = { status: 'VALID' as LicenseStatus, daysRemaining };
    this.lastStatusCache = { checkedAt: now, status: result };
    return result;
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
