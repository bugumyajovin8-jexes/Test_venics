/**
 * "Bidhaa inayouzwa kila siku imenyamaza" — a product that normally sells
 * steadily has stopped selling while the business goes on trading. The
 * commonest way that happens is a sale nobody recorded: the item left the
 * shelf and the money left with it. Shown in Shughuli za Wafanyakazi as
 * anomaly_ghost_items.
 *
 * WHAT IT REPLACES
 *   The old check ran on every device, once a day each, from that device's own
 *   sales, with one rule for all: "over 30 sold in 30 days, none in 3 days". So
 *   one product was reported once per device, again every day it stayed
 *   quiet, after holidays, and whenever a phone simply had not received the
 *   other devices' sales yet. And it was never uploaded (signed 'system'), so
 *   the boss saw only what the boss's own device had guessed.
 *
 * THE RULES NOW
 *   * Judged by how fast THIS product sells, per day the business actually sold
 *     anything (closed days count neither way).
 *   * Counted in whole trading days after the product's last sale (today,
 *     unfinished, is not counted).
 *   * Reported only when that many trading days without one sale would be
 *     very unlikely by chance: at least 3 sales expected in the gap, which a
 *     steady seller misses less than 5% of the time. Roughly: 5 a day ->
 *     after 1 day; 1 a day -> after 3; under one every 2 days -> never.
 *   * Only when the business really traded in that time — at least half its
 *     usual number of sales on those days — and every member of staff who
 *     usually sells this product has sales on those days ON THIS DEVICE.
 *     Otherwise their sales have not reached this device yet (offline, not
 *     synced) or they were not at work, and nothing is said.
 *   * Not for a product that cannot sell or has been dealt with: deleted,
 *     stock not tracked, no stock left that has not expired, or changed since
 *     its last sale (restocked, edited, counted — it may have been out).
 *   * Once per quiet spell: the notice's id is made from the product and its
 *     last sale, so every device that finds it writes the SAME row (the server
 *     keeps one), and it is not repeated day after day. If the product sells
 *     and later goes quiet again, that is a new spell and a new notice.
 *   * Signed "Mfumo" but by the signed-in person, like the sync's own notices
 *     (SyncService.logSyncAnomaly), so it uploads and reaches the boss.
 */

import { v5 as uuidv5 } from 'uuid';
import { db } from '../db';
import { useStore } from '../store';
import { getValidStock } from '../utils/stock';
import { formatRate, timesPerWeek } from '../utils/auditNarrative';
import { nowDate, nowIso } from './clock';

const DAY = 86_400_000;
/** How far back a product's usual speed is measured. */
const WINDOW_DAYS = 30;
/** A business (or a device) with fewer trading days than this is not judged yet. */
const MIN_TRADING_DAYS = 7;
/** Slower than about one every two days: going quiet for a while is normal. */
const MIN_RATE = 0.5;
/** Sales expected in the quiet spell before it is worth saying (e^-3 ≈ 5%). */
const EXPECTED = 3;
/** On the quiet days the business must have made at least this share of its usual sales. */
const MIN_TRADE_SHARE = 0.5;
/** A member of staff who made this share of a product's sales "usually sells it". */
const MAIN_SELLER_SHARE = 0.25;
/** A product written to later than this after its last sale was changed since. */
const CHANGED_AFTER = 10 * 60 * 1000;
/** Ids of the notices: (product, last sale) -> the same uuid on every device. */
const NAMESPACE = '3f6c1d2a-8b47-4e95-a0c3-7d2e9f1b5a64';
const END = String.fromCharCode(0xffff);

const pad = (n: number) => String(n).padStart(2, '0');
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function quietNoticeId(productId: string, lastSoldAt: string): string {
  return uuidv5(`quiet:${productId}:${lastSoldAt}`, NAMESPACE);
}

export interface QuietProduct {
  productId: string;
  name: string;
  /** Units per trading day, over the last 30 days. */
  rate: number;
  lastSoldAt: string;
  /** Whole trading days since its last sale (today not counted). */
  gapDays: number;
  /** Sales of other products on those days. */
  otherSales: number;
  /** Units of it those days would normally have sold. */
  expected: number;
}

interface SaleLite { id: string; at: string; by: string }

/** The products that have gone quiet, by this device's sales. Most striking first. */
export async function findQuietProducts(shopId: string, now: Date = nowDate()): Promise<QuietProduct[]> {
  if (!shopId) return [];
  const nowS = now.toISOString();
  const from = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
  const sales: SaleLite[] = (await db.sales
    .where('[shop_id+isDeleted+created_at]')
    .between([shopId, 0, from], [shopId, 0, END])
    .toArray())
    .filter((s: any) => s.status !== 'cancelled' && s.status !== 'refunded' && s.created_at <= nowS)
    .map((s: any) => ({ id: s.id, at: s.created_at, by: s.user_id || '' }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (!sales.length) return [];

  const tradingDays = new Set(sales.map(s => dayKey(s.at)));
  if (tradingDays.size < MIN_TRADING_DAYS) return [];
  const salesPerDay = sales.length / tradingDays.size;
  const today = dayKey(nowS);

  const saleById = new Map(sales.map(s => [s.id, s]));
  const items = await db.saleItems.where('sale_id').anyOf([...saleById.keys()]).toArray();
  const byProduct = new Map<string, { units: number; last: string; sellers: Map<string, number> }>();
  for (const item of items as any[]) {
    if (item.isDeleted === 1 || !item.product_id) continue;
    const sale = saleById.get(item.sale_id);
    if (!sale) continue;
    const qty = Number(item.qty) || 0;
    const p = byProduct.get(item.product_id) ?? { units: 0, last: '', sellers: new Map() };
    p.units += qty;
    p.sellers.set(sale.by, (p.sellers.get(sale.by) ?? 0) + qty);
    if (sale.at > p.last) p.last = sale.at;
    byProduct.set(item.product_id, p);
  }

  const shop: any = await db.shops.get(shopId);
  // A business that does not keep stock in the app has no stock to go by.
  if (shop?.enable_stock === false) return [];
  const expiryOn = shop?.enable_expiry === true;
  const found: QuietProduct[] = [];

  for (const [productId, { units, last, sellers }] of byProduct) {
    const rate = units / tradingDays.size;
    if (rate < MIN_RATE) continue;

    // The sales after this product's last one, on whole trading days (neither
    // the day of that last sale nor today).
    let lo = 0, hi = sales.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sales[mid].at <= last) lo = mid + 1; else hi = mid; }
    const lastDay = dayKey(last);
    const gap = sales.slice(lo).filter(s => { const d = dayKey(s.at); return d !== lastDay && d !== today; });
    const gapDays = new Set(gap.map(s => dayKey(s.at))).size;
    const expected = rate * gapDays;
    if (expected < EXPECTED) continue;
    if (gap.length < MIN_TRADE_SHARE * salesPerDay * gapDays) continue;

    // Everyone who usually sells it was selling (on this device) on those days.
    const working = new Set(gap.map(s => s.by));
    const absent = [...sellers].some(([by, u]) => u >= MAIN_SELLER_SHARE * units && !working.has(by));
    if (absent) continue;

    const product: any = await db.products.get(productId);
    if (!product || product.isDeleted === 1 || product.track_stock === false) continue;
    if (getValidStock(product, expiryOn) <= 0) continue;
    const changedAt = Date.parse(product.updated_at || '');
    if (changedAt && changedAt > Date.parse(last) + CHANGED_AFTER) continue;

    found.push({ productId, name: product.name, rate, lastSoldAt: last, gapDays, otherSales: gap.length, expected });
  }
  return found.sort((a, b) => b.expected - a.expected);
}

/** The notice as stored: always Swahili. The screen builds its own sentence from the figures. */
export function quietWarningSw(q: { name: string; rate: number; gapDays: number; otherSales: number }): string {
  const speed = q.rate >= 1 ? `wastani wa ${formatRate(q.rate)} kwa siku` : `mara ${timesPerWeek(q.rate)} kwa wiki`;
  return `${q.name} huuzwa ${speed}, lakini haijauzwa hata mara moja kwa siku ${q.gapDays} zilizopita, ingawa kulikuwa na mauzo ${q.otherSales} ya bidhaa nyingine. Huenda inauzwa bila kurekodiwa: ihesabu stoo yake.`;
}

let lastRun = 0;
let running = false;
/** Not more than once in three hours on a device; the notices are idempotent anyway. */
const EVERY = 3 * 60 * 60 * 1000;

/** Look for quiet products and write one notice for each new quiet spell. */
export async function checkQuietProducts(shopId: string, opts: { now?: Date; force?: boolean } = {}): Promise<number> {
  const user: any = useStore.getState().user;
  if (!shopId || !user?.id || running) return 0;
  if (!opts.force && Date.now() - lastRun < EVERY) return 0;
  running = true;
  lastRun = Date.now();
  let written = 0;
  try {
    for (const q of await findQuietProducts(shopId, opts.now)) {
      const id = quietNoticeId(q.productId, q.lastSoldAt);
      if (await db.auditLogs.get(id)) continue;
      await db.auditLogs.add({
        id,
        shop_id: shopId,
        user_id: user.id,
        user_name: 'Mfumo',
        action: 'anomaly_ghost_items',
        details: {
          version: 2,
          product_id: q.productId,
          product_name: q.name,
          ghost_items: [q.name],
          rate: Math.round(q.rate * 10) / 10,
          last_sold_at: q.lastSoldAt,
          gap_days: q.gapDays,
          other_sales: q.otherSales,
          employee_name: 'Mfumo',
          warning: quietWarningSw(q),
        },
        isDeleted: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
        synced: 0,
      } as any);
      written++;
    }
  } catch (err) {
    console.error('[ghostItems] check failed:', err);
  } finally {
    running = false;
  }
  return written;
}
