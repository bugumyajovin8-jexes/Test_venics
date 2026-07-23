import Dexie, { type Table } from 'dexie';

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
}

export interface User {
  id: string;
  shop_id?: string;
  shopId?: string; // Alias for compatibility
  email: string;
  name: string;
  phone?: string;
  role: 'boss' | 'employee';
  status: 'active' | 'blocked';
  isActive?: boolean; // Alias for compatibility
  last_seen?: string;
  is_deleted?: boolean; // Remote field
  fcm_token?: string; // For push notifications
  isDeleted: number;
  created_at: string;
  updated_at: string;
  synced: number;
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
  isDeleted: number; // 0 for false, 1 for true
  pricing_verified?: number; // 1 if user marked prices as correct/OK
  track_stock?: boolean;
  catalog_id?: string; // origin id from catalog_products when imported from the global catalog
  created_at: string;
  updated_at: string;
  synced: number;
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
  compactLayout?: boolean;
}

export interface Feature {
  id: string;
  shop_id?: string;
  featureKey: string;
  isEnabled: boolean;
  updated_at: string;
  synced: number;
}

export interface AuditLog {
  id: string;
  shop_id: string;
  user_id: string;
  user_name?: string;
  action: 'add_product' | 'edit_product' | 'import_products' | 'delete_product' | 'delete_all_products' | 'refund_sale' | 'add_expense' | 'discounted_sale' | 'login' | 'logout' | 'app_opened' | 'anomaly_delayed_delete' | 'anomaly_heavy_discount' | 'anomaly_backdated' | 'anomaly_frequent_voids' | 'anomaly_stock_reduction' | 'anomaly_ghost_items' | 'anomaly_off_hours' | 'anomaly_expense_late' | 'anomaly_expense_vague_round' | 'anomaly_expense_spike' | 'anomaly_fake_debt' | 'anomaly_debt_settle';
  details: any;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
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
}

export interface License {
  id: number; // Always 1
  deviceId: string;
  startDate: number;
  expiryDate: number;
  isActive: boolean;
  lastVerifiedAt: number;
  signature?: string; // HMAC signature for tamper detection
}

// --- Local-only computed rollups ---------------------------------------------
// These are derived from `sales` on-device (never synced) so that all-time
// totals / reports never have to scan every raw sale. One row per shop+day.
export interface SalesDaily {
  id: string;        // `${shop_id}_${date}`
  shop_id: string;
  date: string;      // local YYYY-MM-DD of the sale's created_at
  revenue: number;   // sum(total_amount) of non-deleted sales that day
  profit: number;    // sum(total_profit)
  count: number;     // number of non-deleted sales
  updated_at: string;
}

export interface SalesEmployeeDaily {
  id: string;        // `${shop_id}_${date}_${user_id}`
  shop_id: string;
  date: string;
  user_id: string;
  revenue: number;
  profit: number;
  count: number;
  updated_at: string;
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
  salesDaily!: Table<SalesDaily>;
  salesEmployeeDaily!: Table<SalesEmployeeDaily>;

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

    // v20: local-only rollup tables for fast all-time reports (never synced).
    this.version(20).stores({
      salesDaily: 'id, shop_id, date, [shop_id+date]',
      salesEmployeeDaily: 'id, shop_id, date, user_id, [shop_id+date], [shop_id+user_id]'
    });

    // Write-Through Tracking Hooks
    const EXCLUDED_SYNC_TRIGGER_TABLES = ['settings', 'license', 'saasTelemetry', 'auditLogs', 'salesDaily', 'salesEmployeeDaily'];
    this.tables.forEach(table => {
      if (!EXCLUDED_SYNC_TRIGGER_TABLES.includes(table.name)) {
        table.hook('creating', (primKey, obj: any) => {
          if (obj && obj.synced === 0) {
            triggerSyncCallback();
          }
        });

        table.hook('updating', (modifications: any, primKey, obj: any) => {
          if (modifications.synced === 0 || (obj && obj.synced === 0)) {
            triggerSyncCallback();
          }
        });
      }
    });

    // Summary maintenance: flag a sale's day whenever a sale row is written
    // (locally OR pulled in via sync) so the rollup tables can be rebuilt for
    // just that day. Refunds/edits fire 'updating' with the original created_at.
    this.sales.hook('creating', (_pk, obj: any) => {
      if (obj?.shop_id && obj?.created_at) notifySaleMutation(obj.shop_id, obj.created_at);
    });
    this.sales.hook('updating', (_mods: any, _pk, obj: any) => {
      if (obj?.shop_id && obj?.created_at) notifySaleMutation(obj.shop_id, obj.created_at);
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

// --- Summary maintenance callback (wired by services/summaries.ts) -----------
export type SaleMutationListener = (shopId: string, createdAtIso: string) => void;
let onSaleMutation: SaleMutationListener | null = null;
export function registerSaleMutationListener(listener: SaleMutationListener) {
  onSaleMutation = listener;
}
function notifySaleMutation(shopId: string, createdAtIso: string) {
  if (typeof onSaleMutation === 'function') {
    try {
      onSaleMutation(shopId, createdAtIso);
    } catch (e) {
      console.error('onSaleMutation callback error:', e);
    }
  }
}

export const db = new PosDatabase();

// --- Multi-window IndexedDB safety ------------------------------------------
// The app also runs as an installable PWA, where a user can have both the PWA
// window and a browser tab open. On a schema-version bump, a new connection's
// db.open() is BLOCKED until older connections close — otherwise it hangs forever
// on a blank screen ("the app won't open"). These handlers make the older window
// step aside so the upgrade completes automatically instead of deadlocking.
db.on('versionchange', () => {
  // Another window opened a newer DB version — close ours and reload to match,
  // rather than holding the old version open and blocking that window.
  try { db.close(); } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.location.reload();
});

db.on('blocked', () => {
  // Our own upgrade is being blocked by another still-open connection.
  console.warn('[db] IndexedDB upgrade blocked by another open window/tab.');
});

