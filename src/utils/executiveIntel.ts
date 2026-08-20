/**
 * Executive intelligence.
 *
 * The V Smart page is not a fixed report — it has three modes, and the SAME
 * shop moves between them as its data changes:
 *
 *   PULSE  — trading is happening. "Ninaendaje sasa hivi?"
 *   RISK   — money is leaking. "Ninavuja wapi?"
 *   GROWTH — nothing urgent. "Shilingi yangu ijayo itatoka wapi?"
 *
 * The mode is chosen from the numbers, not from shop type, and the choice is
 * always explained to the boss. Every figure here is money in the shop's own
 * currency — no abstract scores — so each card states something real.
 *
 * Capabilities are detected, never assumed: a shop that does not track expiry
 * simply never sees expiry cards (and gets one nudge explaining what it is
 * missing), rather than being placed in a different "type" of dashboard.
 */

import { startOfDay, subDays, differenceInDays } from 'date-fns';
import type { Product, Sale, SaleItem, Expense, AuditLog, User, DebtPayment, Shop } from '../db';

export type Mode = 'pulse' | 'risk' | 'growth';

export interface Capabilities {
  /** Expiry dates are switched on AND at least one batch actually carries one. */
  expiry: boolean;
  stock: boolean;
  staff: boolean;
  credit: boolean;
  expenses: boolean;
}

export interface IntelCard {
  id: string;
  title: string;
  detail: string;
  /** Shillings at risk (RISK) or reachable (GROWTH). 0 when not quantifiable. */
  amount: number;
  /** Ranking weight — higher shows first. */
  weight: number;
  tone: 'danger' | 'warn' | 'info' | 'good';
  action?: { label: string; route: string; spotlight?: string };
}

export interface PulseState {
  revenue: number;
  profit: number;
  transactions: number;
  goal: number;
  goalPct: number;
  /** Typical revenue by this hour, averaged over recent trading days. */
  typicalByNow: number;
  /** % ahead (+) or behind (-) that typical pace. null when there is no history. */
  paceDelta: number | null;
  cash: number;
  mobile: number;
  credit: number;
  sellers: Array<{ id: string; name: string; revenue: number; pct: number }>;
  movers: Array<{ name: string; qty: number; profit: number }>;
}

export interface Intel {
  capabilities: Capabilities;
  leaks: IntelCard[];
  totalAtRisk: number;
  opportunities: IntelCard[];
  totalUpside: number;
  pulse: PulseState;
  mode: Mode;
  /** Plain-Swahili explanation of why this mode leads today. */
  reason: string;
  avgDailyRevenue: number;
  /** Revenue per day for the last 7 days, oldest first — the trend strip. */
  weekTrend: Array<{ date: Date; revenue: number; hitGoal: boolean }>;
  streak: number;
}

// ---------------------------------------------------------------------------
// Daily goal (device-local, survives logout — never sent to Supabase)
// ---------------------------------------------------------------------------

const goalKey = (shopId: string) => `venics_goal_${shopId}`;

/** Rounds to a target a shopkeeper would actually say out loud. */
function roundGoal(value: number): number {
  if (value <= 0) return 10000;
  const step = value >= 500000 ? 50000 : value >= 100000 ? 10000 : 5000;
  return Math.max(step, Math.round(value / step) * step);
}

/** Suggested target: a small stretch on recent trading days. */
export function suggestGoal(dailyRevenues: number[]): number {
  const trading = dailyRevenues.filter((v) => v > 0);
  if (!trading.length) return 10000;
  const avg = trading.reduce((a, b) => a + b, 0) / trading.length;
  return roundGoal(avg * 1.1);
}

export function readGoal(shopId: string): number | null {
  try {
    const raw = localStorage.getItem(goalKey(shopId));
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeGoal(shopId: string, amount: number): void {
  try {
    localStorage.setItem(goalKey(shopId), String(Math.max(0, Math.round(amount))));
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isRealSale = (s: Sale) => s.status !== 'cancelled' && s.status !== 'refunded';
const saleDate = (s: Sale) => new Date(s.date || s.created_at);

function revenueByDay(sales: Sale[], days: number): Array<{ date: Date; revenue: number }> {
  const out: Array<{ date: Date; revenue: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = startOfDay(subDays(new Date(), i));
    const next = subDays(startOfDay(new Date()), i - 1);
    const revenue = sales
      .filter((s) => isRealSale(s))
      .filter((s) => {
        const d = saleDate(s);
        return d >= day && d < next;
      })
      .reduce((acc, s) => acc + (s.total_amount || 0), 0);
    out.push({ date: day, revenue });
  }
  return out;
}

/** Stock a product still has, respecting per-product stock tracking. */
function tracked(p: Product, shop?: Shop | null): boolean {
  if (p.track_stock === false) return false;
  if (shop?.enable_stock === false) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface IntelInput {
  shop?: Shop | null;
  shopId: string;
  sales: Sale[];        // last ~30 days
  saleItems: SaleItem[]; // items for those sales
  products: Product[];
  expenses: Expense[];  // last ~30 days
  auditLogs: AuditLog[];
  users: User[];
  debtPayments: DebtPayment[];
  now?: Date;
}

export function buildIntel(input: IntelInput): Intel {
  const now = input.now ?? new Date();
  const today = startOfDay(now);
  const { shop, shopId, sales, saleItems, products, expenses, auditLogs, users, debtPayments } = input;

  const live = sales.filter(isRealSale);
  const todaySales = live.filter((s) => saleDate(s) >= today);

  // ---- Capabilities -----------------------------------------------------
  const anyBatchDated = products.some((p) => (p.batches || []).some((b) => !!b.expiry_date));
  const capabilities: Capabilities = {
    expiry: shop?.enable_expiry !== false && anyBatchDated,
    stock: shop?.enable_stock !== false && products.length > 0,
    staff: users.filter((u) => u.role !== 'boss' && (u.role as string) !== 'admin').length > 0,
    credit: live.some((s) => s.payment_method === 'credit'),
    expenses: expenses.length > 0,
  };

  // ---- Trend / goal ------------------------------------------------------
  const last7 = revenueByDay(live, 7);
  const goal = readGoal(shopId) ?? suggestGoal(last7.map((d) => d.revenue));
  const weekTrend = last7.map((d) => ({ ...d, hitGoal: d.revenue >= goal }));

  let streak = 0;
  for (let i = weekTrend.length - 1; i >= 0; i--) {
    // Today only breaks a streak once it is over; while trading, skip it.
    if (i === weekTrend.length - 1 && weekTrend[i].revenue < goal) continue;
    if (weekTrend[i].revenue >= goal) streak++;
    else break;
  }

  const tradingDays = last7.filter((d) => d.revenue > 0);
  const avgDailyRevenue = tradingDays.length
    ? tradingDays.reduce((a, d) => a + d.revenue, 0) / tradingDays.length
    : 0;

  // ---- Pulse -------------------------------------------------------------
  const revenue = todaySales.reduce((a, s) => a + (s.total_amount || 0), 0);
  const profit = todaySales.reduce((a, s) => a + (s.total_profit || 0), 0);

  // Pace: how much a normal day has produced by this hour.
  const hourNow = now.getHours();
  const priorDays = live.filter((s) => saleDate(s) < today);
  const byDay = new Map<string, number>();
  for (const s of priorDays) {
    const d = saleDate(s);
    if (d.getHours() > hourNow) continue;
    const key = startOfDay(d).toISOString();
    byDay.set(key, (byDay.get(key) ?? 0) + (s.total_amount || 0));
  }
  const paceSamples = [...byDay.values()].filter((v) => v > 0);
  const typicalByNow = paceSamples.length
    ? paceSamples.reduce((a, b) => a + b, 0) / paceSamples.length
    : 0;
  const paceDelta = typicalByNow > 0 ? ((revenue - typicalByNow) / typicalByNow) * 100 : null;

  let cash = 0, mobile = 0, creditToday = 0;
  for (const s of todaySales) {
    const amt = s.total_amount || 0;
    if (s.payment_method === 'credit') creditToday += amt;
    else if (s.payment_method === 'mobile' || s.payment_method === 'mobile_money') mobile += amt;
    else cash += amt;
  }

  const revenueByUser = new Map<string, number>();
  for (const s of todaySales) {
    revenueByUser.set(s.user_id, (revenueByUser.get(s.user_id) ?? 0) + (s.total_amount || 0));
  }
  const sellers = [...revenueByUser.entries()]
    .map(([id, rev]) => ({
      id,
      name: users.find((u) => u.id === id)?.name || 'Muuzaji',
      revenue: rev,
      pct: revenue > 0 ? Math.round((rev / revenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const todayIds = new Set(todaySales.map((s) => s.id));
  const moverStats = new Map<string, { name: string; qty: number; profit: number }>();
  for (const item of saleItems) {
    if (!todayIds.has(item.sale_id)) continue;
    const entry = moverStats.get(item.product_id) ?? { name: item.product_name, qty: 0, profit: 0 };
    entry.qty += item.qty;
    entry.profit += (item.sell_price - item.buy_price) * item.qty;
    moverStats.set(item.product_id, entry);
  }
  const movers = [...moverStats.values()].sort((a, b) => b.profit - a.profit).slice(0, 3);

  const pulse: PulseState = {
    revenue, profit, transactions: todaySales.length,
    goal, goalPct: goal > 0 ? Math.min(revenue / goal, 1) : 0,
    typicalByNow, paceDelta,
    cash, mobile, credit: creditToday,
    sellers, movers,
  };

  // ---- 30-day product movement (shared by leaks and opportunities) -------
  const soldQty = new Map<string, number>();
  const soldRevenue = new Map<string, number>();
  for (const item of saleItems) {
    soldQty.set(item.product_id, (soldQty.get(item.product_id) ?? 0) + item.qty);
    soldRevenue.set(item.product_id, (soldRevenue.get(item.product_id) ?? 0) + item.sell_price * item.qty);
  }

  // ---- LEAKS -------------------------------------------------------------
  const leaks: IntelCard[] = [];

  const lossMakers = products.filter(
    (p) => p.pricing_verified !== 1 && p.buy_price > 0 && p.sell_price <= p.buy_price,
  );
  if (lossMakers.length) {
    const exposure = lossMakers.reduce(
      (a, p) => a + (p.buy_price - p.sell_price) * Math.max(0, tracked(p, shop) ? p.stock : 1),
      0,
    );
    leaks.push({
      id: 'loss_pricing',
      title: 'Unauza chini ya bei ya kununua',
      detail: `Bidhaa ${lossMakers.length} zinauzwa kwa bei iliyo chini au sawa na uliyonunua. Kila mauzo yanakula mtaji wako.`,
      amount: exposure,
      weight: 100,
      tone: 'danger',
      action: { label: 'Rekebisha bei', route: '/bidhaa', spotlight: 'product-search' },
    });
  }

  if (capabilities.expiry) {
    const window = shop?.notify_expiry_days ?? 30;
    let expiredValue = 0, expiredCount = 0;
    let soonValue = 0, soonCount = 0;

    for (const p of products) {
      for (const b of p.batches || []) {
        if (!b.expiry_date || b.stock <= 0) continue;
        const daysLeft = differenceInDays(new Date(b.expiry_date), today);
        const value = b.stock * (p.buy_price || 0);
        if (daysLeft < 0) { expiredValue += value; expiredCount++; }
        else if (daysLeft <= window) { soonValue += value; soonCount++; }
      }
    }

    if (expiredValue > 0) {
      leaks.push({
        id: 'expired_stock',
        title: 'Mzigo umeisha muda',
        detail: `Mafungu ${expiredCount} tayari yameisha muda na bado yapo stoo. Hii ni hasara iliyokwisha tokea — iondoe kwenye hesabu zako.`,
        amount: expiredValue,
        weight: 95,
        tone: 'danger',
        action: { label: 'Kagua bidhaa', route: '/bidhaa', spotlight: 'product-search' },
      });
    }
    if (soonValue > 0) {
      leaks.push({
        id: 'expiring_soon',
        title: 'Mzigo unakaribia kuisha muda',
        detail: `Mafungu ${soonCount} yataisha muda ndani ya siku ${window}. Yauze kwa punguzo sasa badala ya kuyatupa baadaye.`,
        amount: soonValue,
        weight: 88,
        tone: 'warn',
        action: { label: 'Panga promosheni', route: '/bidhaa', spotlight: 'product-search' },
      });
    }
  }

  if (capabilities.credit) {
    const paidBySale = new Map<string, number>();
    for (const p of debtPayments) {
      paidBySale.set(p.sale_id, (paidBySale.get(p.sale_id) ?? 0) + p.amount);
    }
    let overdue = 0, overdueCount = 0, outstanding = 0;
    for (const s of live) {
      if (s.payment_method !== 'credit' || s.status !== 'pending') continue;
      const remaining = (s.total_amount || 0) - (paidBySale.get(s.id) ?? 0);
      if (remaining <= 0.1) continue;
      outstanding += remaining;
      if (s.due_date && new Date(s.due_date) < today) { overdue += remaining; overdueCount++; }
    }

    if (overdue > 0) {
      leaks.push({
        id: 'overdue_debt',
        title: 'Madeni yamechelewa kulipwa',
        detail: `Wateja ${overdueCount} wamepitisha tarehe ya kulipa. Hizi ni pesa zako zilizokaa nje ya duka.`,
        amount: overdue,
        weight: 92,
        tone: 'danger',
        action: { label: 'Wakumbushe', route: '/madeni', spotlight: 'debts-list' },
      });
    }
    if (outstanding - overdue > 0) {
      // Not a leak yet, but cash that could be working.
      leaks.push({
        id: 'outstanding_debt',
        title: 'Pesa zilizo nje (bado hazijachelewa)',
        detail: 'Madeni ambayo bado yapo ndani ya muda. Yakikusanywa mapema yanaongeza mzunguko wa pesa dukani.',
        amount: outstanding - overdue,
        weight: 40,
        tone: 'info',
        action: { label: 'Angalia madeni', route: '/madeni', spotlight: 'debts-list' },
      });
    }
  }

  if (capabilities.stock) {
    const dead = products.filter(
      (p) => tracked(p, shop) && p.stock > 0 && !(soldQty.get(p.id) ?? 0),
    );
    if (dead.length) {
      const frozen = dead.reduce((a, p) => a + p.stock * (p.buy_price || 0), 0);
      if (frozen > 0) {
        leaks.push({
          id: 'dead_stock',
          title: 'Mtaji umelala kwenye mzigo',
          detail: `Bidhaa ${dead.length} hazijauzwa hata kimoja mwezi mzima. Pesa zako zimekaa kwenye rafu badala ya kuzunguka.`,
          amount: frozen,
          weight: 70,
          tone: 'warn',
          action: { label: 'Ziangalie', route: '/bidhaa', spotlight: 'product-search' },
        });
      }
    }
  }

  // Expenses that were being recorded and then stopped — profit is overstated.
  const recentExpenses = expenses.filter((e) => new Date(e.date || e.created_at) >= subDays(today, 7));
  const olderExpenses = expenses.filter((e) => new Date(e.date || e.created_at) < subDays(today, 7));
  if (capabilities.expenses && recentExpenses.length === 0 && olderExpenses.length > 0 && revenue > 0) {
    const dailyAvg = olderExpenses.reduce((a, e) => a + e.amount, 0) / 23;
    leaks.push({
      id: 'missing_expenses',
      title: 'Hujarekodi matumizi wiki hii',
      detail: 'Ulikuwa unarekodi matumizi, kisha ukasimama. Faida unayoiona sasa ni kubwa kuliko uhalisia.',
      amount: Math.max(0, Math.round(dailyAvg * 7)),
      weight: 80,
      tone: 'warn',
      action: { label: 'Rekodi matumizi', route: '/matumizi', spotlight: 'add-expense-btn' },
    });
  }

  const todayLogs = auditLogs.filter((l) => new Date(l.created_at) >= today);
  const refundsToday = live.length
    ? sales.filter((s) => s.status === 'refunded' && saleDate(s) >= today)
    : [];
  const anomalies = todayLogs.filter((l) => (l.action as string).startsWith('anomaly_'));
  if (refundsToday.length > 0 || anomalies.length > 0) {
    const refundValue = refundsToday.reduce((a, s) => a + (s.total_amount || 0), 0);
    leaks.push({
      id: 'suspicious_activity',
      title: 'Mabadiliko ya kuangaliwa leo',
      detail: `Kumefanyika marejesho ${refundsToday.length} na viashiria ${anomalies.length} vya mabadiliko yasiyo ya kawaida leo.`,
      amount: refundValue,
      weight: 85,
      tone: 'danger',
      action: { label: 'Kagua mabadiliko', route: '/audit-logs', spotlight: 'audit-list' },
    });
  }

  leaks.sort((a, b) => b.weight - a.weight || b.amount - a.amount);
  // Outstanding (not-yet-due) debt is cash flow, not a leak — keep it out of the headline.
  const totalAtRisk = leaks
    .filter((l) => l.id !== 'outstanding_debt')
    .reduce((a, l) => a + l.amount, 0);

  // ---- OPPORTUNITIES -----------------------------------------------------
  const opportunities: IntelCard[] = [];

  if (capabilities.stock) {
    const runningOut = products.filter(
      (p) => tracked(p, shop) && (soldQty.get(p.id) ?? 0) > 0 && p.stock <= p.min_stock,
    );
    if (runningOut.length) {
      // A week of sales you would lose at the current rate.
      const upside = runningOut.reduce((a, p) => {
        const perDay = (soldQty.get(p.id) ?? 0) / 30;
        return a + perDay * 7 * Math.max(0, p.sell_price - p.buy_price);
      }, 0);
      opportunities.push({
        id: 'restock_movers',
        title: 'Agiza bidhaa zinazouzwa haraka',
        detail: `Bidhaa ${runningOut.length} zinauzwa vizuri lakini stoo inaisha. Zikikosekana, wateja watanunua kwingine.`,
        amount: Math.round(upside),
        weight: 95,
        tone: 'good',
        action: { label: 'Agiza sasa', route: '/bidhaa', spotlight: 'product-search' },
      });
    }

    const slowHighMargin = products.filter((p) => {
      if (!tracked(p, shop) || p.stock <= 0 || p.buy_price <= 0) return false;
      const margin = (p.sell_price - p.buy_price) / p.buy_price;
      return margin > 0.4 && (soldQty.get(p.id) ?? 0) === 0;
    });
    if (slowHighMargin.length) {
      const upside = slowHighMargin.reduce(
        (a, p) => a + p.stock * (p.sell_price - p.buy_price), 0,
      );
      opportunities.push({
        id: 'promote_margin',
        title: 'Bidhaa zenye faida kubwa hazitembei',
        detail: `Bidhaa ${slowHighMargin.length} zina faida kubwa lakini hazijauzwa mwezi huu. Zipe nafasi mbele au punguzo dogo.`,
        amount: Math.round(upside),
        weight: 82,
        tone: 'good',
        action: { label: 'Zipange', route: '/bidhaa', spotlight: 'product-search' },
      });
    }
  }

  // Peak hour — when the shop actually makes its money.
  const byHour = new Array(24).fill(0);
  for (const s of live) byHour[saleDate(s).getHours()] += s.total_amount || 0;
  const peakHour = byHour.indexOf(Math.max(...byHour));
  if (Math.max(...byHour) > 0 && live.length >= 10) {
    opportunities.push({
      id: 'peak_hour',
      title: `Saa za kilele: ${peakHour}:00 – ${(peakHour + 1) % 24}:00`,
      detail: 'Hapa ndipo pesa nyingi zinaingia. Hakikisha bidhaa zimejaa na mfanyakazi yupo muda huu.',
      amount: 0,
      weight: 55,
      tone: 'info',
    });
  }

  // Best sellers with thin margins — a small price move compounds.
  const topByVolume = [...soldQty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const thin = topByVolume
    .map(([id]) => products.find((p) => p.id === id))
    .filter((p): p is Product => !!p && p.buy_price > 0 && (p.sell_price - p.buy_price) / p.buy_price < 0.15);
  if (thin.length) {
    const upside = thin.reduce((a, p) => a + (soldRevenue.get(p.id) ?? 0) * 0.05, 0);
    opportunities.push({
      id: 'margin_lift',
      title: 'Bidhaa maarufu zina faida nyembamba',
      detail: `Bidhaa ${thin.length} zinazouzwa sana zina faida ndogo. Nyongeza ndogo ya bei (5%) inaweza kuongeza faida bila kupoteza wateja.`,
      amount: Math.round(upside),
      weight: 78,
      tone: 'good',
      action: { label: 'Pitia bei', route: '/bidhaa', spotlight: 'product-search' },
    });
  }

  // Capability nudge — dynamic, not a different dashboard.
  if (!capabilities.expiry && capabilities.stock && products.some((p) => p.stock > 0)) {
    opportunities.push({
      id: 'enable_expiry',
      title: 'Hufuatilii tarehe ya kuisha muda',
      detail: 'Ukiwasha expiry, nitakuonya kabla mzigo haujaharibika badala ya kugundua umeshakwisha. Ni muhimu kwa vinywaji, vyakula na dawa.',
      amount: 0,
      weight: 45,
      tone: 'info',
      action: { label: 'Washa expiry', route: '/zaidi', spotlight: 'expiry-section' },
    });
  }
  if (!capabilities.expenses && revenue > 0) {
    opportunities.push({
      id: 'start_expenses',
      title: 'Hujaanza kurekodi matumizi',
      detail: 'Bila matumizi, faida unayoiona ni ya bidhaa tu — siyo pesa halisi zinazobaki mfukoni.',
      amount: 0,
      weight: 60,
      tone: 'info',
      action: { label: 'Anza sasa', route: '/matumizi', spotlight: 'add-expense-btn' },
    });
  }

  opportunities.sort((a, b) => b.weight - a.weight || b.amount - a.amount);
  const totalUpside = opportunities.reduce((a, o) => a + o.amount, 0);

  // ---- Mode selection ----------------------------------------------------
  // Expressed in days of revenue, so the same rule fits a kiosk and a wholesaler.
  const riskDays = avgDailyRevenue > 0 ? totalAtRisk / avgDailyRevenue : totalAtRisk > 0 ? 99 : 0;

  let mode: Mode;
  let reason: string;

  if (riskDays >= 2) {
    mode = 'risk';
    reason = `Nimeanza na Kinga kwa sababu kuna kiasi kinacholingana na mauzo ya siku ${riskDays.toFixed(1)} kilicho hatarini.`;
  } else if (todaySales.length > 0) {
    mode = 'pulse';
    reason = paceDelta === null
      ? 'Nimeanza na Leo kwa sababu biashara inaendelea sasa hivi.'
      : paceDelta >= 0
        ? `Nimeanza na Leo — upo mbele ya kasi yako ya kawaida kwa ${Math.round(paceDelta)}%.`
        : `Nimeanza na Leo — upo nyuma ya kasi yako ya kawaida kwa ${Math.round(Math.abs(paceDelta))}%.`;
  } else if (opportunities.length > 0) {
    mode = 'growth';
    reason = 'Hakuna hatari kubwa na bado hujauza leo — hebu tuangalie pa kuongeza mauzo.';
  } else {
    mode = 'pulse';
    reason = 'Kila kitu kipo shwari. Anza kuuza na nitakufuatilia hapa.';
  }

  return {
    capabilities, leaks, totalAtRisk, opportunities, totalUpside,
    pulse, mode, reason, avgDailyRevenue, weekTrend, streak,
  };
}
