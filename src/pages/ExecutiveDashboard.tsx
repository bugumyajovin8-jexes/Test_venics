import { useMemo, useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths, format,
} from 'date-fns';
import {
  AlertCircle, ShieldAlert, TrendingUp, Zap, Users, ArrowRight, ArrowLeft, Check,
  Wallet, Smartphone, Flame, Target, Sparkles,
} from 'lucide-react';

import { db } from '../db';
import { useStore } from '../store';
import { useTap } from '../utils/useTap';
import { useMagnified } from '../utils/useMagnified';
import { formatCurrency } from '../utils/format';
import { SyncService } from '../services/sync';
import {
  buildIntel, writeGoal, suggestGoal,
  type Mode, type IntelCard,
} from '../utils/executiveIntel';

import EmployeeReports from '../components/EmployeeReports';
import MshauriChat from '../components/MshauriChat';
import ReadOnlyNotice from '../components/ReadOnlyNotice';

const MODE_META: Record<Mode, { label: string; icon: typeof Zap; accent: string; ring: string }> = {
  pulse:  { label: 'Leo',   icon: Zap,         accent: 'text-blue-600',    ring: 'bg-blue-600' },
  risk:   { label: 'Kinga', icon: ShieldAlert, accent: 'text-rose-600',    ring: 'bg-rose-600' },
  growth: { label: 'Kukua', icon: TrendingUp,  accent: 'text-emerald-600', ring: 'bg-emerald-600' },
};

/** A number that climbs to its value — makes progress feel earned. */
function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = value;
      setShown(value);
      return;
    }

    const started = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min((t - started) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);

  return shown;
}

function GoalRing({
  revenue, goal, pct, currency, onEdit, magnified,
}: {
  revenue: number; goal: number; pct: number; currency: string;
  onEdit: () => void; magnified: boolean;
}) {
  const tap = useTap();
  const shown = useCountUp(revenue);
  const size = magnified ? 200 : 176;
  const stroke = magnified ? 15 : 13;
  const r = (size - stroke) / 2 - 2;
  const circumference = 2 * Math.PI * r;
  const hit = pct >= 1;
  const remaining = Math.max(0, goal - revenue);

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
          <motion.circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={hit ? '#059669' : '#2563eb'}
            strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circumference}
            initial={false}
            animate={{ strokeDashoffset: circumference * (1 - pct) }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Mauzo ya leo</span>
          <span className={`font-black leading-none mt-1 ${magnified ? 'text-2xl' : 'text-xl'} ${hit ? 'text-emerald-700' : 'text-gray-900'}`}>
            {shown.toLocaleString()}
          </span>
          <span className="text-[10px] font-bold text-gray-400 mt-1">lengo {goal.toLocaleString()}</span>
        </div>
      </div>

      {hit ? (
        <div className="mt-3 bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-2 rounded-2xl text-sm font-black">
          🎉 Umefikia lengo la leo!
        </div>
      ) : (
        <div className="mt-3 text-sm font-bold text-gray-600">
          Umebakiza <span className="text-gray-900">{formatCurrency(remaining, currency)}</span>
        </div>
      )}

      <button
        onClick={tap(onEdit)}
        onPointerUp={tap(onEdit)}
        className="mt-2 text-[11px] font-bold text-blue-600 underline decoration-dashed underline-offset-4 cursor-pointer"
      >
        Badilisha lengo
      </button>
    </div>
  );
}

function TrendStrip({
  trend, streak, magnified,
}: {
  trend: Array<{ date: Date; revenue: number; hitGoal: boolean }>;
  streak: number; magnified: boolean;
}) {
  const peak = Math.max(...trend.map((d) => d.revenue), 1);

  return (
    <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">Siku 7 zilizopita</h3>
        {streak > 1 && (
          <span className="flex items-center gap-1 text-[11px] font-black text-orange-700 bg-orange-50 border border-orange-100 px-2.5 py-1 rounded-full">
            <Flame className="w-3.5 h-3.5" /> Siku {streak} mfululizo
          </span>
        )}
      </div>

      <div className={`flex items-end justify-between gap-1.5 ${magnified ? 'h-28' : 'h-20'}`}>
        {trend.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(6, (d.revenue / peak) * 100)}%` }}
              transition={{ duration: 0.5, delay: i * 0.05 }}
              className={`w-full rounded-t-lg ${d.hitGoal ? 'bg-emerald-500' : d.revenue > 0 ? 'bg-blue-400' : 'bg-gray-200'}`}
            />
            <span className="text-[9px] font-bold text-gray-400">{format(d.date, 'EEE')[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Miamala (Cash / Simu) — kept exactly as shop owners already know it.
 *
 * The three familiar entry points at the bottom of this page are deliberately
 * unchanged: the modes above are new, so the way out of the page should not be.
 */
function PaymentBreakdownWidget({ shopId }: { shopId: string }) {
  const tap = useTap();
  const [isOpen, setIsOpen] = useState(false);
  const [period, setPeriod] = useState<'today' | 'yesterday' | 'this_month' | 'last_month'>('today');

  const paymentData = useLiveQuery(async () => {
    if (!shopId) return { cash: 0, mobile: 0, total: 0 };

    let startIso: string;
    let endIso: string;
    const now = new Date();

    if (period === 'today') {
      startIso = startOfDay(now).toISOString();
      endIso = endOfDay(now).toISOString();
    } else if (period === 'yesterday') {
      const y = subDays(now, 1);
      startIso = startOfDay(y).toISOString();
      endIso = endOfDay(y).toISOString();
    } else if (period === 'this_month') {
      startIso = startOfMonth(now).toISOString();
      endIso = endOfMonth(now).toISOString();
    } else {
      const lm = subMonths(now, 1);
      startIso = startOfMonth(lm).toISOString();
      endIso = endOfMonth(lm).toISOString();
    }

    const sales = await db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([shopId, 0, startIso], [shopId, 0, endIso])
      .toArray();

    let cash = 0;
    let mobile = 0;

    sales.forEach(s => {
      if (s.status !== 'cancelled' && s.status !== 'refunded') {
        const amount = s.total_amount || 0;
        if (s.payment_method === 'cash') {
          cash += amount;
        } else if (s.payment_method === 'mobile' || s.payment_method === 'mobile_money') {
          mobile += amount;
        }
      }
    });

    return { cash, mobile, total: cash + mobile };
  }, [shopId, period], { cash: 0, mobile: 0, total: 0 });

  const tabs: Array<['today' | 'yesterday' | 'this_month' | 'last_month', string]> = [
    ['today', 'Leo'], ['yesterday', 'Jana'], ['this_month', 'Mwezi Huu'], ['last_month', 'Mwezi Uliopita'],
  ];

  return (
    <div className="space-y-4">
      <button
        data-tour="payment-breakdown"
        onClick={tap(() => setIsOpen(!isOpen))}
        onPointerUp={tap(() => setIsOpen(!isOpen))}
        className="w-full bg-indigo-50 text-indigo-700 font-bold py-5 rounded-[2rem] flex items-center justify-between px-6 transition-all active:scale-95 border border-indigo-100"
      >
        <div className="flex items-center">
          <Wallet className="w-6 h-6 mr-3 text-indigo-500" />
          <div className="text-left">
            <h3 className="font-bold text-lg">Miamala (Cash / Simu)</h3>
            <p className="text-indigo-600/70 text-sm font-medium">Bonyeza kuona mchanganuo wa malipo</p>
          </div>
        </div>
        <ArrowLeft className={`w-5 h-5 transition-transform duration-300 ${isOpen ? '-rotate-90' : 'rotate-180'}`} />
      </button>

      {isOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden"
        >
          <div className="flex space-x-2 mb-6 overflow-x-auto scrollbar-hide pb-2">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                onClick={tap(() => setPeriod(key))}
                onPointerUp={tap(() => setPeriod(key))}
                className={`flex-shrink-0 px-4 py-2 text-xs font-bold rounded-full transition-all cursor-pointer touch-manipulation select-none active:scale-95 ${
                  period === key ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'bg-gray-100 text-gray-600'
                }`}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 flex flex-col justify-center">
              <div className="flex items-center text-emerald-800 mb-1">
                <Wallet className="w-4 h-4 mr-1.5" />
                <span className="text-xs font-bold uppercase tracking-wider">Taslimu (Cash)</span>
              </div>
              <span className="text-lg font-black text-emerald-900 mt-1">
                {paymentData.cash.toLocaleString()}
              </span>
              <span className="text-[10px] text-emerald-600 mt-1 font-semibold">
                {paymentData.total > 0 ? Math.round((paymentData.cash / paymentData.total) * 100) : 0}% ya mapato
              </span>
            </div>

            <div className="bg-sky-50 rounded-2xl p-4 border border-sky-100 flex flex-col justify-center">
              <div className="flex items-center text-sky-800 mb-1">
                <Smartphone className="w-4 h-4 mr-1.5" />
                <span className="text-xs font-bold uppercase tracking-wider">Kwa Simu (Mobile)</span>
              </div>
              <span className="text-lg font-black text-sky-900 mt-1">
                {paymentData.mobile.toLocaleString()}
              </span>
              <span className="text-[10px] text-sky-600 mt-1 font-semibold">
                {paymentData.total > 0 ? Math.round((paymentData.mobile / paymentData.total) * 100) : 0}% ya mapato
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function CardView({ card, currency, onAct, magnified }: {
  card: IntelCard; currency: string; onAct: (c: IntelCard) => void; magnified: boolean;
}) {
  const tap = useTap();
  const tones = {
    danger: 'bg-rose-50 border-rose-100 text-rose-900',
    warn:   'bg-amber-50 border-amber-100 text-amber-900',
    info:   'bg-slate-50 border-slate-200 text-slate-800',
    good:   'bg-emerald-50 border-emerald-100 text-emerald-900',
  } as const;
  const buttons = {
    danger: 'bg-rose-600', warn: 'bg-amber-600', info: 'bg-slate-700', good: 'bg-emerald-600',
  } as const;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-4 rounded-[1.75rem] border ${tones[card.tone]}`}
    >
      <div className={`flex ${magnified ? 'flex-col gap-2' : 'items-start justify-between gap-3'}`}>
        <h4 className="font-black text-[15px] leading-snug flex-1">{card.title}</h4>
        {card.amount > 0 && (
          <span className="shrink-0 font-black text-sm bg-white/70 px-2.5 py-1 rounded-xl">
            {formatCurrency(card.amount, currency)}
          </span>
        )}
      </div>

      <p className="text-[12.5px] leading-relaxed mt-1.5 opacity-90">{card.detail}</p>

      {card.action && (
        <button
          onClick={tap(() => onAct(card))}
          onPointerUp={tap(() => onAct(card))}
          className={`mt-3 w-full ${buttons[card.tone]} text-white font-bold text-sm py-2.5 rounded-2xl flex items-center justify-center gap-1.5 cursor-pointer`}
        >
          {card.action.label} <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </motion.div>
  );
}

export default function ExecutiveDashboard() {
  const tap = useTap();
  const navigate = useNavigate();
  const magnified = useMagnified();
  const { user } = useStore();
  const shopId = user?.shopId || '';

  const [showEmployeeReports, setShowEmployeeReports] = useState(false);
  const [manualMode, setManualMode] = useState<Mode | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');

  const since = useMemo(() => startOfDay(subDays(new Date(), 29)).toISOString(), []);
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  const shop = useLiveQuery(
    () => (shopId ? db.shops.get(shopId) : Promise.resolve(undefined)), [shopId],
  );

  const sales = useLiveQuery(async () => {
    if (!shopId) return [];
    return db.sales.where('[shop_id+isDeleted+created_at]')
      .between([shopId, 0, since], [shopId, 0, '￿']).toArray();
  }, [shopId, since]) || [];

  const products = useLiveQuery(() => {
    if (!shopId) return [];
    return db.products.where('[shop_id+isDeleted]').equals([shopId, 0]).toArray();
  }, [shopId]) || [];

  // Kept as its own query so the first paint never waits on line items.
  const saleItems = useLiveQuery(async () => {
    if (!shopId || sales.length === 0) return [];
    return db.saleItems.where('sale_id').anyOf(sales.map((s) => s.id))
      .filter((i) => i.isDeleted === 0).toArray();
  }, [shopId, sales]) || [];

  const expenses = useLiveQuery(async () => {
    if (!shopId) return [];
    return db.expenses.where('[shop_id+isDeleted+date]')
      .between([shopId, 0, since], [shopId, 0, '￿']).toArray();
  }, [shopId, since]) || [];

  const auditLogs = useLiveQuery(async () => {
    if (!shopId) return [];
    const from = startOfDay(subDays(new Date(), 7)).toISOString();
    return db.auditLogs.where('[shop_id+isDeleted+created_at]')
      .between([shopId, 0, from], [shopId, 0, '￿']).toArray();
  }, [shopId]) || [];

  const users = useLiveQuery(() => {
    if (!shopId) return [];
    return db.users.where('shop_id').equals(shopId).toArray();
  }, [shopId]) || [];

  const debtPayments = useLiveQuery(() => {
    if (!shopId) return [];
    return db.debtPayments.where('shop_id').equals(shopId).toArray();
  }, [shopId]) || [];

  const intel = useMemo(
    () => buildIntel({ shop, shopId, sales, saleItems, products, expenses, auditLogs, users, debtPayments }),
    [shop, shopId, sales, saleItems, products, expenses, auditLogs, users, debtPayments],
  );

  const mode = manualMode ?? intel.mode;

  const act = (card: IntelCard) => {
    if (!card.action) return;
    navigate(
      card.action.route,
      card.action.spotlight ? { state: { spotlight: card.action.spotlight } } : undefined,
    );
  };

  const verifyAllPricing = async () => {
    const toVerify = products.filter(
      (p) => p.pricing_verified !== 1 && p.buy_price > 0 && p.sell_price <= p.buy_price,
    );
    if (!toVerify.length) return;
    try {
      await db.transaction('rw', [db.products], async () => {
        for (const p of toVerify) await db.products.update(p.id, { pricing_verified: 1, synced: 0 });
      });
      SyncService.sync();
    } catch (err) {
      console.error('Failed to verify prices:', err);
    }
  };

  const saveGoal = () => {
    const n = Number(goalDraft.replace(/[^\d]/g, ''));
    if (Number.isFinite(n) && n > 0) writeGoal(shopId, n);
    setEditingGoal(false);
  };

  if (user?.role !== 'boss') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-xl font-bold text-gray-900">Sehemu ya Bosi Tu</h1>
        <p className="text-gray-600 mt-2">Huna ruhusa ya kuona ripoti hizi za siri.</p>
      </div>
    );
  }

  if (showEmployeeReports) {
    return <EmployeeReports onClose={() => setShowEmployeeReports(false)} />;
  }

  const { pulse, capabilities } = intel;

  return (
    <div className="p-4 space-y-5 pb-28 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-gray-900 tracking-tight">V Smart</h1>
        <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">
          Duka lako linakuambia nini leo
        </p>
      </div>

      {/* Placed high on the boss's landing page: they read far more than they
          write, so without this the lock can go unnoticed for a whole session. */}
      <ReadOnlyNotice />

      {/* Mode switch — one shop moves between these as its own numbers change */}
      <div className="flex gap-2 bg-gray-100 p-1.5 rounded-[1.5rem]">
        {(Object.keys(MODE_META) as Mode[]).map((m) => {
          const meta = MODE_META[m];
          const Icon = meta.icon;
          const badge = m === 'risk' ? intel.leaks.filter((l) => l.tone !== 'info').length
                      : m === 'growth' ? intel.opportunities.length
                      : pulse.transactions;
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={tap(() => setManualMode(m))}
              onPointerUp={tap(() => setManualMode(m))}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[1.15rem] font-black text-[12.5px] cursor-pointer transition-all ${
                active ? 'bg-white shadow-sm ' + meta.accent : 'text-gray-500'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {meta.label}
              {badge > 0 && (
                <span className={`text-[9px] text-white px-1.5 py-0.5 rounded-full ${active ? meta.ring : 'bg-gray-400'}`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* The page explains why it opened where it did */}
      {!manualMode && (
        <div className="flex items-start gap-2 bg-blue-50/60 border border-blue-100 px-4 py-3 rounded-2xl">
          <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-blue-900 font-medium leading-relaxed">{intel.reason}</p>
        </div>
      )}

      {/* ===================== PULSE ===================== */}
      {mode === 'pulse' && (
        <div className="space-y-5">
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
            <GoalRing
              revenue={pulse.revenue} goal={pulse.goal} pct={pulse.goalPct}
              currency={currency} magnified={magnified}
              onEdit={() => { setGoalDraft(String(pulse.goal)); setEditingGoal(true); }}
            />

            <div className={`mt-5 pt-5 border-t border-gray-100 grid ${magnified ? 'grid-cols-1 gap-3' : 'grid-cols-3 gap-2'}`}>
              <div className="text-center">
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Faida</p>
                <p className="font-black text-gray-900 mt-0.5">{pulse.profit.toLocaleString()}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Miamala</p>
                <p className="font-black text-gray-900 mt-0.5">{pulse.transactions}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Kasi</p>
                <p className={`font-black mt-0.5 ${
                  pulse.paceDelta === null ? 'text-gray-400'
                    : pulse.paceDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}>
                  {pulse.paceDelta === null ? '—' : `${pulse.paceDelta >= 0 ? '+' : ''}${Math.round(pulse.paceDelta)}%`}
                </p>
              </div>
            </div>

            {pulse.paceDelta !== null && (
              <p className="text-[11.5px] text-gray-500 text-center mt-3 leading-relaxed">
                Saa hii kwa kawaida ulikuwa umefikia{' '}
                <b className="text-gray-700">{formatCurrency(pulse.typicalByNow, currency)}</b>.
              </p>
            )}
          </div>

          <TrendStrip trend={intel.weekTrend} streak={intel.streak} magnified={magnified} />


          {pulse.movers.length > 0 && (
            <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                Zinazoongoza leo
              </h3>
              <ul className="space-y-2.5">
                {pulse.movers.map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-gray-800 truncate">{m.name}</span>
                    <span className="text-xs text-gray-500 shrink-0">
                      {m.qty} • faida {m.profit.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {capabilities.staff && (
            <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-blue-500" /> Timu leo
              </h3>
              {pulse.sellers.length > 0 ? (
                <ul className="space-y-2.5 mb-3">
                  {pulse.sellers.slice(0, 4).map((s) => (
                    <li key={s.id}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-bold text-gray-800 truncate">{s.name}</span>
                        <span className="text-gray-500 shrink-0">{s.revenue.toLocaleString()} • {s.pct}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }} animate={{ width: `${s.pct}%` }}
                          className="h-full bg-blue-500 rounded-full"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">Bado hakuna aliyeuza leo.</p>
              )}
              {/* No button here — the familiar "Tazama Ripoti za Wafanyakazi"
                  entry point lives at the bottom of the page, in every mode. */}
            </div>
          )}
        </div>
      )}

      {/* ===================== RISK ===================== */}
      {mode === 'risk' && (
        <div className="space-y-4">
          <div className="bg-rose-600 text-white p-6 rounded-[2rem] shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-rose-100">
              Jumla iliyo hatarini
            </p>
            <p className="text-3xl font-black mt-1">{formatCurrency(intel.totalAtRisk, currency)}</p>
            <p className="text-[12.5px] text-rose-100 mt-2 leading-relaxed">
              {intel.avgDailyRevenue > 0
                ? `Sawa na mauzo ya siku ${(intel.totalAtRisk / intel.avgDailyRevenue).toFixed(1)} kwa kasi yako ya sasa.`
                : 'Kagua vipengele hapa chini kuzuia upotevu.'}
            </p>
          </div>

          {intel.leaks.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-[2rem] text-center">
              <Check className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
              <p className="font-black text-emerald-900">Hakuna uvujaji uliobainika</p>
              <p className="text-sm text-emerald-700 mt-1">Bei, madeni na mzigo wako vipo sawa kwa sasa.</p>
            </div>
          ) : (
            intel.leaks.map((card) => (
              <div key={card.id}>
                <CardView card={card} currency={currency} onAct={act} magnified={magnified} />
                {card.id === 'loss_pricing' && (
                  <button
                    onClick={tap(verifyAllPricing)}
                    onPointerUp={tap(verifyAllPricing)}
                    className="mt-2 w-full bg-white border border-rose-200 text-rose-800 font-bold text-xs py-2.5 rounded-2xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" /> Bei zote zipo sawa
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================== GROWTH ===================== */}
      {mode === 'growth' && (
        <div className="space-y-4">
          <div className="bg-emerald-600 text-white p-6 rounded-[2rem] shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-100">
              Nafasi ya kuongeza
            </p>
            <p className="text-3xl font-black mt-1">{formatCurrency(intel.totalUpside, currency)}</p>
            <p className="text-[12.5px] text-emerald-100 mt-2 leading-relaxed">
              Makadirio ya faida ya ziada ukichukua hatua zilizo hapa chini.
            </p>
          </div>

          {intel.opportunities.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 p-6 rounded-[2rem] text-center">
              <Target className="w-10 h-10 text-slate-400 mx-auto mb-2" />
              <p className="font-black text-slate-800">Bado sina takwimu za kutosha</p>
              <p className="text-sm text-slate-600 mt-1">
                Endelea kuuza na kurekodi — nitaanza kukuonyesha pa kuongeza faida.
              </p>
            </div>
          ) : (
            intel.opportunities.map((card) => (
              <CardView key={card.id} card={card} currency={currency} onAct={act} magnified={magnified} />
            ))
          )}
        </div>
      )}

      {/* ============================================================
          The three familiar entry points, unchanged and always present.
          They sit below every mode so the modes never move a control the
          shop owner already knows how to find.
          ============================================================ */}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center">
            <Users className="w-5 h-5 mr-2 text-blue-500" /> Wafanyakazi
          </h3>
        </div>
        <button
          onClick={tap(() => setShowEmployeeReports(true))}
          onPointerUp={tap(() => setShowEmployeeReports(true))}
          className="w-full bg-blue-50 text-blue-700 font-bold py-4 rounded-2xl flex items-center justify-center transition-colors cursor-pointer"
        >
          Tazama Ripoti za Wafanyakazi (Zamu)
          <ArrowLeft className="w-4 h-4 ml-2 rotate-180" />
        </button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <button
          onClick={tap(() => navigate('/audit-logs', { state: { spotlight: 'audit-list' } }))}
          onPointerUp={tap(() => navigate('/audit-logs', { state: { spotlight: 'audit-list' } }))}
          className="w-full bg-blue-600 text-white p-5 rounded-[2rem] shadow-sm flex items-center justify-between transition-colors cursor-pointer"
        >
          <div className="flex items-center">
            <div className="bg-blue-500/30 p-2 rounded-full mr-4">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <h3 className="font-bold text-lg">Mabadiliko ya Bidhaa</h3>
              <p className="text-blue-100 text-sm">Fuatilia nani amebadilisha bei au stock</p>
            </div>
          </div>
          <ArrowLeft className="w-5 h-5 rotate-180" />
        </button>
      </motion.div>

      {shopId && <PaymentBreakdownWidget shopId={shopId} />}

      <div className="text-center pt-4 pb-2 border-t border-gray-100">
        <p className="text-lg font-bold text-blue-600">Venics Sales</p>
        <p className="text-[10px] text-gray-300 mt-1">Made by Venics Software Company</p>
      </div>

      {editingGoal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            className="bg-white w-full max-w-sm rounded-[2rem] p-6 space-y-4"
          >
            <div>
              <h2 className="text-lg font-black text-gray-900">Lengo la mauzo ya siku</h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Nimependekeza {suggestGoal(intel.weekTrend.map((d) => d.revenue)).toLocaleString()} kutokana na
                wastani wa siku 7 zilizopita. Lengo linahifadhiwa kwenye kifaa hiki pekee.
              </p>
            </div>

            <input
              type="number" inputMode="numeric" value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-lg font-black text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="flex gap-2">
              <button
                onClick={tap(() => setEditingGoal(false))}
                onPointerUp={tap(() => setEditingGoal(false))}
                className="flex-1 bg-gray-100 text-gray-700 font-bold py-3 rounded-2xl cursor-pointer"
              >
                Ghairi
              </button>
              <button
                onClick={tap(saveGoal)}
                onPointerUp={tap(saveGoal)}
                className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-2xl cursor-pointer"
              >
                Hifadhi
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <MshauriChat />
    </div>
  );
}
