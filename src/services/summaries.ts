import { db, registerSaleMutationListener, type SalesDaily } from '../db';
import { format, startOfDay } from 'date-fns';

// -----------------------------------------------------------------------------
// Rolling daily rollups (salesDaily / salesEmployeeDaily).
//
// Reports read these instead of scanning every raw sale, so all-time totals,
// trends, monthly/yearly reports and the employee "Zote" stay O(days), not
// O(sales). Rollups are rebuilt for just the affected day whenever a sale is
// written locally OR pulled in via sync (see the sales hook in db.ts).
// -----------------------------------------------------------------------------

const BACKFILL_FLAG_PREFIX = 'summaries_backfilled_v20_';

export function msToDateStr(ms: number): string {
  return format(new Date(ms), 'yyyy-MM-dd');
}

function localDateOf(createdAtIso: string): string {
  return format(new Date(createdAtIso), 'yyyy-MM-dd');
}

// Rebuild both rollup tables for a single shop+day from the raw sales of that day.
export async function rebuildSummaryForDate(shopId: string, dateStr: string): Promise<void> {
  const dayStart = startOfDay(new Date(`${dateStr}T00:00:00`)).getTime();
  const startIso = new Date(dayStart).toISOString();
  const endIso = new Date(dayStart + 86400000).toISOString();

  const rangeRows = await db.sales
    .where('[shop_id+isDeleted+created_at]')
    .between([shopId, 0, startIso], [shopId, 0, endIso], true, false)
    .toArray();

  // Guard against timezone edge rows: keep only sales whose LOCAL day matches.
  const daySales = rangeRows.filter((s) => localDateOf(s.created_at) === dateStr);

  const dailyId = `${shopId}_${dateStr}`;

  if (daySales.length === 0) {
    // Day emptied out (e.g. everything refunded) — drop stale rollups.
    await db.salesDaily.delete(dailyId);
    await db.salesEmployeeDaily.where('[shop_id+date]').equals([shopId, dateStr]).delete();
    return;
  }

  let revenue = 0;
  let profit = 0;
  const byEmp = new Map<string, { revenue: number; profit: number; count: number }>();
  for (const s of daySales) {
    const amt = s.total_amount || 0;
    const prf = s.total_profit || 0;
    revenue += amt;
    profit += prf;
    const uid = s.user_id || 'unknown';
    const e = byEmp.get(uid) || { revenue: 0, profit: 0, count: 0 };
    e.revenue += amt;
    e.profit += prf;
    e.count += 1;
    byEmp.set(uid, e);
  }

  const nowIso = new Date().toISOString();

  await db.salesDaily.put({
    id: dailyId, shop_id: shopId, date: dateStr,
    revenue, profit, count: daySales.length, updated_at: nowIso,
  });

  await db.salesEmployeeDaily.where('[shop_id+date]').equals([shopId, dateStr]).delete();
  const empRows = Array.from(byEmp.entries()).map(([uid, v]) => ({
    id: `${shopId}_${dateStr}_${uid}`,
    shop_id: shopId, date: dateStr, user_id: uid,
    revenue: v.revenue, profit: v.profit, count: v.count, updated_at: nowIso,
  }));
  if (empRows.length) await db.salesEmployeeDaily.bulkPut(empRows);
}

// --- Dirty-day tracking + debounced flush (driven by the sales hook) ---------
const dirty = new Map<string, Set<string>>(); // shopId -> set of YYYY-MM-DD
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDirty();
  }, 800);
}

async function flushDirty(): Promise<void> {
  const snapshot = new Map(dirty);
  dirty.clear();
  for (const [shopId, dates] of snapshot) {
    for (const dateStr of dates) {
      try {
        await rebuildSummaryForDate(shopId, dateStr);
      } catch (e) {
        console.error('[summaries] rebuild failed for', shopId, dateStr, e);
      }
    }
  }
}

registerSaleMutationListener((shopId, createdAtIso) => {
  try {
    let set = dirty.get(shopId);
    if (!set) {
      set = new Set();
      dirty.set(shopId, set);
    }
    set.add(localDateOf(createdAtIso));
    scheduleFlush();
  } catch {
    /* ignore */
  }
});

// Force-rebuild the pending dirty days RIGHT NOW (bypasses the 800ms debounce).
// Called before generating a report so it reflects everything just synced, without
// re-scanning the whole period. No-op (instant) when nothing has changed.
export async function flushDirtyNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushDirty();
}

// One-time full backfill for an existing shop (runs once per shop, cursor-streamed
// so it never loads the whole sales table into memory).
export async function ensureSummariesBackfill(shopId: string): Promise<void> {
  if (!shopId) return;
  const flag = BACKFILL_FLAG_PREFIX + shopId;
  if (localStorage.getItem(flag) === 'done') return;

  try {
    type Day = { revenue: number; profit: number; count: number; emp: Map<string, { revenue: number; profit: number; count: number }> };
    const perDay = new Map<string, Day>();

    await db.sales.where('[shop_id+isDeleted]').equals([shopId, 0]).each((s) => {
      const dateStr = localDateOf(s.created_at);
      let d = perDay.get(dateStr);
      if (!d) {
        d = { revenue: 0, profit: 0, count: 0, emp: new Map() };
        perDay.set(dateStr, d);
      }
      const amt = s.total_amount || 0;
      const prf = s.total_profit || 0;
      d.revenue += amt;
      d.profit += prf;
      d.count += 1;
      const uid = s.user_id || 'unknown';
      const e = d.emp.get(uid) || { revenue: 0, profit: 0, count: 0 };
      e.revenue += amt;
      e.profit += prf;
      e.count += 1;
      d.emp.set(uid, e);
    });

    const nowIso = new Date().toISOString();
    const dailyRows: SalesDaily[] = [];
    const empRows: any[] = [];
    for (const [dateStr, d] of perDay) {
      dailyRows.push({ id: `${shopId}_${dateStr}`, shop_id: shopId, date: dateStr, revenue: d.revenue, profit: d.profit, count: d.count, updated_at: nowIso });
      for (const [uid, e] of d.emp) {
        empRows.push({ id: `${shopId}_${dateStr}_${uid}`, shop_id: shopId, date: dateStr, user_id: uid, revenue: e.revenue, profit: e.profit, count: e.count, updated_at: nowIso });
      }
    }

    // Replace any existing rollups for this shop, then write fresh.
    await db.salesDaily.where('shop_id').equals(shopId).delete();
    await db.salesEmployeeDaily.where('shop_id').equals(shopId).delete();
    if (dailyRows.length) await db.salesDaily.bulkPut(dailyRows);
    if (empRows.length) await db.salesEmployeeDaily.bulkPut(empRows);

    localStorage.setItem(flag, 'done');
  } catch (e) {
    console.error('[summaries] backfill failed', e);
  }
}

// Rebuild the rollups for EVERY day in [startMs, endMs] straight from raw sales.
// Used right before generating a report so the numbers reflect all currently-synced
// data (not just whatever the debounced background flush happened to process). The
// caller caps the span; the guard is a hard safety limit (~2 years of days).
export async function rebuildSummariesRange(shopId: string, startMs: number, endMs: number): Promise<void> {
  if (!shopId) return;
  const dayMs = 86400000;
  let t = startOfDay(new Date(startMs)).getTime();
  let guard = 0;
  while (t <= endMs && guard < 800) {
    try {
      await rebuildSummaryForDate(shopId, msToDateStr(t));
    } catch (e) {
      console.error('[summaries] range rebuild failed for', msToDateStr(t), e);
    }
    t += dayMs;
    guard++;
  }
}

// --- Read helpers (date range is inclusive, YYYY-MM-DD) ----------------------
export async function getSalesTotals(shopId: string, startDateStr: string, endDateStr: string) {
  const rows = await db.salesDaily.where('[shop_id+date]').between([shopId, startDateStr], [shopId, endDateStr], true, true).toArray();
  return rows.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, profit: acc.profit + r.profit, count: acc.count + r.count }),
    { revenue: 0, profit: 0, count: 0 }
  );
}

export async function getDailySeries(shopId: string, startDateStr: string, endDateStr: string): Promise<SalesDaily[]> {
  return db.salesDaily.where('[shop_id+date]').between([shopId, startDateStr], [shopId, endDateStr], true, true).toArray();
}

// Per-day series for a SINGLE employee (from the salesEmployeeDaily rollups) — used
// for charts where a non-boss must only see their own numbers, not the whole shop.
export async function getEmployeeDailySeries(
  shopId: string,
  userId: string,
  startDateStr: string,
  endDateStr: string
): Promise<{ date: string; revenue: number; profit: number; count: number }[]> {
  const rows = await db.salesEmployeeDaily
    .where('[shop_id+date]')
    .between([shopId, startDateStr], [shopId, endDateStr], true, true)
    .toArray();
  return rows
    .filter((r) => r.user_id === userId)
    .map((r) => ({ date: r.date, revenue: r.revenue, profit: r.profit, count: r.count }));
}

export async function getEmployeeTotals(shopId: string, startDateStr: string, endDateStr: string) {
  const rows = await db.salesEmployeeDaily.where('[shop_id+date]').between([shopId, startDateStr], [shopId, endDateStr], true, true).toArray();
  const m = new Map<string, { revenue: number; profit: number; count: number }>();
  for (const r of rows) {
    const e = m.get(r.user_id) || { revenue: 0, profit: 0, count: 0 };
    e.revenue += r.revenue;
    e.profit += r.profit;
    e.count += r.count;
    m.set(r.user_id, e);
  }
  return m;
}
