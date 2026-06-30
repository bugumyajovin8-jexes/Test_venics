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
  | 'TAMPERED';

type RemoteLicenseRow = {
  id?: string;
  shop_id: string;
  status: string;
  expiry_date: string;
  created_at?: string;
  updated_at?: string;
};

const TRIAL_DAYS = 14;
const MAX_CLOCK_DRIFT_MS = 60 * 60 * 1000; // 1 hour
const DATE_ROLLBACK_TOLERANCE_MS = 2 * 60 * 1000; // 2 minutes
const LOCAL_STATUS_CACHE_MS = 5_000;
const LICENSE_SYNC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours (cache heavily!)

export class LicenseService {
  private static syncPromise: Promise<void> | null = null;
  private static lastSyncStartedAt = 0;
  private static lastStatusCache: { checkedAt: number; status: { status: LicenseStatus; daysRemaining: number } } | null = null;

  private static getLicensePayload(license: Partial<License>): string {
    // Keep this small and deterministic.
    return `${license.deviceId}-${license.startDate}-${license.expiryDate}-${license.isActive}`;
  }

  static async getLocalLicense() {
    let license = await db.license.get(1);
    if (license) return license;

    const user = useStore.getState().user;
    if (!user?.shopId && user?.role !== 'boss') return null;

    const now = Date.now();
    const newLicense: Partial<License> = {
      id: 1,
      deviceId: uuidv4(),
      startDate: now,
      expiryDate: now + TRIAL_DAYS * 24 * 60 * 60 * 1000,
      isActive: true,
      lastVerifiedAt: now,
    };

    newLicense.signature = generateHMAC(this.getLicensePayload(newLicense));
    await db.license.add(newLicense as License);
    return newLicense as License;
  }

  static async checkStatus(): Promise<{ status: LicenseStatus; daysRemaining: number }> {
    const now = Date.now();
    if (this.lastStatusCache && now - this.lastStatusCache.checkedAt < LOCAL_STATUS_CACHE_MS) {
      return this.lastStatusCache.status;
    }

    const user = useStore.getState().user;
    if (!user?.shopId) {
      const result = { status: 'VALID' as LicenseStatus, daysRemaining: TRIAL_DAYS };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    const license = await this.getLocalLicense();
    if (!license) {
      const result = { status: 'SYNC_REQUIRED' as LicenseStatus, daysRemaining: TRIAL_DAYS };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    const daysRemaining = Math.ceil((license.expiryDate - now) / (24 * 60 * 60 * 1000));
    const currentPayload = this.getLicensePayload(license);

    if (!license.signature || !verifyHMAC(currentPayload, license.signature)) {
      const result = { status: 'TAMPERED' as LicenseStatus, daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

    if (!license.isActive) {
      const result = { status: 'BLOCKED' as LicenseStatus, daysRemaining };
      this.lastStatusCache = { checkedAt: now, status: result };
      return result;
    }

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

  static async syncLicense(force = false) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    if (force) {
      this.clearStatusCache();
      this.syncPromise = null;
    }

    const now = Date.now();
    if (this.syncPromise) return this.syncPromise;

    if (!force) {
      // Persistently cache the last successful sync in localStorage to avoid network requests on reload
      const lastSyncStr = localStorage.getItem('last_license_sync_success_at');
      const lastSyncTime = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;
      
      if (now - lastSyncTime < LICENSE_SYNC_MIN_INTERVAL_MS) return;
    }

    if (!force && now - this.lastSyncStartedAt < 60000) return; // Prevent double trigger in-memory
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
    const localLicense = await this.getLocalLicense();
    if (!localLicense) return;

    try {
      // Setup queries
      const licenseQuery = supabase
        .from('licenses')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Check for cached server time offset to completely bypass get_server_time RPC in most hours
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

      // Handle server time caching: cache the offset for up to 24 hours
      let serverTime = now + offset;
      if (shouldFetchServerTime && serverTimeRes && serverTimeRes.data) {
        const fetchedServerTime = new Date(serverTimeRes.data).getTime();
        offset = fetchedServerTime - now;
        localStorage.setItem('server_time_offset', offset.toString());
        localStorage.setItem('server_time_offset_expiry', (now + 24 * 60 * 60 * 1000).toString());
        serverTime = fetchedServerTime;
      }

      const remote = (licenseRes.data ?? null) as RemoteLicenseRow | null;
      const localTime = Date.now();

      if (Math.abs(serverTime - localTime) > MAX_CLOCK_DRIFT_MS) {
        console.warn('Significant time drift detected between server and local clock');
      }

      if (remote) {
        const updatedLicense: Partial<License> = {
          expiryDate: new Date(remote.expiry_date).getTime(),
          isActive: remote.status?.toLowerCase() === 'active',
          lastVerifiedAt: serverTime,
        };

        const mergedLicense = { ...localLicense, ...updatedLicense };
        updatedLicense.signature = generateHMAC(this.getLicensePayload(mergedLicense));

        await db.license.update(1, updatedLicense);
        if (force) {
          this.clearStatusCache();
        }
        return;
      }

      // If no remote license exists, create or replace one safely.
      const payload = {
        shop_id: shopId,
        status: 'active',
        expiry_date: new Date(localLicense.expiryDate).toISOString(),
        created_at: new Date(localLicense.startDate).toISOString(),
      };

      const { error: upsertError } = await supabase
        .from('licenses')
        .upsert(payload, { onConflict: 'shop_id' });

      if (upsertError) {
        console.error('Error creating remote license:', upsertError);
      }

      const updated: Partial<License> = { lastVerifiedAt: serverTime };
      updated.signature = generateHMAC(this.getLicensePayload({ ...localLicense, ...updated }));
      await db.license.update(1, updated);
    } catch (e) {
      console.error('License sync failed', e);
    }
  }

  static clearStatusCache() {
    this.lastStatusCache = null;
  }
}
