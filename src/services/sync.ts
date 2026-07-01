import { db, AuditLog, registerLocalWriteTrigger } from '../db';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { LicenseService } from './license';
import { TelemetryService } from './telemetry';
import { v4 as uuidv4 } from 'uuid';
import { subDays } from 'date-fns';
import { getSales30DaysVelocityMap } from '../utils/stock';

// Register immediate write-through trigger for index mutations (Push-on-Commit)
registerLocalWriteTrigger(() => {
  console.log('⚡ Write-Through Trigger received. Scheduling critical sync in 500ms...');
  SyncService.scheduleCriticalSync(false);
});

type DexieTable = {
  where: (field: string) => any;
  get: (key: string) => Promise<any>;
  put: (value: any) => Promise<any>;
  update: (key: string, changes: any) => Promise<any>;
  add: (value: any) => Promise<any>;
  toArray: () => Promise<any[]>;
};

type SupabaseResult<T> = { data: T; error: any };
type SyncScope = 'critical' | 'background' | 'full';
type SyncRequest = { scope: SyncScope; force: boolean; createdAt: number };

const SYNC_BATCH_SIZE = 100;
const PUSH_CHUNK_SIZE = 50;
const MAX_RETRIES = 3;

const CRITICAL_TABLES = ['sales', 'sale_items', 'products', 'debt_payments', 'assistant_chats'] as const;
const DELAYED_TABLES = ['shops', 'users', 'features'] as const;
const BACKGROUND_TABLES = ['audit_logs', 'expenses', 'saas_telemetry'] as const;
const ALL_TABLES = [
  'shops',
  'users',
  'products',
  'sales',
  'sale_items',
  'expenses',
  'features',
  'audit_logs',
  'debt_payments',
  'assistant_chats',
  'saas_telemetry',
] as const;

export class SyncService {
  private static activeSyncPromise: Promise<void> | null = null;
  private static requestQueue: SyncRequest[] = [];
  private static inFlightProductDeltas: Map<string, number> = new Map();
  private static scheduledCriticalSync: ReturnType<typeof setTimeout> | null = null;
  private static scheduledBackgroundSync: ReturnType<typeof setTimeout> | null = null;
  private static scheduledFullSync: ReturnType<typeof setTimeout> | null = null;
  private static lastCriticalSyncStartedAt = 0;
  private static lastBackgroundSyncStartedAt = 0;
  private static lastFullSyncStartedAt = 0;

  // Track last successful pull times to prevent egress-heavy rapid polling
  private static lastTablePullTime: Record<string, number> = {};

  // Fine-tuned pull throttle intervals per table to conserve user budget & bandwidth
  private static readonly PULL_THROTTLE_MS: Record<string, number> = {
    sales: 90_000,
    sale_items: 90_000,
    products: 90_000,
    debt_payments: 90_000,
    assistant_chats: 60_000,
    shops: 300_000,         // Shops static config rarely changes (5 min)
    users: 300_000,         // User profiles rarely change (5 min)
    expenses: 120_000,      // Expenses are non-interactive back-off records (2 min)
    features: 300_000,      // SaaS features (5 min)
    audit_logs: 300_000,    // High volume trailing logs (5 min)
  };

  private static pendingAuditLogs: any[] = [];
  private static auditLogFlushTimeout: ReturnType<typeof setTimeout> | null = null;

  private static scheduleAuditLogFlush() {
    if (this.auditLogFlushTimeout) return;
    this.auditLogFlushTimeout = setTimeout(async () => {
      this.auditLogFlushTimeout = null;
      await this.flushAuditLogs();
    }, 25_000); // 25s deferral to fully clear initial login and system startup windows
  }

  static async flushAuditLogs() {
    if (this.pendingAuditLogs.length === 0) return;
    const logsToFlush = [...this.pendingAuditLogs];
    this.pendingAuditLogs = [];
    try {
      await db.auditLogs.bulkAdd(logsToFlush);
      console.log(`[SyncService] Flushed ${logsToFlush.length} deferred audit logs.`);
      this.scheduleBackgroundSync();
    } catch (err) {
      console.error('[SyncService] Failed to flush deferred audit logs:', err);
      // Re-insert at the start of queue
      this.pendingAuditLogs.unshift(...logsToFlush);
    }
  }

  private static lastAuthWarnTime = 0;

  static async sync(force = false, scope: SyncScope = 'full'): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    this.enqueueRequest(scope, force);
    if (this.activeSyncPromise) return this.activeSyncPromise;

    this.activeSyncPromise = this.drainQueue();
    try {
      await this.activeSyncPromise;
    } finally {
      this.activeSyncPromise = null;
    }
  }

  static scheduleCriticalSync(force = false) {
    if (this.scheduledCriticalSync) clearTimeout(this.scheduledCriticalSync);
    this.scheduledCriticalSync = setTimeout(() => {
      this.scheduledCriticalSync = null;
      void this.sync(force, 'critical');
    }, 500);
  }

  static scheduleBackgroundSync(force = false) {
    if (this.scheduledBackgroundSync) clearTimeout(this.scheduledBackgroundSync);
    this.scheduledBackgroundSync = setTimeout(() => {
      this.scheduledBackgroundSync = null;
      void this.sync(force, 'background');
    }, 300_000); // Debounce background syncs heavily (5 minutes) to avoid I/O load
  }

  static scheduleFullSync(force = false) {
    if (this.scheduledFullSync) clearTimeout(this.scheduledFullSync);
    this.scheduledFullSync = setTimeout(() => {
      this.scheduledFullSync = null;
      void this.sync(force, 'full');
    }, 30_000);
  }

  static getIsSyncing() {
    return this.activeSyncPromise !== null;
  }

  static async triggerCriticalSync() {
    this.scheduleCriticalSync(true);
  }

  private static enqueueRequest(scope: SyncScope, force: boolean) {
    const existing = this.requestQueue.find(r => r.scope === scope);
    if (existing) {
      existing.force = existing.force || force;
      existing.createdAt = Math.min(existing.createdAt, Date.now());
    } else {
      this.requestQueue.push({ scope, force, createdAt: Date.now() });
    }

    this.requestQueue.sort((a, b) => {
      const priority = this.getScopePriority(b.scope) - this.getScopePriority(a.scope);
      if (priority !== 0) return priority;
      return a.createdAt - b.createdAt;
    });
  }

  private static async drainQueue(): Promise<void> {
    while (this.requestQueue.length > 0) {
      // Coalesce all enqueued requests to avoid running redundant sequential full/critical syncs
      let force = false;
      let highestScope: SyncScope = 'background';
      for (const req of this.requestQueue) {
        force = force || req.force;
        if (req.scope === 'critical') {
          highestScope = 'critical';
        } else if (req.scope === 'full' && highestScope !== 'critical') {
          highestScope = 'full';
        }
      }
      
      // Clear the queue as our consolidated run will handle all requested sync operations
      this.requestQueue = [];
      
      await this.runOneSync(force, highestScope);
    }
  }

  private static getScopePriority(scope: SyncScope): number {
    if (scope === 'critical') return 3;
    if (scope === 'full') return 2;
    return 1;
  }

  public static async ensureSessionValid(): Promise<boolean> {
    try {
      // 1. Fetch current session from Supabase Client memory/cookie storage
      let { data: { session } } = await supabase.auth.getSession();
      
      const bufferMs = 600000; // 10 minutes safety buffer before expiration
      const isValid = session && session.expires_at && (session.expires_at * 1000 - Date.now() > bufferMs);
      
      if (session && isValid) {
        // Current in-memory session is fully valid! Reinforce backup local storage tokens.
        localStorage.setItem('pos_token', session.access_token);
        if (session.refresh_token) {
          localStorage.setItem('pos_refresh_token', session.refresh_token);
        }
        return true;
      }
      
      console.log('[SyncService] In-memory session missing, expired or expiring within 10 minutes. Healing auth...');
      
      // 2. Fetch backup tokens from persistent localStorage
      const storedAccess = localStorage.getItem('pos_token');
      const storedRefresh = localStorage.getItem('pos_refresh_token');
      
      // If we have a refresh token, we can forcefully request a refreshed session
      if (storedRefresh) {
        console.log('[SyncService] Attempting explicit refreshSession with persisted refresh_token...');
        try {
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
            refresh_token: storedRefresh
          });
          
          if (refreshData?.session) {
            console.log('[SyncService] Auth session successfully healed using refresh_token.');
            // Update backup keys
            localStorage.setItem('pos_token', refreshData.session.access_token);
            if (refreshData.session.refresh_token) {
              localStorage.setItem('pos_refresh_token', refreshData.session.refresh_token);
            }
            
            // Sync store so visual indicators show online/authorized state immediately
            const currentUser = useStore.getState().user;
            if (currentUser) {
              useStore.getState().setAuth(refreshData.session.access_token, currentUser, refreshData.session.refresh_token);
            }
            return true;
          } else {
            console.warn('[SyncService] refreshSession block failed:', refreshError);
          }
        } catch (err) {
          console.error('[SyncService] Exception during refreshSession:', err);
        }
      }
      
      // Fallback: Try setSession with both tokens
      if (storedAccess && storedRefresh) {
        console.log('[SyncService] Attempting setSession with stored access and refresh tokens...');
        try {
          const { data: setSessionData, error: setSessionError } = await supabase.auth.setSession({
            access_token: storedAccess,
            refresh_token: storedRefresh
          });
          
          if (setSessionData?.session) {
            console.log('[SyncService] Auth recovered successfully via setSession.');
            localStorage.setItem('pos_token', setSessionData.session.access_token);
            if (setSessionData.session.refresh_token) {
              localStorage.setItem('pos_refresh_token', setSessionData.session.refresh_token);
            }
            
            const currentUser = useStore.getState().user;
            if (currentUser) {
              useStore.getState().setAuth(setSessionData.session.access_token, currentUser, setSessionData.session.refresh_token);
            }
            return true;
          } else {
            console.warn('[SyncService] setSession block failed:', setSessionError);
          }
        } catch (err) {
          console.error('[SyncService] Exception during setSession:', err);
        }
      }

      // Final double-check: if network issue occurred, sometimes getSession() might still recover locally.
      const { data: finalCheck } = await supabase.auth.getSession();
      if (finalCheck?.session) {
        return true;
      }

      return false;
    } catch (e) {
      console.error('[SyncService] Critical session validation exception:', e);
      return false;
    }
  }

  private static async runOneSync(force: boolean, scope: SyncScope): Promise<void> {
    const now = Date.now();
    if (!force) {
      if (scope === 'critical' && now - this.lastCriticalSyncStartedAt < 1_000) return;
      if (scope === 'background' && now - this.lastBackgroundSyncStartedAt < 600_000) return; // 10 minutes throttle for non-urgent telemetry
      if (scope === 'full' && now - this.lastFullSyncStartedAt < 30_000) return;
    }

    if (scope === 'critical') this.lastCriticalSyncStartedAt = now;
    if (scope === 'background') this.lastBackgroundSyncStartedAt = now;
    if (scope === 'full') this.lastFullSyncStartedAt = now;

    const state = useStore.getState();
    const user = state.user;
    if (!user?.shopId) return;

    // Direct proactive session recovery before starting any push or pull procedures
    const isSessionValid = await this.ensureSessionValid();
    if (!isSessionValid) {
      const canLog = Date.now() - this.lastAuthWarnTime > 60000;
      if (canLog) {
        console.error('[SyncService] Sync aborted because active Supabase session could not be established or recovered.');
        this.lastAuthWarnTime = Date.now();
      }
      return;
    }

    const shopId = user.shopId;
    const settings = await db.settings.get(1);

    try {
      console.log(`Starting ${scope} sync process...`);

      if (scope === 'full' || scope === 'background') {
        await this.runWithRetry(() => LicenseService.syncLicense(), 'syncLicense');
      }

      const pushTargets = this.getPushTargets(scope, user.role);
      let anyPushed = false;
      for (const tableName of pushTargets) {
        const table = this.getTableRef(tableName);
        if (table) {
          const unsyncedCount = await table.where('synced').equals(0).count();
          if (unsyncedCount > 0) {
            try {
              await this.pushTable(tableName, table);
              anyPushed = true;
            } catch (error) {
              const isNonCritical = ['saas_telemetry', 'audit_logs', 'assistant_chats'].includes(tableName);
              if (isNonCritical) {
                console.warn(`[SyncService] Bypassed non-critical push failure for ${tableName} to keep main sync healthy:`, error);
              } else {
                throw error;
              }
            }
          }
        }
      }

      if (anyPushed) {
        // Heartbeat shortcut removed for 100% reliable multi-device sync
      }

      const pullTargets = this.getPullTargets(scope, user.role);
      for (const tableName of pullTargets) {
        const lastSyncDate = this.getTableSyncDate(settings, tableName);
        await this.pullTable(tableName, this.getTableRef(tableName), shopId, lastSyncDate, force);
      }

      if (scope !== 'critical') {
        await this.saveSettingsPatch({ lastSync: Date.now() });
      }

      if (scope === 'full' || scope === 'background') {
        const allFeatures = await db.features.toArray();
        const featureMap: Record<string, boolean> = {};
        allFeatures.forEach(f => {
          featureMap[f.featureKey] = f.isEnabled;
        });
        useStore.getState().setFeatures(featureMap);
      }

      useStore.getState().setSyncHealth('healthy');
      console.log(`${scope} sync completed successfully`);
    } catch (error) {
      useStore.getState().setSyncHealth('error');
      console.error(`${scope} sync failed:`, error);
    }
  }

  private static getPushTargets(scope: SyncScope, role?: string): string[] {
    const isBoss = role === 'boss';

    if (scope === 'critical') return [...CRITICAL_TABLES];
    if (scope === 'background') return [...BACKGROUND_TABLES, 'features'];

    const tables = [...ALL_TABLES];
    if (!isBoss) {
      return tables.filter(t => !['shops', 'users', 'features'].includes(t));
    }
    return tables as string[];
  }

  private static getPullTargets(scope: SyncScope, role?: string): string[] {
    const isBoss = role === 'boss';

    let targets: string[] = [];
    if (scope === 'critical') {
      targets = [...CRITICAL_TABLES];
    } else if (scope === 'background') {
      targets = [...BACKGROUND_TABLES, 'features'];
    } else {
      const tables = [...ALL_TABLES];
      if (!isBoss) {
        targets = tables.filter(t => !['shops', 'users'].includes(t));
      } else {
        targets = tables as string[];
      }
    }
    // Never pull saas_telemetry from remote since the clients only generate it
    return targets.filter(t => t !== 'saas_telemetry');
  }

  private static getTableRef(tableName: string): DexieTable {
    const tables: Record<string, DexieTable> = {
      shops: db.shops,
      users: db.users,
      products: db.products,
      sales: db.sales,
      sale_items: db.saleItems,
      expenses: db.expenses,
      features: db.features,
      audit_logs: db.auditLogs,
      debt_payments: db.debtPayments,
      assistant_chats: db.assistantChats,
      saas_telemetry: db.saasTelemetry,
    };

    return tables[tableName];
  }

  private static async runWithRetry<T>(fn: () => any, label: string): Promise<T> {
    let lastError: any;

    // Expand max retries slightly to allow for explicit auth re-challenges to succeed
    const maxAttempts = MAX_RETRIES + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await fn();
        if (result && typeof result === 'object' && 'error' in result && result.error) {
          throw result.error;
        }
        return (result && typeof result === 'object' && 'data' in result ? result.data : result) as T;
      } catch (error: any) {
        lastError = error;

        // PWA specific handling: Check if it's an Auth / JWT error
        const isAuthError = 
          error?.status === 401 || 
          error?.status === 403 || 
          error?.code === 'PGRST301' || 
          (error?.message || '').toLowerCase().includes('jwt') ||
          (error?.message || '').includes('User not associated with any shop') ||
          error?.code === '401' ||
          error?.code === '403';

        if (isAuthError) {
          console.warn(`[SyncService] ${label} encountered Auth error on attempt ${attempt}. Forcing token refresh...`);
          try {
            let { data } = await supabase.auth.refreshSession();
            if (!data.session) {
              const storedAccess = localStorage.getItem('pos_token');
              const storedRefresh = localStorage.getItem('pos_refresh_token');
              if (storedAccess && storedRefresh) {
                 const restore = await supabase.auth.setSession({ access_token: storedAccess, refresh_token: storedRefresh });
                 if (restore.data.session) {
                    console.log('[SyncService] Restored auth session during retry block.');
                 }
              }
            }
            // Optional delay after refresh to let token propagate
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (refreshErr) {
            console.warn('[SyncService] Token refresh failed during sync retry:', refreshErr);
          }
        }

        const waitMs = 300 * attempt * attempt;
        console.warn(`${label} failed on attempt ${attempt}/${maxAttempts}. Retrying in ${waitMs}ms.`, error);
        
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }
    }

    throw lastError;
  }

  private static chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private static async saveSettingsPatch(patch: Record<string, any>) {
    const current = await db.settings.get(1);
    if (current) {
      await db.settings.update(1, patch);
    } else {
      await db.settings.put({ id: 1, ...patch } as any);
    }
  }

  public static clearPullThrottleCache() {
    this.lastTablePullTime = {};
    this.lastFullSyncStartedAt = 0;
    this.lastCriticalSyncStartedAt = 0;
    this.lastBackgroundSyncStartedAt = 0;
  }

  private static getCursorKey(tableName: string) {
    const user = useStore.getState().user;
    const shopId = user?.shopId || 'default';
    return `syncCursor_${shopId}_${tableName}`;
  }

  private static getTableSyncDate(settings: any, tableName: string): string {
    const cursor = settings?.[this.getCursorKey(tableName)];
    if (!cursor) return new Date(0).toISOString();
    // If it's already a string, it might have microsecond precision from Postgres
    if (typeof cursor === 'string') return cursor;
    // Fallback for older number cursors
    return new Date(cursor).toISOString();
  }

  private static async setTableSyncCursor(tableName: string, cursorValue: string | number) {
    await this.saveSettingsPatch({ [this.getCursorKey(tableName)]: cursorValue });
  }

  private static async pushTable(tableName: string, table: DexieTable) {
    const userRole = useStore.getState().user?.role;
    const isBoss = userRole === 'boss';

    if (!isBoss && ['shops', 'users', 'features'].includes(tableName)) return;

    let unsynced = await table.where('synced').equals(0).toArray();
    if (unsynced.length === 0) return;

    if (tableName === 'audit_logs') {
      const currentUser = useStore.getState().user;
      if (currentUser) {
        unsynced = unsynced.filter((record: any) => record.user_id === currentUser.id);
      } else {
        unsynced = [];
      }
      if (unsynced.length === 0) return;
    }

    if (tableName === 'products') {
      for (const record of unsynced) {
        this.inFlightProductDeltas.set(record.id, record.stock_delta || 0);
      }

      try {
        const productsData = unsynced.map(record => {
          const { synced, ...localData } = record;
          const dataToSync = this.mapToRemote(tableName, localData);
          dataToSync.stock_delta = record.stock_delta || 0;
          return dataToSync;
        });

        await this.runWithRetry(() => supabase.rpc('sync_products_with_deltas', { products_data: productsData }), 'sync_products_with_deltas');

        // Since the remote RPC 'sync_products_with_deltas' might not handle updating newer columns like `track_stock` in the DB,
        // we perform a standard upsert for non-stock columns of these products to ensure they are synchronized correctly in Supabase.
        const nonStockUpdates = productsData.map(p => {
          const { stock, stock_delta, ...rest } = p;
          return rest;
        });
        await this.runWithRetry(() => supabase.from('products').upsert(nonStockUpdates, { onConflict: 'id' }), 'sync products non-stock fields');

        for (const record of unsynced) {
          const current = await table.get(record.id);
          if (!current) continue;
          const newDelta = (current.stock_delta || 0) - (record.stock_delta || 0);
          await table.update(record.id, {
            synced: newDelta === 0 ? 1 : 0,
            stock_delta: newDelta,
          });
        }
      } finally {
        for (const record of unsynced) {
          this.inFlightProductDeltas.delete(record.id);
        }
      }
      return;
    }

    const remoteBatch = unsynced.map(record => {
      const { synced, ...localData } = record;
      return this.mapToRemote(tableName, localData);
    });

    let cursor = 0;
    for (const batch of this.chunk(remoteBatch, PUSH_CHUNK_SIZE)) {
      try {
        if (tableName === 'audit_logs') {
          await this.runWithRetry(() => supabase.from(tableName).insert(batch), `push ${tableName}`);
        } else {
          await this.runWithRetry(() => supabase.from(tableName).upsert(batch, { onConflict: 'id' }), `push ${tableName}`);
        }

        const syncedRows = unsynced.slice(cursor, cursor + batch.length);
        for (const record of syncedRows) {
          await table.update(record.id, { synced: 1 });
        }
      } catch (error: any) {
        const isNonCritical = ['saas_telemetry', 'audit_logs', 'assistant_chats'].includes(tableName);
        if (isNonCritical) {
          console.warn(`[SyncService] push failed for non-critical ${tableName}:`, error);

          // Handle RLS/Permission errors specifically to prevent infinite failure loops and excessive egress costs
          const isPermError = 
            error?.status === 403 || 
            error?.code === '42501' ||
            error?.code === 'PGRST301' ||
            (error?.message || '').toLowerCase().includes('row-level security') ||
            (error?.message || '').toLowerCase().includes('violates row-level security');

          if (isPermError) {
            console.warn(`[SyncService] Permanent RLS policy restriction or permission block on ${tableName}. auto-marking batch as synced in local DB to stop egress/sync storm.`);
            const syncedRows = unsynced.slice(cursor, cursor + batch.length);
            for (const record of syncedRows) {
              await table.update(record.id, { synced: 1 });
            }
          } else {
            // Re-throw transient issues (e.g. timeout, disconnect) to try again later
            throw error;
          }
        } else {
          throw error;
        }
      }
      cursor += batch.length;
    }
  }

  private static async pullTable(tableName: string, table: DexieTable, shopId: string, lastSyncDate: string, force: boolean) {
    // assistant_chats should only be pushed to, never pulled from remote Supabase DB to reduce egress/bandwidth
    if (tableName === 'assistant_chats') {
      return;
    }

    if (tableName === 'audit_logs') {
      const role = useStore.getState().user?.role;
      if (role !== 'boss') return;
    }

    // Throttle pull operations for each table unless explicitly forced to save user egress bandwidth
    const now = Date.now();
    const throttleInterval = this.PULL_THROTTLE_MS[tableName] || 60_000;
    const lastPull = this.lastTablePullTime[tableName] || 0;

    if (!force && (now - lastPull < throttleInterval)) {
      // Skip query execution as this table was pulled successfully very recently
      return;
    }

    let hasMore = true;
    let offset = 0;
    let newestRemoteCursorMs = 0;
    let newestRemoteCursorStr: string | null = null;

    while (hasMore) {
      let query = supabase.from(tableName).select('*');

      if (tableName === 'shops') {
        query = query.eq('id', shopId);
      } else {
        query = query.eq('shop_id', shopId);
      }

      if (tableName === 'audit_logs') {
        query = query.eq('is_deleted', false);
      }

      if (lastSyncDate && !force && tableName !== 'features') {
        query = query.gt('updated_at', lastSyncDate);
      }

      query = query
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + SYNC_BATCH_SIZE - 1);

      let data: any[];
      try {
        data = await this.runWithRetry(() => query, `pull ${tableName} offset ${offset}`);
      } catch (error) {
        console.error(`Error pulling ${tableName} (offset ${offset}):`, error);
        return;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      await db.transaction('rw', table as any, async () => {
        for (const record of data) {
          const localData = this.mapToLocal(tableName, record);
          const existing = await table.get(record.id);

          const remoteUpdatedAtMs = record.updated_at ? new Date(record.updated_at).getTime() : 0;
          if (remoteUpdatedAtMs > newestRemoteCursorMs) {
            newestRemoteCursorMs = remoteUpdatedAtMs;
            newestRemoteCursorStr = record.updated_at;
          } else if (remoteUpdatedAtMs === newestRemoteCursorMs && record.updated_at) {
            if (!newestRemoteCursorStr || record.updated_at > newestRemoteCursorStr) {
               newestRemoteCursorStr = record.updated_at;
            }
          }

          const isRemoteNewer = Boolean(
            existing &&
            record.updated_at &&
            existing.updated_at &&
            (record.updated_at > existing.updated_at || new Date(record.updated_at) > new Date(existing.updated_at))
          );

          const hasUnsyncedChanges = Boolean(existing && existing.synced === 0);

          if (!existing) {
            const dataToStore: any = { ...localData, synced: 1 };
            if (tableName === 'products') {
              dataToStore.stock_delta = 0;
            }
            await table.put(dataToStore);
            continue;
          }

          if (isRemoteNewer) {
            if (tableName === 'products' && hasUnsyncedChanges) {
              const pendingDelta = existing.stock_delta || 0;
              const inFlightDelta = SyncService.inFlightProductDeltas.get(record.id) || 0;
              const netDelta = pendingDelta - inFlightDelta;
              const remoteStock = Number(record.stock) || 0;
              const mergedStock = Math.max(0, remoteStock + netDelta);

              // Local row has unsynced edits (e.g. offline name/price/min_stock/batch
              // changes). Keep ALL local fields so they aren't clobbered by the remote
              // copy; only reconcile stock via deltas so concurrent remote sales aren't
              // lost. The row stays synced:0 so the local edits get pushed next cycle.
              await table.put({
                ...existing,
                stock: mergedStock,
                stock_delta: pendingDelta,
                synced: 0,
              });
            } else if (!hasUnsyncedChanges) {
              const dataToStore = { ...existing, ...localData, synced: 1 };
              if (tableName === 'products') {
                dataToStore.stock_delta = 0;
              }
              await table.put(dataToStore);
            }
          }
        }
      });

      if (data.length < SYNC_BATCH_SIZE) {
        hasMore = false;
      } else {
        offset += SYNC_BATCH_SIZE;
      }
    }

    if (newestRemoteCursorStr) {
      await this.setTableSyncCursor(tableName, newestRemoteCursorStr);
    } else if (newestRemoteCursorMs > 0) {
      await this.setTableSyncCursor(tableName, newestRemoteCursorMs);
    }

    // Record the timestamp of successful table pulling completion to enforce throttled requests
    this.lastTablePullTime[tableName] = now;
  }

  private static mapToRemote(tableName: string, data: any) {
    const mapped: any = { ...data };
    const tablesWithIsDeleted = ['products', 'sales', 'sale_items', 'expenses', 'debt_payments', 'audit_logs'];

    if ('isDeleted' in mapped) {
      if (tablesWithIsDeleted.includes(tableName)) {
        mapped.is_deleted = mapped.isDeleted === 1;
      }
      delete mapped.isDeleted;
    }

    if ('shopId' in mapped) {
      if (!mapped.shop_id) mapped.shop_id = mapped.shopId;
      delete mapped.shopId;
    }

    delete mapped.synced;
    delete mapped.stock_delta;
    delete mapped.pricing_verified;

    if (tableName === 'assistant_chats') {
      mapped.is_unresolved = data.is_unresolved === 1;
    }

    if (tableName === 'users') {
      mapped.status = data.status || (data.isActive ? 'active' : 'blocked');
      delete mapped.isActive;
    }

    if (tableName === 'sales') {
      if (mapped.payment_method === 'mobile' || mapped.payment_method === 'card') {
        mapped.payment_method = 'mobile_money';
      }
      if (!mapped.created_at && mapped.date) {
        mapped.created_at = mapped.date;
      }
      delete mapped.is_credit;
      delete mapped.is_paid;
      delete mapped.date;
    }

    if (tableName === 'debt_payments') {
      if (mapped.date) mapped.created_at = mapped.date;
      delete mapped.date;
    }

    if (tableName === 'features') {
      mapped.feature_key = data.featureKey;
      mapped.is_enabled = data.isEnabled;
      delete mapped.featureKey;
      delete mapped.isEnabled;
    }

    return mapped;
  }

  private static mapToLocal(tableName: string, data: any) {
    const mapped: any = { ...data };
    mapped.isDeleted = 0;

    if ('is_deleted' in data) {
      mapped.isDeleted = data.is_deleted ? 1 : 0;
      delete mapped.is_deleted;
    } else if (!('isDeleted' in mapped)) {
      mapped.isDeleted = 0; // Default fallback for local consistency
    }

    if (tableName === 'users') {
      mapped.isActive = data.status === 'active';
      mapped.shopId = data.shop_id;
    }

    if (tableName === 'assistant_chats') {
      mapped.is_unresolved = data.is_unresolved ? 1 : 0;
    }

    if (tableName === 'sales') {
      mapped.is_credit = data.payment_method === 'credit';
      mapped.is_paid = data.status === 'completed';
      mapped.date = data.created_at;
    }

    if (tableName === 'debt_payments') {
      mapped.date = data.created_at;
    }

    if (tableName === 'sale_items') {
      mapped.product_name = data.product_name || data.name;
    }

    if (tableName === 'features') {
      mapped.featureKey = data.feature_key;
      mapped.isEnabled = data.is_enabled;
    }

    return mapped;
  }

  static async checkGhostItems(shopId: string) {
    if (!shopId) return;
    try {
      // Check if we already logged this anomaly today
      const startOfToday = new Date();
      startOfToday.setHours(0,0,0,0);
      const existingLog = await db.auditLogs
        .where('[shop_id+isDeleted+created_at]')
        .between([shopId, 0, startOfToday.toISOString()], [shopId, 0, '\uffff'])
        .filter(l => l.action === 'anomaly_ghost_items')
        .first();
        
      if (existingLog) return; // Already checked today

      const velocityMap = await getSales30DaysVelocityMap(shopId);
      if (Object.keys(velocityMap).length === 0) return;

      // High moving products (> 30 sold in last 30 days)
      const highMovingProductIds = Object.keys(velocityMap).filter(id => velocityMap[id] > 30);
      if (highMovingProductIds.length === 0) return;

      const products = await db.products.where('id').anyOf(highMovingProductIds).toArray();
      const ghosts: any[] = [];
      const threeDaysAgo = subDays(new Date(), 3).toISOString();

      for (const product of products) {
        if (product.stock > 0 && product.isDeleted === 0) {
          // Hasn't sold in 3 days? Check saleItems recently
          const recentItems = await db.saleItems
            .where('product_id')
            .equals(product.id || '')
            .filter(i => i.isDeleted === 0 && new Date(i.created_at) > new Date(threeDaysAgo))
            .first();

          if (!recentItems) {
            ghosts.push(product);
          }
        }
      }

      if (ghosts.length > 0) {
        await db.auditLogs.add({
          id: uuidv4(),
          shop_id: shopId,
          user_id: 'system',
          user_name: 'Mfumo',
          action: 'anomaly_ghost_items',
          details: {
            employee_name: 'Mfumo (System)',
            ghost_items: ghosts.map(g => g.name),
            warning: `Bidhaa hizi zinauzwa kwa wingi lakini zimekaa siku 3 bila rekodi yoyote ya mauzo ilhali zina stock: ${ghosts.map(g => g.name).join(', ')}`
          },
          isDeleted: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          synced: 0
        });
        
        // Let it sync normally during standard cycles
      }
    } catch (err) {
      console.error('Error checking ghost items:', err);
    }
  }

  static async logAction(action: AuditLog['action'], details: any) {
    const user = useStore.getState().user;
    if (!user?.shopId) return;

    if (user.role === 'boss') return;

    const currentHour = new Date().getHours();
    const isOffHours = currentHour >= 0 && currentHour < 6;
    
    // Only flag critical explicit actions, skip cascading anomalies to avoid infinite loops
    const explicitActions = ['add_product', 'edit_product', 'delete_product', 'delete_all_products', 'refund_sale', 'discounted_sale', 'app_opened', 'login'];
    if (isOffHours && explicitActions.includes(action)) {
      try {
        const settings = await db.settings.toCollection().last();
        if (!settings?.operate24Hours) {
           await db.auditLogs.add({
            id: crypto.randomUUID(),
            shop_id: user.shopId,
            user_id: user.id,
            user_name: user.name,
            action: 'anomaly_off_hours',
            details: {
              employee_name: user.name,
              trigger_action: action,
              warning: `Amefungua mfumo au kufanya mabadiliko nyeti (kama kuhariri, kufuta au kulog in) usiku wa manane. Muda huu kwa kawaida duka limefungwa.`
            },
            isDeleted: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            synced: 0,
          });
        }
      } catch (e) {
        console.error('Error logging off-hours anomaly', e);
      }
    }

    const logEntry = {
      id: crypto.randomUUID(),
      shop_id: user.shopId,
      user_id: user.id,
      user_name: user.name,
      action,
      details,
      isDeleted: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      synced: 0,
    };

    if (action === 'logout') {
      try {
        await db.auditLogs.add(logEntry);
        await this.flushAuditLogs();
      } catch (err) {
        console.warn('Logging logout immediately failed, buffering:', err);
        this.pendingAuditLogs.push(logEntry);
        await this.flushAuditLogs();
      }
    } else {
      this.pendingAuditLogs.push(logEntry);
      this.scheduleAuditLogFlush();
    }
  }

  static async toggleFeature(key: string, isEnabled: boolean) {
    const user = useStore.getState().user;
    if (!user?.shopId) return;

    const existing = await db.features.where('featureKey').equals(key).first();
    const now = new Date().toISOString();

    if (existing) {
      await db.features.update(existing.id, {
        shop_id: user.shopId,
        isEnabled,
        updated_at: now,
        synced: 0,
      });
    } else {
      await db.features.add({
        id: crypto.randomUUID(),
        shop_id: user.shopId,
        featureKey: key,
        isEnabled,
        updated_at: now,
        synced: 0,
      });
    }

    const currentFeatures = useStore.getState().features;
    useStore.getState().setFeatures({ ...currentFeatures, [key]: isEnabled });
    this.scheduleBackgroundSync();
  }
}
