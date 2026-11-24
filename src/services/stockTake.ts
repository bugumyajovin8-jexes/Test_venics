/**
 * Hesabu ya Stoo — stock taking.
 *
 * The shop counts what is on its shelves; Venics compares each figure with what
 * it held at that moment; the boss approves the differences, and the stock is
 * corrected. Staff count with the system's figures hidden and send the count to
 * the boss. Approving is for the boss, or staff the boss allows to add and edit
 * products ("Ruhusu Wafanyakazi Kuongeza Bidhaa") — the same people the server
 * lets write product details; when staff approve or cancel, Shughuli za
 * Wafanyakazi records it for the boss.
 *
 * WHAT IS RECORDED (db.ts StockTake / StockTakeItem, 20261110_stock_takes.sql)
 *   A count is a row in `stockTakes`; each product counted is a row in
 *   `stockTakeItems` holding what Venics held WHEN THAT PRODUCT WAS COUNTED, what
 *   was on the shelf, and the buying price then. Sales may carry on while the
 *   shop counts: each product is compared against its own moment, not against
 *   the moment the count began.
 *
 *   A product's row has the same id in the same count on every device, so two
 *   people counting one product end in one row; the later count wins.
 *
 * APPROVING
 *   For each difference, the stock becomes the shelf figure PLUS whatever moved
 *   on this computer since that product was counted (sold, received), so a sale
 *   made after the count is not undone. It goes up the way a typed stock figure
 *   always has: as a COUNT against the figure it was taken from (db.ts
 *   Product.count_id), which the server applies outright when it still agrees
 *   and reports when another device had moved it. A shortage leaves from the
 *   batches that expire first, as when stock is edited in Bidhaa.
 *
 * SYNC
 *   Through the cloud, with the background tables. Writes here do not trigger a
 *   sync each (a count is typed product by product); an upload is asked for
 *   after a pause, and straight away when a count is started, sent or approved.
 *   The shop hub (Kituo) does not carry these tables yet.
 */

import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { db, type Product, type StockTake, type StockTakeItem } from '../db';
import { useStore } from '../store';
import { nowIso } from './clock';
import { SyncService } from './sync';

/** Why something is short. Anything left as the first is the loss to look into. */
export const REASONS = ['Haijulikani', 'Imeisha muda', 'Imeharibika', 'Matumizi ya duka', 'Kosa la kurekodi'] as const;
export const UNKNOWN_REASON = REASONS[0];

/** Namespace for counted-item ids: (count, product) -> the same id everywhere. */
const ITEM_NAMESPACE = '5b0e2c8a-7f43-4d1e-9c26-3a8f1d6e4b70';

export function itemId(takeId: string, productId: string): string {
  return uuidv5(`${takeId}:${productId}`, ITEM_NAMESPACE);
}

function me() {
  const u: any = useStore.getState().user;
  return { id: u?.id as string | undefined, name: (u?.name as string) || '', shopId: (u?.shopId || u?.shop_id) as string, boss: u?.role === 'boss' };
}

/**
 * Whether the signed-in person may approve (and cancel) counts: the boss, or
 * staff allowed to add and edit products. Mirrors can_approve_stock_takes() on
 * the server (20261110_stock_takes.sql). Until the shop's switches have loaded
 * the answer for staff is no, which is the safe way round for a power.
 */
export function canApproveStockTakes(): boolean {
  const s = useStore.getState();
  return s.user?.role === 'boss' || s.isFeatureEnabled('staff_product_management');
}

/** Products a count can cover: in the shop, not deleted, stock tracked. */
export function countable(products: Product[]): Product[] {
  return products.filter(p => p.isDeleted !== 1 && p.track_stock !== false);
}

/** The products one count covers. */
export function inScope(products: Product[], take: StockTake | null | undefined): Product[] {
  const list = countable(products);
  if (!take || take.scope === 'all' || !take.product_ids) return list;
  const ids = new Set(take.product_ids);
  return list.filter(p => ids.has(p.id!));
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
/** Upload after a pause in typing. */
function syncSoon(ms = 15_000) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; void SyncService.sync(true, 'background'); }, ms);
}
/** Upload (and download) now. */
export function syncStockTakesNow() {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  void SyncService.sync(true, 'background');
}

export async function startTake(opts: { productIds: string[] | null; blind: boolean; total: number }): Promise<StockTake> {
  const u = me();
  const now = nowIso();
  const take: StockTake = {
    id: uuidv4(),
    shop_id: u.shopId,
    scope: opts.productIds ? 'some' : 'all',
    product_ids: opts.productIds,
    // Staff always count without Venics's figures.
    blind: u.boss ? opts.blind : true,
    status: 'counting',
    started_by: u.id,
    started_by_name: u.name,
    started_at: now,
    total_products: opts.total,
    counted_products: 0,
    created_at: now,
    updated_at: now,
    isDeleted: 0,
    synced: 0,
  };
  await db.stockTakes.put(take);
  syncStockTakesNow();
  return take;
}

/** The figure found on the shelf for one product; null clears it. */
export async function recordCount(take: StockTake, product: Product, counted: number | null) {
  const id = itemId(take.id, product.id!);
  const u = me();
  const now = nowIso();
  const existing = await db.stockTakeItems.get(id);
  if (counted === null) {
    if (existing && existing.isDeleted !== 1) await db.stockTakeItems.update(id, { isDeleted: 1, updated_at: now, synced: 0 });
  } else {
    const row: StockTakeItem = {
      id,
      stock_take_id: take.id,
      shop_id: take.shop_id,
      product_id: product.id!,
      product_name: product.name,
      unit: product.unit,
      // What Venics holds at THIS moment, against which this figure is judged.
      expected_qty: Number(product.stock) || 0,
      counted_qty: Math.max(0, counted),
      buy_price: Number(product.buy_price) || 0,
      reason: existing?.reason ?? null,
      counted_by: u.id,
      counted_by_name: u.name,
      counted_at: now,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      isDeleted: 0,
      synced: 0,
    };
    await db.stockTakeItems.put(row);
  }
  syncSoon();
}

export async function setReason(item: StockTakeItem, reason: string) {
  await db.stockTakeItems.update(item.id, { reason, updated_at: nowIso(), synced: 0 });
  syncSoon();
}

/** Staff: the count is finished, for the boss to approve. */
export async function submitTake(take: StockTake, countedProducts: number) {
  const u = me();
  const now = nowIso();
  await db.stockTakes.update(take.id, {
    status: 'submitted',
    submitted_by: u.id,
    submitted_by_name: u.name,
    submitted_at: now,
    counted_products: countedProducts,
    updated_at: now,
    synced: 0,
  });
  void SyncService.logAction('stock_take_submitted', { counted: countedProducts, total: take.total_products ?? null, scope: take.scope });
  syncStockTakesNow();
}

/** Drop a count without changing any stock (whoever may approve). */
export async function cancelTake(take: StockTake, countedProducts: number) {
  if (!canApproveStockTakes()) throw new Error('Not allowed to cancel a stock take');
  await db.stockTakes.update(take.id, { status: 'cancelled', updated_at: nowIso(), synced: 0 });
  // Staff only (the boss's own actions are not logged): a count dropped after
  // the losses showed is exactly what the boss should hear about.
  void SyncService.logAction('stock_take_cancelled', { counted: countedProducts, total: take.total_products ?? null, scope: take.scope });
  syncStockTakesNow();
}

export interface Summary {
  lost: number; lostCount: number;
  extra: number; extraCount: number;
  unexplained: number;
  net: number;
}

/** Shortages and surpluses at buying price. "Unexplained" is a shortage with no reason given. */
export function summarize(items: StockTakeItem[]): Summary {
  const s: Summary = { lost: 0, lostCount: 0, extra: 0, extraCount: 0, unexplained: 0, net: 0 };
  for (const i of items) {
    const value = (Number(i.counted_qty) - Number(i.expected_qty)) * (Number(i.buy_price) || 0);
    if (i.counted_qty < i.expected_qty) {
      s.lost += -value;
      s.lostCount++;
      if (!i.reason || i.reason === UNKNOWN_REASON) s.unexplained += -value;
    } else if (i.counted_qty > i.expected_qty) {
      s.extra += value;
      s.extraCount++;
    }
  }
  s.net = s.extra - s.lost;
  return s;
}

/** A shortage leaves from the batches that expire first (as in Bidhaa). */
function trimBatches(batches: any[], newStock: number): any[] {
  if (!Array.isArray(batches) || batches.length === 0) return batches ?? [];
  const total = batches.reduce((sum, b) => sum + (Number(b?.stock) || 0), 0);
  if (newStock >= total) return batches;
  let toRemove = total - newStock;
  return [...batches]
    .sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())
    .map(b => {
      if (toRemove <= 0) return b;
      const stock = Number(b.stock) || 0;
      if (stock <= toRemove) { toRemove -= stock; return { ...b, stock: 0 }; }
      const left = stock - toRemove;
      toRemove = 0;
      return { ...b, stock: left };
    })
    .filter(b => Number(b.stock) > 0);
}

export interface ApproveResult {
  corrected: number;
  /** Products that are gone or no longer tracked: recorded, but their stock not touched. */
  skipped: string[];
}

/** Correct the stock and close the count (whoever may approve). */
export async function approveTake(take: StockTake, items: StockTakeItem[], totalProducts: number): Promise<ApproveResult> {
  const u = me();
  if (!canApproveStockTakes()) throw new Error('Not allowed to approve a stock take');
  const result: ApproveResult = { corrected: 0, skipped: [] };

  for (const item of items) {
    if (item.counted_qty === item.expected_qty) continue;
    const product = await db.products.get(item.product_id);
    if (!product || product.isDeleted === 1 || product.track_stock === false) {
      result.skipped.push(item.product_name);
      continue;
    }
    const current = Number(product.stock) || 0;
    // Whatever moved on this computer since the product was counted.
    const movedSince = current - (Number(item.expected_qty) || 0);
    const newStock = Math.max(0, (Number(item.counted_qty) || 0) + movedSince);
    if (newStock === current) continue;
    await db.products.update(product.id!, {
      stock: newStock,
      batches: trimBatches(product.batches as any[], newStock),
      // A count, not a difference: see db.ts Product.count_id.
      stock_delta: 0,
      count_id: uuidv4(),
      counted_stock: newStock,
      counted_base: current,
      counted_delta: product.stock_delta || 0,
      updated_at: nowIso(),
      synced: 0,
    } as any);
    result.corrected++;
  }

  const s = summarize(items);
  const now = nowIso();
  await db.stockTakes.update(take.id, {
    status: 'approved',
    approved_by: u.id,
    approved_by_name: u.name,
    approved_at: now,
    total_products: totalProducts,
    counted_products: items.length,
    lost_value: s.lost,
    lost_count: s.lostCount,
    extra_value: s.extra,
    extra_count: s.extraCount,
    unexplained_value: s.unexplained,
    updated_at: now,
    synced: 0,
  });
  // Staff only (the boss's own actions are not logged): the stock was changed,
  // and the boss should see by whom and by how much.
  void SyncService.logAction('stock_take_approved', {
    counted: items.length, total: totalProducts, scope: take.scope,
    corrected: result.corrected, lost: s.lost, unexplained: s.unexplained, extra: s.extra,
  });
  syncStockTakesNow();
  return result;
}
