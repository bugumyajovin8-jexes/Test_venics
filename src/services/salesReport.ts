/**
 * "Pakua Ripoti (PDF)" on Historia → Ripoti: the business report as a PDF file.
 *
 * The same report the Mobile app makes (banner, totals, charts drawn as vector
 * shapes, income statement, signature), built from this computer's own data,
 * plus what a boss at a desk wants next to it: the period before for
 * comparison, how customers paid and what credit is still unpaid, the best
 * products, each seller's sales, expenses by group, and the busiest day and hour.
 *
 * jsPDF is loaded only when a report is made, so the app does not carry it.
 */

import type { jsPDF } from 'jspdf';
import { addDays, endOfMonth, format, startOfDay, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns';
import { db } from '../db';
import { supabase } from '../supabase';
import { formatCurrency } from '../utils/format';
import { monthNames, t, tData, weekdayNames } from '../i18n';
import { dailyRows, dateKey, ensureDailyTotals, flushDailyNow, historyWindowMs, type DayRow } from './dailyTotals';

type RGB = [number, number, number];
export type ReportPeriod = 'mwezi' | 'mwezi_uliopita' | 'miezi3' | 'miezi6' | 'mwaka' | 'custom';
type Group = 'day' | 'month';

export function reportPeriods(): { id: Exclude<ReportPeriod, 'custom'>; label: string; hint: string }[] {
  return [
    { id: 'mwezi', label: t('Mwezi Huu'), hint: t('Mchanganuo wa kila siku') },
    { id: 'mwezi_uliopita', label: t('Mwezi Uliopita'), hint: t('Mwezi mzima uliopita, kila siku') },
    { id: 'miezi3', label: t('Miezi 3'), hint: t('Robo ya mwaka, kwa mwezi') },
    { id: 'miezi6', label: t('Miezi 6'), hint: t('Nusu mwaka, kwa mwezi') },
    { id: 'mwaka', label: t('Mwaka Huu'), hint: t('Mwaka mzima, kwa mwezi') },
  ];
}

const shortMonth = (d: Date) => monthNames()[d.getMonth()].slice(0, 3);
const dayLabel = (d: Date) => `${d.getDate()} ${shortMonth(d)}`;
const monthLabel = (d: Date) => `${monthNames()[d.getMonth()]} ${d.getFullYear()}`;
const longDate = (d: Date) => `${d.getDate()} ${monthNames()[d.getMonth()]} ${d.getFullYear()}`;

/** Start and end of a period, how its rows are grouped, and how it is named. */
export function reportRange(period: ReportPeriod, custom?: { from: string; to: string }): { start: Date; end: Date; group: Group; name: string } {
  const now = new Date();
  switch (period) {
    case 'mwezi': return { start: startOfMonth(now), end: now, group: 'day', name: monthLabel(now) };
    case 'mwezi_uliopita': {
      const last = subMonths(now, 1);
      return { start: startOfMonth(last), end: endOfMonth(last), group: 'day', name: monthLabel(last) };
    }
    case 'miezi3': return { start: startOfMonth(subMonths(now, 2)), end: now, group: 'month', name: t('Miezi 3') };
    case 'miezi6': return { start: startOfMonth(subMonths(now, 5)), end: now, group: 'month', name: t('Miezi 6') };
    case 'mwaka': return { start: startOfYear(now), end: now, group: 'month', name: String(now.getFullYear()) };
    case 'custom':
    default: {
      const start = new Date(`${custom?.from}T00:00:00`);
      const lastDay = new Date(`${custom?.to}T00:00:00`);
      const end = new Date(lastDay.getTime() + 86400000 - 1);
      const days = Math.round((lastDay.getTime() - start.getTime()) / 86400000) + 1;
      return { start, end, group: days <= 62 ? 'day' : 'month', name: `${longDate(start)} - ${longDate(lastDay)}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers (vector shapes, so the PDF is sharp at any zoom)
// ---------------------------------------------------------------------------

function drawGroupedBars(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  labels: string[], series: { name: string; color: RGB; values: number[] }[], fmt: (n: number) => string,
): void {
  const plotBottom = y + h;
  const maxVal = Math.max(1, ...series.flatMap(s => s.values).map(v => Math.abs(v)));
  doc.setFontSize(6.5);
  for (let i = 0; i <= 4; i++) {
    const gy = plotBottom - (h * i) / 4;
    doc.setDrawColor(223, 227, 233);
    doc.setLineWidth(0.15);
    doc.line(x, gy, x + w, gy);
    doc.setTextColor(120, 126, 138);
    doc.text(fmt((maxVal * i) / 4), x - 2, gy + 1, { align: 'right' });
  }
  const groups = Math.max(1, labels.length);
  const groupW = w / groups;
  const barGap = groupW * 0.14;
  const innerW = groupW - barGap * 2;
  const barW = innerW / Math.max(1, series.length);
  // A month of days does not fit a label under every bar: every few days.
  const every = Math.ceil(groups / 12);
  labels.forEach((label, gi) => {
    const gx = x + gi * groupW + barGap;
    series.forEach((s, si) => {
      const bh = (Math.max(0, s.values[gi] || 0) / maxVal) * h;
      doc.setFillColor(s.color[0], s.color[1], s.color[2]);
      doc.rect(gx + si * barW, plotBottom - bh, barW * 0.84, bh, 'F');
    });
    if (gi % every === 0 || gi === groups - 1) {
      doc.setFontSize(6.5);
      doc.setTextColor(120, 126, 138);
      doc.text(label, gx + innerW / 2, plotBottom + 4, { align: 'center' });
    }
  });
  let lx = x;
  const ly = plotBottom + 10;
  doc.setFontSize(7.5);
  series.forEach(s => {
    doc.setFillColor(s.color[0], s.color[1], s.color[2]);
    doc.rect(lx, ly - 2.4, 3, 3, 'F');
    doc.setTextColor(80, 80, 80);
    doc.text(s.name, lx + 4.2, ly);
    lx += 4.2 + doc.getTextWidth(s.name) + 8;
  });
}

function drawDonut(doc: jsPDF, cx: number, cy: number, r: number, slices: { label: string; value: number; color: RGB }[], fmt: (n: number) => string): void {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  let angle = -Math.PI / 2;
  slices.forEach(s => {
    const sweep = (Math.max(0, s.value) / total) * Math.PI * 2;
    if (sweep <= 0) return;
    // One filled shape per slice: drawn as many triangles, the PDF showed
    // hairline seams between them.
    const steps = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * 96));
    const points: [number, number][] = [[cx, cy]];
    for (let i = 0; i <= steps; i++) {
      const a = angle + (sweep * i) / steps;
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    const segments = points.slice(1).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
    doc.setFillColor(s.color[0], s.color[1], s.color[2]);
    doc.lines(segments, cx, cy, [1, 1], 'F', true);
    angle += sweep;
  });
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, r * 0.56, 'F');
  let ly = cy - r + 3;
  const lx = cx + r + 7;
  slices.forEach(s => {
    const pct = ((Math.max(0, s.value) / total) * 100).toFixed(1);
    doc.setFillColor(s.color[0], s.color[1], s.color[2]);
    doc.rect(lx, ly - 2.6, 3.4, 3.4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(55, 55, 55);
    doc.text(`${s.label}  ${pct}%`, lx + 5, ly);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(125, 125, 125);
    doc.text(fmt(Math.max(0, s.value)), lx + 5, ly + 4);
    ly += 10.5;
  });
}

/** Horizontal bars with the label above and the amount at the end. */
function drawHBars(doc: jsPDF, x: number, y: number, w: number, rows: { label: string; value: number; color: RGB; note?: string }[], fmt: (n: number) => string): void {
  const max = Math.max(1, ...rows.map(r => r.value));
  rows.forEach((r, i) => {
    const ry = y + i * 11;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(55, 55, 55);
    doc.text(r.label, x, ry);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 110, 110);
    doc.text(`${fmt(r.value)}${r.note ? `  ·  ${r.note}` : ''}`, x + w, ry, { align: 'right' });
    doc.setFillColor(238, 241, 245);
    doc.roundedRect(x, ry + 1.6, w, 3.2, 1.2, 1.2, 'F');
    const bw = (Math.max(0, r.value) / max) * w;
    if (bw > 0.5) {
      doc.setFillColor(r.color[0], r.color[1], r.color[2]);
      doc.roundedRect(x, ry + 1.6, bw, 3.2, 1.2, 1.2, 'F');
    }
  });
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

interface Totals { revenue: number; gross: number; count: number }
const sum = (rows: DayRow[]): Totals => rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, gross: a.gross + r.profit, count: a.count + r.count }), { revenue: 0, gross: 0, count: 0 });

async function expensesBetween(shopId: string, start: Date, end: Date) {
  return db.expenses.where('[shop_id+isDeleted+date]').between([shopId, 0, start.toISOString()], [shopId, 0, end.toISOString()], true, true).toArray();
}

/** What the daily totals do not hold: products, items, hours, unpaid credit. */
interface Extras { top: { name: string; qty: number; revenue: number; profit: number }[]; units: number; byHour: number[]; unpaid: number }

/** From this computer's own sales, when it has all of the period's. */
async function localExtras(shopId: string, start: Date, end: Date): Promise<Extras> {
  const sales = await db.sales.where('[shop_id+isDeleted+created_at]').between([shopId, 0, start.toISOString()], [shopId, 0, end.toISOString()], true, true).toArray();
  // Range reads, not lookups by sale id: a year can be a hundred thousand sales.
  const live = new Set(sales.map(x => x.id));
  const [allItems, allPayments] = await Promise.all([
    db.saleItems.where('[shop_id+created_at]').between([shopId, start.toISOString()], [shopId, end.toISOString()], true, true).toArray(),
    db.debtPayments.where('shop_id').equals(shopId).toArray(),
  ]);
  const items = allItems.filter(i => i.isDeleted !== 1 && live.has(i.sale_id));
  const payments = allPayments.filter(p => p.isDeleted !== 1 && live.has(p.sale_id));
  const products = new Map<string, Extras['top'][number]>();
  items.forEach(i => {
    const p = products.get(i.product_id) ?? { name: i.product_name, qty: 0, revenue: 0, profit: 0 };
    p.qty += i.qty; p.revenue += i.qty * i.sell_price; p.profit += (i.sell_price - i.buy_price) * i.qty;
    products.set(i.product_id, p);
  });
  const byHour = Array(24).fill(0);
  sales.forEach(x => { byHour[new Date(x.created_at).getHours()] += 1; });
  const paid = new Map<string, number>();
  payments.forEach(p => paid.set(p.sale_id, (paid.get(p.sale_id) ?? 0) + Number(p.amount)));
  const unpaid = sales.filter(x => x.payment_method === 'credit')
    .reduce((a, x) => a + (x.is_paid ? 0 : Math.max(0, x.total_amount - (paid.get(x.id) ?? 0))), 0);
  return {
    top: [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    units: items.reduce((a, i) => a + i.qty, 0),
    byHour,
    unpaid,
  };
}

/** From the server, for a period reaching back before what this computer downloaded. Null offline. */
async function cloudExtras(start: Date, end: Date): Promise<Extras | null> {
  try {
    const { data, error } = await supabase.rpc('sales_report_extras', { p_from: start.toISOString(), p_to: new Date(end.getTime() + 1).toISOString() });
    if (error || !data) return null;
    return {
      top: (data.top_products ?? []).map((p: any) => ({ name: p.name, qty: Number(p.qty) || 0, revenue: Number(p.revenue) || 0, profit: Number(p.profit) || 0 })),
      units: Number(data.units_sold) || 0,
      byHour: Array.isArray(data.by_hour) ? data.by_hour.map((n: any) => Number(n) || 0) : Array(24).fill(0),
      unpaid: Number(data.unpaid_credit) || 0,
    };
  } catch {
    return null;
  }
}

/** Makes and downloads the report. 'empty' when the period has nothing to report. */
export async function downloadSalesReport(opts: {
  shopId: string;
  currency: string;
  fallbackShopName: string;
  period: ReportPeriod;
  custom?: { from: string; to: string };
}): Promise<'saved' | 'empty'> {
  const { shopId, currency } = opts;
  const range = reportRange(opts.period, opts.custom);
  // The day totals, current up to what was just written.
  await ensureDailyTotals(shopId);
  await flushDailyNow();
  const [dayRows, expenses, shop, users] = await Promise.all([
    dailyRows(shopId, dateKey(range.start), dateKey(range.end)),
    expensesBetween(shopId, range.start, range.end),
    db.shops.get(shopId),
    db.users.where('shop_id').equals(shopId).toArray(),
  ]);
  if (sum(dayRows).count === 0 && expenses.length === 0) return 'empty';

  // What to compare with: last month against the month before, this month
  // against the same days of last month, the year against last year's same
  // stretch; any other range against the same length just before it.
  const back = { mwezi: 1, mwezi_uliopita: 1, miezi3: 3, miezi6: 6, mwaka: 12, custom: 0 }[opts.period];
  let prevStart: Date;
  let prevEnd: Date;
  if (opts.period === 'mwezi_uliopita') {
    prevStart = startOfMonth(subMonths(range.start, 1));
    prevEnd = endOfMonth(prevStart);
  } else if (back === 12) {
    prevStart = subYears(range.start, 1);
    prevEnd = subYears(range.end, 1);
  } else if (back > 0) {
    prevStart = subMonths(range.start, back);
    prevEnd = subMonths(range.end, back);
  } else {
    const span = range.end.getTime() - range.start.getTime();
    prevEnd = new Date(range.start.getTime() - 1);
    prevStart = new Date(range.start.getTime() - span - 1);
  }
  const [prevRows, prevExpenses] = await Promise.all([dailyRows(shopId, dateKey(prevStart), dateKey(prevEnd)), expensesBetween(shopId, prevStart, prevEnd)]);

  // A period this computer holds every sale of is worked out here; one reaching
  // further back asks the server, and without internet those parts are left out.
  const extras = range.start.getTime() >= historyWindowMs(shopId)
    ? await localExtras(shopId, range.start, range.end)
    : await cloudExtras(range.start, range.end);

  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new JsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 14;
  const contentW = pageW - M * 2;
  const money = (n: number) => formatCurrency(n, currency);
  const compact = (n: number) => {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
  };
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const brand: RGB = [37, 99, 235];
  const green: RGB = [22, 163, 74];
  const purple: RGB = [124, 58, 237];
  const orange: RGB = [234, 88, 12];
  const amber: RGB = [217, 119, 6];
  const sky: RGB = [14, 165, 233];
  const grey: RGB = [148, 163, 184];

  // ---- Figures ----
  const now = sum(dayRows);
  const spent = expenses.reduce((a, e) => a + e.amount, 0);
  const net = now.gross - spent;
  const margin = now.revenue > 0 ? (net / now.revenue) * 100 : 0;
  const avgSale = now.count > 0 ? Math.round(now.revenue / now.count) : 0;
  const unitsSold = extras?.units ?? null;
  const cogs = Math.max(0, now.revenue - now.gross);

  const before = sum(prevRows);
  const beforeNet = before.gross - prevExpenses.reduce((a, e) => a + e.amount, 0);
  const change = (a: number, b: number) => (b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);

  // Rows of the income statement: every day (or month) of the period, even quiet ones.
  const rows: { key: string; label: string; chart: string; mapato: number; faida: number; matumizi: number; mauzo: number }[] = [];
  const rowAt = new Map<string, (typeof rows)[number]>();
  const keyOf = (d: Date) => (range.group === 'day' ? format(d, 'yyyy-MM-dd') : format(d, 'yyyy-MM'));
  for (let d = startOfDay(range.start); d <= range.end; d = range.group === 'day' ? addDays(d, 1) : startOfMonth(addDays(endOfMonth(d), 1))) {
    // Whole weekday names: in Swahili their first letters are mostly "Jum".
    const row = { key: keyOf(d), label: range.group === 'day' ? `${weekdayNames()[d.getDay()]} ${dayLabel(d)}` : monthLabel(d), chart: range.group === 'day' ? String(d.getDate()) : `${shortMonth(d)} ${String(d.getFullYear()).slice(2)}`, mapato: 0, faida: 0, matumizi: 0, mauzo: 0 };
    rows.push(row);
    rowAt.set(row.key, row);
  }
  dayRows.forEach(d => { const r = rowAt.get(keyOf(new Date(`${d.date}T00:00:00`))); if (r) { r.mapato += d.revenue; r.faida += d.profit; r.mauzo += d.count; } });
  expenses.forEach(e => { const r = rowAt.get(keyOf(new Date(e.date))); if (r) r.matumizi += e.amount; });

  // How customers paid, and the credit still owed.
  const byMethod = { cash: 0, mobile: 0, credit: 0 };
  dayRows.forEach(d => { byMethod[d.method] += d.revenue; });
  const unpaid = extras?.unpaid ?? null;

  // Products, sellers, expense groups.
  const topProducts = extras?.top ?? [];
  const names = new Map(users.map(u => [u.id, u.name]));
  const sellers = new Map<string, { name: string; count: number; revenue: number; profit: number }>();
  dayRows.forEach(d => {
    const v = sellers.get(d.user_id) ?? { name: names.get(d.user_id) || t('Mtumiaji'), count: 0, revenue: 0, profit: 0 };
    v.count += d.count; v.revenue += d.revenue; v.profit += d.profit;
    sellers.set(d.user_id, v);
  });
  for (const [id, v] of sellers) if (v.count === 0 && v.revenue === 0) sellers.delete(id);
  const expenseGroups = new Map<string, number>();
  expenses.forEach(e => expenseGroups.set(e.category, (expenseGroups.get(e.category) ?? 0) + e.amount));

  // When the shop is busiest.
  const byWeekday = Array(7).fill(0);
  dayRows.forEach(d => { byWeekday[new Date(`${d.date}T00:00:00`).getDay()] += d.revenue; });
  const bestWeekday = byWeekday.indexOf(Math.max(...byWeekday));
  const byHour = extras?.byHour ?? null;
  const bestHour = byHour && byHour.some(n => n > 0) ? byHour.indexOf(Math.max(...byHour)) : null;

  // ======================= PAGE 1 =======================
  doc.setFillColor(brand[0], brand[1], brand[2]);
  doc.rect(0, 0, pageW, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text(shop?.name || opts.fallbackShopName || t('Biashara'), M, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(t('Ripoti ya Kifedha na Uamuzi wa Biashara'), M, 21.5);
  doc.setFontSize(8);
  doc.text(t('Imetolewa: {format}', { format: format(new Date(), 'dd/MM/yyyy HH:mm') }), pageW - M, 13, { align: 'right' });
  doc.text(t('Muhtasari: {periodLabel}', { periodLabel: range.name }), pageW - M, 20, { align: 'right' });

  doc.setTextColor(90, 90, 90);
  doc.setFontSize(9);
  doc.text(t('Mmiliki: {v}', { v: shop?.owner_name || '-' }), M, 40);
  doc.text(t('Simu: {v}', { v: shop?.phone || '-' }), M + 68, 40);
  doc.text(t('Kipindi: {rangeLabel}', { rangeLabel: `${longDate(range.start)} - ${longDate(range.end)}` }), M + 112, 40);

  // Eight totals, two rows.
  const cards = [
    { label: t('Jumla ya Mapato'), value: money(now.revenue), color: brand },
    { label: t('Faida Ghafi'), value: money(now.gross), color: green },
    { label: t('Matumizi'), value: money(spent), color: orange },
    { label: t('Faida Halisi'), value: money(net), color: net >= 0 ? green : orange },
    { label: t('Margin ya Faida'), value: pct(margin), color: purple },
    { label: t('Idadi ya Mauzo'), value: now.count.toLocaleString(), color: sky },
    { label: t('Wastani kwa Risiti'), value: money(avgSale), color: brand },
    { label: t('Bidhaa Zilizouzwa'), value: unitsSold === null ? '—' : unitsSold.toLocaleString(), color: amber },
  ];
  const gap = 4;
  const cardW = (contentW - gap * 3) / 4;
  const cardH = 19;
  cards.forEach((c, i) => {
    const cx = M + (i % 4) * (cardW + gap);
    const cy = 46 + Math.floor(i / 4) * (cardH + 4);
    doc.setFillColor(247, 248, 250);
    doc.roundedRect(cx, cy, cardW, cardH, 2, 2, 'F');
    doc.setFillColor(c.color[0], c.color[1], c.color[2]);
    doc.rect(cx, cy + 2, 1.6, cardH - 4, 'F');
    doc.setTextColor(120, 120, 120);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(c.label, cx + 5, cy + 6.5);
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(c.value, cx + 5, cy + 14);
  });

  // Against the period before.
  let y = 46 + cardH * 2 + 4 + 7;
  doc.setFillColor(239, 246, 255);
  doc.roundedRect(M, y - 5, contentW, 12, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 64, 175);
  doc.text(t('Ukilinganisha na kipindi kilichotangulia ({from} - {to})', { from: dayLabel(prevStart), to: dayLabel(prevEnd) }), M + 4, y);
  doc.setFont('helvetica', 'normal');
  const delta = (label: string, a: number, b: number) => {
    const c = change(a, b);
    return `${label}: ${c === null ? t('hakuna cha kulinganisha') : `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`}`;
  };
  doc.setTextColor(55, 65, 81);
  doc.text([delta(t('Mapato'), now.revenue, before.revenue), delta(t('Faida Halisi'), net, beforeNet), delta(t('Idadi ya Mauzo'), now.count, before.count)].join('     '), M + 4, y + 4.5);

  // Trend.
  y += 16;
  doc.setTextColor(40, 40, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(t('Mwenendo wa Mapato na Faida Halisi'), M, y);
  const chartRows = range.group === 'day' ? rows : rows.slice(-12);
  drawGroupedBars(doc, M + 16, y + 6, contentW - 16, 40,
    chartRows.map(r => r.chart),
    [
      { name: t('Mapato'), color: brand, values: chartRows.map(r => r.mapato) },
      { name: t('Faida Halisi'), color: green, values: chartRows.map(r => Math.max(0, r.faida - r.matumizi)) },
    ],
    compact);

  // Where each shilling goes, and how customers paid.
  y += 66;
  doc.setTextColor(40, 40, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(t('Mgawanyo wa Kila Shilingi ya Mapato'), M, y);
  doc.text(t('Njia za Malipo'), M + contentW / 2 + 4, y);
  drawDonut(doc, M + 22, y + 26, 19, [
    { label: t('Gharama ya Bidhaa'), value: cogs, color: grey },
    { label: t('Matumizi'), value: spent, color: orange },
    { label: t('Faida Halisi'), value: Math.max(0, net), color: green },
  ], money);
  const share = (v: number) => (now.revenue > 0 ? pct((v / now.revenue) * 100) : '0%');
  drawHBars(doc, M + contentW / 2 + 4, y + 10, contentW / 2 - 4, [
    { label: t('Taslimu'), value: byMethod.cash, color: green, note: share(byMethod.cash) },
    { label: t('Kwa Simu'), value: byMethod.mobile, color: sky, note: share(byMethod.mobile) },
    { label: t('Mkopo'), value: byMethod.credit, color: amber, note: share(byMethod.credit) },
  ], money);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  if (unpaid !== null) {
    doc.setTextColor(unpaid > 0 ? 180 : 90, unpaid > 0 ? 83 : 90, unpaid > 0 ? 9 : 90);
    doc.text(t('Mikopo ya kipindi hiki ambayo bado haijalipwa: {v}', { v: money(unpaid) }), M + contentW / 2 + 4, y + 46);
  }
  if (!extras) {
    // Offline, for days this computer did not download: say what is missing.
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(7.5);
    doc.text(t('Bidhaa, saa za mauzo na mikopo hazikupatikana: hakuna mtandao.'), M, y + 52);
  }

  // ======================= PAGE 2 =======================
  doc.addPage();
  doc.setFillColor(brand[0], brand[1], brand[2]);
  doc.rect(0, 0, pageW, 4, 'F');
  doc.setTextColor(40, 40, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(t('Uchambuzi na Mapendekezo'), M, 18);

  const insights: string[] = [];
  insights.push(
    margin < 0
      ? t('Biashara ina hasara ya {money}. Kagua gharama za bidhaa na matumizi haraka.', { money: money(Math.abs(net)) })
      : margin < 10
        ? t('Margin ya faida ni {marginPct}% — ni ya chini. Ongeza bei kidogo au punguza gharama ili kuboresha faida.', { marginPct: margin.toFixed(1) })
        : t('Margin ya faida ni {marginPct}% — kiwango kizuri na chenye afya kwa biashara.', { marginPct: margin.toFixed(1) }),
  );
  const revChange = change(now.revenue, before.revenue);
  if (revChange !== null) {
    insights.push(t('Mapato {v} kwa {g}% ukilinganisha na kipindi kilichotangulia.', { v: revChange >= 0 ? t('yameongezeka') : t('yamepungua'), g: Math.abs(revChange).toFixed(1) }));
  }
  const busiest = [...rows].sort((a, b) => b.mapato - a.mapato)[0];
  if (busiest && busiest.mapato > 0) insights.push(t('Kipindi bora ni {label} chenye mapato ya {mapato}.', { label: busiest.label, mapato: money(busiest.mapato) }));
  if (now.count > 0 && bestHour !== null) {
    insights.push(t('Siku yenye mauzo makubwa zaidi ni {day}; saa za mauzo mengi ni {from}:00 - {to}:00.', { day: weekdayNames()[bestWeekday], from: String(bestHour).padStart(2, '0'), to: String((bestHour + 1) % 24).padStart(2, '0') }));
  } else if (now.count > 0) {
    insights.push(t('Siku yenye mauzo makubwa zaidi ni {day}.', { day: weekdayNames()[bestWeekday] }));
  }
  if (topProducts[0]) insights.push(t('Bidhaa inayoleta mapato mengi zaidi ni {name} ({v}).', { name: topProducts[0].name, v: money(topProducts[0].revenue) }));
  const expRatio = now.revenue > 0 ? (spent / now.revenue) * 100 : 0;
  insights.push(t('Matumizi ni {expRatio}% ya mapato{v}', { expRatio: expRatio.toFixed(1), v: expRatio > 30 ? t(' — ni juu, jaribu kubana gharama za uendeshaji.') : '.' }));
  if (byMethod.credit > 0 && unpaid !== null) insights.push(t('Mauzo ya mkopo ni {share} ya mapato; {unpaid} bado hayajalipwa.', { share: share(byMethod.credit), unpaid: money(unpaid) }));
  insights.push(t('Wastani wa mauzo kwa risiti moja ni {avgSale}.', { avgSale: money(avgSale) }));

  y = 27;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(55, 55, 55);
  insights.forEach(line => {
    doc.setFillColor(brand[0], brand[1], brand[2]);
    doc.circle(M + 1.2, y - 1.2, 0.9, 'F');
    const wrapped = doc.splitTextToSize(line, contentW - 6);
    doc.text(wrapped, M + 5, y);
    y += wrapped.length * 5 + 2.5;
  });

  const tableStyle = {
    theme: 'striped' as const,
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [246, 248, 251] as RGB },
    margin: { left: M, right: M },
  };
  const heading = (text: string, at: number) => {
    let hy = at;
    if (hy > pageH - 40) { doc.addPage(); hy = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text(text, M, hy);
    return hy + 4;
  };
  const after = () => (doc as any).lastAutoTable.finalY + 11;
  // Number columns: right-aligned, headings included.
  const right = (...cols: number[]) => ({
    columnStyles: Object.fromEntries(cols.map(c => [c, { halign: 'right' as const }])),
    didParseCell: (data: any) => { if (data.section === 'head' && cols.includes(data.column.index)) data.cell.styles.halign = 'right'; },
  });

  if (topProducts.length) {
    autoTable(doc, {
      ...tableStyle,
      startY: heading(t('Bidhaa 10 Zinazoongoza'), y + 5),
      head: [['#', t('Bidhaa'), t('Idadi'), t('Mapato'), t('Faida')]],
      body: topProducts.map((p, i) => [String(i + 1), p.name, p.qty.toLocaleString(), money(p.revenue), money(p.profit)]),
      ...right(2, 3, 4),
      columnStyles: { 0: { cellWidth: 8 }, ...right(2, 3, 4).columnStyles },
    });
    y = after();
  }
  if (sellers.size) {
    autoTable(doc, {
      ...tableStyle,
      startY: heading(t('Mauzo kwa Muuzaji'), y),
      head: [[t('Muuzaji'), t('Risiti'), t('Mapato'), t('Faida'), t('Sehemu ya Mapato')]],
      body: [...sellers.values()].sort((a, b) => b.revenue - a.revenue).map(v => [v.name, v.count.toLocaleString(), money(v.revenue), money(v.profit), share(v.revenue)]),
      ...right(1, 2, 3, 4),
    });
    y = after();
  }
  if (expenseGroups.size) {
    autoTable(doc, {
      ...tableStyle,
      startY: heading(t('Matumizi kwa Kundi'), y),
      head: [[t('Kundi'), t('Kiasi'), t('Sehemu ya Matumizi')]],
      body: [...expenseGroups.entries()].sort((a, b) => b[1] - a[1]).map(([cat, amount]) => [tData(cat), money(amount), spent > 0 ? pct((amount / spent) * 100) : '0%']),
      ...right(1, 2),
    });
    y = after();
  }

  // ======================= Income statement + declaration =======================
  const body = [...rows].reverse().map(r => [r.label, money(r.mapato), money(r.faida), money(r.matumizi), money(r.faida - r.matumizi), r.mauzo.toLocaleString()]);
  body.push([t('JUMLA'), money(now.revenue), money(now.gross), money(spent), money(net), now.count.toLocaleString()]);
  autoTable(doc, {
    ...tableStyle,
    startY: heading(t('Taarifa ya Mapato (Income Statement)'), y),
    head: [[t('Kipindi'), t('Mapato'), t('Faida Ghafi'), t('Matumizi'), t('Faida Halisi'), t('Mauzo')]],
    body,
    // A month of days fits on one page with the signature under it.
    styles: body.length > 20 ? { fontSize: 7.8, cellPadding: 1.35 } : tableStyle.styles,
    columnStyles: right(1, 2, 3, 4, 5).columnStyles,
    didParseCell: (data: any) => {
      right(1, 2, 3, 4, 5).didParseCell(data);
      if (data.section === 'body' && data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [232, 238, 246];
      }
      // A day that lost money stands out.
      if (data.section === 'body' && data.column.index === 4 && data.row.index < body.length - 1 && String(data.cell.raw).includes('-')) {
        data.cell.styles.textColor = [220, 38, 38];
      }
    },
  });

  let fy = after() + 3;
  if (fy > pageH - 45) { doc.addPage(); fy = 24; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(40, 40, 40);
  doc.text(t('Uthibitisho'), M, fy);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(t('Ninathibitisha kuwa taarifa zilizopo kwenye ripoti hii ni sahihi kwa ufahamu wangu.'), M, fy + 7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(40, 40, 40);
  doc.text(t('Sahihi: __________________________'), M, fy + 20);
  doc.text(t('Jina: {v}', { v: shop?.owner_name || '' }), M, fy + 28);
  doc.text(t('Tarehe: {format}', { format: format(new Date(), 'dd/MM/yyyy') }), M, fy + 36);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(t('Imetengenezwa na Venics Sales'), M, pageH - 8);
    doc.text(t('Ukurasa {i}/{pages}', { i, pages }), pageW - M, pageH - 8, { align: 'right' });
  }

  doc.save(`ripoti_${format(range.start, 'yyyy-MM-dd')}_${format(range.end, 'yyyy-MM-dd')}.pdf`);
  return 'saved';
}
