/**
 * Historia's receipts, a page at a time.
 *
 * Only what is on the screen is read. This computer's own receipts come
 * straight off the date index, newest first, stopping as soon as the page is
 * full, so a shop's tenth year opens as fast as its first week. Receipts from
 * before this computer's history window (services/dailyTotals.ts) are asked of
 * the server 50 at a time, only when someone scrolls that far back
 * (public.history_receipts in 20261104_sales_daily_and_history.sql), and are
 * not stored.
 */

import { db } from '../db';
import { supabase } from '../supabase';
import { historyWindowMs, payKind, type PayKind } from './dailyTotals';

export const RECEIPTS_PAGE = 50;

export interface ReceiptLine { id: string; product_name: string; qty: number; sell_price: number }
export interface Receipt {
  id: string;
  created_at: string;
  user_id: string;
  total_amount: number;
  total_profit: number;
  payment_method: string;
  customer_name?: string;
  customer_phone?: string;
  due_date?: string;
  lines: ReceiptLine[];
  /** Came from the server for this screen only: not on this computer. */
  cloud?: boolean;
}

export interface ReceiptQuery {
  shopId: string;
  /** ms, inclusive */
  from: number;
  /** ms, exclusive (Infinity: up to now) */
  to: number;
  payment: PayKind | 'all';
  seller: string | 'all';
  /** Staff see only their own. */
  onlyUser?: string;
  search: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

function keep(q: ReceiptQuery) {
  return (s: any) =>
    (q.payment === 'all' || payKind(s.payment_method) === q.payment) &&
    (q.seller === 'all' || s.user_id === q.seller) &&
    (!q.onlyUser || s.user_id === q.onlyUser);
}

async function linesFor(saleIds: string[]): Promise<Map<string, ReceiptLine[]>> {
  const bySale = new Map<string, ReceiptLine[]>();
  if (!saleIds.length) return bySale;
  const items = await db.saleItems.where('sale_id').anyOf(saleIds).filter(i => i.isDeleted !== 1).toArray();
  for (const i of items) {
    const list = bySale.get(i.sale_id) ?? [];
    list.push({ id: i.id, product_name: i.product_name, qty: i.qty, sell_price: i.sell_price });
    bySale.set(i.sale_id, list);
  }
  return bySale;
}

const asReceipt = (s: any, lines: ReceiptLine[]): Receipt => ({
  id: s.id, created_at: s.created_at, user_id: s.user_id, total_amount: Number(s.total_amount) || 0,
  total_profit: Number(s.total_profit) || 0, payment_method: s.payment_method, customer_name: s.customer_name,
  customer_phone: s.customer_phone, due_date: s.due_date, lines,
});

/** Where this computer's own receipts start for a query (its history window). */
export function localFloor(q: ReceiptQuery): number {
  return Math.max(q.from, historyWindowMs(q.shopId));
}

/** The newest `limit` receipts on this computer for a query, and whether there are more. */
export async function localReceipts(q: ReceiptQuery, limit: number): Promise<{ receipts: Receipt[]; more: boolean }> {
  const floor = localFloor(q);
  if (!q.shopId || q.to <= floor) return { receipts: [], more: false };
  const lower = [q.shopId, 0, iso(floor)];
  const upperIso = Number.isFinite(q.to) ? iso(q.to) : '￿';
  const term = q.search.trim().toLowerCase();

  const filtered = !!term || q.payment !== 'all' || q.seller !== 'all' || !!q.onlyUser;

  if (!filtered) {
    // Newest first straight off the index, stopping as soon as the page is full.
    const rows = await db.sales.where('[shop_id+isDeleted+created_at]')
      .between(lower, [q.shopId, 0, upperIso], true, false)
      .reverse().limit(limit + 1).toArray();
    const page = rows.slice(0, limit);
    const lines = await linesFor(page.map(s => s.id));
    return { receipts: page.map(s => asReceipt(s, lines.get(s.id) ?? [])), more: rows.length > limit };
  }

  // Filtered or searching: a row-by-row walk with a test on each row is slow in
  // IndexedDB, and over years of sales a rare filter would read them all that
  // way. So the period is read back in date chunks (a plain range read, the
  // fast path), newest first: two weeks, then twice as long each time little
  // was found, until the page is full or the period ends.
  const oldest = await db.sales.where('[shop_id+isDeleted+created_at]').between(lower, [q.shopId, 0, upperIso], true, false).first();
  if (!oldest) return { receipts: [], more: false };
  const stop = Math.max(floor, new Date(oldest.created_at).getTime());
  const match = keep(q);
  const found: Receipt[] = [];
  let hi = Number.isFinite(q.to) ? q.to : Date.now() + 86400000;
  let firstChunk = true;
  let span = 14 * 86400000;
  while (found.length <= limit && hi > stop) {
    const lo = Math.max(stop, hi - span);
    // The first chunk reaches to the top of the range ('\uffff' when open), so a
    // sale stamped ahead of this computer's clock is not left out.
    const chunk = await db.sales.where('[shop_id+isDeleted+created_at]')
      .between([q.shopId, 0, iso(lo)], [q.shopId, 0, firstChunk ? upperIso : iso(hi)], true, false)
      .toArray();
    const firstChunk0 = firstChunk;
    firstChunk = false;
    const candidates = chunk.filter(match).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
    if (candidates.length) {
      if (!term) {
        const need = candidates.slice(0, limit + 1 - found.length);
        const lines = await linesFor(need.map(s => s.id));
        for (const s of need) found.push(asReceipt(s, lines.get(s.id) ?? []));
      } else {
        // The chunk's lines in one range read: looking them up sale by sale
        // made a search through years of sales take minutes.
        const live = new Set(candidates.map(s => s.id));
        const lines = new Map<string, ReceiptLine[]>();
        const chunkItems = await db.saleItems.where('[shop_id+created_at]')
          .between([q.shopId, new Date(lo - 86400000).toISOString()], [q.shopId, firstChunk0 ? upperIso : new Date(hi + 86400000).toISOString()], true, true)
          .toArray();
        for (const i of chunkItems) {
          if (i.isDeleted === 1 || !live.has(i.sale_id)) continue;
          const list = lines.get(i.sale_id) ?? [];
          list.push({ id: i.id, product_name: i.product_name, qty: i.qty, sell_price: i.sell_price });
          lines.set(i.sale_id, list);
        }
        // Lines without a date (very old rows) are looked up the slow way.
        const undated = candidates.filter(s => !lines.has(s.id)).map(s => s.id);
        if (undated.length && undated.length <= 200) for (const [id, l] of await linesFor(undated)) lines.set(id, l);
        for (const s of candidates) {
          const mine = lines.get(s.id) ?? [];
          const hit = (s.customer_name || '').toLowerCase().includes(term)
            || (s.customer_phone || '').toLowerCase().includes(term)
            || mine.some(l => l.product_name.toLowerCase().includes(term));
          if (hit) found.push(asReceipt(s, mine));
          if (found.length > limit) break;
        }
      }
    }
    if (found.length < limit / 2) span = Math.min(span * 2, 400 * 86400000);
    hi = lo;
  }
  return { receipts: found.slice(0, limit), more: found.length > limit };
}

/** Whether a query reaches back before this computer's history window. */
export function needsCloud(q: ReceiptQuery): boolean {
  const windowMs = historyWindowMs(q.shopId);
  return windowMs > 0 && q.from < windowMs && !q.onlyUser;
}

/** The next `limit` older receipts from the server, after `before` (the last one shown). */
export async function cloudReceipts(q: ReceiptQuery, before: Receipt | null, limit = RECEIPTS_PAGE): Promise<{ receipts: Receipt[]; done: boolean }> {
  const windowMs = historyWindowMs(q.shopId);
  const to = Math.min(Number.isFinite(q.to) ? q.to : windowMs, windowMs);
  const { data, error } = await supabase.rpc('history_receipts', {
    p_from: iso(q.from),
    p_to: iso(to),
    p_before_at: before?.created_at ?? null,
    p_before_id: before?.id ?? null,
    p_limit: limit,
    p_search: q.search.trim() || null,
    p_payment: q.payment === 'all' ? null : q.payment,
    p_seller: q.seller === 'all' ? null : q.seller,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const receipts = rows.map((r: any) => ({
    ...asReceipt(r, (r.items ?? []).map((i: any) => ({ id: i.id, product_name: i.product_name, qty: Number(i.qty) || 0, sell_price: Number(i.sell_price) || 0 }))),
    cloud: true,
  }));
  return { receipts, done: receipts.length < limit };
}
