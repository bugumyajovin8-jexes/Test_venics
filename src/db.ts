import Dexie, { type Table } from 'dexie';
import { decrypt } from './utils/encryption';

export interface Shop {
  id: string;
  name: string;
  owner_name: string;
  phone?: string;
  whatsapp_phone?: string;
  status?: 'active' | 'blocked';
  enable_expiry?: boolean;
  enable_stock?: boolean;
  notify_expiry_days?: number; // shop-wide "warn me N days before expiry" window (default 30)
  created_by: string;
  created_at: string;
  updated_at: string;
  isDeleted: number;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface User {
  id: string;
  shop_id?: string;
  shopId?: string; // Alias for compatibility
  email: string;
  name: string;
  phone?: string;
  role: 'superadmin' | 'admin' | 'employee' | 'staff' | 'boss' | 'manager' | 'cashier'; // Expanded roles to match schema
  status: 'active' | 'blocked';
  isActive?: boolean; // Alias for compatibility
  last_seen?: string;
  is_deleted?: boolean; // Remote field
  fcm_token?: string; // For push notifications
  isDeleted: number;
  created_at: string;
  updated_at: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface Product {
  id: string;
  shop_id: string;
  name: string;
  buy_price: number;
  sell_price: number;
  stock: number;
  min_stock: number;
  unit: string;
  batches: {
    id: string;
    batch_number: string;
    expiry_date: string;
    stock: number;
  }[];
  notify_expiry_days?: number;
  stock_delta: number;
  /**
   * The delta currently being pushed, claimed on disk BEFORE the request goes
   * out and cleared only once the server has confirmed it.
   *
   * Exists because `stock_delta` is additive on the server and the local "I have
   * consumed this" bookkeeping happens in a separate write afterwards. If the
   * app is closed or killed in between, the delta is still pending on next
   * launch and gets sent again. The server de-duplicates by `delta_id`, so a
   * resend is harmless — but it can only match if the client repeats the SAME
   * id and the SAME amount, which is what these two fields preserve.
   *
   * Any stock added after the claim keeps accumulating in `stock_delta` and goes
   * out under a fresh id on the next push, so nothing is lost either way.
   *
   * Not indexed, so no Dexie version bump is required.
   */
  pending_delta_id?: string | null;
  pending_delta?: number | null;
  /**
   * A RECOUNT waiting to be sent: what was counted on the shelf, what this
   * device believed at that moment, and the unsent changes the count already
   * contains (it counted the shelf AFTER them).
   *
   * Stock travels as a difference, which is right for a sale or a delivery and
   * wrong for a count: "the shelf has 12", typed on a device that last synced
   * days ago, used to be sent as "+2" and landed as 32 where the truth was 30.
   * With the base attached, the server can set the stock outright when its own
   * figure still matches — and say so when it does not.
   *
   * Local only: the products push attaches them and clears them once answered.
   * Not indexed, so no Dexie version bump is required.
   */
  /**
   * The stock change still owed to the SHOP HUB, kept apart from `stock_delta`
   * (owed to the cloud) so that whichever path sends first cannot consume what
   * the other has not seen. Maintained by the hooks in this file.
   */
  hub_delta?: number | null;
  /**
   * The hub delta currently in flight, claimed on disk before the request goes
   * out — the same discipline `pending_delta` applies to the cloud, and for the
   * same reason: the "I have sent this" bookkeeping happens in a separate write
   * afterwards, and anything that interrupts the two leaves the delta owed.
   */
  hub_pending_delta?: number | null;
  hub_pending_id?: string | null;
  /**
   * The hub's OWN copy of a shelf count.
   *
   * A count is an absolute figure — "the shelf has 12" — and each sync path
   * has to be told it separately, because what this device still owes the
   * cloud is not what it owes the hub. Sending one count with the other
   * path's arithmetic lands the stock twice, or not at all.
   */
  hub_count_id?: string | null;
  hub_counted_stock?: number | null;
  hub_counted_base?: number | null;
  hub_counted_delta?: number | null;
  /**
   * The delta already in flight when the shelf was counted, per path.
   *
   * The count is recorded net of it: that claim is on its way under its own
   * id and lands on top of the count, so the count must not carry it a second
   * time. Once it does land, the device owes nothing more for it — which is
   * why the sync services do not subtract it again when this matches.
   */
  counted_claim_id?: string | null;
  hub_counted_claim_id?: string | null;
  count_id?: string | null;
  counted_stock?: number | null;
  counted_base?: number | null;
  /**
   * The unsent stock changes the count already contains — it counted the shelf
   * AFTER them. Sent so the server can work out what this device would have
   * seen had it been up to date, and reset to 0 at the moment of counting so
   * anything sold afterwards is an ordinary delta again.
   */
  counted_delta?: number | null;
  track_stock?: boolean;
  catalog_id?: string; // origin id from catalog_products when imported from the global catalog
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface Sale {
  id: string;
  shop_id: string;
  user_id: string;
  total_amount: number;
  total_profit: number;
  is_credit: boolean;
  is_paid: boolean;
  payment_method: 'cash' | 'mobile_money' | 'credit' | 'mobile' | 'card';
  status: 'completed' | 'cancelled' | 'refunded' | 'pending';
  customer_name?: string;
  customer_phone?: string;
  due_date?: string;
  date: string;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  shop_id: string;
  product_id: string;
  product_name: string;
  qty: number;
  buy_price: number;
  sell_price: number;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at?: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface Expense {
  id: string;
  shop_id: string;
  user_id?: string;
  amount: number;
  category: string;
  description?: string;
  date: string;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface Settings {
  id: number;
  shopName: string;
  currency: string;
  taxPercentage: number;
  darkMode: boolean;
  lastSync: number;
  shopId?: string;
  autoInvoice?: boolean;
  operate24Hours?: boolean;
  /**
   * Hides remaining-stock figures from STAFF on this computer.
   *
   * Deliberately device-local and never synced: `settings` is not in the sync
   * service's table list, so this stays on the one shared PC the boss set it on
   * rather than following the shop everywhere. That is the whole point — the
   * boss walks to the counter machine, signs in, switches it on, signs out, and
   * the employee who signs in next sees no counts.
   *
   * It also survives logout: `clearAllLocalData()` never clears the `settings`
   * table, even with forceAll (it only resets the sync cursors inside that row),
   * and `purgeLocalAuth()` only removes auth keys.
   *
   * Defaults to off (undefined === off). The boss always sees real numbers.
   */
  hideStockFromStaff?: boolean;

  /**
   * Shuts an employee out of Historia entirely on THIS computer.
   *
   * Same device-local contract as [hideStockFromStaff]: never synced, survives
   * logout, off by default, and never applies to a boss.
   *
   * Historia carries every past receipt, every refund and the whole reporting
   * view, so this is a stronger restriction than hiding stock counts — which is
   * why the route itself is guarded, not just the buttons that lead to it. A
   * hidden link is a suggestion; a redirect is the rule.
   */
  blockHistoriaForStaff?: boolean;
}

export interface Feature {
  id: string;
  shop_id?: string;
  featureKey: string;
  isEnabled: boolean;
  updated_at: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface AuditLog {
  id: string;
  shop_id: string;
  user_id: string;
  user_name?: string;
  action: 'add_product' | 'edit_product' | 'import_products' | 'delete_product' | 'delete_all_products' | 'refund_sale' | 'add_expense' | 'discounted_sale' | 'login' | 'logout' | 'app_opened' | 'anomaly_delayed_delete' | 'anomaly_heavy_discount' | 'anomaly_backdated' | 'anomaly_frequent_voids' | 'anomaly_stock_reduction' | 'anomaly_ghost_items' | 'anomaly_off_hours' | 'anomaly_expense_late' | 'anomaly_expense_vague_round' | 'anomaly_expense_spike' | 'anomaly_fake_debt' | 'anomaly_debt_settle'
    // Found by the sync, not done by a person: stock that merged below zero
    // because two devices sold it apart, and a count typed on a device that
    // had fallen behind. See SyncService.logSyncAnomaly.
    | 'anomaly_stock_oversold' | 'anomaly_stale_recount';
  details: any;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface SaasTelemetry {
  id: string;
  shop_id: string;
  user_id: string;
  user_name?: string;
  feature_key: string;
  details: any;
  created_at: string;
  updated_at: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface DebtPayment {
  id: string;
  shop_id: string;
  sale_id: string;
  amount: number;
  date: string;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface AssistantChat {
  id: string;
  shop_id: string;
  user_id: string;
  session_id: string;
  message_type: 'user' | 'assistant' | 'system';
  content: string;
  is_unresolved: number; // 0 for false, 1 for true
  metadata?: any;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
  /** Sent to the shop hub? Separate from `synced`, which is the cloud. */
  hub_synced?: number;
  /** Stamped by a sync service on rows IT writes — see the hooks below. */
  sync_ack?: number;
}

export interface License {
  id: number; // Always 1
  deviceId: string;
  /**
   * Which shop this cached licence belongs to.
   *
   * The row is keyed `id: 1`, i.e. one per DEVICE, so without this there is no
   * way to tell whose licence is being held — and a licence another device
   * verified (see LicenseService.acceptVouchedLicense) must never be taken by
   * a till signed in to a different shop.
   *
   * Optional because rows cached by earlier versions do not carry it; those
   * are simply refreshed on the next check with the server.
   */
  shopId?: string;
  startDate: number;
  expiryDate: number;
  isActive: boolean;
  lastVerifiedAt: number;
  signature?: string; // HMAC signature for tamper detection
}

export class PosDatabase extends Dexie {
  shops!: Table<Shop>;
  users!: Table<User>;
  products!: Table<Product>;
  sales!: Table<Sale>;
  saleItems!: Table<SaleItem>;
  expenses!: Table<Expense>;
  settings!: Table<Settings>;
  features!: Table<Feature>;
  auditLogs!: Table<AuditLog>;
  license!: Table<License>;
  debtPayments!: Table<DebtPayment>;
  assistantChats!: Table<AssistantChat>;
  saasTelemetry!: Table<SaasTelemetry>;

  constructor() {
    super('PosDatabaseV10'); // Bumped version for encryption
    this.version(19).stores({
      shops: 'id, name, created_by, synced',
      users: 'id, shop_id, email, role, synced',
      products: 'id, shop_id, name, synced, isDeleted, [shop_id+isDeleted]',
      sales: 'id, shop_id, user_id, status, created_at, synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+created_at]',
      saleItems: 'id, sale_id, shop_id, product_id, synced, isDeleted',
      expenses: 'id, shop_id, category, date, synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+date]',
      settings: 'id',
      features: 'id, featureKey, synced',
      auditLogs: 'id, shop_id, user_id, action, created_at, synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+created_at]',
      license: 'id',
      debtPayments: 'id, shop_id, sale_id, synced, isDeleted',
      assistantChats: 'id, shop_id, user_id, session_id, created_at, synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+created_at]',
      saasTelemetry: 'id, shop_id, user_id, feature_key, created_at, synced'
    });

    // Encryption Hooks (Reading only for backward compatibility)
    const sensitiveFields: Record<string, string[]> = {
      products: ['buy_price'],
      sales: ['total_profit'],
      saleItems: ['buy_price'],
      expenses: ['amount'],
      debtPayments: ['amount']
    };

    Object.entries(sensitiveFields).forEach(([tableName, fields]) => {
      const table = this.table(tableName);

      table.hook('reading', (obj) => {
        if (!obj) return obj;
        fields.forEach(field => {
          if (obj[field] !== undefined && typeof obj[field] === 'string') {
            try {
              const decrypted = decrypt(obj[field]);
              const num = parseFloat(decrypted);
              if (!isNaN(num)) {
                obj[field] = num;
              }
            } catch (e) {
              // If decryption fails, it might not be encrypted yet
            }
          }
        });
        return obj;
      });
    });

    // v23: the shop hub (see services/hub.ts). A row now has TWO destinations
    // — the cloud and, when the shop has one, the hub on its own wifi — and a
    // row that reached one has not necessarily reached the other. `hub_synced`
    // is the hub's own copy of `synced`, indexed on the tables big enough that
    // scanning them every cycle would be felt.
    //
    // Existing rows have it undefined, which reads as "not sent to the hub yet"
    // — correct: a shop that adds a hub should see its history appear on it.
    this.version(23).stores({
      products: 'id, shop_id, name, synced, hub_synced, isDeleted, [shop_id+isDeleted]',
      sales: 'id, shop_id, user_id, status, created_at, synced, hub_synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+created_at]',
      saleItems: 'id, sale_id, shop_id, product_id, synced, hub_synced, isDeleted',
      expenses: 'id, shop_id, category, date, synced, hub_synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+date]',
      debtPayments: 'id, shop_id, sale_id, synced, hub_synced, isDeleted',
      auditLogs: 'id, shop_id, user_id, action, created_at, synced, hub_synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+created_at]',
      workSessions: 'id, shop_id, user_id, started_at, synced, hub_synced, isDeleted, [shop_id+user_id], [shop_id+isDeleted+started_at]',
    });

    // Fields that are one sync path's own notes about a row rather than the
    // shop's data. Changing only these is not a local edit.
    const SYNC_BOOKKEEPING = new Set([
      'sync_ack',
      'synced', 'hub_synced', 'stock_delta', 'hub_delta', 'hub_counted_delta',
      'pending_delta', 'pending_delta_id', 'hub_pending_delta', 'hub_pending_id',
      'hub_count_id', 'hub_counted_stock', 'hub_counted_base',
      'counted_claim_id', 'hub_counted_claim_id',
    ]);

    // Write-Through Tracking Hooks
    const EXCLUDED_SYNC_TRIGGER_TABLES = ['settings', 'license', 'saasTelemetry', 'auditLogs', 'salesDaily', 'salesEmployeeDaily'];
    this.tables.forEach(table => {
      if (!EXCLUDED_SYNC_TRIGGER_TABLES.includes(table.name)) {
        // A local write is unsent to the hub as well as to the cloud, and a
        // stock change is owed to both. Neither is derived from the other:
        // each destination consumes its own, so one arriving first cannot
        // swallow what the other has not seen. Set here rather than at the
        // ~14 places that write stock, so a new one cannot forget.
        //
        // A writer that names these fields itself wins — which is how the two
        // sync services consume their own copy without touching the other's.
        table.hook('creating', (primKey, obj: any) => {
          if (obj && obj.synced === 0) {
            if (obj.hub_synced === undefined) obj.hub_synced = 0;
            if (obj.stock_delta !== undefined && obj.hub_delta === undefined) obj.hub_delta = obj.stock_delta;
            triggerSyncCallback();
          }
        });

        table.hook('updating', (modifications: any, primKey, obj: any) => {
          // A sync service writing what it has just sent or received. It sets
          // both flags itself, so nothing here should be derived.
          //
          // The stamp exists because Dexie DROPS modifications that do not
          // change the value: a sync writing `hub_synced: 1` onto a row that
          // already held 1 left the hook seeing only data fields, which is
          // indistinguishable from a person editing the row. The row was marked
          // unsent, sent, returned, marked again — for ever. A stamp that is
          // different every time cannot be dropped.
          if (modifications.sync_ack !== undefined) {
            if (modifications.synced === 0 || (obj && obj.synced === 0)) triggerSyncCallback();
            return undefined;
          }

          const extra: any = {};
          const keys = Object.keys(modifications);
          // Dexie strips modifications that do not CHANGE anything, so a row
          // that is already `synced: 0` updates without `synced` in here at
          // all. Keying off that alone missed every second edit — and every
          // edit to a row that arrived from the hub, which is written unsent.
          // So: any change to real data marks the row unsent to the hub.
          const touchesData = keys.some(k => !SYNC_BOOKKEEPING.has(k));
          const isLocalEdit = modifications.synced === 0 || (touchesData && modifications.synced !== 1);

          if (isLocalEdit && modifications.hub_synced === undefined) extra.hub_synced = 0;

          if (modifications.count_id !== undefined && modifications.count_id !== null) {
            // A counted shelf subsumes what was owed, on BOTH paths — and each
            // path is told separately, because the two owe different amounts.
            //
            // Every figure is recorded NET OF THE CLAIM ALREADY IN FLIGHT on
            // that path. That claim is on its way under its own id and lands
            // on top of the count, so a count that still contained it would
            // add it twice. Netting all three keeps the server's check exactly
            // as it would be with nothing in flight, so the ordinary case
            // matches and only a genuinely stale count is reported.
            const claimOut = Number(obj?.pending_delta) || 0;
            const hubClaimOut = Number(obj?.hub_pending_delta) || 0;

            // Dexie drops a modification whose value equals what the row
            // already holds, so none of the three figures can be relied on to
            // arrive here — two counts in a row with the same numbers send
            // only `count_id`. They are read back off the row instead, where
            // the same three live: the shelf is the stock being written, the
            // base is the stock before it, and what was owed is the
            // accumulator this count is resetting.
            const shelf = Number(modifications.counted_stock ?? modifications.stock ?? obj?.stock) || 0;
            const base = Number(modifications.counted_base ?? obj?.stock) || 0;
            const owed = Number(modifications.counted_delta ?? obj?.stock_delta) || 0;

            extra.counted_stock = shelf - claimOut;
            extra.counted_base = base - claimOut;
            extra.counted_delta = owed - claimOut;
            if (modifications.counted_claim_id === undefined) extra.counted_claim_id = obj?.pending_delta_id ?? null;

            if (modifications.hub_count_id === undefined) extra.hub_count_id = modifications.count_id;
            if (modifications.hub_counted_stock === undefined) extra.hub_counted_stock = shelf - hubClaimOut;
            if (modifications.hub_counted_base === undefined) extra.hub_counted_base = base - hubClaimOut;
            if (modifications.hub_counted_delta === undefined) {
              extra.hub_counted_delta = (Number(obj?.hub_delta) || 0) - hubClaimOut;
            }
            if (modifications.hub_counted_claim_id === undefined) extra.hub_counted_claim_id = obj?.hub_pending_id ?? null;
            if (modifications.hub_delta === undefined) extra.hub_delta = 0;
          } else if (modifications.stock_delta !== undefined && modifications.hub_delta === undefined) {
            const moved = (Number(modifications.stock_delta) || 0) - (Number(obj?.stock_delta) || 0);
            if (moved !== 0) extra.hub_delta = (Number(obj?.hub_delta) || 0) + moved;
          }

          if (modifications.synced === 0 || (obj && obj.synced === 0)) {
            triggerSyncCallback();
          }
          return Object.keys(extra).length ? extra : undefined;
        });
      }
    });

  }
}

export type LocalWriteListener = () => void;
let onLocalWriteTrigger: LocalWriteListener | null = null;

let scheduledCallback: any = null;
const triggerSyncCallback = () => {
  if (scheduledCallback) return;
  scheduledCallback = setTimeout(() => {
    scheduledCallback = null;
    if (typeof onLocalWriteTrigger === 'function') {
      try {
        onLocalWriteTrigger();
      } catch (e) {
        console.error('onLocalWriteTrigger callback error:', e);
      }
    }
  }, 100);
};

export function registerLocalWriteTrigger(listener: LocalWriteListener) {
  onLocalWriteTrigger = listener;
}

export const db = new PosDatabase();

// --- Multi-window IndexedDB safety ------------------------------------------
// Desktop/PWA users often keep more than one window or tab open at once. On a
// schema-version bump, a new window's db.open() is BLOCKED until the older
// connection closes — otherwise it hangs forever on a blank window, which looks
// exactly like "the app icon won't open". These handlers make the older window
// step aside so the upgrade completes automatically instead of deadlocking.
db.on('versionchange', () => {
  // Another window opened a newer DB version — close ours and reload to match,
  // rather than holding the old version open and blocking that window.
  try { db.close(); } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.location.reload();
});

db.on('blocked', () => {
  // Our open is blocked by another still-open connection (an older-version window that
  // hasn't stepped aside). Left alone this "hangs forever on a blank window", so recover:
  // give the other window's versionchange handler a moment to close, then reload once.
  // Guarded so two windows can't bounce each other in an endless reload loop.
  console.warn('[db] IndexedDB open blocked by another window/tab — attempting recovery.');
  if (typeof window === 'undefined') return;
  try {
    const KEY = 'db_blocked_recovery_at';
    const now = Date.now();
    const last = parseInt(localStorage.getItem(KEY) || '0', 10);
    if (now - last < 30000) return; // already tried recently — don't loop
    localStorage.setItem(KEY, now.toString());
    setTimeout(() => { try { window.location.reload(); } catch { /* ignore */ } }, 3000);
  } catch { /* ignore */ }
});

export async function clearAllLocalData(options?: { forceAll?: boolean }) {
  const forceAll = options?.forceAll === true;
  
  // By default, keep static / expensive tables (products, shops, users, features) to avoid massive data pull on shift change.
  // Only clear transaction-specific logs of the previous user's shift. Wiping of all tables happens on forceAll.
  const tablesToClear = forceAll
    ? [
        'shops',
        'users',
        'products',
        'sales',
        'saleItems',
        'expenses',
        'features',
        'auditLogs',
        'debtPayments',
        'assistantChats',
        'saasTelemetry'
      ]
    : [
        'sales',
        'saleItems',
        'expenses',
        'auditLogs',
        'debtPayments',
        'assistantChats',
        'saasTelemetry'
      ];
  
  await db.transaction('rw', tablesToClear.map(name => db.table(name)), async () => {
    for (const name of tablesToClear) {
      try {
        await db.table(name).clear();
      } catch (err) {
        console.error(`Error clearing local table ${name}:`, err);
      }
    }
  });

  // Throwing the rows away and keeping the sync watermarks is incoherent, and it
  // is why a fresh login showed an empty app.
  //
  // Every pull filters `.gt('updated_at', cursor)`. Logout wipes sales, sale
  // items, expenses, debt payments and audit logs from IndexedDB but leaves
  // `settings` — including those cursors — untouched. So the next login asked
  // the server for "anything changed since <after all of it>" and was correctly
  // told: nothing. Products survived only because they are not in the wipe list,
  // which is exactly why they were the one thing still on screen. Making a sale
  // appeared to fix it because checkout calls sync(force: true), and force is
  // the one path that ignores the cursor.
  //
  // The wipe and the watermarks are two halves of one operation, so they are
  // done together here. Costs one full re-pull after a logout, which is the
  // correct price for having deleted the data.
  try {
    const settings = await db.settings.get(1);
    if (settings) {
      const cursors = Object.keys(settings).filter((k) => k.startsWith('syncCursor'));
      if (cursors.length) {
        const patch: Record<string, undefined> = {};
        for (const k of cursors) patch[k] = undefined;
        await db.settings.update(1, patch);
        console.log(`[clearAllLocalData] Reset ${cursors.length} sync cursors alongside the wiped tables.`);
      }
    }
  } catch (err) {
    console.error('Failed to reset sync cursors after clearing local data:', err);
  }
}

