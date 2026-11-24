/**
 * "Ripoti ya Siku" — one day of the shop, as the Mobile app shows it
 * (Mobile app/src/pages/RipotiYaSiku.tsx): a day bar with a month calendar,
 * the day's totals, how the money came in, and the day's sales and expenses.
 *
 * Opened from Historia's "Chagua tarehe". Totals come from the daily rows
 * (services/dailyTotals.ts), so any day adds up at once. The day's receipts are
 * this computer's own; a day from before a new computer's history window is
 * fetched from the server 50 at a time (services/historyReceipts.ts).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, addMonths, format, getDaysInMonth, isBefore, isSameDay, startOfDay, startOfMonth } from 'date-fns';
import { ArrowLeft, Banknote, Calendar, ChevronLeft, ChevronRight, Clock, Coins, Lock, PiggyBank, RefreshCw, ShoppingBag, Smartphone, TrendingUp, Wallet } from 'lucide-react';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { t, tData, monthNames, weekdayNames } from '../i18n';
import { dailyRows, dateKey, historyWindowMs, payKind, sumRows, type DayRow } from '../services/dailyTotals';
import { cloudReceipts, localReceipts, needsCloud, RECEIPTS_PAGE, type Receipt, type ReceiptQuery } from '../services/historyReceipts';

const dayLabel = (d: Date) => `${weekdayNames()[d.getDay()]}, ${d.getDate()} ${monthNames()[d.getMonth()]} ${d.getFullYear()}`;
// Monday first, as the Mobile app's calendar.
const weekHeads = () => [t('Jtt'), t('Jnn'), t('Jtn'), t('Alh'), t('Iju'), t('Jms'), t('Jpl')];

function StatCard({ label, value, icon, bg, loading }: { label: string; value: string; icon: React.ReactNode; bg: string; loading: boolean }) {
  return (
    <div className={`${bg} rounded-2xl p-4 text-white shadow-sm`}>
      <div className="mb-1 flex items-center gap-2 opacity-80">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      {/* A zero would read as "nothing sold this day"; show a bar until the day is read. */}
      {loading ? <div className="h-6 w-24 animate-pulse rounded bg-white/30" /> : <div className="break-words text-xl font-bold tabular-nums">{value}</div>}
    </div>
  );
}

export default function DayReport({ onBack, sellerName }: { onBack: () => void; sellerName: (id: string) => string }) {
  const { user, isBoss, isFeatureEnabled } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  const money = (n: number) => formatCurrency(n, currency);
  const shopId = user?.shopId || '';
  const boss = isBoss();
  const hasAccess = boss || isFeatureEnabled('show_mapato_to_staff');
  // Revenue may be shared with staff; profit reveals buying prices, so it stays with the boss.
  const canSeeProfit = boss;
  const canSeeExpenses = boss || isFeatureEnabled('staff_expense_management');

  const today = startOfDay(new Date());
  // Staff computers keep only their last three days of sales.
  const earliest = boss ? null : startOfDay(addDays(today, -2));
  const [selected, setSelected] = useState<Date>(today);
  const [showCal, setShowCal] = useState(false);
  const [calRef, setCalRef] = useState<Date>(() => startOfMonth(today));
  const [showList, setShowList] = useState(true);

  const dayStart = startOfDay(selected).getTime();
  const dayEnd = startOfDay(addDays(selected, 1)).getTime();
  const day = dateKey(dayStart);
  const prevDisabled = !!earliest && !isBefore(earliest, startOfDay(selected));
  const nextDisabled = !isBefore(startOfDay(selected), today);

  // ---- Totals and how the money came in: the day's rows ----
  const rows = useLiveQuery(() => (shopId && hasAccess ? dailyRows(shopId, day, day) : Promise.resolve([] as DayRow[])), [shopId, hasAccess, day]);
  const mine = boss ? rows ?? [] : (rows ?? []).filter(r => r.user_id === user?.id);
  const totals = sumRows(mine);
  const mix = { cash: 0, mobile: 0, credit: 0 };
  for (const r of mine) mix[r.method] += r.revenue;

  const expenses = useLiveQuery(async () => {
    if (!shopId || !hasAccess || !canSeeExpenses) return [];
    const list = await db.expenses.where('[shop_id+isDeleted+date]')
      .between([shopId, 0, new Date(dayStart).toISOString()], [shopId, 0, new Date(dayEnd).toISOString()], true, false).toArray();
    return boss ? list : list.filter(e => e.user_id === user?.id);
  }, [shopId, hasAccess, canSeeExpenses, boss, user?.id, dayStart, dayEnd]);
  const spent = (expenses ?? []).reduce((a, e) => a + e.amount, 0);
  const loading = rows === undefined || (canSeeExpenses && expenses === undefined);

  // ---- The day's sales, 50 at a time ----
  const query: ReceiptQuery = useMemo(() => ({
    shopId, from: dayStart, to: dayEnd, payment: 'all', seller: 'all', onlyUser: boss ? undefined : user?.id, search: '',
  }), [shopId, dayStart, dayEnd, boss, user?.id]);
  const key = JSON.stringify(query);
  const [shown, setShown] = useState(RECEIPTS_PAGE);
  useEffect(() => { setShown(RECEIPTS_PAGE); }, [key]);
  const localRaw = useLiveQuery(async () => {
    const page = showList && hasAccess && shopId ? await localReceipts(query, shown) : { receipts: [] as Receipt[], more: false };
    return { ...page, key, shown };
  }, [showList, hasAccess, key, shown]);
  const local = localRaw && localRaw.key === key ? localRaw : undefined;
  const localExact = local && local.shown === shown ? local : undefined;

  const [cloud, setCloud] = useState<{ key: string; rows: Receipt[]; done: boolean; loading: boolean; failed: boolean }>({ key: '', rows: [], done: false, loading: false, failed: false });
  const cloudState = cloud.key === key ? cloud : { key, rows: [] as Receipt[], done: false, loading: false, failed: false };
  const cloudNeeded = showList && boss && needsCloud(query);
  const fetching = useRef(false);
  const fetchOlder = async () => {
    if (fetching.current) return;
    fetching.current = true;
    const base = cloudState;
    setCloud({ ...base, loading: true, failed: false });
    try {
      const page = await cloudReceipts(query, base.rows[base.rows.length - 1] ?? null, RECEIPTS_PAGE);
      setCloud(c => {
        const cur = c.key === key ? c : { key, rows: [] as Receipt[], done: false, loading: false, failed: false };
        const have = new Set(cur.rows.map(r => r.id));
        return { ...cur, rows: [...cur.rows, ...page.receipts.filter(r => !have.has(r.id))], done: page.done, loading: false };
      });
    } catch (err) {
      console.warn('Receipts of the day could not be fetched:', err);
      setCloud(c => ({ ...(c.key === key ? c : { key, rows: [], done: false }), loading: false, failed: true }));
    } finally {
      fetching.current = false;
    }
  };
  const want = localExact && !localExact.more ? Math.max(0, shown - localExact.receipts.length) : 0;
  useEffect(() => {
    if (cloudNeeded && want > cloudState.rows.length && !cloudState.done && !cloudState.loading && !cloudState.failed) void fetchOlder();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudNeeded, want, key, cloudState.rows.length, cloudState.done, cloudState.loading, cloudState.failed]);

  const receipts: Receipt[] = local
    ? [...local.receipts, ...(cloudNeeded && !local.more ? cloudState.rows.slice(0, Math.max(0, local.shown - local.receipts.length)) : [])]
    : [];
  const more = (local?.more ?? false) || (cloudNeeded && !cloudState.done && !cloudState.failed);

  // Sales and expenses together, newest first. While more sales are still to
  // come, only the expenses down to the oldest sale shown are mixed in, so the
  // order holds as more load.
  const oldestShown = receipts.length ? receipts[receipts.length - 1].created_at : null;
  const timeline = [
    ...receipts.map(r => ({ kind: 'sale' as const, time: r.created_at, sale: r })),
    ...(expenses ?? []).filter(e => !more || !oldestShown || e.date >= oldestShown).map(e => ({ kind: 'expense' as const, time: e.date, expense: e })),
  ].sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  const txCount = totals.count + (expenses?.length ?? 0);

  // ---- The calendar ----
  const cells = useMemo(() => {
    const first = startOfMonth(calRef);
    const lead = (first.getDay() + 6) % 7;
    const list: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= getDaysInMonth(calRef); d++) list.push(new Date(calRef.getFullYear(), calRef.getMonth(), d));
    return list;
  }, [calRef]);
  const calNextDisabled = !isBefore(startOfMonth(calRef), startOfMonth(today));
  const calPrevDisabled = !!earliest && !isBefore(startOfMonth(earliest), startOfMonth(calRef));
  const pick = (d: Date) => { setSelected(startOfDay(d)); setShowCal(false); };
  const move = (delta: number) => setSelected(d => startOfDay(addDays(d, delta)));

  const chip = (method: string) => {
    const k = payKind(method);
    return k === 'credit' ? { label: t('Mkopo'), cls: 'bg-orange-100 text-orange-700' }
      : k === 'mobile' ? { label: t('Kwa Simu'), cls: 'bg-indigo-100 text-indigo-700' }
      : { label: t('Taslimu'), cls: 'bg-green-100 text-green-700' };
  };

  const header = (
    <div className="mb-4 flex items-center">
      <button onClick={onBack} className="mr-3 cursor-pointer rounded-full border border-gray-100 bg-white p-2 shadow-sm hover:bg-gray-50" aria-label={t('Rudi')}>
        <ArrowLeft className="h-5 w-5" />
      </button>
      <h1 className="text-2xl font-bold text-gray-800">{t('Ripoti ya Siku')}</h1>
    </div>
  );

  if (!hasAccess) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 md:p-5">
        {header}
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100"><Lock className="h-8 w-8 text-gray-400" /></div>
          <p className="font-medium text-gray-600">{t('Huna ruhusa ya kuona ripoti ya mapato.')}</p>
          <p className="mt-1 text-xs text-gray-400">{t('Muombe bosi akuwezeshe kuona mapato.')}</p>
        </div>
      </div>
    );
  }

  const cardCount = 1 + (canSeeProfit ? 2 : 0) + (canSeeExpenses ? 1 : 0);

  return (
    <div className="mx-auto w-full max-w-4xl p-4 pb-10 md:p-5" data-testid="day-report">
      {header}

      {/* Day bar */}
      <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-2 shadow-sm">
        <div className="flex items-center justify-between">
          <button onClick={() => !prevDisabled && move(-1)} disabled={prevDisabled} aria-label={t('Siku iliyopita')}
            className={`rounded-xl p-2 ${prevDisabled ? 'text-gray-200' : 'cursor-pointer text-gray-600 hover:bg-gray-100'}`}>
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button onClick={() => { setCalRef(startOfMonth(selected)); setShowCal(v => !v); }} data-testid="day-picker"
            className="mx-1 flex min-w-0 flex-1 cursor-pointer flex-col items-center rounded-xl py-1 hover:bg-gray-50">
            <span className="flex flex-wrap items-center justify-center gap-1.5 text-center text-sm font-bold leading-tight text-gray-800">
              <Calendar className="h-4 w-4 shrink-0 text-blue-600" />
              {dayLabel(selected)}
            </span>
            <span className="mt-0.5 text-[10px] font-bold text-blue-600">{t('Bonyeza kubadilisha tarehe')}</span>
          </button>
          <button onClick={() => !nextDisabled && move(1)} disabled={nextDisabled} aria-label={t('Siku inayofuata')}
            className={`rounded-xl p-2 ${nextDisabled ? 'text-gray-200' : 'cursor-pointer text-gray-600 hover:bg-gray-100'}`}>
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>

        {!isSameDay(selected, today) && (
          <button onClick={() => { setSelected(today); setShowCal(false); }} className="mt-1 w-full cursor-pointer rounded-xl bg-blue-50 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-100">
            {t('Rudi Leo')}
          </button>
        )}

        {showCal && (
          <div className="mx-auto mt-2 max-w-md border-t border-gray-100 pt-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <button onClick={() => !calPrevDisabled && setCalRef(m => addMonths(m, -1))} disabled={calPrevDisabled} aria-label={t('Mwezi uliopita')}
                className={`rounded-lg p-1.5 ${calPrevDisabled ? 'text-gray-200' : 'cursor-pointer text-gray-600 hover:bg-gray-100'}`}>
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-sm font-bold text-gray-800">{monthNames()[calRef.getMonth()]} {calRef.getFullYear()}</span>
              <button onClick={() => !calNextDisabled && setCalRef(m => addMonths(m, 1))} disabled={calNextDisabled} aria-label={t('Mwezi ujao')}
                className={`rounded-lg p-1.5 ${calNextDisabled ? 'text-gray-200' : 'cursor-pointer text-gray-600 hover:bg-gray-100'}`}>
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-1 grid grid-cols-7 gap-1">
              {weekHeads().map((w, i) => <div key={i} className="text-center text-[10px] font-bold uppercase text-gray-400">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const off = isBefore(today, startOfDay(d)) || (!!earliest && isBefore(startOfDay(d), earliest));
                const isSel = isSameDay(d, selected);
                const isToday = isSameDay(d, today);
                return (
                  <button key={i} disabled={off} onClick={() => !off && pick(d)}
                    className={`flex min-h-9 items-center justify-center rounded-lg text-sm font-semibold ${
                      isSel ? 'bg-blue-600 text-white' : off ? 'text-gray-200' : isToday ? 'cursor-pointer bg-blue-50 text-blue-600' : 'cursor-pointer text-gray-700 hover:bg-gray-100'}`}>
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* The day's totals */}
      <div className={`grid gap-3 ${cardCount === 1 ? 'grid-cols-1' : cardCount === 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        <StatCard label={t('Mapato')} value={money(totals.revenue)} loading={loading} bg="bg-blue-500" icon={<Coins className="h-4 w-4" />} />
        {canSeeProfit && <StatCard label={t('Faida')} value={money(totals.profit)} loading={loading} bg="bg-green-500" icon={<TrendingUp className="h-4 w-4" />} />}
        {canSeeExpenses && <StatCard label={t('Matumizi')} value={money(spent)} loading={loading} bg="bg-orange-500" icon={<Wallet className="h-4 w-4" />} />}
        {canSeeProfit && (
          <StatCard label={t('Faida Halisi')} value={money(totals.profit - spent)} loading={loading}
            bg={totals.profit - spent >= 0 ? 'bg-purple-500' : 'bg-rose-500'} icon={<PiggyBank className="h-4 w-4" />} />
        )}
      </div>

      {/* How the money came in */}
      <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-gray-500">{t('Mapato Yaliingiaje')}</p>
        <div className="space-y-2.5">
          {[
            { label: t('Taslimu (Cash)'), value: mix.cash, icon: <Banknote className="h-4 w-4 text-green-600" />, tone: 'bg-green-100', text: 'text-gray-900' },
            { label: t('Kwa Simu'), value: mix.mobile, icon: <Smartphone className="h-4 w-4 text-indigo-600" />, tone: 'bg-indigo-100', text: 'text-gray-900' },
            { label: t('Mkopo (bado)'), value: mix.credit, icon: <Clock className="h-4 w-4 text-amber-600" />, tone: 'bg-amber-100', text: 'text-amber-600' },
          ].map(m => (
            <div key={m.label} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-gray-700"><span className={`rounded-lg p-1.5 ${m.tone}`}>{m.icon}</span>{m.label}</span>
              <span className={`text-sm font-bold tabular-nums ${m.text}`}>{loading ? '…' : money(m.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* The day's sales and expenses */}
      <div className="mt-3">
        <button onClick={() => setShowList(v => !v)} data-testid="day-list-toggle"
          className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:bg-gray-50">
          <span className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <ShoppingBag className="h-4 w-4 text-gray-500" />
            {t('Miamala ya Siku ({txCount})', { txCount })}
          </span>
          <ChevronRight className={`h-5 w-5 text-gray-400 transition-transform ${showList ? 'rotate-90' : ''}`} />
        </button>

        {showList && (
          !local ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500"><RefreshCw className="h-4 w-4 animate-spin" /> {t('Inapakia...')}</div>
          ) : timeline.length === 0 && !more && !cloudState.failed ? (
            <p className="py-8 text-center text-sm text-gray-400">{t('Hakuna miamala siku hii.')}</p>
          ) : (
            <div className="mt-3 space-y-3">
              {timeline.map(row => {
                if (row.kind === 'sale') {
                  const s = row.sale;
                  const c = chip(s.payment_method);
                  return (
                    <div key={`sale-${s.id}`} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm" data-testid="day-sale">
                      <div className="mb-2 flex items-start justify-between">
                        <div className="flex items-center text-sm text-gray-600">
                          <Clock className="mr-1.5 h-4 w-4" />
                          {format(new Date(s.created_at), 'HH:mm')}
                          {boss && <span className="ml-2 text-xs text-gray-400">· {sellerName(s.user_id)}</span>}
                        </div>
                        <span className={`rounded px-2 py-1 text-[10px] font-bold ${c.cls}`}>{c.label}</span>
                      </div>
                      <div className="mt-3 flex items-end justify-between">
                        <div className="mr-3 min-w-0 text-sm text-gray-500">
                          <div className="line-clamp-2 font-medium text-gray-700">{s.lines.map(i => i.product_name).join(', ') || s.customer_name || t('Mauzo')}</div>
                          {t('Idadi: {totalQty}', { totalQty: s.lines.reduce((a, i) => a + i.qty, 0) })}
                          {s.customer_name && <span className="ml-2 text-xs text-orange-700">{t('Mteja: {name}', { name: s.customer_name })}</span>}
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          <div className="font-bold tabular-nums text-gray-900">{money(s.total_amount)}</div>
                          {canSeeProfit && <div className="text-xs tabular-nums text-green-600">{t('Faida: {total_profit}', { total_profit: money(s.total_profit) })}</div>}
                        </div>
                      </div>
                    </div>
                  );
                }
                const e = row.expense;
                return (
                  <div key={`exp-${e.id}`} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm" data-testid="day-expense">
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex items-center text-sm text-gray-600"><Clock className="mr-1.5 h-4 w-4" />{format(new Date(row.time), 'HH:mm')}</div>
                      <span className="rounded bg-orange-100 px-2 py-1 text-[10px] font-bold text-orange-700">{t('Matumizi')}</span>
                    </div>
                    <div className="mt-3 flex items-end justify-between">
                      <div className="mr-3 min-w-0 text-sm text-gray-500">
                        <div className="line-clamp-2 font-medium text-gray-700">{tData(e.category) || t('Matumizi')}</div>
                        {e.description && <span className="text-xs text-gray-400">{tData(e.description)}</span>}
                      </div>
                      <div className="shrink-0 font-bold tabular-nums text-rose-500">− {money(e.amount)}</div>
                    </div>
                  </div>
                );
              })}
              {cloudNeeded && cloudState.loading && (
                <div className="flex items-center justify-center gap-2 py-3 text-xs text-gray-500"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> {t('Inaleta risiti za zamani kutoka mtandaoni...')}</div>
              )}
              {cloudNeeded && cloudState.failed && (
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-center text-xs text-amber-800">
                  {t('Mauzo ya siku hii yako mtandaoni (cloud). Unganisha mtandao ili kuyaona.')}{' '}
                  <button onClick={() => void fetchOlder()} className="cursor-pointer font-semibold text-blue-600 hover:underline">{t('Jaribu tena')}</button>
                </div>
              )}
              {more && !cloudState.loading && (
                <button onClick={() => setShown(n => n + RECEIPTS_PAGE)} className="w-full cursor-pointer rounded-xl border border-gray-200 bg-white py-3 text-sm font-bold text-blue-600 hover:bg-blue-50">
                  {t('Onyesha 50 zaidi')}
                </button>
              )}
            </div>
          )
        )}
      </div>
      {historyWindowMs(shopId) > dayStart && boss && (
        <p className="mt-3 text-center text-[11px] text-gray-400">{t('Siku hii haikupakuliwa kwenye kompyuta hii: jumla zinatoka kwenye seva.')}</p>
      )}
    </div>
  );
}
