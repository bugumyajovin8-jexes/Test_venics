import { db, Product } from '../db';
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

// Shop-wide stock-tracking flag.
//
// When we HAVE the shops row (the boss, and any device that syncs the shops table) it is
// authoritative — it's exactly what the global switch writes to and reads from — so we trust
// it directly. This keeps the switch, the product cards, Mauzo and the per-product toggle all
// reading ONE value; previously behaviour read the feature flag while the switch read
// shop.enable_stock, so a not-yet-synced feature flag made the switch say OFF while products
// still showed stock (and vice-versa).
//
// Only when there is no shops row (employees never pull the shops table, so their `shop` is
// undefined) do we fall back to the `stock_tracking_enabled` feature flag, which is synced to
// them via the features table for exactly this purpose.
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
  // If global is disabled, only track if product individually has track_stock set to true
  return product?.track_stock === true;
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

export function getDynamicThreshold(productId: string, minStock: number, velocityMap: Record<string, number>): number {
  const totalQtySold30Days = velocityMap[productId] || 0;
  const dailyVelocity = totalQtySold30Days / 30;
  // Velocity-based lead-time threshold refines but never drops below the
  // configured min_stock, so slow-moving products still get a low-stock alert.
  return Math.max(minStock, Math.ceil(dailyVelocity * 7)); // Lead-time to restock is 7 days
}

// Days-of-cover low-stock model. A product is "low" only if it is actually SELLING (had sales
// in the 30-day velocity window) AND its current valid stock won't cover the 7-day restock
// lead time. Products with no sales in the window are never flagged — so dead stock, including
// never-sold zero-stock items, stays out of the alert. min_stock is intentionally ignored here.
export function isLowStock(product: Product, isExpiryEnabled: boolean, velocityMap: Record<string, number>): boolean {
  const dailyVelocity = (velocityMap[product.id] || 0) / 30;
  if (dailyVelocity <= 0) return false; // never sold in the window → not a restock priority
  const validStock = getValidStock(product, isExpiryEnabled);
  return validStock <= dailyVelocity * 7; // days-of-cover ≤ 7-day lead time
}

