import { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { useTap } from '../utils/useTap';
import { useMagnified } from '../utils/useMagnified';
import { formatCurrency } from '../utils/format';
import { useNavigate } from 'react-router-dom';
import { startOfDay, startOfMonth, addDays, addMonths, isBefore, isSameDay, getDaysInMonth, format } from 'date-fns';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Coins, TrendingUp, Wallet, PiggyBank,
  Calendar, Lock, ShoppingBag, Banknote, Smartphone, Clock,
} from 'lucide-react';

const WEEKDAYS_SW = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];
const WEEKDAYS_EN_MIN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // Monday-first grid header
const MONTHS_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];

const dayLabel = (d: Date) => `${WEEKDAYS_SW[d.getDay()]}, ${d.getDate()} ${MONTHS_SW[d.getMonth()]} ${d.getFullYear()}`;

// cash → till, digital → mobile money / bank / card, credit → not yet received.
const bucketOf = (m: string): 'cash' | 'digital' | 'credit' =>
  m === 'cash' ? 'cash' : m === 'credit' ? 'credit' : 'digital';

// Solid, opaque card — matches the Dashibodi KPI tiles (bg-*-500, white text).
function StatCard({ label, value, icon, bg }: { label: string; value: string; icon: React.ReactNode; bg: string }) {
  return (
    <div className={`${bg} text-white p-4 rounded-2xl shadow-sm`}>
      <div className="flex items-center space-x-2 opacity-80 mb-1">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-lg font-bold break-all">{value}</div>
    </div>
  );
}

export default function RipotiYaSiku() {
  const tap = useTap();
  const navigate = useNavigate();
  const isMagnified = useMagnified();
  const { user, isFeatureEnabled } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  const money = (n: number) => formatCurrency(n, currency);

  const boss = user?.role === 'boss';
  const hasAccess = boss || isFeatureEnabled('show_mapato_to_staff');

  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [showCal, setShowCal] = useState(false);
  const [calRef, setCalRef] = useState<Date>(() => startOfMonth(new Date())); // any day in the viewed month
  const [slideDir, setSlideDir] = useState<'l' | 'r'>('l');
  const [showList, setShowList] = useState(false);

  // Swipe-to-change-month. A horizontal drag past the threshold flips the month and marks the
  // gesture so the day cell under the finger doesn't also get selected on release.
  const swipeStartX = useRef<number | null>(null);
  const didSwipe = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Plain navigate(-1): the only way onto this page is the button in Historia's header, so back
  // always means Historia. useTap already debounces this button's own onClick+onPointerUp; the
  // stray iOS ghost click lands on HISTORIA's back button, which guards against it on its side.
  const goBack = () => navigate(-1);

  const today = startOfDay(new Date());
  const dayStartIso = startOfDay(selectedDate).toISOString();
  const dayEndIso = startOfDay(addDays(selectedDate, 1)).toISOString();
  const nextDisabled = !isBefore(startOfDay(selectedDate), today); // can't view the future

  // Only the selected day's rows are read, via the compound indexes — an indexed range scan, so
  // this stays fast no matter how much history the shop has accumulated.
  const daySales = useLiveQuery(async () => {
    if (!user?.shopId || !hasAccess) return [];
    const rows = await db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, dayStartIso], [user.shopId, 0, dayEndIso], true, false)
      .toArray();
    return boss ? rows : rows.filter(s => s.user_id === user.id);
  }, [user?.shopId, user?.id, boss, hasAccess, dayStartIso, dayEndIso]) || [];

  const dayExpenses = useLiveQuery(async () => {
    if (!user?.shopId || !hasAccess) return [];
    const rows = await db.expenses
      .where('[shop_id+isDeleted+date]')
      .between([user.shopId, 0, dayStartIso], [user.shopId, 0, dayEndIso], true, false)
      .toArray();
    return boss ? rows : rows.filter(e => e.user_id === user.id);
  }, [user?.shopId, user?.id, boss, hasAccess, dayStartIso, dayEndIso]) || [];

  // Line items are only needed for the (collapsed-by-default) receipt list, so load them lazily —
  // only once the list is opened, and only for that day's sales. Indexed by sale_id, so it's cheap.
  const dayItems = useLiveQuery(async () => {
    if (!showList || daySales.length === 0) return [];
    const ids = daySales.map(s => s.id);
    return db.saleItems.where('sale_id').anyOf(ids).filter(i => i.isDeleted === 0).toArray();
  }, [showList, daySales]) || [];

  const itemsBySale = useMemo(() => {
    const m: Record<string, { name: string; qty: number }[]> = {};
    dayItems.forEach(i => { (m[i.sale_id] ||= []).push({ name: i.product_name, qty: Number(i.qty || 0) }); });
    return m;
  }, [dayItems]);

  const totals = useMemo(() => {
    const mapato = daySales.reduce((s, x) => s + Number(x.total_amount || 0), 0);
    const faida = daySales.reduce((s, x) => s + Number(x.total_profit || 0), 0);
    const matumizi = dayExpenses.reduce((s, x) => s + Number(x.amount || 0), 0);
    const mix = { cash: 0, digital: 0, credit: 0 };
    daySales.forEach(x => { mix[bucketOf(x.payment_method)] += Number(x.total_amount || 0); });
    return { mapato, faida, matumizi, faidaHalisi: faida - matumizi, mix };
  }, [daySales, dayExpenses]);

  // Merged, newest-first timeline of sales + expenses for the collapsible list.
  const timeline = useMemo(() => {
    const rows = [
      ...daySales.map(s => ({ kind: 'sale' as const, time: s.created_at, sale: s })),
      ...dayExpenses.map(e => ({ kind: 'expense' as const, time: e.date || e.created_at, expense: e })),
    ];
    rows.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
    return rows;
  }, [daySales, dayExpenses]);

  const openCalendar = () => { setCalRef(startOfMonth(selectedDate)); setShowCal(v => !v); };
  const pickDay = (d: Date) => { setSelectedDate(startOfDay(d)); setShowCal(false); };

  // Month grid (Monday-first) for the jump calendar.
  const calCells = useMemo(() => {
    const first = startOfMonth(calRef);
    const jsDow = first.getDay();              // 0=Sun..6=Sat
    const lead = (jsDow + 6) % 7;              // convert to Monday-first offset
    const total = getDaysInMonth(calRef);
    const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d++) cells.push(new Date(calRef.getFullYear(), calRef.getMonth(), d));
    return cells;
  }, [calRef]);
  const calNextDisabled = !isBefore(startOfMonth(calRef), startOfMonth(today));

  // delta +1 = next month (blocked if that would be the future), -1 = previous. Sets the slide
  // direction so the incoming grid animates in from the correct side.
  const changeMonth = (delta: number) => {
    if (delta > 0 && calNextDisabled) return;
    setSlideDir(delta > 0 ? 'l' : 'r');
    setCalRef(m => addMonths(m, delta));
  };

  const onCalPointerDown = (e: React.PointerEvent) => { swipeStartX.current = e.clientX; didSwipe.current = false; };
  const onCalPointerMove = (e: React.PointerEvent) => {
    if (swipeStartX.current !== null && Math.abs(e.clientX - swipeStartX.current) > 40) didSwipe.current = true;
  };
  const onCalPointerUp = (e: React.PointerEvent) => {
    if (swipeStartX.current === null) return;
    const dx = e.clientX - swipeStartX.current;
    swipeStartX.current = null;
    if (Math.abs(dx) < 40) return;
    changeMonth(dx < 0 ? 1 : -1); // swipe left → next month
  };

  // Slide the day grid in whenever the month changes. Done with a plain transform transition rather
  // than tailwindcss-animate utilities, which this Tailwind v4 build does not generate. useLayoutEffect
  // (not useEffect) applies the off-screen start BEFORE the browser paints, so there's no flash of the
  // grid at rest first. The `key` on the grid remounts it each month, so this fires every change.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const from = slideDir === 'l' ? 70 : -70; // next month enters from the right, previous from the left
    el.style.transition = 'none';
    el.style.transform = `translateX(${from}px)`;
    el.style.opacity = '0';
    void el.offsetHeight; // force reflow so the start state is committed before the transition
    el.style.transition = 'transform 280ms ease-out, opacity 280ms ease-out';
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
  }, [calRef, slideDir]);

  const chipFor = (b: 'cash' | 'digital' | 'credit') =>
    b === 'cash' ? { label: 'Taslimu', cls: 'bg-green-100 text-green-700' }
    : b === 'digital' ? { label: 'Simu/Benki', cls: 'bg-indigo-100 text-indigo-700' }
    : { label: 'Mkopo', cls: 'bg-orange-100 text-orange-700' };

  if (!hasAccess) {
    return (
      <div className="p-4 pt-safe pt-safe-standalone">
        <div className="flex items-center mb-6">
          <button
            onClick={tap(goBack)} onPointerUp={tap(goBack)}
            className="mr-3 p-2 bg-white rounded-full shadow-sm border border-gray-100 cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-gray-800">Ripoti ya Siku</h1>
        </div>
        <div className="bg-white p-8 rounded-2xl border border-gray-100 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-600 font-medium">Huna ruhusa ya kuona ripoti ya mapato.</p>
          <p className="text-xs text-gray-400 mt-1">Muombe bosi akuwezeshe kuona mapato.</p>
        </div>
      </div>
    );
  }

  const txCount = timeline.length;

  return (
    <div className="p-4 pb-24 pt-safe pt-safe-standalone">
      <div className="flex items-center mb-4">
        <button
          onClick={tap(() => navigate(-1))} onPointerUp={tap(() => navigate(-1))}
          className="mr-3 p-2 bg-white rounded-full shadow-sm border border-gray-100 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-gray-800">Ripoti ya Siku</h1>
      </div>

      {/* Day navigator */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-2 mb-4">
        <div className="flex items-center justify-between">
          <button
            onClick={tap(() => setSelectedDate(d => startOfDay(addDays(d, -1))))}
            onPointerUp={tap(() => setSelectedDate(d => startOfDay(addDays(d, -1))))}
            className="p-2 rounded-xl text-gray-600 active:bg-gray-100"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <button data-tour="date-picker"
            onClick={tap(openCalendar)} onPointerUp={tap(openCalendar)}
            className="flex-1 min-w-0 mx-1 flex flex-col items-center py-1 rounded-xl active:bg-gray-50"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <span className="flex flex-wrap items-center justify-center gap-1.5 text-sm font-bold text-gray-800 text-center leading-tight">
              <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
              {dayLabel(selectedDate)}
            </span>
            {!isSameDay(selectedDate, today) && (
              <span className="text-[10px] text-blue-600 font-bold mt-0.5">Gusa kubadilisha tarehe</span>
            )}
          </button>

          <button
            disabled={nextDisabled}
            onClick={tap(() => { if (!nextDisabled) setSelectedDate(d => startOfDay(addDays(d, 1))); })}
            onPointerUp={tap(() => { if (!nextDisabled) setSelectedDate(d => startOfDay(addDays(d, 1))); })}
            className={`p-2 rounded-xl ${nextDisabled ? 'text-gray-200' : 'text-gray-600 active:bg-gray-100'}`}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>

        {!isSameDay(selectedDate, today) && (
          <button
            onClick={tap(() => { setSelectedDate(today); setShowCal(false); })}
            onPointerUp={tap(() => { setSelectedDate(today); setShowCal(false); })}
            className="mt-1 w-full py-1.5 text-xs font-bold text-blue-600 bg-blue-50 rounded-xl"
          >
            Rudi Leo
          </button>
        )}

        {showCal && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2 px-1">
              <button
                onClick={tap(() => changeMonth(-1))} onPointerUp={tap(() => changeMonth(-1))}
                className="p-1.5 rounded-lg text-gray-600 active:bg-gray-100" style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-sm font-bold text-gray-800">{MONTHS_SW[calRef.getMonth()]} {calRef.getFullYear()}</span>
              <button
                disabled={calNextDisabled}
                onClick={tap(() => changeMonth(1))} onPointerUp={tap(() => changeMonth(1))}
                className={`p-1.5 rounded-lg ${calNextDisabled ? 'text-gray-200' : 'text-gray-600 active:bg-gray-100'}`}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            {/* Swipeable month body: pan-y lets the page still scroll vertically while we own the
                horizontal drag. overflow-hidden clips the slide-in animation to the calendar. */}
            <div
              onPointerDown={onCalPointerDown}
              onPointerMove={onCalPointerMove}
              onPointerUp={onCalPointerUp}
              className="overflow-hidden"
              style={{ touchAction: 'pan-y' }}
            >
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAYS_EN_MIN.map((w, i) => (
                  <div key={i} className="text-center text-[9px] font-bold text-gray-400 uppercase">{w}</div>
                ))}
              </div>
              <div
                key={`${calRef.getFullYear()}-${calRef.getMonth()}`}
                ref={gridRef}
                className="grid grid-cols-7 gap-1 will-change-transform"
              >
                {calCells.map((d, i) => {
                  if (!d) return <div key={i} />;
                  const isFuture = isBefore(today, startOfDay(d));
                  const isSel = isSameDay(d, selectedDate);
                  const isToday = isSameDay(d, today);
                  return (
                    <button
                      key={i}
                      disabled={isFuture}
                      onClick={tap(() => { if (didSwipe.current || isFuture) return; pickDay(d); })}
                      onPointerUp={tap(() => { if (didSwipe.current || isFuture) return; pickDay(d); })}
                      className={`min-h-9 flex items-center justify-center rounded-lg text-sm font-semibold ${
                        isSel ? 'bg-blue-600 text-white'
                        : isFuture ? 'text-gray-200'
                        : isToday ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-700 active:bg-gray-100'}`}
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-center text-[9px] text-gray-300 mt-1.5">‹ Telezesha kubadilisha mwezi ›</p>
          </div>
        )}
      </div>

      {/* Stat cards — one per row when magnified so the currency values never get cramped/overlap */}
      <div className={`grid gap-3 ${isMagnified ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <StatCard label="Mapato" value={money(totals.mapato)} bg="bg-blue-500" icon={<Coins className="w-4 h-4" />} />
        <StatCard label="Faida" value={money(totals.faida)} bg="bg-green-500" icon={<TrendingUp className="w-4 h-4" />} />
        <StatCard label="Matumizi" value={money(totals.matumizi)} bg="bg-orange-500" icon={<Wallet className="w-4 h-4" />} />
        <StatCard
          label="Faida Halisi" value={money(totals.faidaHalisi)}
          bg={totals.faidaHalisi >= 0 ? 'bg-purple-500' : 'bg-rose-500'}
          icon={<PiggyBank className="w-4 h-4" />}
        />
      </div>

      {/* How the money came in */}
      <div className="mt-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Mapato Yaliingiaje</p>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-gray-700">
              <span className="p-1.5 rounded-lg bg-green-100"><Banknote className="w-4 h-4 text-green-600" /></span>
              Taslimu (Cash)
            </span>
            <span className="text-sm font-bold text-gray-900">{money(totals.mix.cash)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-gray-700">
              <span className="p-1.5 rounded-lg bg-indigo-100"><Smartphone className="w-4 h-4 text-indigo-600" /></span>
              Simu / Benki
            </span>
            <span className="text-sm font-bold text-gray-900">{money(totals.mix.digital)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-gray-700">
              <span className="p-1.5 rounded-lg bg-amber-100"><Clock className="w-4 h-4 text-amber-600" /></span>
              Mkopo (bado)
            </span>
            <span className="text-sm font-bold text-amber-600">{money(totals.mix.credit)}</span>
          </div>
        </div>
      </div>

      {/* Collapsible receipts + expenses */}
      <div className="mt-3">
        <button
          onClick={tap(() => setShowList(v => !v))} onPointerUp={tap(() => setShowList(v => !v))}
          className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 shadow-sm"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <span className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <ShoppingBag className="w-4 h-4 text-gray-500" />
            Miamala ya Siku ({txCount})
          </span>
          <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${showList ? 'rotate-90' : ''}`} />
        </button>

        {showList && (
          txCount === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">Hakuna miamala siku hii.</p>
          ) : (
            <div className="space-y-3 mt-3">
              {timeline.map(row => {
                if (row.kind === 'sale') {
                  const s = row.sale;
                  const items = itemsBySale[s.id] || [];
                  const names = items.map(i => i.name).join(', ');
                  const totalQty = items.reduce((a, b) => a + b.qty, 0);
                  const chip = chipFor(bucketOf(s.payment_method));
                  return (
                    <div key={`sale-${s.id}`} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center text-gray-600 text-sm">
                          <Calendar className="w-4 h-4 mr-1.5" />
                          {format(new Date(s.created_at), 'dd/MM/yyyy HH:mm')}
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded ${chip.cls}`}>{chip.label}</span>
                      </div>
                      <div className={`flex mt-3 ${isMagnified ? 'flex-col items-start gap-1' : 'justify-between items-end'}`}>
                        <div className="text-sm text-gray-500 min-w-0 mr-3">
                          <div className="font-medium text-gray-700 line-clamp-2">{names || (s.customer_name || 'Mauzo')}</div>
                          Idadi: {totalQty}
                        </div>
                        <div className={`flex flex-col shrink-0 ${isMagnified ? 'items-start' : 'items-end'}`}>
                          <div className="font-bold text-gray-900 break-all">{money(s.total_amount)}</div>
                          {boss && <div className="text-xs text-green-600 break-all">Faida: {money(s.total_profit)}</div>}
                        </div>
                      </div>
                    </div>
                  );
                }
                const e = row.expense;
                return (
                  <div key={`exp-${e.id}`} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center text-gray-600 text-sm">
                        <Calendar className="w-4 h-4 mr-1.5" />
                        {format(new Date(row.time), 'dd/MM/yyyy HH:mm')}
                      </div>
                      <span className="text-[10px] font-bold px-2 py-1 rounded bg-orange-100 text-orange-700">Matumizi</span>
                    </div>
                    <div className={`flex mt-3 ${isMagnified ? 'flex-col items-start gap-1' : 'justify-between items-end'}`}>
                      <div className="text-sm text-gray-500 min-w-0 mr-3">
                        <div className="font-medium text-gray-700 line-clamp-2">{e.category || 'Matumizi'}</div>
                        {e.description && <span className="text-xs text-gray-400">{e.description}</span>}
                      </div>
                      <div className="font-bold text-rose-500 shrink-0 break-all">− {money(e.amount)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
