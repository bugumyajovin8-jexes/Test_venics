import { db, Product } from '../db';
import { subDays } from 'date-fns';

export function getValidStock(product: Product, isExpiryEnabled: boolean): number {
  if (!isExpiryEnabled || !product.batches || product.batches.length === 0) {
    return product.stock;
  }

  const now = new Date();
  const totalBatchStock = product.batches.reduce((sum, b) => sum + Number(b.stock), 0);
  const unbatchedStock = Math.max(0, Number(product.stock) - totalBatchStock);
  
  const validBatchStock = product.batches.reduce((sum, b) => {
    if (Number(b.stock) > 0 && new Date(b.expiry_date) > now) {
      return sum + Number(b.stock);
    }
    return sum;
  }, 0);
  
  return validBatchStock + unbatchedStock;
}

export function isProductStockTracked(product: any, shop: any): boolean {
  // If global stock tracking is active (defaults to true), all products track stock.
  const globalEnabled = shop?.enable_stock !== false; // defaults to true if undefined or true
  if (globalEnabled) {
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

