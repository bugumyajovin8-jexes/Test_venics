/**
 * Sales totals by day — what Historia, its reports and the PDF add up, instead
 * of reading every sale.
 *
 * One row per shop, day, seller and payment kind (cash / mobile / credit):
 * revenue, profit and number of sales. A year is a few hundred rows however
 * busy the shop, so any period adds up in an instant. The idea is the Mobile
 * app's (services/summaries.ts), kept per seller and payment kind so the
 * filters work on totals too.
 *
 * Two sources, never mixed for the same day:
 *   salesDaily       built here from this computer's own sales, rebuilt for a
 *                    day whenever one of its sales is written (locally or by
 *                    sync). Always right for days whose sales are all here.
 *   salesDailyCloud  pulled from the server's sales_daily
 *                    (20261104_sales_daily_and_history.sql).
 * A computer that signed in after that migration downloads only recent sales
 * (see the history window below); days before that come from the cloud copy.
 * Every other computer has all its sales and uses its own totals throughout.
 */

import { format, startOfDay } from 'date-fns';
import { db, registerSaleMutationListener, type Sale, type SalesDaily } from '../db';

export type PayKind = 'cash' | 'mobile' | 'credit';
export const NO_SELLER = '00000000-0000-0000-0000-000000000000';

export function payKind(method: Sale['payment_method'] | string | null | undefined): PayKind {
  if (method === 'credit') return 'credit';
  if (method === 'mobile_money' || method === 'mobile') return 'mobile';
  return 'cash';
}

export const dateKey = (ms: number | Date) => format(ms, 'yyyy-MM-dd');

// ---------------------------------------------------------------------------
// The history window: from when this computer holds every sale of the shop.
// ---------------------------------------------------------------------------
const windowKey = (shopId: string) => `history_window_${shopId}`;

/** ISO instant from which this computer has all the shop's sales, or null if it has them all. */
export function historyWindow(shopId: string): string | null {
  try {
    return localStorage.getItem(windowKey(shopId));
  } catch {
    return null;
  }
}

export function setHistoryWindow(shopId: string, iso: string | null): void {
  try {
    if (iso) localStorage.setItem(windowKey(shopId), iso);
    else localStorage.removeItem(windowKey(shopId));
  } catch {
    /* storage blocked: this computer then behaves as one holding everything */
  }
}

/** Start of the window in ms (0 when this computer has every sale). */
export function historyWindowMs(shopId: string): number {
  const iso = historyWindow(shopId);
  const ms = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

// ---------------------------------------------------------------------------
// Building this computer's own totals
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;
const midnight = (day: string) => new Date(`${day}T00:00:00`).getTime();
// Days rebuilt together: one read of their sales and one write of their rows.
// Rebuilding a long stretch one day at a time, one write each, is slow, and
// everything showing totals re-reads them after every write.
const BATCH_DAYS = 90;

function addSale(rows: Map<string, SalesDaily>, shopId: string, day: string, s: any) {
  const seller = s.user_id || NO_SELLER;
  const method = payKind(s.payment_method);
  const id = `${shopId}_${day}_${seller}_${method}`;
  const row = rows.get(id) ?? { id, shop_id: shopId, date: day, user_id: seller, method, revenue: 0, profit: 0, count: 0 };
  row.revenue += Number(s.total_amount) || 0;
  row.profit += Number(s.total_profit) || 0;
  row.count += 1;
  rows.set(id, row);
}

/** Rebuilds the rows of the given days (sorted or not) from this computer's sales. */
export async function rebuildDays(shopId: string, days: Iterable<string>): Promise<void> {
  const sorted = [...new Set(days)].sort();
  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i];
    const group: string[] = [];
    while (i < sorted.length && midnight(sorted[i]) < midnight(first) + BATCH_DAYS * DAY_MS) group.push(sorted[i++]);
    const last = group[group.length - 1];
    const wanted = new Set(group);
    // A day either side: a local day is not a UTC day.
    const sales = await db.sales.where('[shop_id+isDeleted+created_at]')
      .between([shopId, 0, new Date(midnight(first) - DAY_MS).toISOString()], [shopId, 0, new Date(midnight(last) + 2 * DAY_MS).toISOString()], true, false)
      .toArray();
    const rows = new Map<string, SalesDaily>();
    for (const s of sales) {
      const at = new Date(s.created_at).getTime();
      if (!Number.isFinite(at)) continue;
      const day = dateKey(at);
      if (wanted.has(day)) addSale(rows, shopId, day, s);
    }
    await db.transaction('rw', db.salesDaily, async () => {
      // Ids first, then one bulk delete: a filtered delete goes row by row and
      // took about a second per batch.
      const old = (await db.salesDaily.where('[shop_id+date]').between([shopId, first], [shopId, last], true, true).toArray())
        .filter(r => wanted.has(r.date)).map(r => r.id);
      if (old.length) await db.salesDaily.bulkDelete(old);
      if (rows.size) await db.salesDaily.bulkPut([...rows.values()]);
    });
  }
}

/** Rebuilds one day's rows from the day's sales on this computer. */
export function rebuildDay(shopId: string, day: string): Promise<void> {
  return rebuildDays(shopId, [day]);
}

// Days touched by a write, rebuilt shortly after (a sync writes many at once).
const dirty = new Map<string, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Days written while a full build is reading: it may have read them before the
// write, so they are rebuilt again once it has saved.
const touchedDuringBuild = new Map<string, Set<string>>();
const backfills = new Map<string, Promise<void>>();

// The rebuild under way, if any: one at a time, and "now" waits for it.
let flushing: Promise<void> | null = null;

function flushDirty(): Promise<void> {
  const run = (flushing ?? Promise.resolve()).then(async () => {
    const work = [...dirty.entries()];
    dirty.clear();
    for (const [shopId, days] of work) {
      // A full build is under way: it takes these days in when it finishes.
      if (backfills.has(shopId)) continue;
      try {
        await rebuildDays(shopId, days);
      } catch (e) {
        console.error('[dailyTotals] rebuild failed', e);
      }
    }
  });
  const mine = run.finally(() => { if (flushing === mine) flushing = null; });
  flushing = mine;
  return mine;
}

registerSaleMutationListener((shopId, createdAt) => {
  if (!shopId || !createdAt) return;
  const at = new Date(createdAt).getTime();
  if (!Number.isFinite(at)) return;
  let days = dirty.get(shopId);
  if (!days) dirty.set(shopId, (days = new Set()));
  days.add(dateKey(at));
  touchedDuringBuild.get(shopId)?.add(dateKey(at));
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushDirty();
    }, 600);
  }
});

/** Rebuilds the days waiting to be rebuilt now, so a report includes what was just written. */
export async function flushDailyNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushDirty();
}

const BACKFILL_FLAG = (shopId: string) => `daily_totals_v1_${shopId}`;

/**
 * Once per shop on each computer: builds the totals for every day it already
 * has sales for, BATCH_DAYS at a time.
 */
export function ensureDailyTotals(shopId: string): Promise<void> {
  if (!shopId) return Promise.resolve();
  const running = backfills.get(shopId);
  if (running) return running;
  const job = (async () => {
    let built = false;
    try {
      built = localStorage.getItem(BACKFILL_FLAG(shopId)) === 'done';
    } catch {
      /* build */
    }
    // The note alone is not trusted: if the totals are gone (the database was
    // emptied some other way) while sales are here, they are built again.
    if (built && ((await db.salesDaily.where('shop_id').equals(shopId).limit(1).count()) > 0
      || (await db.sales.where('[shop_id+isDeleted]').equals([shopId, 0]).limit(1).count()) === 0)) return;
    touchedDuringBuild.set(shopId, new Set());
    // Separate collections: first() and last() change the one they are called on.
    const range = () => db.sales.where('[shop_id+isDeleted+created_at]').between([shopId, 0, ''], [shopId, 0, '\uffff']);
    const oldest = await range().first();
    const newest = await range().last();
    const stale = await db.salesDaily.where('shop_id').equals(shopId).primaryKeys();
    if (stale.length) await db.salesDaily.bulkDelete(stale);
    if (oldest && newest) {
      const days: string[] = [];
      for (let t = midnight(dateKey(new Date(oldest.created_at).getTime())); t <= new Date(newest.created_at).getTime() + DAY_MS; t += DAY_MS) days.push(dateKey(t));
      await rebuildDays(shopId, days);
    }
    // Days written meanwhile, and any left waiting while this ran.
    const again = new Set([...(touchedDuringBuild.get(shopId) ?? []), ...(dirty.get(shopId) ?? [])]);
    dirty.delete(shopId);
    if (again.size) await rebuildDays(shopId, again);
    try {
      localStorage.setItem(BACKFILL_FLAG(shopId), 'done');
    } catch {
      /* built again next time: harmless */
    }
  })().finally(() => {
    backfills.delete(shopId);
    touchedDuringBuild.delete(shopId);
  });
  backfills.set(shopId, job);
  return job;
}

export function dailyTotalsReady(shopId: string): boolean {
  try {
    return localStorage.getItem(BACKFILL_FLAG(shopId)) === 'done';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reading totals
// ---------------------------------------------------------------------------

export interface DayRow { date: string; user_id: string; method: PayKind; revenue: number; profit: number; count: number }

/**
 * The rows for [fromDay, toDay] (inclusive, 'yyyy-MM-dd'): this computer's own
 * for days it holds every sale of, the cloud's before that.
 */
export async function dailyRows(shopId: string, fromDay: string, toDay: string): Promise<DayRow[]> {
  if (!shopId || fromDay > toDay) return [];
  const windowMs = historyWindowMs(shopId);
  const firstLocalDay = windowMs ? dateKey(windowMs) : '0000-01-01';
  const out: DayRow[] = [];
  if (toDay >= firstLocalDay) {
    const from = fromDay > firstLocalDay ? fromDay : firstLocalDay;
    const local = await db.salesDaily.where('[shop_id+date]').between([shopId, from], [shopId, toDay], true, true).toArray();
    for (const r of local) out.push({ date: r.date, user_id: r.user_id, method: r.method, revenue: r.revenue, profit: r.profit, count: r.count });
  }
  if (windowMs && fromDay < firstLocalDay) {
    const lastCloudDay = toDay < firstLocalDay ? toDay : dateKey(new Date(`${firstLocalDay}T00:00:00`).getTime() - 86400000);
    const cloud = await db.salesDailyCloud.where('[shop_id+date]').between([shopId, fromDay], [shopId, lastCloudDay], true, true).toArray();
    for (const r of cloud) out.push({ date: r.date, user_id: r.user_id, method: r.method as PayKind, revenue: Number(r.revenue) || 0, profit: Number(r.profit) || 0, count: Number(r.count) || 0 });
  }
  return out;
}

export interface Totals { revenue: number; profit: number; count: number }

/** Adds rows up, keeping only a payment kind and/or seller if given. */
export function sumRows(rows: DayRow[], filter: { payment?: PayKind | 'all'; seller?: string | 'all' } = {}): Totals {
  const t = { revenue: 0, profit: 0, count: 0 };
  for (const r of rows) {
    if (filter.payment && filter.payment !== 'all' && r.method !== filter.payment) continue;
    if (filter.seller && filter.seller !== 'all' && r.user_id !== filter.seller) continue;
    t.revenue += r.revenue;
    t.profit += r.profit;
    t.count += r.count;
  }
  return t;
}
