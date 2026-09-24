import { isOpenCreditSale } from '../utils/debt';
import { db, AuditLog, registerLocalWriteTrigger } from '../db';
import { useStore } from '../store';
import { promoteLegacyStaffRestrictions } from './legacyRestrictions';
import { supabase, supabaseUrl, supabaseAnonKey } from '../supabase';
import { LicenseService } from './license';
import { TelemetryService } from './telemetry';
import { v4 as uuidv4 } from 'uuid';
import { subDays } from 'date-fns';
import { getSales30DaysVelocityMap } from '../utils/stock';
import { nowIso, syncClockWithServer, clockStatus } from './clock';
import { getHubConfig, syncWithHub, type HubSyncResult } from './hub';

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

/** When this device last finished a sync. Read by the sync screen and by the stock-count warning. */
const LAST_SYNC_SUCCESS_KEY = 'last_sync_success_at';

const SYNC_BATCH_SIZE = 100;
const PUSH_CHUNK_SIZE = 50;
const MAX_RETRIES = 3;

const CRITICAL_TABLES = ['sales', 'sale_items', 'products', 'debt_payments', 'assistant_chats'] as const;
const DELAYED_TABLES = ['shops', 'users', 'features'] as const;
const BACKGROUND_TABLES = ['audit_logs', 'expenses'] as const;
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

  /**
   * Problems already reported this session, keyed by what they are about. A
   * merge that oversold stock is re-detected on every pull until the shop
   * recounts, and one warning is enough.
   */
  private static anomalyReportedAt = new Map<string, number>();

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
    // The shop hub first, and on its own. It is on the shop's wifi and answers
    // in milliseconds, while the cloud half can wait a long time on an internet
    // that is not there. Queued behind that, a sale would not reach the next
    // phone until the internet came back — the one thing the hub is for.
    this.ensureHubLoop();
    const hub = this.hubCycle();

    // No network at all: nothing to do in the cloud.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await hub;
      return;
    }

    this.enqueueRequest(scope, force);
    if (!this.activeSyncPromise) {
      this.activeSyncPromise = this.drainQueue().finally(() => {
        this.activeSyncPromise = null;
      });
    }
    await Promise.all([hub, this.activeSyncPromise]);
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
      // Coalesce all enqueued requests to avoid running redundant sequential full/critical syncs.
      //
      // Coalescing must WIDEN the scope, never narrow it. 'critical' is the highest URGENCY but the
      // smallest COVERAGE (it pulls neither `features` nor the feature-map rebuild), so the old
      // "critical beats full" rule silently downgraded a queued 'full' into a 'critical' run and
      // then cleared the queue — discarding it rather than deferring it. That is why a staff
      // "Ruhusa" click often did nothing (yet still reported success) until clicked again.
      // 'full' is the only scope that is a superset of the others, and since neither 'critical' nor
      // 'background' contains the other, any mix of scopes also has to be promoted to 'full'.
      let force = false;
      for (const req of this.requestQueue) {
        force = force || req.force;
      }
      const scopes = new Set(this.requestQueue.map(r => r.scope));
      const targetScope: SyncScope = scopes.has('full') || scopes.size > 1
        ? 'full'
        : [...scopes][0];

      // Clear the queue as our consolidated run will handle all requested sync operations
      this.requestQueue = [];

      await this.runOneSync(force, targetScope);
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

      // 2. Let Supabase use its own internal storage first — it always holds the latest
      //    rotated refresh token. Using our backup token directly risks a "token already
      //    rotated" 400 if Supabase silently refreshed between syncs.
      try {
        const { data: internalRefresh } = await supabase.auth.refreshSession();
        if (internalRefresh?.session) {
          console.log('[SyncService] Auth healed via Supabase internal token.');
          localStorage.setItem('pos_token', internalRefresh.session.access_token);
          if (internalRefresh.session.refresh_token) {
            localStorage.setItem('pos_refresh_token', internalRefresh.session.refresh_token);
          }
          const currentUser = useStore.getState().user;
          if (currentUser) {
            useStore.getState().setAuth(internalRefresh.session.access_token, currentUser, internalRefresh.session.refresh_token);
          }
          return true;
        }
      } catch {}

      // 3. Fetch backup tokens from persistent localStorage
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

      // All recovery paths exhausted. Clear stale backup tokens so that when
      // Supabase fires the next SIGNED_OUT event (on the next sync attempt that
      // retries the refresh), the onAuthStateChange handler finds no pos_token
      // and correctly calls logout().
      // We do NOT call logout() here directly because we cannot distinguish
      // a dead auth token from a temporary network outage — wipeLocalData on
      // an offline user would destroy unsynced sales.
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_refresh_token');
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

    const state = useStore.getState();
    const user = state.user;
    const shopId = user?.shopId || user?.shop_id;
    if (!shopId) return;

    // ---- No internet behind the wifi? Stop here, in seconds. ---------------
    // The normal state of an offline shop is a router with nothing behind it,
    // which the browser still calls "online". Without this check the next step
    // — refreshing the login — waits on a request that goes nowhere, then every
    // push and pull after it does the same; every later sync, and logout, queue
    // behind them. The hub is not in this queue: sync() runs it on its own.
    if (!(await this.cloudReachable(force))) {
      console.log('[SyncService] Supabase unreachable — cloud sync skipped this round.');
      return;
    }

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

    // Learn the server's clock before anything is written or compared. Every
    // record carries `updated_at`, and when two devices have edited the same
    // row the later timestamp wins — so a phone with a wrong clock decides
    // conflicts it should lose. Only the very first measurement is waited for;
    // after that the offset is on disk and a refresh can happen in the
    // background. See services/clock.ts.
    if (clockStatus().measuredAt === null) {
      await syncClockWithServer().catch(() => false);
    } else {
      void syncClockWithServer().catch(() => false);
    }

    // Stamp the throttle only once the preconditions pass and this run is actually going ahead.
    // Stamping before them meant an attempt that did ZERO work (no shopId yet, or a transient
    // session failure right after login) still burned the 30s full-sync window, so the legitimate
    // retry seconds later was silently skipped — the same "looks like it ran, but didn't" failure
    // as the Ruhusa button. Safe against retry storms: sync() collapses concurrent callers into the
    // single in-flight promise and returns early when offline.
    const startedAt = Date.now();
    if (scope === 'critical') this.lastCriticalSyncStartedAt = startedAt;
    if (scope === 'background') this.lastBackgroundSyncStartedAt = startedAt;
    if (scope === 'full') this.lastFullSyncStartedAt = startedAt;

    const settings = await db.settings.get(1);
    await this.clearLegacyCursors(settings);

    try {
      console.log(`Starting ${scope} sync process...`);

      if (scope === 'full' || scope === 'background') {
        await this.runWithRetry(() => LicenseService.syncLicense(), 'syncLicense');
      }

      // Auto-prune cashier local ledger history to restrict data access to past sales
      await this.pruneOldTransactionDataForEmployees();

      const pushTargets = this.getPushTargets(scope, user.role);
      let anyPushed = false;
      for (const tableName of pushTargets) {
        const table = this.getTableRef(tableName);
        if (table) {
          const unsyncedCount = await table.where('synced').equals(0).count();
          if (unsyncedCount > 0) {
            await this.pushTable(tableName, table);
            anyPushed = true;
          }
        }
      }

      if (anyPushed) {
        // Heartbeat shortcut removed for 100% reliable multi-device sync
      }

      const pullTargets = this.getPullTargets(scope, user.role);
      // Incremental unless a full re-download can actually fix something.
      const refetch = force && scope === 'full' && this.shouldDeepResync();
      for (const tableName of pullTargets) {
        const lastSyncDate = this.getTableSyncDate(settings, tableName);
        await this.pullTable(tableName, this.getTableRef(tableName), shopId, lastSyncDate, force, refetch);
      }

      // Cashiers only: the 3-day cap above leaves older debts without their line
      // items. Runs after the sales pull, so it works from a current picture.
      const roleNow = useStore.getState().user?.role;
      const bossNow = roleNow === 'boss' || roleNow === 'admin' || roleNow === 'superadmin';
      if (!bossNow && pullTargets.includes('sale_items')) {
        await this.pullOpenDebtSaleItems(shopId);
      }

      if (scope !== 'critical') {
        await this.saveSettingsPatch({ lastSync: Date.now() });
      }

      if (scope === 'full' || scope === 'background') {
        // Scope to the active shop. The map is keyed by featureKey alone, so an unscoped read let a
        // previously logged-in shop's row overwrite this shop's flag (last one wins) — meaning the
        // Zaidi permission toggles could show and enforce the WRONG shop's settings.
        const allFeatures = await db.features.filter(f => f.shop_id === shopId).toArray();
        const featureMap: Record<string, boolean> = {};
        allFeatures.forEach(f => {
          featureMap[f.featureKey] = f.isEnabled;
        });
        useStore.getState().setFeatures(featureMap);

        // Right after the pull, and only here: the promotion must not create a
        // feature row before it can see whether the server already has one.
        // It is a no-op on every launch after the first.
        void promoteLegacyStaffRestrictions();
      }

      useStore.getState().setSyncHealth('healthy');
      // What "this device is up to date" means, for the sync screen and for the
      // warning shown when a stock count is typed on a device that is behind.
      try {
        localStorage.setItem(LAST_SYNC_SUCCESS_KEY, String(Date.now()));
      } catch {
        /* storage full or blocked: the screen falls back to "haijulikani" */
      }
      console.log(`${scope} sync completed successfully`);
    } catch (error) {
      useStore.getState().setSyncHealth('error');
      console.error(`${scope} sync failed:`, error);
    }
  }

  /**
   * Prune local sales and saleItem records older than 3 days when a cashier/non-boss of the same shop is logged in.
   * This reduces database disk size and completely protects past business metrics visually and architecturally.
   * NOTE: We retain pending debts (payment_method === 'credit' && status === 'pending') so cashiers can still see and collect them!
   */
  private static async pruneOldTransactionDataForEmployees() {
    try {
      const state = useStore.getState();
      const user = state.user;
      if (!user) return;

      const isBoss = user.role === 'admin' || user.role === 'superadmin' || user.role === 'boss';
      if (isBoss) return; // Boss looks at full records

      const shopId = user.shopId || user.shop_id;
      if (!shopId) return;

      // 3 days threshold
      const threeDaysAgoStr = subDays(new Date(), 3).toISOString();

      // Gather older local sales, excluding open debts.
      //
      // Scoped to the ACTIVE shop. `where('created_at').below(...)` walks the
      // whole table, so on a machine that has served more than one shop this was
      // deleting every shop's old sales, not just this one's — and the deletion
      // is local and permanent, so the other shop simply lost its history until
      // someone forced a full re-pull.
      //
      // isOpenCreditSale rather than a hand-written status test: an unpaid debt
      // whose status is missing must survive the prune, or the cashier loses the
      // record of money still owed.
      const oldSales = await db.sales
        .where('created_at')
        .below(threeDaysAgoStr)
        .filter(s => s.shop_id === shopId && !isOpenCreditSale(s))
        .toArray();

      if (oldSales.length === 0) return;

      const oldSaleIds = oldSales.map(s => s.id);

      // Perform a clean transaction to erase the records
      await db.transaction('rw', [db.sales, db.saleItems], async () => {
        await db.sales.where('id').anyOf(oldSaleIds).delete();
        await db.saleItems.where('sale_id').anyOf(oldSaleIds).delete();
      });

      console.log(`[SyncService] Secure local retention: Automatically pruned ${oldSales.length} old sales and matching items from cashier storage.`);
    } catch (err) {
      console.error('[SyncService] Failed to prune employee ledger table items:', err);
    }
  }

  /**
   * Pulls the line items of a cashier's OPEN DEBTS, whatever their age.
   *
   * The sale_items pull is capped at 3 days for cashiers, and PostgREST cannot
   * join back to sales, so a debt older than that arrived with no items — Madeni
   * listed the customer and the amount but showed nothing about what was bought,
   * which is exactly what a customer disputes at the counter.
   *
   * Driven from the sales already stored locally, so it costs one request only
   * when there are old debts whose items are missing.
   */
  private static async pullOpenDebtSaleItems(shopId: string) {
    try {
      const openDebts = await db.sales
        .where('[shop_id+isDeleted]')
        .equals([shopId, 0])
        .filter((s: any) => isOpenCreditSale(s))
        .toArray();
      if (!openDebts.length) return;

      const ids = openDebts.map((s: any) => s.id);
      const have = new Set(
        (await db.saleItems.where('sale_id').anyOf(ids).toArray()).map((i: any) => i.sale_id)
      );
      const missing = ids.filter((id: string) => !have.has(id));
      if (!missing.length) return;

      // Chunked: a shop can carry more open debts than one URL will hold.
      for (let i = 0; i < missing.length; i += 50) {
        const slice = missing.slice(i, i + 50);
        const rows = await this.runWithRetry<any[]>(
          () => supabase.from('sale_items').select('*').eq('shop_id', shopId).in('sale_id', slice),
          'pull sale_items for open debts'
        );
        if (!rows?.length) continue;
        await db.transaction('rw', db.saleItems, async () => {
          for (const record of rows) {
            const existing = await db.saleItems.get(record.id);
            // Never clobber a local row still waiting to be pushed.
            if (existing && existing.synced === 0) continue;
            await db.saleItems.put({ ...(existing || {}), ...this.mapToLocal('sale_items', record), synced: 1 });
          }
        });
      }
    } catch (e) {
      // Never fail a sync over this — the debt itself is already visible.
      console.warn('[SyncService] Could not backfill items for open debts:', e);
    }
  }

  private static getPushTargets(scope: SyncScope, role?: string): string[] {
    const isBoss = role === 'boss' || role === 'admin' || role === 'superadmin';

    if (scope === 'critical') return [...CRITICAL_TABLES];
    // Only a boss may WRITE feature flags. pushTable() already hard-blocks this for staff, but the
    // full scope below strips it too, so the background scope is made consistent rather than
    // handing staff a target that will only be dropped later. Pulling features stays open to
    // everyone, since staff still need to READ the permissions their boss set.
    if (scope === 'background') {
      return isBoss ? [...BACKGROUND_TABLES, 'features'] : [...BACKGROUND_TABLES];
    }

    const tables = [...ALL_TABLES];
    if (!isBoss) {
      return tables.filter(t => !['shops', 'users', 'features'].includes(t));
    }
    return tables as string[];
  }

  private static getPullTargets(scope: SyncScope, role?: string): string[] {
    const isBoss = role === 'boss' || role === 'admin' || role === 'superadmin';

    let targets: string[] = [];
    if (scope === 'critical') {
      targets = [...CRITICAL_TABLES];
    } else if (scope === 'background') {
      targets = [...BACKGROUND_TABLES, 'features'];
    } else {
      const tables = [...ALL_TABLES];
      if (!isBoss) {
        targets = tables.filter(t => !['users'].includes(t));
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

  /**
   * Set once a pull discovers whether the server has `server_updated_at`.
   * null = not yet known. Lets this build ship before the migration is run
   * without every pull failing on an unknown column.
   */
  private static serverCursorColumn: boolean | null = null;

  /** The column the incremental pull filters and orders on. */
  private static cursorColumn(): 'server_updated_at' | 'updated_at' {
    return this.serverCursorColumn === false ? 'updated_at' : 'server_updated_at';
  }

  /**
   * May a manual, forced full sync re-download history instead of pulling
   * only what changed?
   *
   * Only on the old `updated_at` fallback, where a row edited offline can sort
   * below the cursor and be skipped — there, re-downloading is the only repair.
   * With `server_updated_at` in place an incremental pull is complete, so a
   * re-download would fetch nothing new at great cost. Unknown (no pull has
   * run yet) is treated as "no". Even on the fallback it is capped at once a
   * day per device, so a habitual tap on "Sync" cannot turn into a habit of
   * downloading the whole shop.
   */
  private static shouldDeepResync(): boolean {
    if (this.serverCursorColumn !== false) return false;
    const KEY = 'last_deep_resync_at';
    try {
      const last = Number(localStorage.getItem(KEY) || 0);
      if (Date.now() - last < 24 * 60 * 60 * 1000) return false;
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      return false;
    }
    console.warn('[SyncService] Running the once-a-day full re-download: server_updated_at is missing. Run 20260901_server_sync_cursor.sql to make this unnecessary.');
    return true;
  }

  private static getCursorKey(tableName: string) {
    // Scoped to the shop, matching the mobile app.
    //
    // This used to be one global key per table, held in the `settings` row that
    // logout never clears. Every pull filters on `.gt('updated_at', cursor)`, so
    // that key was a high-water mark shared by every shop and every account the
    // machine had ever signed into — and it only ever moves forward. Anything
    // below it was never requested again: not next sync, not ever. One shop
    // switch, or one pull that advanced the mark while returning a partial set,
    // and that device silently stopped seeing its own history.
    //
    // Old unscoped keys need no migration: they no longer match any lookup, so
    // getTableSyncDate falls back to epoch and the next pull fetches everything.
    // They are swept up by clearLegacyCursors() purely to keep settings tidy.
    //
    // v2 namespace: the stored value changes MEANING with the server-cursor
    // migration — it used to be a device clock reading, it is now a server one —
    // and comparing an old client timestamp against the new column would skip
    // rows just as badly as the bug it replaces. A fresh key starts this machine
    // from epoch once, which is also what repairs a device already missing data.
    const user = useStore.getState().user;
    const shopId = user?.shopId || user?.shop_id || 'default';
    return `syncCursorV2_${shopId}_${tableName}`;
  }

  /**
   * Removes every v1 cursor key — both the original unscoped ones and the
   * shop-scoped generation that followed. `syncCursor_` is exactly the v1
   * prefix; the current keys begin `syncCursorV2_`, so they are not matched.
   * Runs once; harmless if repeated.
   */
  private static async clearLegacyCursors(settings: any) {
    if (!settings) return;
    const legacy = Object.keys(settings).filter((k) => k.startsWith('syncCursor_'));
    if (!legacy.length) return;
    const patch: Record<string, undefined> = {};
    for (const k of legacy) patch[k] = undefined;
    await this.saveSettingsPatch(patch);
    console.log(`[SyncService] Cleared ${legacy.length} legacy unscoped sync cursors.`);
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
    const isBoss = userRole === 'boss' || userRole === 'admin' || userRole === 'superadmin';

    if (!isBoss && ['shops', 'users', 'features'].includes(tableName)) return;

    let unsynced = await table.where('synced').equals(0).toArray();
    if (unsynced.length === 0) return;

    // Only ever push rows belonging to the ACTIVE shop. The local cache retains rows from every
    // shop this device has logged into, and every RLS policy resolves the caller's shop to the
    // single `users.shop_id` — so pushing another shop's row is guaranteed to be rejected (42501).
    // Filtered-out rows simply stay `synced: 0` and go up when the user switches back to that
    // shop; that is safe, whereas pushing them is not. Rows carrying no shop_id at all are left
    // alone rather than being stranded here forever.
    const currentUser = useStore.getState().user;
    const activeShopId = currentUser?.shopId || currentUser?.shop_id;
    if (activeShopId) {
      unsynced = unsynced.filter((record: any) => {
        // `shops` rows identify their shop by their own primary key, not a shop_id column.
        const owner = tableName === 'shops' ? record.id : record.shop_id;
        return owner === undefined || owner === null || owner === activeShopId;
      });
      if (unsynced.length === 0) return;
    }

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
      // ---- Claim each delta on disk BEFORE sending it ----------------------
      // Stock is additive on the server, so a delta that arrives twice is
      // counted twice — a shop that received 20 items sees 40. The server
      // de-duplicates by `delta_id`, but only if the client repeats the SAME id
      // and the SAME amount, and an in-memory note of that does not survive the
      // process being killed mid-request. So the claim is persisted first.
      //
      // A row that ALREADY carries a claim is a resend: something interrupted
      // the previous attempt. Re-send that exact claim rather than whatever the
      // delta has grown to since, or the server would recognise the id, skip the
      // whole thing, and silently swallow the stock added in between.
      const claims = new Map<string, { deltaId: string; amount: number }>();

      for (const record of unsynced) {
        const resuming = !!record.pending_delta_id;
        const claim = resuming
          ? { deltaId: record.pending_delta_id as string, amount: Number(record.pending_delta) || 0 }
          : { deltaId: uuidv4(), amount: record.stock_delta || 0 };

        claims.set(record.id, claim);
        this.inFlightProductDeltas.set(record.id, claim.amount);

        if (!resuming) {
          await table.update(record.id, {
            pending_delta_id: claim.deltaId,
            pending_delta: claim.amount,
          });
        }
      }

      try {
        const productsData = unsynced.map(record => {
          const claim = claims.get(record.id)!;
          const { synced, ...localData } = record;
          const dataToSync = this.mapToRemote(tableName, localData);
          // The claimed amount, not the current one: anything added since the
          // claim rides on the next push under a new id.
          dataToSync.stock_delta = claim.amount;
          dataToSync.delta_id = claim.deltaId;
          // A RECOUNT is not a difference. "The shelf has 12" typed on a device
          // that last synced days ago used to be sent as "+2" (12 minus the 10
          // it happened to remember), which lands as 32 if the truth is 30. So
          // the count travels with what it was counted from, and the server
          // sets the stock only if its own figure still matches that; otherwise
          // it falls back to the difference AND reports the clash, which is
          // what `conflicts` below turns into a warning for the shop.
          if (record.count_id && record.counted_stock != null && record.counted_base != null) {
            dataToSync.count_id = record.count_id;
            dataToSync.counted_stock = record.counted_stock;
            dataToSync.counted_base = record.counted_base;
            dataToSync.counted_delta = record.counted_delta ?? 0;
          }
          return dataToSync;
        });

        const rpcResult = await this.runWithRetry<any>(
          () => supabase.rpc('sync_products_with_deltas', { products_data: productsData }),
          'sync_products_with_deltas',
        );

        // Counts the server could not apply as typed, because another device
        // had already changed that product. Older servers return nothing here,
        // and the push is unaffected.
        const conflicts = Array.isArray(rpcResult?.count_conflicts) ? rpcResult.count_conflicts : [];
        for (const clash of conflicts) {
          const product = unsynced.find((r: any) => r.id === clash.product_id);
          const name = product?.name ?? 'bidhaa';
          // The figures travelled net of the delta that was in flight when the
          // shelf was counted (see db.ts), which is right for the arithmetic
          // and meaningless to a shopkeeper. Put it back, so the warning says
          // the number that was actually typed.
          const inFlight = Number(claims.get(clash.product_id)?.amount) || 0;
          const counted = Number(clash.counted_stock) + inFlight;
          const countedFrom = Number(clash.counted_base) + inFlight;
          const serverStock = Number(clash.server_stock) + inFlight;
          void this.logSyncAnomaly(
            'anomaly_stale_recount',
            {
              product_id: clash.product_id,
              product_name: name,
              counted,
              counted_from: countedFrom,
              server_stock: serverStock,
              warning: `Ulihesabu "${name}" kama ${counted}, lakini kifaa chako kilikuwa kimebaki nyuma — mfumo ulikuwa na ${serverStock}, siyo ${countedFrom}. Tofauti imetumika badala ya hesabu yako; hakiki salio la bidhaa hii.`,
            },
            `recount:${clash.product_id}:${clash.count_id ?? ''}`,
          );
        }

        // Products the server had never seen before this push. It creates
        // those from the absolute figure the device sent rather than building
        // them up from differences, so the delta and the count that travelled
        // with them were consumed by that one write.
        const inserted = new Set<string>(
          Array.isArray(rpcResult?.inserted) ? rpcResult.inserted.map((x: any) => String(x)) : [],
        );

        for (const record of unsynced) {
          const claim = claims.get(record.id)!;
          const current = await table.get(record.id);
          if (!current) continue;

          // Ordinarily: subtract only what was actually sent, so stock added
          // while the request was in flight stays queued and goes out next
          // time. Two cases are not ordinary.
          //
          //   created  the server wrote this device's absolute figure, so what
          //            is still owed is only what moved during the request.
          //            Subtracting the claim here would leave the row owing
          //            MINUS what it just sent, and the next push would take
          //            that much off the shop's stock for nothing.
          //   absorbed a shelf count was recorded while this claim was in
          //            flight. The count was written net of it (see db.ts) and
          //            the server lands on the counted figure once the claim is
          //            applied — so nothing further is owed for it.
          const created = inserted.has(String(record.id));
          const absorbed = current.counted_claim_id != null && current.counted_claim_id === claim.deltaId;
          const newDelta = created
            ? (Number(current.stock) || 0) - (Number(record.stock) || 0)
            : absorbed
              ? (current.stock_delta || 0)
              : (current.stock_delta || 0) - claim.amount;

          // The count has been answered — applied, overruled, or absorbed by
          // the row's creation. Clear it only if it is still the one that was
          // sent: a shelf counted while the request was in flight has not been
          // anywhere yet, and dropping it would lose both the figure and the
          // unsent changes it absorbed. The hub has its own copy of the count
          // and is not affected either way.
          const sentCount = (record.count_id ?? null) !== null
            && (record.count_id ?? null) === (current.count_id ?? null);
          // Still unsent if anything is left owed, or if a count arrived
          // while the request was in flight and has not travelled yet.
          const countStillOwed = Boolean(current.count_id) && !sentCount;
          await table.update(record.id, {
            sync_ack: Date.now(),
            synced: newDelta === 0 && !countStillOwed ? 1 : 0,
            stock_delta: newDelta,
            pending_delta_id: null,
            pending_delta: null,
            ...(sentCount
              ? { count_id: null, counted_stock: null, counted_base: null, counted_delta: null, counted_claim_id: null }
              : {}),
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
      let filteredBatch = [...batch];

      if (tableName === 'sale_items' || tableName === 'debt_payments') {
        const saleIds = Array.from(new Set(batch.map((r: any) => r.sale_id).filter(Boolean))) as string[];
        if (saleIds.length > 0) {
          try {
            const { data: existingSales, error } = await supabase
              .from('sales')
              .select('id')
              .in('id', saleIds);
              
            if (!error && existingSales) {
              const existingSaleIds = new Set(existingSales.map(s => s.id));
              const missingSaleIds = saleIds.filter(id => !existingSaleIds.has(id));
              
              if (missingSaleIds.length > 0) {
                console.warn(`[SyncService] Found orphan items for missing sales in Supabase! Missing sales:`, missingSaleIds);
                
                // Filter them out of the batch to prevent foreign key violation error!
                filteredBatch = batch.filter((r: any) => !missingSaleIds.includes(r.sale_id));
                
                // Mark the local orphans as synced: 1 so they don't block subsequent syncs
                const syncedRows = unsynced.slice(cursor, cursor + batch.length);
                for (const record of syncedRows) {
                  if (missingSaleIds.includes(record.sale_id)) {
                    console.log(`[SyncService] Auto-resolving local orphan item of table ${tableName} with ID ${record.id}`);
                    await table.update(record.id, { synced: 1 });
                  }
                }
              }
            }
          } catch (err) {
            console.error(`[SyncService] Failed to pre-verify parent sales for ${tableName}:`, err);
          }
        }
      }

      if (filteredBatch.length > 0) {
        try {
          if (tableName === 'audit_logs') {
            // Audit logs are append-only with a client-generated uuid. A plain .insert() is NOT
            // idempotent: if a batch reached Postgres but the response was lost (timeout, aborted
            // fetch, dropped connection), the row stays synced:0 locally and the next sync re-inserts
            // the same id → 23505 on audit_logs_pkey (a 409), which then repeats forever. upsert with
            // ignoreDuplicates compiles to INSERT ... ON CONFLICT DO NOTHING — it silently skips a row
            // that already exists, so the retry succeeds and clears. ignoreDuplicates matters here:
            // audit_logs has an INSERT policy but NO UPDATE policy, so a normal upsert's update branch
            // would be rejected by RLS. DO NOTHING never updates, so INSERT rights alone suffice.
            await this.runWithRetry(() => supabase.from(tableName).upsert(filteredBatch, { onConflict: 'id', ignoreDuplicates: true }), `push ${tableName}`);
          } else {
            // `features` is identified remotely by its UNIQUE (shop_id, feature_key) index, not by
            // id. Conflicting on 'id' makes a same-shop/same-key row that merely carries a different
            // uuid INSERT and trip features_shop_id_feature_key_key (23505). Targeting the real key
            // updates the existing row instead; we still send `id`, so the server adopts our uuid
            // and local and remote ids stay aligned for the id-keyed pull.
            const onConflict = tableName === 'features' ? 'shop_id,feature_key' : 'id';
            await this.runWithRetry(() => supabase.from(tableName).upsert(filteredBatch, { onConflict }), `push ${tableName}`);
          }
        } catch (error: any) {
          // An RLS/permission rejection is PERMANENT for this row, so retrying it forever wedges
          // the whole sync: the row never clears `synced: 0`, so every later run throws here again
          // and aborts before the remaining tables. Mark the batch synced locally and move on.
          const isPermError =
            error?.status === 403 ||
            error?.code === '42501' ||
            error?.code === 'PGRST301' ||
            (error?.message || '').toLowerCase().includes('row-level security') ||
            (error?.message || '').toLowerCase().includes('violates row-level security');

          if (!isPermError) throw error; // transient (timeout/disconnect) — retry next cycle

          console.warn(`[SyncService] Permanent RLS/permission block on ${tableName}. Auto-marking batch as synced locally to stop the egress/sync storm.`);
          const blockedRows = unsynced.slice(cursor, cursor + batch.length);
          for (const record of blockedRows) {
            await table.update(record.id, { synced: 1 });
          }
          cursor += batch.length;
          continue;
        }
      }

      const syncedRows = unsynced.slice(cursor, cursor + batch.length);
      for (const record of syncedRows) {
        const current = await table.get(record.id);
        if (current && current.synced === 0) {
          await table.update(record.id, { synced: 1 });
        }
      }
      cursor += batch.length;
    }
  }

  /**
   * `force` and `refetch` are deliberately separate.
   *
   *   force    run NOW: skip the per-table pull throttle. Still incremental —
   *            only rows newer than this shop's cursor are requested.
   *   refetch  ignore the cursor and download the table's ENTIRE history.
   *
   * They used to be one flag, so every "sync now" — the Sync button, toggling
   * a setting, and on Desktop and Invoice every single checkout — re-downloaded
   * the whole shop, 100 rows per request. A shop with 10,000 sales pulled
   * tens of thousands of rows to deliver one new one. On the free plan that is
   * the fastest way through the monthly egress allowance there is.
   */
  private static async pullTable(tableName: string, table: DexieTable, shopId: string, lastSyncDate: string, force: boolean, refetch = false) {
    // assistant_chats should only be pushed to, never pulled from remote Supabase DB to reduce egress/bandwidth
    if (tableName === 'assistant_chats') {
      return;
    }

    if (tableName === 'audit_logs') {
      const role = useStore.getState().user?.role;
      if (role !== 'boss' && role !== 'admin' && role !== 'superadmin') return;
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

      // Filtered and ordered on the SERVER's clock, not the device's. See
      // 20260901_server_sync_cursor.sql: `updated_at` is stamped by whichever
      // device made the edit, so a row typed offline at 10:00 and pushed at
      // 14:00 sorted below rows another device had already consumed — and was
      // never handed to it again.
      const cursorCol = this.cursorColumn();
      if (lastSyncDate && !refetch && tableName !== 'features') {
        query = query.gt(cursorCol, lastSyncDate);
      }

      // Cashiers pull only the last 3 days of history, to keep egress down.
      // Debts are the deliberate exception: however old, a cashier has to be able
      // to see who owes what and take the payment.
      //
      // `status.is.null` is part of that exception, not decoration. A legacy row,
      // or one written by an older client, can arrive without a status; matching
      // only `status.eq.pending` left those debts invisible to every cashier
      // while still being money owed.
      const userRole = useStore.getState().user?.role;
      const isBossRole = userRole === 'boss' || userRole === 'admin' || userRole === 'superadmin';
      if (!isBossRole) {
        const threeDaysAgo = subDays(new Date(), 3).toISOString();
        if (tableName === 'sales') {
          query = query.or(
            `created_at.gte.${threeDaysAgo},` +
            `and(payment_method.eq.credit,status.eq.pending),` +
            `and(payment_method.eq.credit,status.is.null)`
          );
        } else if (tableName === 'sale_items') {
          // Items for older debts cannot be expressed here — PostgREST cannot
          // join back to sales — so they are fetched separately, by sale id, in
          // pullOpenDebtSaleItems() once the sales pull has landed.
          query = query.gte('created_at', threeDaysAgo);
        }
      }

      query = query
        .order(cursorCol, { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + SYNC_BATCH_SIZE - 1);

      let data: any[];
      try {
        data = await this.runWithRetry(() => query, `pull ${tableName} offset ${offset}`);
        if (this.serverCursorColumn === null && cursorCol === 'server_updated_at') {
          this.serverCursorColumn = true;
        }
      } catch (error: any) {
        // This build can reach a machine before the migration reaches the
        // database. Postgres reports an unknown column as 42703; PostgREST also
        // names it in the message. Fall back to `updated_at` for the session
        // rather than failing every pull — the old, imperfect behaviour, which
        // is still far better than no sync at all.
        const missingColumn =
          cursorCol === 'server_updated_at' &&
          (error?.code === '42703' || /server_updated_at/i.test(error?.message || ''));
        if (missingColumn) {
          console.warn('[SyncService] server_updated_at not present yet — falling back to updated_at. Run 20260901_server_sync_cursor.sql.');
          this.serverCursorColumn = false;
          continue; // retry this same page with the old column
        }
        console.error(`Error pulling ${tableName} (offset ${offset}):`, error);
        return;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      // Stock below zero means the shop sold more than it had: two devices sold
      // the same items while they could not see each other, and the server —
      // which only adds up the differences it is sent — is right to show it.
      // No screen can use a negative shelf, so it is clamped to zero, but
      // clamping SILENTLY is how an oversell disappears and a shop is left with
      // a figure it cannot trust. Clamp AND say so.
      //
      // Collected, not written, while inside the transaction below: that
      // transaction is scoped to ONE table, so writing the audit row there
      // throws and the warning would be swallowed by its own catch.
      const oversold: { id: string; name: string; short: number; serverStock: number }[] = [];
      const clampStock = (value: any, name: string, id: string): any => {
        const n = Number(value);
        if (!Number.isFinite(n) || n >= -0.0001) return value;
        oversold.push({ id, name, short: Math.round(Math.abs(n) * 100) / 100, serverStock: n });
        return 0;
      };

      await db.transaction('rw', table as any, async () => {
        for (const record of data) {
          const localData = this.mapToLocal(tableName, record);
          const existing = await table.get(record.id);

          // The watermark must come from the SAME column the filter uses, or the
          // next pull compares two different clocks against each other.
          const cursorValue = record[cursorCol] ?? record.updated_at;
          const remoteUpdatedAtMs = cursorValue ? new Date(cursorValue).getTime() : 0;
          if (remoteUpdatedAtMs > newestRemoteCursorMs) {
            newestRemoteCursorMs = remoteUpdatedAtMs;
            newestRemoteCursorStr = cursorValue;
          } else if (remoteUpdatedAtMs === newestRemoteCursorMs && cursorValue) {
            // Same instant: keep the lexicographically greatest string so
            // sub-millisecond precision is not lost. cursorValue, not
            // record.updated_at — mixing the two clocks here would poison the
            // watermark just as thoroughly as the bug being fixed.
            if (!newestRemoteCursorStr || cursorValue > newestRemoteCursorStr) {
               newestRemoteCursorStr = cursorValue;
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
            // Owed to the hub: it has not seen this row, and on a shop with no
            // internet the hub is how the other devices will.
            const dataToStore: any = { ...localData, synced: 1, hub_synced: 0, sync_ack: Date.now() };
            if (tableName === 'products') {
              dataToStore.stock = clampStock(dataToStore.stock, dataToStore.name, record.id);
              dataToStore.stock_delta = localData.stock_delta || 0;
              if (dataToStore.track_stock === undefined) {
                dataToStore.track_stock = true;
              }
            }
            await table.put(dataToStore);
            continue;
          }

          // An incremental pull only returns rows the SERVER has changed since
          // this device's cursor, so when nothing local is unsynced the local
          // row is merely a cached copy of that — the server's version wins
          // even if its timestamp looks older.
          //
          // Which it can: the first time a device's clock is corrected, its
          // LATER edits carry EARLIER timestamps than the future-dated rows it
          // pushed while the clock was wrong. Gating on the timestamp there
          // would leave every other device stale for as long as the clock had
          // been out — hours, or days.
          if (isRemoteNewer || !hasUnsyncedChanges) {
            if (tableName === 'products' && hasUnsyncedChanges) {
              const pendingDelta = existing.stock_delta || 0;
              // Prefer the claim persisted on the row: unlike the in-memory map
              // it survives a restart, so a pull that runs after an interrupted
              // push still knows which slice of the delta the server already has.
              const inFlightDelta = existing.pending_delta != null
                ? Number(existing.pending_delta) || 0
                : SyncService.inFlightProductDeltas.get(record.id) || 0;
              const netDelta = pendingDelta - inFlightDelta;
              const remoteStock = Number(record.stock) || 0;
              const rawMerged = remoteStock + netDelta;
              const mergedStock = Math.max(0, rawMerged);

              // Same situation, reached the other way: this device still has
              // sales of its own queued when the server's figure arrives.
              if (rawMerged < -0.0001) clampStock(rawMerged, existing.name, record.id);

              // Local row has unsynced edits (e.g. offline name/price/min_stock/batch
              // changes). Keep ALL local fields so they aren't clobbered by the remote
              // copy; only reconcile stock via deltas so concurrent remote sales aren't
              // lost. The row stays synced:0 so the local edits go up next cycle, and a
              // later pull brings whatever else changed remotely.
              //
              // Spreading `localData` here instead — as this app used to — silently
              // replaced the price typed on this device with the server's, and then
              // pushed the server's value back up as if the user had chosen it.
              await table.put({
                ...existing,
                stock: mergedStock,
                stock_delta: pendingDelta,
                synced: 0,
                sync_ack: Date.now(),
                // What the server moved has to reach the hub too.
                ...this.hubCountPatch(existing, mergedStock),
              });
            } else if (!hasUnsyncedChanges) {
              const dataToStore: any = { ...existing, ...localData, synced: 1, hub_synced: 0, sync_ack: Date.now() };
              if (tableName === 'products') {
                dataToStore.stock = clampStock(dataToStore.stock, dataToStore.name ?? existing.name, record.id);
                Object.assign(dataToStore, this.hubCountPatch(existing, dataToStore.stock));
              }
              await table.put(dataToStore);
            }
          }
        }
      });

      for (const o of oversold) {
        await this.logSyncAnomaly(
          'anomaly_stock_oversold',
          {
            product_id: o.id,
            product_name: o.name,
            shortfall: o.short,
            server_stock: o.serverStock,
            warning: `Bidhaa "${o.name}" imeuzwa zaidi ya iliyokuwepo (pungufu ${o.short}). Vifaa viwili viliuza wakati havijasawazishana. Salio limewekwa 0 — tafadhali hesabu upya.`,
          },
          `oversold:${o.id}`,
        );
      }
      oversold.length = 0;

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
    // Local delta bookkeeping. `delta_id` is re-attached by the products push
    // (it is what the server de-duplicates on); these two never leave the device.
    delete mapped.pending_delta_id;
    delete mapped.pending_delta;
    // Re-attached by the products push, which is the only place they mean
    // anything; on every other table they do not exist at all.
    delete mapped.hub_synced;
    delete mapped.hub_delta;
    delete mapped.hub_pending_delta;
    delete mapped.hub_pending_id;
    delete mapped.hub_counted_delta;
    delete mapped.hub_count_id;
    delete mapped.hub_counted_stock;
    delete mapped.hub_counted_base;
    delete mapped.hub_counted_claim_id;
    delete mapped.counted_claim_id;
    delete mapped.sync_ack;
    delete mapped.count_id;
    delete mapped.counted_stock;
    delete mapped.counted_base;
    delete mapped.counted_delta;
    // Server-owned. The trigger overwrites whatever arrives, so sending it back
    // is merely pointless — but a client that could set it would be able to hide
    // its own rows below other devices' watermarks, which is the whole bug this
    // column exists to end.
    delete mapped.server_updated_at;

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

    if (tableName === 'shops') {
      if ('enable_stock' in mapped) {
        mapped.enable_stock = mapped.enable_stock === true || mapped.enable_stock === 1 || mapped.enable_stock === 'true';
      }
      if ('enable_expiry' in mapped) {
        mapped.enable_expiry = mapped.enable_expiry === true || mapped.enable_expiry === 1 || mapped.enable_expiry === 'true';
      }
    }

    if (tableName === 'products') {
      if ('track_stock' in mapped) {
        if (mapped.track_stock === null || mapped.track_stock === undefined) {
          delete mapped.track_stock;
        } else {
          mapped.track_stock = mapped.track_stock === true || mapped.track_stock === 1 || mapped.track_stock === 'true';
        }
      }
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
          created_at: nowIso(),
          updated_at: nowIso(),
          synced: 0
        });
        
        // Let it sync normally during standard cycles
      }
    } catch (err) {
      console.error('Error checking ghost items:', err);
    }
  }

  /**
   * A problem the SYNC found, rather than something a person did.
   *
   * Written straight to the log instead of through logAction, which drops the
   * boss's own actions: an oversell or a clashing recount is exactly what the
   * boss needs to see, and in a one-phone shop the boss is the only person
   * there. `key` collapses repeats — the same clash is re-detected on every
   * pull until the shop recounts.
   */
  static async logSyncAnomaly(
    action: AuditLog['action'],
    details: any,
    key?: string,
    cooldownMs = 6 * 60 * 60 * 1000,
  ): Promise<void> {
    const user = useStore.getState().user;
    if (!user?.shopId) return;

    if (key) {
      const last = this.anomalyReportedAt.get(key) ?? 0;
      if (Date.now() - last < cooldownMs) return;
      this.anomalyReportedAt.set(key, Date.now());
    }

    try {
      await db.auditLogs.add({
        id: crypto.randomUUID(),
        shop_id: user.shopId,
        user_id: user.id || '',
        user_name: user.name,
        action,
        details,
        isDeleted: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
        synced: 0,
      });
    } catch (err) {
      console.warn('[SyncService] could not record sync anomaly', err);
    }
  }

  /**
   * One exchange with the hub, plus what it may bring back: a licence another
   * device verified online, for a device that cannot. Never throws — a hub
   * that is switched off is a normal state, not an error.
   */
  private static async hubCycle(): Promise<HubSyncResult | null> {
    if (!getHubConfig()) return null;
    let result: HubSyncResult | null = null;
    try {
      result = await this.runHubSync();
    } catch (err) {
      console.warn('[SyncService] hub sync failed:', err);
      return null;
    }
    if (result?.licence) {
      try {
        await LicenseService.acceptVouchedLicense(result.licence);
      } catch (err) {
        console.warn('[SyncService] could not accept the hub licence:', err);
      }
    }
    return result;
  }

  /**
   * How often an open app talks to the hub on its own, sale or no sale — so a
   * till that is only being looked at still shows a phone's sale within
   * seconds. On the shop's wifi one exchange costs a few milliseconds.
   */
  private static readonly HUB_LOOP_MS = 15_000;
  private static hubLoop: ReturnType<typeof setInterval> | null = null;

  static ensureHubLoop(): void {
    if (this.hubLoop || typeof setInterval !== 'function') return;
    // The device says its network came back: forget any "no internet" verdict.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => { this.cloudProbe = null; });
    }
    this.hubLoop = setInterval(() => {
      if (!getHubConfig() || !useStore.getState().user?.shopId) return;
      void this.hubCycle();
    }, this.HUB_LOOP_MS);
  }

  /** How long to wait for Supabase to answer at all before calling it unreachable. */
  private static readonly CLOUD_PROBE_TIMEOUT_MS = 6_000;
  /** A verdict is reused this long, so a burst of syncs costs one probe. */
  private static readonly CLOUD_PROBE_REUSE_MS = 15_000;
  private static cloudProbe: { at: number; ok: boolean } | null = null;

  /**
   * Can this device reach Supabase right now? One small request with a short
   * deadline, asked before the cloud half of a sync starts. Any answer from the
   * server — even an error status — means the internet is there.
   */
  static async cloudReachable(fresh = false): Promise<boolean> {
    // A sync someone asked for — the button, a sale, logout — always asks
    // afresh: the internet may have come back a second ago.
    const now = Date.now();
    if (!fresh && this.cloudProbe && now - this.cloudProbe.at < this.CLOUD_PROBE_REUSE_MS) return this.cloudProbe.ok;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.CLOUD_PROBE_TIMEOUT_MS);
    let ok = false;
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: { apikey: supabaseAnonKey },
        cache: 'no-store',
        signal: controller.signal,
      });
      ok = res.status > 0;
    } catch {
      ok = false;
    } finally {
      clearTimeout(timer);
    }
    this.cloudProbe = { at: Date.now(), ok };
    return ok;
  }

  /**
   * The last sync before signing out, with a deadline: long enough to hand
   * this shift's work to the hub or the cloud when either is there, never long
   * enough to hold the door when neither is. Whatever does not make it stays
   * on this device and goes out with the next sync.
   */
  static async syncBeforeLogout(budgetMs = 12_000): Promise<void> {
    await Promise.race([
      this.sync(true, 'full').catch(err => console.warn('[SyncService] last sync before logout failed:', err)),
      new Promise<void>(resolve => setTimeout(resolve, budgetMs)),
    ]);
  }

  /**
   * Records that exist on this device and nowhere else — sent to neither the
   * cloud nor the shop hub. Sales, expenses, debt payments, and the audit
   * entries a boss would want (not the routine login/logout ones). A sale's
   * items travel with it and are not counted separately.
   */
  static async countUnsentAnywhere(): Promise<number> {
    // A row the hub has confirmed stays safe there, whether or not this device
    // is still joined to it — another device relays it to the cloud.
    const unsent = (r: any) => r.hub_synced !== 1;
    const ROUTINE = new Set(['login', 'logout', 'app_opened']);
    let total = 0;
    for (const name of ['sales', 'expenses', 'debtPayments', 'auditLogs']) {
      const table = (db as any)[name];
      if (!table) continue;
      try {
        total += await table.where('synced').equals(0)
          .filter((r: any) => unsent(r) && !(name === 'auditLogs' && ROUTINE.has(r.action)))
          .count();
      } catch {
        /* a table this app does not have */
      }
    }
    return total;
  }

  /**
   * One exchange with the shop hub, if this shop has one.
   *
   * Runs on every cycle, whether or not the internet is there — that is the
   * point of it. When both are reachable this device is the relay: rows from
   * the hub are written `synced: 0` so the next cloud push carries them up,
   * and rows from the cloud are written `hub_synced: 0` so the next hub push
   * carries them down to the phones that cannot reach Supabase themselves.
   */
  static async runHubSync(): Promise<HubSyncResult | null> {
    if (!getHubConfig()) return null;
    // One at a time. A write triggers its own sync half a second later, so an
    // exchange started by hand can overlap with one started by a sale — and two
    // runs sharing one delta accumulator subtract it twice.
    if (this.hubSyncPromise) return this.hubSyncPromise;
    this.hubSyncPromise = this.doHubSync().finally(() => { this.hubSyncPromise = null; });
    return this.hubSyncPromise;
  }

  private static hubSyncPromise: Promise<HubSyncResult | null> | null = null;

  private static async doHubSync(): Promise<HubSyncResult | null> {
    const result = await syncWithHub(async (dexieTable, rows) => this.applyHubRows(dexieTable, rows));

    for (const clash of result.conflicts ?? []) {
      const product = await db.products.get(clash.product_id);
      const name = product?.name ?? 'bidhaa';
      await this.logSyncAnomaly(
        'anomaly_stale_recount',
        {
          product_id: clash.product_id,
          product_name: name,
          counted: clash.counted_stock,
          counted_from: clash.counted_base,
          server_stock: clash.server_stock,
          warning: `Ulihesabu "${name}" kama ${clash.counted_stock}, lakini kituo cha duka kilikuwa na ${clash.server_stock}. Tofauti imetumika badala ya hesabu yako; hakiki salio la bidhaa hii.`,
        },
        `recount-hub:${clash.product_id}:${clash.count_id ?? ''}`,
      );
    }

    return result;
  }

  /**
   * Write what the hub sent.
   *
   * Stock needs care, because the hub's figure is the shop's truth while the
   * cloud's is not: it already contains every device's sales, including a
   * phone that has never reached the internet. So the new stock is the hub's
   * plus whatever this device has not sent the hub yet — and the difference
   * the hub brought is attached to the row as a COUNT, so this device's next
   * cloud push carries the other phones' stock up with it. Without that, the
   * cloud would receive their SALES but never their stock, and drift.
   */
  /**
   * Stock that arrived from the CLOUD has to reach the hub as well, or the
   * devices with no internet never learn of it — a sale rung up on the phone
   * that has signal, or on the till, would simply not exist for the rest of
   * the shop.
   *
   * It cannot travel as a difference: this device did not make the change and
   * owes nothing for it. So it travels the way a shelf count does — an
   * absolute figure, with what this device believes the hub holds, which the
   * hub applies only if it still agrees. The mirror image of the count
   * `applyHubRows` makes for the cloud.
   */
  private static hubCountPatch(existing: any, nextStock: number): any {
    const moved = nextStock - (Number(existing?.stock) || 0);
    if (!existing || Math.abs(moved) < 0.0001) return {};

    if (existing.hub_count_id && existing.hub_counted_stock != null) {
      // A count still waiting to reach the hub carries the changes it
      // absorbed. Fold the movement into it rather than replacing it.
      return {
        hub_synced: 0,
        hub_counted_stock: (Number(existing.hub_counted_stock) || 0) + moved,
      };
    }

    const owedToHub = Number(existing.hub_delta) || 0;
    return {
      hub_synced: 0,
      hub_count_id: `cloud-${existing.id}-${Date.now()}`,
      hub_counted_stock: nextStock - owedToHub,
      hub_counted_base: (Number(existing.stock) || 0) - owedToHub,
      hub_counted_delta: 0,
      hub_counted_claim_id: null,
    };
  }

  private static async applyHubRows(dexieTable: string, rows: any[]): Promise<number> {
    const table = (db as any)[dexieTable];
    if (!table || !rows.length) return 0;
    let applied = 0;

    for (const row of rows) {
      const { hub_seq, hub_from, ...incoming } = row;
      const existing = await table.get(incoming.id);

      if (!existing) {
        await table.put({ ...incoming, synced: 0, hub_synced: 1, sync_ack: Date.now(), ...(dexieTable === 'products' ? { stock_delta: 0, hub_delta: 0 } : {}) });
        applied++;
        continue;
      }

      // Last write wins on the same corrected clock the cloud path uses.
      const mine = String(existing.updated_at ?? '');
      const theirs = String(incoming.updated_at ?? '');
      const takeFields = theirs >= mine;

      if (dexieTable !== 'products') {
        if (!takeFields) continue;
        await table.put({ ...existing, ...incoming, synced: 0, hub_synced: 1, sync_ack: Date.now() });
        applied++;
        continue;
      }

      // A claim left in flight by an interrupted push is already on its way to
      // the hub, so it must not be counted on top of what the hub reports.
      const inFlight = Number(existing.hub_pending_delta) || 0;
      const owedToHub = (Number(existing.hub_delta) || 0) - inFlight;
      const owedToCloud = Number(existing.stock_delta) || 0;
      const hubStock = Number(incoming.stock) || 0;
      const nextStock = hubStock + owedToHub;
      const moved = nextStock - (Number(existing.stock) || 0);

      const patch: any = takeFields ? { ...existing, ...incoming } : { ...existing };
      patch.sync_ack = Date.now();
      patch.stock = Math.max(0, nextStock);
      patch.stock_delta = owedToCloud;
      patch.hub_delta = owedToHub;
      patch.hub_synced = owedToHub === 0 ? 1 : 0;
      patch.synced = 0;

      if (Math.abs(moved) > 0.0001) {
        if (existing.count_id && existing.counted_stock != null) {
          // A shelf count this device has not managed to send the cloud yet
          // still has to get there, and it carries the unsent changes it
          // absorbed. Replacing it would lose both, so what the hub reports is
          // folded INTO it: the same movement added to the figure the count
          // asks the cloud to end on.
          patch.count_id = existing.count_id;
          patch.counted_stock = (Number(existing.counted_stock) || 0) + moved;
          patch.counted_base = existing.counted_base;
          patch.counted_delta = existing.counted_delta ?? 0;
          patch.counted_claim_id = existing.counted_claim_id ?? null;
        } else {
          // What the cloud should end up with, and what this device believes
          // the cloud has now. Its own pending delta is sent separately and
          // lands on top, so it is excluded from both.
          patch.count_id = `hub-${incoming.id}-${hub_seq}`;
          patch.counted_stock = Math.max(0, nextStock - owedToCloud);
          patch.counted_base = Math.max(0, (Number(existing.stock) || 0) - owedToCloud);
          patch.counted_delta = 0;
          patch.counted_claim_id = null;
        }
      }

      await table.put(patch);
      applied++;
    }

    return applied;
  }

  /** When this device last completed a sync, or null if it never has. */
  static getLastSyncAt(): number | null {
    try {
      const raw = localStorage.getItem(LAST_SYNC_SUCCESS_KEY);
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  /** Rows still waiting to go up, per table — what "not yet synced" really is. */
  static async getPendingCounts(): Promise<{ total: number; byTable: Record<string, number> }> {
    const byTable: Record<string, number> = {};
    let total = 0;
    for (const tableName of ALL_TABLES) {
      const table = this.getTableRef(tableName);
      if (!table) continue;
      try {
        const count = await table.where('synced').equals(0).count();
        if (count > 0) {
          byTable[tableName] = count;
          total += count;
        }
      } catch {
        /* a table that does not exist on this app */
      }
    }
    return { total, byTable };
  }

  static async logAction(action: AuditLog['action'], details: any) {
    const user = useStore.getState().user;
    const shopId = user?.shopId || user?.shop_id;
    if (!shopId) return;

    const isBoss = user.role === 'boss' || user.role === 'admin' || user.role === 'superadmin';
    if (isBoss) return;

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
            shop_id: shopId,
            user_id: user.id,
            user_name: user.name,
            action: 'anomaly_off_hours',
            details: {
              employee_name: user.name,
              trigger_action: action,
              warning: `Amefungua mfumo au kufanya mabadiliko nyeti (kama kuhariri, kufuta au kulog in) usiku wa manane. Muda huu kwa kawaida duka limefungwa.`
            },
            isDeleted: 0,
            created_at: nowIso(),
            updated_at: nowIso(),
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
      created_at: nowIso(),
      updated_at: nowIso(),
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

  /**
   * Targeted refresh of the `features` table and the in-memory permission map.
   *
   * Backs the staff-facing "Ruhusa" button. That used to run sync(true, 'full'), which pulls
   * products, sales, sale_items, expenses, audit_logs, debt_payments and shops purely to refresh a
   * handful of booleans — slow for the user and needless Supabase egress. This reads one small
   * table scoped to the shop.
   *
   * Errors are deliberately allowed to propagate so the caller can report a genuine failure;
   * pullTable() swallows pull errors internally, which would let the button claim success after a
   * failed refresh.
   */
  static async refreshFeatures(): Promise<void> {
    const user = useStore.getState().user;
    const shopId = user?.shopId || user?.shop_id;
    if (!shopId) return;

    const isSessionValid = await this.ensureSessionValid();
    if (!isSessionValid) throw new Error('Supabase session could not be established');

    const { data, error } = await supabase
      .from('features')
      .select('*')
      .eq('shop_id', shopId);
    if (error) throw error;

    await db.transaction('rw', db.features, async () => {
      for (const record of data || []) {
        const localData = this.mapToLocal('features', record);
        const existing = await db.features.get(record.id);
        // Never clobber a local row with unsynced edits — that would be a boss mid-toggle whose
        // change hasn't been pushed yet.
        if (existing && existing.synced === 0) continue;
        await db.features.put({ ...(existing || {}), ...localData, synced: 1 });
      }
    });

    const allFeatures = await db.features.filter(f => f.shop_id === shopId).toArray();
    const featureMap: Record<string, boolean> = {};
    allFeatures.forEach(f => {
      featureMap[f.featureKey] = f.isEnabled;
    });
    useStore.getState().setFeatures(featureMap);
  }

  static async toggleFeature(key: string, isEnabled: boolean) {
    const user = useStore.getState().user;
    const shopId = user?.shopId || user?.shop_id;
    if (!shopId) return;

    // Scope by shop as well as key. Matching on featureKey alone let a multi-shop boss pick up
    // ANOTHER shop's row and rewrite its shop_id — which both collides with the target shop's own
    // row (23505) and pushes a cross-shop UPDATE that RLS rejects (42501).
    const matches = await db.features
      .where('featureKey').equals(key)
      .filter(f => f.shop_id === shopId)
      .toArray();
    const existing = matches[0];
    const now = nowIso();

    if (existing) {
      // shop_id is deliberately NOT rewritten here — the row already belongs to this shop.
      await db.features.update(existing.id, {
        isEnabled,
        updated_at: now,
        synced: 0,
      });
      // Heal any duplicate local rows for this shop+key left behind by the old unscoped lookup.
      for (const dupe of matches.slice(1)) {
        await db.features.delete(dupe.id);
      }
    } else {
      await db.features.add({
        id: crypto.randomUUID(),
        shop_id: shopId,
        featureKey: key,
        isEnabled,
        updated_at: now,
        synced: 0,
      });
    }

    const currentFeatures = useStore.getState().features;
    useStore.getState().setFeatures({ ...currentFeatures, [key]: isEnabled });

    // Push this ONE row with a direct upsert instead of going through sync(). scheduleBackgroundSync()
    // debounced 5 minutes (and runOneSync throttled the background scope another 10), so a toggle
    // could sit unsynced for 5-15 minutes — or forever if the boss closed the app. But routing it
    // through sync(true, 'background') was still slow: it queues behind any in-flight run, then
    // awaits ensureSessionValid() and LicenseService.syncLicense(), then pushes audit_logs and
    // expenses, and only then reaches `features` — several round trips for a single row.
    // pushTable() performs just the one upsert (with the shop filter and the (shop_id, feature_key)
    // conflict target) and marks the row synced. On failure the row simply stays synced:0 and the
    // next regular sync retries it, so nothing is lost.
    if (typeof navigator === 'undefined' || navigator.onLine) {
      void this.pushTable('features', db.features).catch(err => {
        console.warn('[SyncService] Immediate features push failed; will retry on the next sync.', err);
      });
    }
  }
}
