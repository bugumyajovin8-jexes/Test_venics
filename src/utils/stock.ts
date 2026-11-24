import { db, Product, Sale, SaleItem } from '../db';
import { subDays, differenceInCalendarDays } from 'date-fns';
import { useStore } from '../store';

// A batch stays valid through the END of its expiry day (local calendar). It only counts as
// expired the day AFTER expiry_date. A missing/blank/invalid expiry_date means "never expires".
// differenceInCalendarDays compares calendar days and ignores the time-of-day, so it isn't thrown
// off by the fact that dates are stored at UTC-midnight (which used to flag goods expired a day
// early).
export function isBatchExpired(expiryDate?: string | null): boolean {
  if (!expiryDate) return false;
  const d = new Date(expiryDate);
  if (isNaN(d.getTime())) return false;
  return differenceInCalendarDays(d, new Date()) < 0;
}

// A batch that is NOT yet expired and whose expiry day is within `withinDays` from today.
export function isBatchExpiringSoon(expiryDate?: string | null, withinDays = 30): boolean {
  if (!expiryDate) return false;
  const d = new Date(expiryDate);
  if (isNaN(d.getTime())) return false;
  const diff = differenceInCalendarDays(d, new Date());
  return diff >= 0 && diff <= withinDays;
}

export function getValidStock(product: Product, isExpiryEnabled: boolean): number {
  if (!isExpiryEnabled || !product.batches || product.batches.length === 0) {
    return product.stock;
  }

  const totalBatchStock = product.batches.reduce((sum, b) => sum + Number(b.stock), 0);
  const unbatchedStock = Math.max(0, Number(product.stock) - totalBatchStock);

  const validBatchStock = product.batches.reduce((sum, b) => {
    if (Number(b.stock) > 0 && !isBatchExpired(b.expiry_date)) {
      return sum + Number(b.stock);
    }
    return sum;
  }, 0);
  
  return validBatchStock + unbatchedStock;
}

export async function getSales30DaysVelocityMap(shopId: string): Promise<Record<string, number>> {
  if (!shopId) return {};

  const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
  
  // 1. Get all completed or non-deleted sales in the last 30 days using faster compound index
  const sales = await db.sales
    .where('[shop_id+isDeleted+created_at]')
    .between([shopId, 0, thirtyDaysAgo], [shopId, 0, '\uffff'])
    .filter(s => s.status !== 'cancelled')
    .toArray();

  const saleIds = sales.map(s => s.id);
  if (saleIds.length === 0) return {};

  // 2. Query saleItems associated with these sales
  const items = await db.saleItems
    .where('sale_id')
    .anyOf(saleIds)
    .filter(item => item.isDeleted === 0)
    .toArray();

  const velocityMap: Record<string, number> = {};
  items.forEach(item => {
    velocityMap[item.product_id] = (velocityMap[item.product_id] || 0) + (Number(item.qty) || 0);
  });

  return velocityMap;
}

// Shop-wide stock-tracking flag.
//
// When we HAVE the shops row (the boss, and any device that syncs the shops table) it is
// authoritative — it's exactly what the global switch writes to and reads from — so we trust it
// directly. Only when there is no shops row (employees never pull the shops table, so their
// `shop` is undefined) do we fall back to the `stock_tracking_enabled` feature flag, which is
// synced to them via the features table for exactly this purpose. Without this fallback an
// employee's undefined `shop` made every product read as "tracked", ignoring a boss's global OFF.
export function isGlobalStockEnabled(shop: any): boolean {
  if (shop && typeof shop.enable_stock === 'boolean') {
    return shop.enable_stock;
  }
  const feat = useStore.getState().features?.['stock_tracking_enabled'];
  if (typeof feat === 'boolean') return feat;
  return shop?.enable_stock !== false; // defaults to true if undefined
}

export function isProductStockTracked(product: any, shop: any): boolean {
  // If global stock tracking is active (defaults to true), all products track stock.
  if (isGlobalStockEnabled(shop)) {
    return true;
  }
  // If global is disabled, only track if the product individually has track_stock set.
  return product?.track_stock === true;
}

// ---------------------------------------------------------------- low stock
//
// THE low-stock rule. Every place that says a product is running out uses it:
// the Dashibodi box, alert card and "Bidhaa Zinazoisha" list, the Bidhaa page
// badge, the bell, the summary notification, V Smart and the AI chat. The same
// rule as the Mobile app. Before, there were
// four rules and the counts disagreed.
//
//  - Only products whose stock is tracked.
//  - "low": it sold in the last 30 days, and what is left (expired batches not
//    counted) would last RESTOCK_LEAD_DAYS days or less at that speed.
//  - "out" (Zimeisha): nothing left, and it sold within the last 90 days. A
//    best-seller that has been empty for weeks cannot sell, so a 30-day window
//    alone would quietly drop it from the list the longer it stays missing.
//  - Anything that has not sold for 90 days is dead stock, not a restock job.
//
// min_stock is no longer asked for when adding a product and plays no part here.

export const RESTOCK_LEAD_DAYS = 7;      // a restock takes about a week
export const OUT_OF_STOCK_LOOKBACK = 90; // days an empty product stays on the list after its last sale
const DAY_MS = 24 * 60 * 60 * 1000;

export type LowStockLevel = 'out' | 'low';

export interface LowStockContext {
  /** The shops row (undefined for staff: the tracking flag then comes from features). */
  shop: any;
  isExpiryEnabled: boolean;
  /** Quantity sold per product over the last 30 days. */
  sold30: Record<string, number>;
  /** Products with a sale in the last OUT_OF_STOCK_LOOKBACK days. */
  soldRecently: Set<string>;
}

export function lowStockLevel(product: Product, ctx: LowStockContext): LowStockLevel | null {
  if (product.isDeleted === 1) return null;
  if (!isProductStockTracked(product, ctx.shop)) return null; // untracked products can't run out
  const stock = getValidStock(product, ctx.isExpiryEnabled);
  const perDay = (ctx.sold30[product.id] || 0) / 30;
  if (stock <= 0) return perDay > 0 || ctx.soldRecently.has(product.id) ? 'out' : null;
  return perDay > 0 && stock <= perDay * RESTOCK_LEAD_DAYS ? 'low' : null;
}

/** Whole days the stock lasts at the last 30 days' speed; null when it is not selling. */
export function stockDaysLeft(product: Product, ctx: LowStockContext): number | null {
  const perDay = (ctx.sold30[product.id] || 0) / 30;
  if (perDay <= 0) return null;
  return Math.max(0, Math.floor(getValidStock(product, ctx.isExpiryEnabled) / perDay));
}

export function filterLowStock<T extends Product>(products: T[], ctx: LowStockContext): T[] {
  return products.filter(p => lowStockLevel(p, ctx) !== null);
}

/** Most urgent first: empty products, then the fewest days left, then by name. */
export function sortLowStock<T extends Product>(products: T[], ctx: LowStockContext): T[] {
  const rank = (p: T) => (lowStockLevel(p, ctx) === 'out' ? -1 : stockDaysLeft(p, ctx) ?? Number.MAX_SAFE_INTEGER);
  return [...products].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The context from the database (Dashibodi, Bidhaa, the bell, the summary notification). */
export async function loadLowStockContext(shopId: string, products?: Product[]): Promise<LowStockContext> {
  const [shop, sold30] = await Promise.all([db.shops.get(shopId), getSales30DaysVelocityMap(shopId)]);
  const isExpiryEnabled = shop?.enable_expiry === true;
  const list = products ?? await db.products.where('[shop_id+isDeleted]').equals([shopId, 0]).toArray();
  const soldRecently = new Set(Object.keys(sold30));
  // Only an empty, tracked product with no sale in 30 days needs the longer look
  // back: usually a handful, each one an indexed lookup of its own sale lines.
  const cutoff = new Date(Date.now() - OUT_OF_STOCK_LOOKBACK * DAY_MS).toISOString();
  for (const p of list) {
    if (sold30[p.id] || p.isDeleted === 1 || !isProductStockTracked(p, shop)) continue;
    if (getValidStock(p, isExpiryEnabled) > 0) continue;
    const lines = await db.saleItems.where('product_id').equals(p.id)
      .filter(i => i.isDeleted === 0 && i.created_at >= cutoff).toArray();
    if (!lines.length) continue;
    const sales = await db.sales.bulkGet([...new Set(lines.map(i => i.sale_id))]);
    if (sales.some(s => s && s.isDeleted === 0 && s.status !== 'cancelled')) soldRecently.add(p.id);
  }
  return { shop, isExpiryEnabled, sold30, soldRecently };
}

/**
 * The same context from sales already in memory (the AI chat keeps the shop's
 * sales and sale lines loaded). Matches loadLowStockContext: cancelled and
 * deleted sales do not count.
 */
export function lowStockContextFromSales(shop: any, sales: Sale[], saleItems: SaleItem[], now = Date.now()): LowStockContext {
  const from30 = now - 30 * DAY_MS;
  const from90 = now - OUT_OF_STOCK_LOOKBACK * DAY_MS;
  const saleTime = new Map<string, number>();
  for (const s of sales) {
    if (s.isDeleted === 1 || s.status === 'cancelled') continue;
    const at = new Date(s.created_at).getTime();
    if (at >= from90) saleTime.set(s.id, at);
  }
  const sold30: Record<string, number> = {};
  const soldRecently = new Set<string>();
  for (const it of saleItems) {
    if (it.isDeleted === 1) continue;
    const at = saleTime.get(it.sale_id);
    if (at === undefined) continue;
    soldRecently.add(it.product_id);
    if (at >= from30) sold30[it.product_id] = (sold30[it.product_id] || 0) + (Number(it.qty) || 0);
  }
  return { shop, isExpiryEnabled: shop?.enable_expiry === true, sold30, soldRecently };
}

/** The products running out, for a shop, straight from the database. */
export async function getLowStockProducts(shopId: string): Promise<Product[]> {
  const products = await db.products.where('[shop_id+isDeleted]').equals([shopId, 0]).toArray();
  const ctx = await loadLowStockContext(shopId, products);
  return filterLowStock(products, ctx);
}
