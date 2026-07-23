import React, { useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AssistantChat } from '../db';
import { useStore } from '../store';
import { generateContent as generateContentViaProxy } from '../services/geminiProxy';
import { supabase } from '../supabase';
import VenicsLogo from './VenicsLogo';
import { v4 as uuidv4 } from 'uuid';
import { 
  MessageSquare, X, Send, Bot, User, Sparkles, 
  FileText, Wallet, CreditCard, Package, Clock, ShieldCheck, ArrowUpRight, TrendingUp,
  RefreshCw, CheckCircle, AlertTriangle, WifiOff, Moon, Users, Settings, Plus
} from 'lucide-react';
import { format, startOfDay, subDays, startOfWeek, subMonths, isToday, differenceInDays } from 'date-fns';
import { formatCurrency } from '../utils/format';
import { useNavigate } from 'react-router-dom';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { IntentEngine } from '../services/mshauri/IntentEngine';
import { BusinessLogic } from '../services/mshauri/BusinessLogic';
import { ResponseGenerator } from '../services/mshauri/ResponseGenerator';
import { KnowledgeBase } from '../services/mshauri/KnowledgeBase';
import { AdvancedAnalytics } from '../services/mshauri/AdvancedAnalytics';
import { FollowUpEngine } from '../services/mshauri/FollowUpEngine';

interface Message {
  id: string;
  sender: 'user' | 'bot' | 'ai';
  text: string | React.ReactNode;
  type?: 'sync' | 'employee_general' | 'employee_single' | 'text' | 'react_node';
  employeeId?: string;
  initialPeriod?: 'week' | 'month' | 'months6';
  intent?: string;
  query?: string;
  followUps?: string[];
  timestamp: Date;
  isInsight?: boolean;
  action?: {
    label: string;
    path: string;
  };
}

function SyncDiagResponse() {
  const [checking, setChecking] = useState(true);
  const [syncCount, setSyncCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const { syncStatus, showToast } = useStore();

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const runCheck = async () => {
    setChecking(true);
    try {
      // Count unsynced records across major tables securely
      const salesCount = await db.sales.where('synced').equals(0).count();
      const productsCount = await db.products.where('synced').equals(0).count();
      const expensesCount = await db.expenses.where('synced').equals(0).count();
      const totalUnsynced = salesCount + productsCount + expensesCount;
      setSyncCount(totalUnsynced);

      if (isOffline) {
        setStatusMessage('Kifaa chako hakina mtandao wa Internet hivi sasa (Offline). Hii inazuia duka kutuma mauzo mapya au kusawazisha bidhaa na PC au simu nyingine.');
      } else if (syncStatus === 'sleep') {
        setStatusMessage('Mifumo ya duka imeingia kwenye hali ya mapumziko (Sleep Mode) kutokana na kutotumika kwa muda mfupi. Hii inatokea ili kubana matumizi ya chaji na mtandao.');
      } else if (totalUnsynced > 0) {
        setStatusMessage(`Kuna takwimu ${totalUnsynced} za mauzo au bidhaa ambazo bado hazijakamilisha kusawazishwa kwenye wingu (cloud).`);
      } else {
        setStatusMessage('Mifumo yote ya usawazishaji ipo sawa na inafanya kazi inavyostahili (Active).');
      }
    } catch (e) {
      setStatusMessage('Imeshindwa kukagua takwimu za hifadhi ya ndani.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    runCheck();
  }, [syncStatus, isOffline]);

  const handleManualSync = async () => {
    if (isOffline) {
      showToast('Huwezi kusawazisha ukiwa hauna mtandao wa Internet!', 'error');
      return;
    }
    setSyncing(true);
    try {
      await SyncService.sync(true); // run a force full-sync
      showToast('Mchakato wa kusawazisha umekamilika kikamilifu!', 'success');
      await runCheck();
    } catch (err) {
      console.error(err);
      showToast('Usawazishaji umeshindwa. Tafadhali jaribu tena baada ya muda.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-3.5 text-slate-800 bg-slate-50 border border-slate-100 p-4 rounded-2xl shadow-sm">
      <div className="flex items-center space-x-2">
        <span className="text-xl">🔄</span>
        <h4 className="font-extrabold text-sm text-slate-900 font-sans tracking-tight">
          Ukaguzi wa Usawazishaji (Sync Status)
        </h4>
      </div>

      {checking ? (
        <div className="flex items-center space-x-2 text-xs text-slate-500 py-1">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
          <span>Inakagua hali ya database na muunganisho wa mfumo...</span>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Diagnostic Badge */}
          <div className={`p-3 rounded-xl flex items-start space-x-2.5 border text-xs leading-relaxed ${
            isOffline 
              ? 'bg-rose-50 border-rose-100 text-rose-800' 
              : syncStatus === 'sleep'
                ? 'bg-amber-50 border-amber-100 text-amber-800'
                : syncCount > 0
                  ? 'bg-orange-50/70 border-orange-100 text-orange-950'
                  : 'bg-emerald-50 border-emerald-100 text-emerald-800'
          }`}>
            <div className="mt-0.5 shrink-0">
              {isOffline ? (
                <WifiOff className="w-4 h-4 text-rose-600" />
              ) : syncStatus === 'sleep' ? (
                <Moon className="w-4 h-4 text-amber-600" />
              ) : syncCount > 0 ? (
                <AlertTriangle className="w-4 h-4 text-orange-600 animate-pulse" />
              ) : (
                <CheckCircle className="w-4 h-4 text-emerald-600" />
              )}
            </div>
            <div>
              <p className="font-black mb-0.5">
                {isOffline ? 'Hatari: Hakuna Mtandao!' :
                 syncStatus === 'sleep' ? 'Tanbihi: Hali ya Mapumziko' :
                 syncCount > 0 ? 'Kuna Data Mpya Isiyosawazishwa' :
                 'Kila Kitu Kiko Sawa!'}
              </p>
              <p className="text-slate-600">{statusMessage}</p>
              {syncCount > 0 && (
                <p className="mt-1.5 text-[11px] font-bold text-slate-700 bg-white inline-block px-2 py-0.5 rounded-lg border">
                  Takwimu za ndani ambazo bado: {syncCount} rekodi
                </p>
              )}
            </div>
          </div>

          {/* Business-Owner Friendly Troubleshooting Guidelines */}
          <div className="text-xs space-y-2 bg-white/70 border border-slate-100 p-3 rounded-xl text-slate-700">
            <span className="font-bold text-slate-900 block mb-1">Mambo Rahisi ya Kufanya Kutatua Hili:</span>
            
            <ol className="list-decimal pl-4.5 space-y-1 text-[12.5px] leading-relaxed">
              <li>
                <b>Kagua Mtandao (Internet):</b> Hakikisha kifaa hiki (PC au simu) pamoja na kile cha mfanyakazi wako vyote vina muunganisho hai na thabiti wa Internet. Kama kifaa kimoja kimekata mtandao, data hazitafika kwenye kifaa kingine.
              </li>
              <li>
                <b>Gusa/Amsha Duka kwenye Kifaa:</b> Ikiwa duka halijatumika kwa dakika kadhaa, mifumo inaingia kwenye hali ya mapumziko kufanya ufanisi (Sleep Mode). Bofya au amsha duka kwa kugusa skrini/kipanya ili mfumo uamke na kusawazisha.
              </li>
              <li>
                <b>Fanya Reload (Refresh):</b> Fungua ukurasa wa kivinjari upya (Futa historia au Bonyeza kitufe cha Refresh) kwenye vifaa vyote viwili ili kulazimisha duka kuunganishwa upya na database ya wingu.
              </li>
              <li>
                <b>Mtumie Mfanyakazi Akaunti Sahihi:</b> Thibitisha kuwa mfanyakazi naye ameingia (login) katika Duka (Shop ID) lile lile ambalo wewe unalitumia.
              </li>
            </ol>
          </div>

          {/* Force Sync Action Button (ONLY User friendly way to force state sync) */}
          <button
            onClick={handleManualSync}
            disabled={syncing}
            className={`w-full py-2.5 px-3 font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 transition-all shadow border ${
              syncing 
                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' 
                : 'bg-indigo-600 border-indigo-700  text-white cursor-pointer active:scale-98'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-slate-400' : 'text-indigo-200'}`} />
            <span>{syncing ? 'Inasawazisha takwimu husika sasa...' : 'Bofya Kusawazisha data Sasa (Sync Now)'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function InlineAddStaffForm() {
  const { user, isBoss } = useStore();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isBoss()) {
      setStatus({ type: 'error', message: 'Huruhusiwi. Bosi pekee ndiye anayeweza kualika wafanyakazi mpya.' });
      return;
    }
    if (!email || !user?.shopId) return;

    setLoading(true);
    setStatus({ type: 'idle', message: '' });

    try {
      // 1. Check if user is already in this shop
      const { data: existingUser } = await supabase
        .from('users')
        .select('id, shop_id')
        .eq('email', email.trim().toLowerCase())
        .single();

      if (existingUser && existingUser.shop_id === user.shopId) {
        throw new Error('Mfanyakazi huyu tayari yupo kwenye duka lako.');
      }

      // 2. Create invitation in Supabase
      const { error: inviteError } = await supabase
        .from('shop_invitations')
        .insert({
          shop_id: user.shopId,
          email: email.trim().toLowerCase(),
          role: 'employee',
          created_at: new Date().toISOString()
        });

      if (inviteError) {
        if (inviteError.code === '23505') {
          throw new Error('Mwaliko kwa email hii tayari upo. Mfanyakazi anapaswa tu kujisajili (Register) ili kujiunga.');
        }
        throw inviteError;
      }

      TelemetryService.trackAddStaff(email.trim().toLowerCase(), 'employee');
      
      setStatus({ 
        type: 'success', 
        message: `Mwaliko umetumwa kwa ${email.trim()}! Hakikisha anajisajili (Register) kwa kutumia email hii sasa hivi.` 
      });
      setEmail('');
    } catch (err: any) {
      console.error('Invite staff error:', err);
      setStatus({ type: 'error', message: err.message || 'Imeshindwa kutuma mwaliko. Jaribu tena.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200/60 p-3.5 rounded-2xl space-y-3 shadow-sm max-w-sm mt-1">
      <div className="flex items-center space-x-2 pb-1 border-b border-slate-100">
        <Users className="w-4.5 h-4.5 text-indigo-600" />
        <span className="font-extrabold text-sm text-slate-800">Sajili/Alika Mfanyakazi Mpya:</span>
      </div>

      {status.type === 'success' && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs rounded-xl flex items-start space-x-1.5 leading-relaxed">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
          <span>{status.message}</span>
        </div>
      )}

      {status.type === 'error' && (
        <div className="p-2.5 bg-red-50 border border-red-100/50 text-red-800 text-xs rounded-xl flex items-start space-x-1.5 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 text-red-650 shrink-0 mt-0.5" />
          <span>{status.message}</span>
        </div>
      )}

      <form onSubmit={handleInvite} className="space-y-2.5">
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Barua Pepe / Email ya Mfanyakazi:</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="mfanyakazi@gmail.com"
            required
            disabled={loading}
            className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !email}
          className="w-full bg-indigo-600 font-bold text-white text-xs py-2 px-3 rounded-xl transition-all shadow-md active:scale-98 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center space-x-1"
        >
          {loading ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" />
              <span>Inatuma Mwaliko...</span>
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5 mr-0.5" />
              <span>Tuma mwaliko sasa</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}

function InlineToggleFeaturesForm() {
  const { isBoss } = useStore();
  const features = useStore(state => state.features);
  const isFeatureEnabled = (key: string) => features[key] === true;
  const [updating, setUpdating] = useState<string | null>(null);

  const handleToggle = async (key: string, currentVal: boolean) => {
    if (!isBoss()) {
      alert("Huruhusiwi. Bosi au Meneja pekee ndiye anayeweza kubadili vipengele vya duka.");
      return;
    }
    setUpdating(key);
    try {
      const nextVal = !currentVal;
      await SyncService.toggleFeature(key, nextVal);
      await TelemetryService.trackFeatureFlagToggle(key, nextVal);
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(null);
    }
  };

  const featuresList = [
    {
      key: 'staff_product_management',
      label: 'Ruhusu Wafanyakazi Kubadili Bidhaa',
      desc: 'Watumishi wanaruhusiwa kuongeza, kufuta au kubadili bei ya bidhaa mbalimbali.',
      color: 'bg-blue-600',
    },
    {
      key: 'staff_expense_management',
      label: 'Ruhusu Wafanyakazi Kurekodi Matumizi',
      desc: 'Watumishi wanaruhusiwa kuandika na kurekodi gharama za matumizi duka hivi sasa.',
      color: 'bg-orange-600',
    },
    {
      key: 'show_mapato_to_staff',
      label: 'Onyesha Mapato/Faida kwa Wafanyakazi',
      desc: 'Soma jopo kuu la mauzo kwa watumishi wote (wakizima wataona dashboard tu).',
      color: 'bg-purple-600',
    }
  ];

  return (
    <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-2xl space-y-3 max-w-sm shadow-sm mt-1">
      <div className="flex items-center space-x-2 pb-1 border-b border-slate-200/50">
        <Settings className="w-4 h-4 text-indigo-600" />
        <span className="font-extrabold text-sm text-slate-800">Udhibiti wa Ruhusa & Vipengele:</span>
      </div>

      <div className="space-y-2.5">
        {featuresList.map((f) => {
          const isEnabled = isFeatureEnabled(f.key);
          const isPending = updating === f.key;

          return (
            <div key={f.key} className="bg-white p-3 rounded-xl border border-slate-100 flex items-start justify-between space-x-3 text-xs shadow-3xs">
              <div className="space-y-0.5">
                <span className="font-bold text-slate-800 block text-[12.5px] leading-snug">{f.label}</span>
                <span className="text-slate-400 text-[10px] block leading-normal">{f.desc}</span>
              </div>

              <div className="shrink-0 pt-0.5">
                <button
                  disabled={isPending}
                  onClick={() => handleToggle(f.key, isEnabled)}
                  className={`w-10 h-5.5 rounded-full transition-colors relative flex items-center ${
                    isEnabled ? f.color : 'bg-gray-300'
                  } ${isPending ? 'opacity-50' : 'cursor-pointer '}`}
                >
                  <div
                    className={`absolute w-3.5 h-3.5 bg-white rounded-full transition-all shadow-4xs ${
                      isEnabled ? 'left-5.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-2 bg-indigo-50 border border-indigo-100 rounded-xl text-[10px] text-indigo-900 leading-normal flex items-start space-x-1">
        <span>💡</span>
        <span>Ukibadilisha ruhusa hizi, zitachukua nafasi mara moja kwenye vifaa vyote vya wafanyakazi.</span>
      </div>
    </div>
  );
}

interface EmployeeBreakdownResponseProps {
  users: any[];
  sales: any[];
  expenses: any[];
  auditLogs: any[];
  initialPeriod?: 'week' | 'month' | 'months6';
  onSelectEmployee?: (name: string) => void;
}

function EmployeeBreakdownResponse({ 
  users, 
  sales, 
  expenses, 
  auditLogs, 
  initialPeriod = 'week',
  onSelectEmployee 
}: EmployeeBreakdownResponseProps) {
  const [period, setPeriod] = useState<'week' | 'month' | 'months6'>(initialPeriod);
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  const isWithinPeriod = (dateStr: string) => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const now = new Date();
    
    if (period === 'week') {
      const start = subDays(now, 7);
      return date >= start;
    } else if (period === 'month') {
      const start = subDays(now, 30);
      return date >= start;
    } else {
      const start = subDays(now, 180);
      return date >= start;
    }
  };

  const displayUsers = users.filter(u => u.role !== 'boss');
  const fallbackUsers = displayUsers.length > 0 ? displayUsers : users.slice(0, 5); // Fallback to first 5 if no specific employees found

  return (
    <div className="space-y-4 text-slate-800 bg-slate-50 border border-slate-100 p-4 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-xl">📊</span>
          <h4 className="font-extrabold text-sm text-slate-900 font-sans tracking-tight">
            Ripoti ya Wafanyakazi
          </h4>
        </div>
        <div className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-lg shadow-sm font-mono uppercase">
          Kipindi: {period === 'week' ? 'Wiki Hii' : period === 'month' ? 'Mwezi Huu' : 'Miezi 6'}
        </div>
      </div>

      {/* Period Selector Tabs */}
      <div className="flex bg-slate-200/60 p-1 rounded-xl gap-1">
        {(['week', 'month', 'months6'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-1 px-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
              period === p
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600  '
            }`}
          >
            {p === 'week' ? 'Wiki Hii' : p === 'month' ? 'Mwezi' : 'Miezi 6'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {fallbackUsers.map((u) => {
          const userSales = sales.filter(s => s.user_id === u.id && isWithinPeriod(s.date || s.created_at));
          const totalSalesValue = userSales.reduce((acc, s) => acc + s.total_amount, 0);

          const userExpenses = expenses.filter(e => e.user_id === u.id && isWithinPeriod(e.date || e.created_at));
          const totalExpensesValue = userExpenses.reduce((acc, e) => acc + e.amount, 0);

          const userAnomalies = auditLogs.filter(log => 
            log.action.startsWith('anomaly_') && 
            isWithinPeriod(log.created_at) &&
            (log.user_id === u.id || log.details?.employee_name?.toLowerCase() === u.name?.toLowerCase())
          );

          return (
            <div key={u.id} className="bg-white border border-slate-100 p-3 rounded-xl shadow-sm space-y-2.5">
              <div className="flex items-start justify-between">
                <div>
                  <h5 className="font-bold text-xs text-slate-900 leading-none mb-1">{u.name || 'Mhudumu'}</h5>
                  <span className="inline-block text-[9px] font-sans font-black uppercase bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-100/50">
                    {u.role || 'Staff'}
                  </span>
                </div>

                {userAnomalies.length > 0 ? (
                  <span className="flex items-center space-x-1 text-[10px] font-bold bg-rose-50 border border-rose-100 text-rose-700 px-1.5 py-0.5 rounded-lg">
                    <AlertTriangle className="w-3 h-3 text-rose-600 animate-pulse" />
                    <span>Red Flags ({userAnomalies.length})</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1 text-[10px] font-bold bg-emerald-50 border border-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-lg">
                    <CheckCircle className="w-3 h-3 text-emerald-600" />
                    <span>Uaminifu Salama</span>
                  </span>
                )}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="bg-slate-50/50 p-1.5 rounded-lg border border-slate-100">
                  <span className="text-[9px] text-slate-400 block mb-0.5">Mauzo Alizouza</span>
                  <p className="font-extrabold text-slate-800 leading-tight">{formatCurrency(totalSalesValue, currency)}</p>
                  <span className="text-[9px] text-slate-400 font-mono block">({userSales.length} malipo)</span>
                </div>
                <div className="bg-slate-50/50 p-1.5 rounded-lg border border-slate-100">
                  <span className="text-[9px] text-slate-400 block mb-0.5">Matumizi Aliyoingiza</span>
                  <p className="font-extrabold text-slate-800 leading-tight">{formatCurrency(totalExpensesValue, currency)}</p>
                  <span className="text-[9px] text-slate-400 font-mono block">({userExpenses.length} rekodi)</span>
                </div>
              </div>

              {/* View Individual Diagnostic Link */}
              <button
                onClick={() => {
                  if (onSelectEmployee) {
                    onSelectEmployee(u.name);
                  }
                }}
                className="w-full py-1 px-2.5 bg-slate-50 border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg flex items-center justify-center space-x-1 transition-all active:scale-98 cursor-pointer"
              >
                <span>Angalia Wasifu na Ushauri wake 🔍</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SingleEmployeeReportProps {
  employee: any;
  sales: any[];
  expenses: any[];
  auditLogs: any[];
  onBackToGeneral?: () => void;
}

function SingleEmployeeReport({
  employee,
  sales,
  expenses,
  auditLogs,
  onBackToGeneral
}: SingleEmployeeReportProps) {
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  const userSales = sales.filter(s => s.user_id === employee.id);
  const totalSalesValue = userSales.reduce((acc, s) => acc + s.total_amount, 0);

  const userExpenses = expenses.filter(e => e.user_id === employee.id);
  const totalExpensesValue = userExpenses.reduce((acc, e) => acc + e.amount, 0);

  const recentAnomalies = auditLogs.filter(log => 
    log.action.startsWith('anomaly_') && 
    (log.user_id === employee.id || log.details?.employee_name?.toLowerCase() === employee.name?.toLowerCase())
  );

  return (
    <div className="space-y-3.5 text-slate-800 bg-slate-50 border border-slate-100 p-4 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
        <div className="flex items-center space-x-1.5">
          <span className="text-xl">👤</span>
          <div>
            <h4 className="font-extrabold text-sm text-slate-900 font-sans tracking-tight leading-none mb-1">
              {employee.name}
            </h4>
            <span className="text-[9px] font-extrabold text-indigo-600 bg-indigo-50 border border-indigo-100/50 px-1 py-0.5 rounded uppercase font-mono">{employee.role || 'Staff'}</span>
          </div>
        </div>
        {onBackToGeneral && (
          <button
            onClick={onBackToGeneral}
            className="text-[10px] text-indigo-700 font-extrabold bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm transition-all cursor-pointer active:scale-95"
          >
            ← Wote
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm">
          <span className="text-[9px] text-slate-400 block mb-0.5 font-bold uppercase">Mauzo (Sales)</span>
          <p className="font-extrabold text-slate-900 text-xs">{formatCurrency(totalSalesValue, currency)}</p>
          <p className="text-[9px] text-slate-400 font-mono mt-0.5">({userSales.length} miamala)</p>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm">
          <span className="text-[9px] text-slate-400 block mb-0.5 font-bold uppercase">Matumizi (Expenses)</span>
          <p className="font-extrabold text-slate-800 text-xs">{formatCurrency(totalExpensesValue, currency)}</p>
          <p className="text-[9px] text-slate-400 font-mono mt-0.5">({userExpenses.length} rekodi)</p>
        </div>
      </div>

      <div className="space-y-2 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
        <span className="text-[10px] font-black tracking-wider text-slate-900 uppercase block mb-0.5">
          ⚠️ Viashiria Shaka na Tabia (Red Flags)
        </span>

        {recentAnomalies.length > 0 ? (
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {recentAnomalies.map(a => (
              <div key={a.id} className="p-2 bg-rose-50/50 border border-rose-100 rounded-lg text-xs">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="font-black text-[9px] uppercase text-rose-800 bg-rose-100 px-1 rounded">
                    {a.action.replace('anomaly_', '').replace('_', ' ')}
                  </span>
                  <span className="text-[8px] text-slate-400 font-mono">
                    {format(new Date(a.created_at || new Date()), 'dd MMM yyyy')}
                  </span>
                </div>
                <p className="text-rose-950 font-medium leading-normal text-[11px]">
                  {a.details?.warning || a.details?.details || 'Nidhamu fupi ya rekodi iliporomoka.'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center space-x-1.5 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-100 p-2.5 rounded-lg">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-medium">Safi sana! Hakuna viashiria vyovyote vya shaka au kufuta bidhaa vilivyorekodiwa na mhudumu huyu hivi karibuni.</span>
          </div>
        )}
      </div>

      <div className="bg-indigo-50/50 border border-indigo-100/60 p-3 rounded-xl space-y-1">
        <div className="flex items-center space-x-1">
          <span className="text-xs">💡</span>
          <span className="font-extrabold text-xs text-indigo-900">Ushauri wa Venics Smart:</span>
        </div>
        <p className="text-[11px] text-indigo-950 font-medium leading-relaxed">
          {recentAnomalies.length > 0 
            ? `Bosi, mhudumu ${employee.name} ana ${recentAnomalies.length} kiashiria cha mabadiliko yenye mashaka duka letu. Unashauriwa kufanya mazungumzo ya kirafiki naye na kupitia daftari la mabadiliko ya duka na bidhaa. Msisitizie kwa upole kuwa mfumo wetu unafuatilia mapunguzo ya bei pamoja na kufuta bidhaa kwenye kikapu ili kusaidia uendeshaji wenye tija.`
            : `Mhudumu ${employee.name} anaonyesha uaminifu wa hali ya juu na mfululizo mzuri wa uuzaji duka letu. Unashauriwa kumpatia motisha ndogo (marupurupu au pongezi ya hadhara) ili kumtia moyo na kuendelea kukuza mauzo kwa uaminifu zaidi!`
          }
        </p>
      </div>
    </div>
  );
}

export default function MshauriChat() {
  const { user, token, isMshauriOpen, mshauriTriggerQuery, setMshauriOpen } = useStore();
  const navigate = useNavigate();
  const isOpen = isMshauriOpen;
  const setIsOpen = (open: boolean) => setMshauriOpen(open, open ? mshauriTriggerQuery : null);

  // --- SEEN INSIGHTS HELPERS ---
  const getSeenMessageIds = (): string[] => {
    try {
      const saved = localStorage.getItem('seen_mshauri_messages');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  };

  const markMessageAsSeen = (id: string) => {
    try {
      const current = getSeenMessageIds();
      if (!current.includes(id)) {
        const updated = [...current, id];
        localStorage.setItem('seen_mshauri_messages', JSON.stringify(updated));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // --- NON-AI STRATEGIC ENGINE (Audit Risk & License Expiry) ---
  const getProactiveInsights = () => {
    const findings: Array<{ priority: number; type: string; id: string; title: string; content: string; action?: { label: string; path: string } }> = [];
    const now = new Date();
    const today = startOfDay(now);
    
    // 1. Security & Audit Risk Score (Restricted to TODAY only for proactivity)
    const todayAuditLogs = auditLogs.filter(log => {
      if (!log.created_at || log.isDeleted === 1) return false;
      const logDate = new Date(log.created_at);
      return logDate >= today;
    });
    
    // Use string type to avoid TS union exhaustiveness errors
    const actions = todayAuditLogs.map(l => l.action as string);

    // High risk anomalies
    const chatAnomalies = todayAuditLogs.filter(log => 
      (log.action as string).startsWith('anomaly_')
    );
    
    // Explicit deletions/refunds of sales (High Risk)
    const salesDeletesCount = actions.filter(a => 
      a === 'refund_sale' || a === 'delete_all_products'
    ).length;

    // Cart Voids (Moderate Risk)
    const cartVoidsCount = todayAuditLogs.filter(log => 
      (log.action as string) === 'anomaly_frequent_voids' ||
      log.details?.warning?.includes('Cart Void') || 
      log.details?.warning?.includes('futa bidhaa kwenye kikapu')
    ).length;

    const securityScore = (chatAnomalies.length * 5) + (cartVoidsCount * 2) + (salesDeletesCount * 4);

    // Only alert if there is ACTUAL suspicious activity TODAY
    if (securityScore >= 10 && (salesDeletesCount > 0 || cartVoidsCount > 0 || chatAnomalies.length > 0)) {
      let insightContent = '';
      if (salesDeletesCount > 0 || cartVoidsCount > 0) {
        insightContent = `Nimeona mabadiliko duka leo: kurejesha miamala ya mauzo (${salesDeletesCount}) na kufuta bidhaa kwenye kikapu (mara ${cartVoidsCount}). Kagua daftari la mabadiliko ya duka sasa ili kuhakikisha usalama wa pesa zako.`;
      } else if (chatAnomalies.length > 0) {
        insightContent = `Nimebaini mabadiliko yasiyo ya kawaida ${chatAnomalies.length} katika matumizi ya mfumo leo. Ni vizuri kukagua daftari la mabadiliko ya duka ili kuzuia mianya ya upotevu.`;
      }

      if (insightContent) {
        const stableId = `security-insight-${salesDeletesCount}-${cartVoidsCount}-${chatAnomalies.length}-${format(today, 'yyyy-MM-dd')}`;
        findings.push({
          priority: 100,
          type: 'security',
          id: stableId,
          title: '🚨 Ripoti ya Mabadiliko (Leo)!',
          content: insightContent,
          action: { label: 'Kagua Mabadiliko duka', path: '/audit-logs' }
        });
      }
    }

    // 2. License Near Expiry
    if (license?.expiryDate) {
      const expiryDate = new Date(license.expiryDate);
      const daysLeft = differenceInDays(expiryDate, now);
      
      if (daysLeft <= 7 && daysLeft > 0) {
        const stableId = `license-near-expiry-${daysLeft}`;
        findings.push({
          priority: 95,
          type: 'license',
          id: stableId,
          title: '⏳ Huduma ya Mfumo itaisha hivi karibuni!',
          content: `Muda wa kutumia Mfumo kwenye duka lako utaisisha baada ya siku **${daysLeft}** pekee. Rekebisha sasa ili kuzuia huduma kusimama (Downtime).`,
          action: { label: 'Rekebisha Sasa', path: '/zaidi' }
        });
      } else if (daysLeft <= 0) {
         const stableId = `license-expired`;
         findings.push({
          priority: 110,
          type: 'license',
          id: stableId,
          title: '❌ Muda wa Mfumo umekwisha!',
          content: `Huduma ya Mfumo kwenye duka hili imekwisha muda wake. Tafadhali fanya marekebisho ili kurejesha huduma kamili na kuendelea kuwahudumia wateja.`,
          action: { label: 'Rekebisha Sasa', path: '/zaidi' }
        });
      }
    }

    // Filter out already seen insights
    const seenIds = getSeenMessageIds();
    const activeFindings = findings.filter(f => !seenIds.includes(f.id));

    // Return only the highest priority finding, or nothing if everything is clean
    return activeFindings.sort((a, b) => b.priority - a.priority).slice(0, 1);
  };

  useEffect(() => {
    if (isOpen) {
      window.history.pushState({ mshauriOpen: true }, '');
      
      // Increment open counter for the first 5 times limit
      try {
        const countStr = localStorage.getItem('mshauri_open_count') || '0';
        const currentCount = parseInt(countStr, 10) || 0;
        localStorage.setItem('mshauri_open_count', String(currentCount + 1));
      } catch (e) {
        console.error('Failed to update mshauri_open_count', e);
      }

      // Proactive Insight Injection
      const insights = getProactiveInsights();
      if (insights.length > 0) {
        const proactiveMessages = insights.map(i => ({
          id: i.id,
          text: `[ST-INSIGHT]\n### ${i.title}\n${i.content}`,
          sender: 'ai' as const,
          timestamp: new Date(),
          isInsight: true,
          action: i.action
        }));
        
        // Only inject if not already injected
        if (!messages.some(m => m.id === insights[0].id)) {
          setMessages(prev => [...prev, ...proactiveMessages]);
        }
      }

      const handlePopState = (event: PopStateEvent) => {
        setIsOpen(false);
      };
      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
        // If we popped and it's still open, close it
        if (window.history.state?.mshauriOpen) {
          window.history.back();
        }
      };
    }
  }, [isOpen]);

  const [isTyping, setIsTyping] = useState(false);
  const [isAiEnabled, setIsAiEnabled] = useState(false);

  const [lastIntent, setLastIntent] = useState<'sales' | 'expenses' | 'debts' | 'stock' | 'behavior' | 'bestselling' | 'unknown'>('unknown');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [defaultQuickOptions] = useState(() => {
    const ALL_QUICK_ACTIONS = [
      "Faida ya leo kiasi gani?",
      "Bidhaa gani zinauzwa sana?",
      "Bidhaa gani zimedoda stoo?",
      "Bidhaa zinazoisha stoo?",
      "Nani anadaiwa hela nyingi?"
    ];
    return [...ALL_QUICK_ACTIONS].sort(() => 0.5 - Math.random()).slice(0, 3);
  });
  const [sessionStartTime] = useState(() => new Date());
  const [welcomeDismissed, setWelcomeDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mshauri_welcome_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const handleDismissWelcome = () => {
    try {
      localStorage.setItem('mshauri_welcome_dismissed', 'true');
      setWelcomeDismissed(true);
    } catch (e) {
      console.error(e);
    }
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  // Retrieve complete shop data in one fast Index-Query
  const sales = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    return db.sales
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .toArray();
  }, [user?.shopId]) || [];

  const expenses = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    return db.expenses
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .toArray();
  }, [user?.shopId]) || [];

  const auditLogs = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    return db.auditLogs
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .toArray();
  }, [user?.shopId]) || [];

  const products = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    return db.products
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .toArray();
  }, [user?.shopId]) || [];

  const saleItems = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    return db.saleItems
      .where('shop_id')
      .equals(user.shopId)
      .toArray();
  }, [user?.shopId]) || [];

  const license = useLiveQuery(() => db.license.get(1)) || null;

  const debtPayments = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    return db.debtPayments
      .where('shop_id')
      .equals(user.shopId)
      .toArray();
  }, [user?.shopId]) || [];

  const users = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const allUsers = await db.users
      .where('shop_id')
      .equals(user.shopId)
      .toArray();
    return allUsers.filter(u => u.isDeleted !== 1);
  }, [user?.shopId]) || [];

  const dbChats = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    return db.assistantChats
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .sortBy('created_at');
  }, [user?.shopId]);

  // Dynamically update messages state with reactive history and count-aware welcome message
  useEffect(() => {
    if (!user?.shopId) return;
    if (dbChats === undefined) return; // Still loading query

    const historyMsg: Message[] = dbChats.map(chat => {
      let parsedMetadata: any = {};
      try {
        parsedMetadata = typeof chat.metadata === 'string' ? JSON.parse(chat.metadata) : (chat.metadata || {});
      } catch {
        parsedMetadata = chat.metadata || {};
      }

      return {
        id: chat.id,
        sender: chat.message_type === 'user' ? 'user' : (chat.message_type === 'system' ? 'system' as any : 'bot'),
        text: chat.content,
        type: parsedMetadata.type || 'text',
        employeeId: parsedMetadata.employeeId,
        initialPeriod: parsedMetadata.initialPeriod,
        intent: parsedMetadata.intent,
        query: parsedMetadata.query,
        timestamp: chat.created_at ? new Date(chat.created_at) : new Date(),
        action: parsedMetadata.action
      };
    });

    const countStr = localStorage.getItem('mshauri_open_count') || '0';
    const currentCount = parseInt(countStr, 10) || 0;

    const filteredHistory = historyMsg.filter(m => m.timestamp.getTime() >= sessionStartTime.getTime());

    if (!welcomeDismissed && currentCount < 5) {
      const welcomeId = 'welcome_msg';
      const welcomeMsgText = `Habari Boss ${user.name || 'Bosi'}! Mimi ni Venics Smart, mshauri wako wa biashara aliyebobea duka hili. Niulize maswali mazito ya ki-uchambuzi au maswali ya mzunguko wa stock, kubana matumizi na ulinzi wa duka.`;
      
      const welcomeMsg: Message = {
        id: welcomeId,
        sender: 'bot',
        text: welcomeMsgText,
        timestamp: new Date(0), // order it first
        followUps: getProactiveInsights().length === 0 ? defaultQuickOptions : undefined
      };
      setMessages([welcomeMsg, ...filteredHistory]);
    } else if (filteredHistory.length === 0 && getProactiveInsights().length === 0) {
      const emptyStateId = 'empty_state_msg';
      const emptyMsgText = `Habari Boss ${user.name || 'Bosi'}, nipo hapa kwa ajili yako. Nikusaidie nini leo kuhusu taarifa za duka lako?`;
      
      const emptyStateMsg: Message = {
        id: emptyStateId,
        sender: 'bot',
        text: emptyMsgText,
        timestamp: new Date(0), 
        followUps: defaultQuickOptions
      };
      setMessages([emptyStateMsg, ...filteredHistory]);
    } else {
      setMessages(filteredHistory);
    }
  }, [dbChats, user?.shopId, user?.name, sessionStartTime, welcomeDismissed, defaultQuickOptions]);

  const getShopContext = () => {
    // 1. Inventory Summary
    const totalProducts = products.length;
    const lowStock = products.filter(p => p.stock <= p.min_stock);
    const lowStockItems = lowStock.map(p => ({ name: p.name, stock: p.stock, min_stock: p.min_stock }));
    const totalValueBuy = products.reduce((acc, p) => acc + (p.buy_price * p.stock), 0);
    const totalValueSell = products.reduce((acc, p) => acc + (p.sell_price * p.stock), 0);

    // 2. Sales Summary (group last 7 days metrics)
    const recentDaysMap: Record<string, { revenue: number, profit: number, count: number }> = {};
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = subDays(now, i);
      const dStr = format(d, 'yyyy-MM-dd');
      recentDaysMap[dStr] = { revenue: 0, profit: 0, count: 0 };
    }

    sales.forEach(s => {
      try {
        const dStr = format(new Date(s.date || s.created_at || now), 'yyyy-MM-dd');
        if (recentDaysMap[dStr]) {
          recentDaysMap[dStr].revenue += s.total_amount || 0;
          recentDaysMap[dStr].profit += s.total_profit || 0;
          recentDaysMap[dStr].count += 1;
        }
      } catch (e) {}
    });

    const recentDays = Object.entries(recentDaysMap).map(([date, metrics]) => ({
      date,
      revenue: metrics.revenue,
      profit: metrics.profit,
      transactions: metrics.count
    }));

    // Bestselling items
    const productQuantities: Record<string, { name: string; qty: number; revenue: number }> = {};
    saleItems.forEach(item => {
      if (item.isDeleted !== 1) {
        if (!productQuantities[item.product_id]) {
          productQuantities[item.product_id] = { name: item.product_name, qty: 0, revenue: 0 };
        }
        productQuantities[item.product_id].qty += item.qty;
        productQuantities[item.product_id].revenue += item.qty * item.sell_price;
      }
    });
    const bestsellers = Object.values(productQuantities)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    // 3. Debts summary (subtract partial debtPayments so this matches the
    // authoritative remaining-balance calc used in the DEBTS_INTENT branch below)
    const creditSales = sales.filter(s => s.payment_method === 'credit' && s.status === 'pending');
    const creditSalesRemaining = creditSales
      .map(s => {
        const totalPaid = debtPayments.filter(p => p.sale_id === s.id).reduce((sum, p) => sum + p.amount, 0);
        return { sale: s, remaining: s.total_amount - totalPaid };
      })
      .filter(item => item.remaining > 0.1);
    const totalOutstanding = creditSalesRemaining.reduce((acc, item) => acc + item.remaining, 0);
    const debtorList = creditSalesRemaining.slice(0, 5).map(item => ({ name: item.sale.customer_name, amount: item.remaining }));

    // 4. Expenses summary
    const recentWeeksMap: Record<string, number> = {};
    expenses.forEach(e => {
      recentWeeksMap[e.category] = (recentWeeksMap[e.category] || 0) + e.amount;
    });
    const recentWeeks = Object.entries(recentWeeksMap).map(([category, amount]) => ({
      category,
      amount
    }));

    // 5. Staff Anomalies
    const anomalies = auditLogs
      .filter(log => log.action.startsWith('anomaly_'))
      .slice(0, 5)
      .map(a => ({
        action: a.action,
        employee: a.details?.employee_name || 'Staff',
        details: a.details?.warning || a.details?.details || '',
        timestamp: a.created_at
      }));

    return {
      currency,
      inventory: {
        totalProducts,
        lowStockCount: lowStock.length,
        lowStockItems,
        totalValueBuy,
        totalValueSell
      },
      sales: {
        recentDays,
        bestsellers
      },
      expenses: {
        recentWeeks
      },
      debts: {
        totalOutstanding,
        debtCount: creditSalesRemaining.length,
        debtorList
      },
      anomalies
    };
  };

  const formatResponseText = (text: string) => {
    if (typeof text !== 'string') return text;
    
    // Simple robust tokenizer/formatter to parse both **bold**, *italic*, and "clickable suggestions"
    const formatLineContent = (contentString: string, keyPrefix: string) => {
      const elements: React.ReactNode[] = [];
      const tokenRegex = /(\*\*(.*?)\*\*)|(\*(.*?)\*)|("(.*?)")/g;
      let match;
      let lastIdx = 0;

      while ((match = tokenRegex.exec(contentString)) !== null) {
        if (match.index > lastIdx) {
          elements.push(contentString.substring(lastIdx, match.index));
        }
        
        const isBold = match[1] !== undefined;
        const isItalic = match[3] !== undefined;
        const isQuoted = match[5] !== undefined;
        
        if (isBold) {
          elements.push(
            <strong key={`${keyPrefix}-b-${match.index}`} className="font-bold text-slate-900 bg-indigo-50/70 px-1 rounded">
              {formatLineContent(match[2], `${keyPrefix}-b-inner-${match.index}`)}
            </strong>
          );
        } else if (isItalic) {
          elements.push(
            <em key={`${keyPrefix}-i-${match.index}`} className="italic font-medium text-slate-800">
              {formatLineContent(match[4], `${keyPrefix}-i-inner-${match.index}`)}
            </em>
          );
        } else if (isQuoted) {
          const suggestion = match[6];
          elements.push(
            <button
              key={`${keyPrefix}-q-${match.index}`}
              onClick={(e) => {
                e.preventDefault();
                sendMessage(suggestion);
              }}
              className="inline-flex items-center text-indigo-700 bg-indigo-50 border-b border-indigo-200 px-1 mx-0.5 rounded transition-all cursor-pointer font-medium underline decoration-indigo-300 underline-offset-2"
            >
              "{suggestion}"
            </button>
          );
        }
        lastIdx = tokenRegex.lastIndex;
      }

      if (lastIdx < contentString.length) {
        elements.push(contentString.substring(lastIdx));
      }

      return elements.length > 0 ? elements : [contentString];
    };

    return text.split('\n').map((line, i) => {
      let cleanLine = line.trim();
      if (!cleanLine) return <div key={i} className="h-2" />;
      
      // Check for major heading (e.g., ### Title or ## Title)
      if (cleanLine.startsWith('#')) {
        const level = cleanLine.match(/^#+/)?.[0].length || 1;
        const title = cleanLine.replace(/^#+\s*/, '');
        return (
          <h4 key={i} className="font-bold text-indigo-950 mt-5 mb-2.5 flex items-center text-lg sm:text-xl border-b border-indigo-100 pb-2 font-sans tracking-tight">
            {level >= 3 && <VenicsLogo size={20} className="mr-1.5 shrink-0" animate="none" />}
            {title}
          </h4>
        );
      }
      
      // Check for bullet lists (e.g., - Item or * Item where item starts with a space)
      const bulletMatch = cleanLine.match(/^([-*])\s+(.*)/);
      if (bulletMatch) {
        const listContent = bulletMatch[2];
        const formattedContent = formatLineContent(listContent, `list-${i}`);
        return (
          <div key={i} className="flex items-start space-x-2.5 pl-4 py-1.5 text-base sm:text-[16.5px] my-0.5 text-slate-700">
            <span className="text-indigo-500 shrink-0 select-none font-bold text-lg">•</span>
            <span className="leading-relaxed">{formattedContent}</span>
          </div>
        );
      }

      // Check for numbered list
      const numberMatch = cleanLine.match(/^(\d+)\.\s+(.*)/);
      if (numberMatch) {
        const num = numberMatch[1];
        const rest = numberMatch[2];
        const formattedContent = formatLineContent(rest, `num-${i}`);
        return (
          <div key={i} className="flex items-start space-x-2.5 pl-4 py-1.5 text-base sm:text-[16.5px] text-slate-700">
            <span className="font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 text-xs w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5">{num}</span>
            <span className="leading-relaxed">{formattedContent}</span>
          </div>
        );
      }

      // Otherwise it is a standard paragraph
      const formattedContent = formatLineContent(cleanLine, `p-${i}`);
      return (
        <p key={i} className="leading-relaxed text-base sm:text-[16.5px] text-slate-700 my-2 block">
          {formattedContent}
        </p>
      );
    });
  };

  // Smart and localized ChatGPT/Gemini-like scrolling setup
  useEffect(() => {
    if (!isOpen || messages.length === 0) return;
    const latestMsg = messages[messages.length - 1];
    
    const timer = setTimeout(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      if (latestMsg.sender === 'user') {
        // Scroll fully to bottom for user input & typing indicator
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      } else {
        // Intelligent scroll: align to beginning of new bot response if too long
        const messageElements = container.querySelectorAll('.message-item');
        const lastElement = messageElements[messageElements.length - 1] as HTMLElement;
        if (lastElement) {
          container.scrollTo({
            top: lastElement.offsetTop - 12,
            behavior: 'smooth'
          });
        }
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [messages, isOpen]);

  const parsePeriod = (textStr: string): { 
    label: string; 
    filterKey: 'leo' | 'jana' | 'wiki' | 'mwezi' | 'miezi6' | 'mwaka' | 'yote'; 
    targetView: 'risiti' | 'ripoti';
    matchFn: (date: Date) => boolean 
  } => {
    const now = new Date();
    const text = textStr.toLowerCase();
    
    if (text.match(/jana/i) || text.match(/yesterday/i)) {
      const jana = subDays(now, 1);
      const janaStr = startOfDay(jana).toDateString();
      return {
        label: 'Jana (Yesterday)',
        filterKey: 'jana',
        targetView: 'risiti',
        matchFn: (d) => d.toDateString() === janaStr
      };
    }
    
    if (text.match(/wiki/i) || text.match(/week/i)) {
      const startOfW = startOfWeek(now, { weekStartsOn: 1 });
      return {
        label: 'Wiki Hii',
        filterKey: 'wiki',
        targetView: 'risiti',
        matchFn: (d) => d >= startOfW
      };
    }
    
    // Check specific English & Swahili months
    const months = [
      { names: ['january', 'januari', 'jan'], index: 0, label: 'Januari' },
      { names: ['february', 'februari', 'feb'], index: 1, label: 'Februari' },
      { names: ['march', 'machi', 'mar'], index: 2, label: 'Machi' },
      { names: ['april', 'aprili', 'apr'], index: 3, label: 'Aprili' },
      { names: ['may', 'mei'], index: 4, label: 'Mei' },
      { names: ['june', 'juni', 'jun'], index: 5, label: 'Juni' },
      { names: ['july', 'julai', 'jul'], index: 6, label: 'Julai' },
      { names: ['august', 'agosti', 'aug', 'ago'], index: 7, label: 'Agosti' },
      { names: ['september', 'septemba', 'sep'], index: 8, label: 'Septemba' },
      { names: ['october', 'oktoba', 'oct', 'okt'], index: 9, label: 'Oktoba' },
      { names: ['november', 'novemba', 'nov'], index: 10, label: 'Novemba' },
      { names: ['december', 'desemba', 'dec', 'des'], index: 11, label: 'Desemba' }
    ];

    for (const m of months) {
      if (m.names.some(n => text.includes(n))) {
        const year = now.getFullYear();
        return {
          label: m.label,
          filterKey: 'mwezi',
          targetView: 'ripoti',
          matchFn: (d) => d.getMonth() === m.index && d.getFullYear() === year
        };
      }
    }

    if (text.match(/mwezi uliopita/i) || text.match(/last month/i)) {
      const lastM = subMonths(now, 1);
      const mIndex = lastM.getMonth();
      const yVal = lastM.getFullYear();
      return {
        label: 'Mwezi Uliopita',
        filterKey: 'mwezi',
        targetView: 'ripoti',
        matchFn: (d) => d.getMonth() === mIndex && d.getFullYear() === yVal
      };
    }

    if (text.match(/mwezi/i) || text.match(/month/i)) {
      const currentM = now.getMonth();
      const yVal = now.getFullYear();
      return {
        label: 'Mwezi Huu',
        filterKey: 'mwezi',
        targetView: 'risiti',
        matchFn: (d) => d.getMonth() === currentM && d.getFullYear() === yVal
      };
    }

    // Default is Today (Leo)
    const todayStr = startOfDay(now).toDateString();
    return {
      label: 'Leo (Today)',
      filterKey: 'leo',
      targetView: 'risiti',
      matchFn: (d) => d.toDateString() === todayStr
    };
  };

  const processQuery = (query: string, resolvedIntent: string): React.ReactNode => {
    const text = query.toLowerCase().trim();
    const period = parsePeriod(text);

    if (resolvedIntent === 'ACTION_ADD_STAFF') {
      return <InlineAddStaffForm />;
    }
    if (resolvedIntent === 'ACTION_TOGGLE_FEATURES') {
      return <InlineToggleFeaturesForm />;
    }

    // Normalize new uppercase intents to legacy lowercase ones
    let activeIntent = resolvedIntent;
    if (resolvedIntent === 'REPORT_SALES') activeIntent = 'sales';
    else if (resolvedIntent === 'REPORT_EXPENSES') activeIntent = 'expenses';
    else if (resolvedIntent === 'REPORT_DEBTS') activeIntent = 'debts';
    else if (resolvedIntent === 'REPORT_STOCK') activeIntent = 'stock';
    else if (resolvedIntent === 'REPORT_SECURITY') activeIntent = 'behavior';
    else if (resolvedIntent === 'REPORT_BEST_SELLING') activeIntent = 'bestselling';
    else if (resolvedIntent === 'REPORT_COMPARISON') activeIntent = 'comparison';
    else if (resolvedIntent === 'REPORT_BUSINESS') activeIntent = 'business';
    resolvedIntent = activeIntent as any;

    // A. SALES & PROFIT INTENT
    if (resolvedIntent === 'sales') {
      const filteredSales = sales.filter(s => period.matchFn(new Date(s.created_at)));
      const todaySales = filteredSales.reduce((acc, s) => acc + s.total_amount, 0);
      const todayProfit = filteredSales.reduce((acc, s) => acc + (s.total_profit || 0), 0);
      
      const filteredExpenses = expenses.filter(e => period.matchFn(new Date(e.date)));
      const expenseTotal = filteredExpenses.reduce((acc, e) => acc + e.amount, 0);
      const netProfit = todayProfit - expenseTotal;
      
      return (
        <div className="space-y-2">
          <p className="font-semibold text-slate-800 flex items-center">
            <TrendingUp className="w-4 h-4 mr-1 text-green-600 shadow-sm" />
            Ripoti ya Mauzo na Faida ({period.label}):
          </p>
          <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl space-y-1">
            <p className="text-sm">Mauzo Ghafi: <b className="font-black text-slate-900">{formatCurrency(todaySales, currency)}</b></p>
            <p className="text-sm">Faida Salama: <b className="font-black text-blue-600">{formatCurrency(todayProfit, currency)}</b></p>
            <p className="text-sm">Matumizi: <b className="font-black text-red-600">{formatCurrency(expenseTotal, currency)}</b></p>
            <p className="text-sm">Faida Halisi: <b className="font-black text-green-600">{formatCurrency(netProfit, currency)}</b></p>
            <p className="text-xs text-slate-500">Miamala yote: {filteredSales.length} iliyokamilika.</p>
          </div>
          <button
            onClick={() => {
              setIsOpen(false);
              navigate('/historia', { state: { filter: period.filterKey, view: period.targetView } });
            }}
            className="w-full mt-2 py-2 px-3 bg-indigo-600 text-white text-xs font-bold rounded-xl flex items-center justify-center space-x-1 transition-all shadow-md active:scale-98 cursor-pointer"
          >
            <span>📊 {period.targetView === 'risiti' ? 'Orodha ya Risiti' : 'Ripoti za Biashara'} ({period.label})</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    // B. EXPENSES INTENT
    if (resolvedIntent === 'expenses') {
      const filteredExpenses = expenses.filter(e => period.matchFn(new Date(e.date)));
      const expenseTotal = filteredExpenses.reduce((acc, e) => acc + e.amount, 0);
      
      // Category Breakdown
      const categories: Record<string, number> = {};
      filteredExpenses.forEach(e => {
        categories[e.category] = (categories[e.category] || 0) + e.amount;
      });
      const topCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 3);

      return (
        <div className="space-y-2">
          <p className="font-semibold text-slate-800 flex items-center">
            <Wallet className="w-4 h-4 mr-1 text-red-500 shadow-sm" />
            Ripoti ya Matumizi ({period.label}):
          </p>
          <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl space-y-1">
            <p className="text-sm">Jumla ya Matumizi: <b className="font-black text-red-600">{formatCurrency(expenseTotal, currency)}</b></p>
            {topCategories.length > 0 ? (
              <div className="mt-2 text-xs text-slate-600 space-y-0.5">
                <span className="font-bold text-slate-700 block mb-1">Mchanganuo wa Makundi:</span>
                {topCategories.map(([cat, amt]) => (
                  <div key={cat} className="flex justify-between border-b border-dashed border-slate-200 py-0.5">
                    <span>• {cat}</span>
                    <span className="font-bold">{formatCurrency(amt, currency)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-1">Hakuna matumizi yaliyorekodiwa kipindi hiki.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/matumizi');
              }}
              className="py-2 px-3 bg-slate-100 text-slate-800 text-xs font-bold rounded-xl flex items-center justify-center space-x-1 transition-all cursor-pointer"
            >
              <span>💸 Orodha</span>
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/historia', { state: { filter: period.filterKey, view: period.targetView } });
              }}
              className="py-2 px-3 bg-indigo-600 text-white text-xs font-bold rounded-xl flex items-center justify-center space-x-1 transition-all shadow-md active:scale-98 cursor-pointer"
            >
              <span>📊 Ripoti</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    // C. DEBTS INTENT
    if (resolvedIntent === 'debts') {
      const creditSalesAll = sales.filter(s => s.payment_method === 'credit' && s.status === 'pending');
      
      const unpaidDebtsList = creditSalesAll
        .map(s => {
          const payments = debtPayments.filter(p => p.sale_id === s.id);
          const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
          const remaining = s.total_amount - totalPaid;
          return { sale: s, remaining };
        })
        .filter(item => item.remaining > 0.1)
        .sort((a, b) => b.remaining - a.remaining);

      const totalUnpaidAmount = unpaidDebtsList.reduce((acc, item) => acc + item.remaining, 0);

      return (
        <div className="space-y-2.5">
          <p className="font-semibold text-slate-800 flex items-center text-sm">
            <CreditCard className="w-4 h-4 mr-1 text-orange-500 shadow-sm" />
            Ripoti ya Madeni na Mikopo:
          </p>
          <div className="bg-slate-50 border border-slate-100 p-3 rounded-2xl space-y-1">
            <p className="text-sm">Jumla ya Madeni Nje: <b className="font-extrabold text-orange-600">{formatCurrency(totalUnpaidAmount, currency)}</b></p>
            <p className="text-xs text-slate-500">Idadi ya wateja wanaodaiwa: <b>{unpaidDebtsList.length}</b></p>
          </div>

          {unpaidDebtsList.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Orodha ya Wanaodaiwa (Bonyeza kukumbusha):</p>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {unpaidDebtsList.slice(0, 4).map(({ sale: debt, remaining }, idx) => {
                  const cleanPhone = (debt.customer_phone || '').replace(/\s+/g, '').replace(/-/g, '').replace(/\+/g, '');
                  let formattedPhone = cleanPhone;
                  if (formattedPhone.startsWith('0')) {
                    formattedPhone = '255' + formattedPhone.substring(1);
                  } else if (formattedPhone.length === 9) {
                    formattedPhone = '255' + formattedPhone;
                  }
                  
                  const shopName = settings?.shopName || 'duka letu';
                  const messageText = `Habari ${debt.customer_name},\n\nHapa ni *${shopName}*. Tunakukumbusha kwa upendo salio la deni lako lililobaki la *${formatCurrency(remaining, currency)}* kwa ajili ya manunuzi uliyofanya hapa dukani.\n\nUnaweza kufanya malipo au kufika dukani kumalizia deni hili. Asante sana kwa kusaidia biashara yetu, tunathamini sana ushirikiano wako! 🙏✨`;
                  const encodedText = encodeURIComponent(messageText);
                  const whatsappUrl = formattedPhone ? `https://wa.me/${formattedPhone}/?text=${encodedText}` : null;

                  return (
                    <div key={idx} className="bg-white border border-slate-100 p-2.5 rounded-xl flex items-center justify-between text-xs transition-colors">
                      <div className="min-w-0 pr-2">
                        <p className="font-bold text-slate-800 truncate">{debt.customer_name}</p>
                        <p className="text-[10px] text-red-600 font-extrabold">{formatCurrency(remaining, currency)} baki</p>
                      </div>
                      
                      {whatsappUrl ? (
                        <a 
                          href={whatsappUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="shrink-0 bg-emerald-50 text-emerald-700 font-bold px-2 py-1.5 rounded-lg border border-emerald-100 flex items-center space-x-1 transition-all"
                        >
                          <span className="text-[12px]">💬</span>
                          <span className="text-[10px]">Kumbusha</span>
                        </a>
                      ) : (
                        <button
                          onClick={() => {
                            setIsOpen(false);
                            navigate('/madeni');
                          }}
                          className="shrink-0 bg-slate-50 text-slate-500 font-bold px-2 py-1.5 rounded-lg border border-slate-200/50 flex items-center space-x-1"
                        >
                          <span className="text-[11px]">✏️</span>
                          <span className="text-[10px] text-slate-600">Weka Namba</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setIsOpen(false);
              navigate('/madeni');
            }}
            className="w-full mt-1.5 py-2 px-3 bg-indigo-600 text-white text-xs font-bold rounded-xl flex items-center justify-center space-x-1 transition-all shadow-md active:scale-98 cursor-pointer"
          >
            <span>👉 Fungua Daftari la Madeni</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    // D. BEST SELLING INTENT (Calculates best sellers dynamically over selected period)
    if (resolvedIntent === 'bestselling') {
      const periodSales = sales.filter(s => period.matchFn(new Date(s.created_at)) && s.isDeleted !== 1);
      const periodSaleIds = new Set(periodSales.map(s => s.id));
      const filteredItems = saleItems.filter(item => item.isDeleted !== 1 && periodSaleIds.has(item.sale_id));

      const productQuantities: Record<string, { name: string; qty: number; revenue: number }> = {};
      filteredItems.forEach(item => {
        if (!productQuantities[item.product_id]) {
          productQuantities[item.product_id] = { name: item.product_name, qty: 0, revenue: 0 };
        }
        productQuantities[item.product_id].qty += item.qty;
        productQuantities[item.product_id].revenue += item.qty * item.sell_price;
      });

      const sortedBestsellers = Object.values(productQuantities).sort((a, b) => b.qty - a.qty).slice(0, 5);

      return (
        <div className="space-y-2">
          <p className="font-semibold text-slate-800 flex items-center">
            <VenicsLogo size={16} className="mr-1 inline-block" animate="none" />
            Bidhaa Zinazouzwa Sana ({period.label}):
          </p>
          <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl space-y-1">
            {sortedBestsellers.length > 0 ? (
              <div className="space-y-1.5 min-w-0">
                {sortedBestsellers.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-sm border-b border-dashed border-slate-200 py-1 last:border-0">
                    <span className="truncate max-w-[180px] font-medium text-slate-700">{idx + 1}. {item.name}</span>
                    <span className="shrink-0 font-bold text-slate-900">{item.qty} pcs ({formatCurrency(item.revenue, currency)})</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Hakuna mauzo ya bidhaa yaliyotokea kipindi hiki ({period.label}).</p>
            )}
          </div>
          <button
            onClick={() => {
              setIsOpen(false);
              navigate('/historia', { state: { filter: period.filterKey, view: period.targetView } });
            }}
            className="w-full mt-2 py-2 px-3 bg-indigo-600 text-white text-xs font-bold rounded-xl flex items-center justify-center space-x-1 transition-all shadow-md active:scale-98 cursor-pointer"
          >
            <span>📊 {period.targetView === 'risiti' ? 'Orodha ya Risiti' : 'Ripoti za Biashara'} ({period.label})</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    // E. STOCK INTENT
    if (resolvedIntent === 'stock') {
      const lowStock = products.filter(p => p.stock <= p.min_stock);
      return (
        <div className="space-y-2">
          <p className="font-semibold text-slate-800 flex items-center">
            <Package className="w-4 h-4 mr-1 text-emerald-500 shadow-sm" />
            Ripoti ya Hali ya Mzigo:
          </p>
          <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl space-y-1">
            <p className="text-sm">Bidhaa Zinazoisha: <b className="font-black text-red-600">{lowStock.length}</b></p>
            {lowStock.length > 0 ? (
              <div className="mt-1 text-xs text-slate-600 space-y-1 max-h-24 overflow-y-auto pr-1">
                {lowStock.slice(0, 4).map(p => (
                  <div key={p.id} className="flex justify-between border-b border-slate-100 pb-0.5 last:border-00">
                    <span className="truncate max-w-[180px]">• {p.name}</span>
                    <span className="font-bold text-red-600 shrink-0">baki {p.stock}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-emerald-600">Safi kabisa! Hakuna bidhaa yoyote iliyo chini sana ya stock leo.</p>
            )}
          </div>
          <button
            onClick={() => {
              setIsOpen(false);
              navigate('/dashibodi', { state: { openLowStock: true } });
            }}
            className="w-full mt-2 py-2 px-3 bg-emerald-600 text-white text-xs font-bold rounded-xl flex items-center justify-center space-x-1 transition-all shadow-md active:scale-98 cursor-pointer"
          >
            <span>⚠️ Fungua Orodha Ya Low Stock</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    // F. BEHAVIOR INTENT
    if (resolvedIntent === 'behavior') {
      const recentAnomalies = auditLogs.filter(log => log.action.startsWith('anomaly_'));
      return (
        <div className="space-y-2">
          <p className="font-semibold text-slate-800 flex items-center">
            <ShieldCheck className="w-4 h-4 mr-1 text-red-600 shadow-sm" />
            Kumbukumbu na Tabia za Wafanyakazi (Siku 3):
          </p>
          <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl space-y-1">
            {recentAnomalies.length > 0 ? (
              <div className="text-xs text-red-700 space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {recentAnomalies.slice(0, 3).map(a => (
                  <div key={a.id} className="bg-red-50 p-2 rounded-lg border border-red-100/50">
                    <span className="font-bold text-red-800 block text-[10px] uppercase mb-0.5">{a.details?.employee_name || 'Mhudumu'}:</span>
                    <span>{a.details?.warning || a.action}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-emerald-600 italic">Hakuna ripoti au viashiria vya hatari upande vya wafanyakazi vilivyoonekana siku za karibuni duka letu.</p>
            )}
          </div>
          <button
            onClick={() => {
              setIsOpen(false);
              navigate('/audit-logs');
            }}
            className="w-full mt-2 py-2 px-3 bg-red-600 text-white text-xs font-bold rounded-xl flex items-center justify-center space-x-1 transition-all shadow-md active:scale-98 cursor-pointer"
          >
            <span>🚨 Fungua Daftari la Mabadiliko ya Duka</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    // F2. COMPARISON INTENT
    if (resolvedIntent === 'comparison') {
      let compPeriod = 'week';
      if (text.match(/mwezi|month/i)) compPeriod = 'month';
      else if (text.match(/siku|day|jana|leo|yesterday|today/i)) compPeriod = 'day';

      const data = BusinessLogic.getComparisonReport(sales, expenses, compPeriod);
      const cur = data.current;
      const prev = data.previous;
      const chg = data.changes;

      const revUp = chg.revenuePct >= 0;
      const profUp = chg.profitPct >= 0;
      const expUp = chg.expensesPct >= 0;
      const netUp = chg.netProfitPct >= 0;

      return (
        <div className="space-y-3">
          <p className="font-semibold text-slate-800 flex items-center text-sm">
            <Sparkles className="w-4 h-4 mr-1 text-indigo-600 animate-pulse animate-duration-[2000ms]" />
            Ulinganisho wa Biashara ({data.periodNameCurrent} Vs {data.periodNamePrevious}):
          </p>

          <div className="space-y-2">
            {/* Revenue Row */}
            <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-500 block">Mauzo (Revenue)</span>
                <span className="font-extrabold text-sm text-slate-800">{formatCurrency(cur.revenue, currency)}</span>
                <span className="text-[10px] text-slate-400 block">Kabla: {formatCurrency(prev.revenue, currency)}</span>
              </div>
              <span className={`text-xs font-black px-2 py-1 rounded-lg ${revUp ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {revUp ? '▲' : '▼'} {Math.abs(chg.revenuePct).toFixed(1)}%
              </span>
            </div>

            {/* Expenses Row */}
            <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-500 block">Matumizi (Expenses)</span>
                <span className="font-extrabold text-sm text-slate-800">{formatCurrency(cur.expenses, currency)}</span>
                <span className="text-[10px] text-slate-400 block">Kabla: {formatCurrency(prev.expenses, currency)}</span>
              </div>
              <span className={`text-xs font-black px-2 py-1 rounded-lg ${expUp ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {expUp ? '▲' : '▼'} {Math.abs(chg.expensesPct).toFixed(1)}%
              </span>
            </div>

            {/* Net Profit Row */}
            <div className="bg-indigo-50 border border-indigo-100 p-2.5 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-indigo-600 font-medium block">Faida Halisi (Net Profit)</span>
                <span className="font-black text-sm text-indigo-700">{formatCurrency(cur.netProfit, currency)}</span>
                <span className="text-[10px] text-slate-400 block">Kabla: {formatCurrency(prev.netProfit, currency)}</span>
              </div>
              <span className={`text-xs font-black px-2 py-1 rounded-lg ${netUp ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {netUp ? '▲' : '▼'} {Math.abs(chg.netProfitPct).toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="bg-indigo-50/50 border border-indigo-100/50 p-2.5 rounded-xl text-[11px] text-indigo-950 leading-relaxed">
            <span className="font-bold text-indigo-900 block mb-0.5">💡 Ushauri wa Haraka:</span>
            {chg.expensesPct > chg.revenuePct && chg.expensesPct > 0 ? (
              <span>⚠️ Gharama zako za uendeshaji zinakua haraka kupita mapato. Dhibiti matumizi ya duka kuzuia upotevu wa faida.</span>
            ) : chg.revenuePct < 0 ? (
              <span>📉 Mauzo yamedhoofika kulingana na kipindi cha zamani. Jaribu kuhamasisha Wafanyakazi na kuongeza upatikanaji wa bidhaa zenye mzunguko mkubwa.</span>
            ) : (
              <span>🚀 Biashara inaendelea vizuri duka lako! Jaza mzigo wa bidhaa zinazopendwa sana (bestsellers) ili kuzidisha faida maradufu.</span>
            )}
          </div>
        </div>
      );
    }

    // G2. BUSINESS REPORT INTENT
    if (resolvedIntent === 'business') {
      const bizData = BusinessLogic.getBusinessSummary(sales, expenses, products, period.filterKey === 'jana' ? 'yesterday' : period.filterKey === 'wiki' ? 'week' : period.filterKey === 'mwezi' ? 'month' : 'today', debtPayments);
      const textResponse = ResponseGenerator.generate('REPORT_BUSINESS', bizData, currency, user?.name);
      return (
        <div className="flex flex-col gap-3 text-inherit">
          <div className="prose prose-slate prose-sm max-w-none">
            {formatResponseText(textResponse)}
          </div>
        </div>
      );
    }

    // G. UNKNOWN FALLBACK
    return (
      <div className="space-y-1 text-slate-700">
        <p>Sijakuelewa vizuri bosi. Jaribu kuuliza maswali yanayohusu:</p>
        <ul className="list-disc pl-4 text-xs space-y-1 text-indigo-700 italic mt-1.5">
          <li role="button" tabIndex={0} className="cursor-pointer active:scale-95 transition-transform" style={{ touchAction: 'manipulation' }} onClick={() => setInputValue('Mauzo jana yalikuwaje?')}>"Mauzo jana yalikuwaje?"</li>
          <li role="button" tabIndex={0} className="cursor-pointer active:scale-95 transition-transform" style={{ touchAction: 'manipulation' }} onClick={() => setInputValue('Matumizi leo ni kiasi gani?')}>"Matumizi leo ni kiasi gani?"</li>
          <li role="button" tabIndex={0} className="cursor-pointer active:scale-95 transition-transform" style={{ touchAction: 'manipulation' }} onClick={() => setInputValue('Bidhaa gani zinauzwa sana mwezi huu?')}>"Bidhaa gani zinauzwa sana mwezi huu?"</li>
          <li role="button" tabIndex={0} className="cursor-pointer active:scale-95 transition-transform" style={{ touchAction: 'manipulation' }} onClick={() => setInputValue('Bidhaa gani zinaisha (low stock)?')}>"Bidhaa gani zinaisha?"</li>
          <li role="button" tabIndex={0} className="cursor-pointer active:scale-95 transition-transform" style={{ touchAction: 'manipulation' }} onClick={() => setInputValue('Kuna tabia za wizi duka letu?')}>"Kuna tabia za wizi duka letu?"</li>
        </ul>
      </div>
    );
  };

  const processStrategicQuery = (query: string): string => {
    const text = query.toLowerCase().trim();
    
    // 1. Overall Shop Health Auditing
    if (text.match(/hali\s+ya\s+duka|hali.*duka|shop\s+okay|business\s+okay|am\s+i\s+doing|niko\s+sawa|kuna\s+shida|afya\s+ya\s+duka|kagua\s+duka|afya\s+ya\s+biashara/i)) {
      const health = AdvancedAnalytics.getStoreHealthScore(products || [], sales || [], expenses || [], debtPayments);
      let analysis = `### 🏥 tathmini ya afya na utendaji wa duka letu\n`;
      analysis += `Habari Boss ${user?.name || ''}, nimefanya ukaguzi wa kina (Multi-Point Health Audit) wa mifumo ya biashara yako leo kulingana na data za sasa:\n\n`;
      analysis += `**Alama ya Afya ya Duka (Store Health Score):**\n`;
      analysis += `> **Alama:** **${health.score}/100** | **Hali:** **${health.badge}**\n\n`;
      analysis += `**Matokeo ya Ukaguzi wa Kila Sehemu (Audit Checklist):**\n`;
      health.auditPoints.forEach(p => {
        const icon = p.status === 'success' ? '✅' : p.status === 'warn' ? '⚠️' : '🚨';
        analysis += `- **${icon} ${p.desc}**\n  *Ushauri:* ${p.advice}\n\n`;
      });
      analysis += `\n*Siri ya mafanikio ya duka hisi ni kufanyia kazi changamoto moja baada ya nyingine. Nakushauri uanze kurekebisha changamoto zenye icon za 🚨 au ⚠️ mara moja bosi!*`;
      return analysis;
    }

    // 2. Hourly, sub-day, daily averages and weekdays distribution
    if (text.match(/asubuhi|morning|noon|mchana|jioni|evening|muda.*mauzo|peak\s+hour|peak.*saa|average\s+daily|daily\s+average|wastani/i)) {
      const temporal = AdvancedAnalytics.getHourlyAndWeeklyPerformance(sales || [], currency);
      let analysis = `### ⏰ uchambuzi wa muda na kasi ya mauzo (temporal trends)\n`;
      analysis += `Habari Boss ${user?.name || ''}, nimepiga hesabu ya mzunguko wa mauzo ya duka lako kwa masaa na siku tofauti za wiki:\n\n`;
      
      analysis += `**Muda Unaouza Zaidi (Peak Hours):**\n`;
      analysis += `- **Saa ya Dhahabu (Peak Hour):** **Saa ${temporal.peakHour}:00** lipata mauzo mengi zaidi ya takriban **${formatCurrency(temporal.peakRevenue, currency)}** katika historia ya saa husika.\n`;
      analysis += `- **Mauzo ya Asubuhi ya Leo (Kabla ya saa 6 mchana):** **${formatCurrency(temporal.morningEarningsToday, currency)}** yaliyoingia leo asubuhi.\n\n`;

      analysis += `**Mzunguko wa Wiki na Siku (Weekday Leaderboard):**\n`;
      analysis += `- **Siku Inayofanya Vizuri Zaidi:** kila siku ya **${temporal.bestDay}** ambapo biashara imepata jumla ya mauzo ya **${formatCurrency(temporal.bestDayRevenue, currency)}** kwa ujumla.\n`;
      analysis += `- **Siku ya Mauzo ya Chini Zaidi:** kila siku ya **${temporal.worstDay}** huku ikiwa imeingiza **${formatCurrency(temporal.worstDayRevenue, currency)}** (Ni wakati mzuri wa kuanzisha kampeni ndogo au ofa ili kuibua mauzo siku hii!).\n\n`;

      analysis += `**Wastani wa Kila Siku (Daily Averages):**\n`;
      analysis += `- **Wastani wa Mauzo kwa Siku:** **${formatCurrency(temporal.avgDailySales, currency)}**.\n`;
      analysis += `- **Wastani wa Kikapu kwa Muamala (Basket Size):** **${formatCurrency(temporal.avgSaleAmount, currency)}** kwa kila mteja anayekamilisha malipo duka letu.\n\n`;

      analysis += `**Mchanganuo wa Wiki Moja (Weekday Distribution Table):**\n`;
      temporal.weekdayDistribution.forEach(day => {
        analysis += `- **${day.name}:** ${formatCurrency(day.revenue, currency)} (${day.count} mauzo)\n`;
      });
      
      analysis += `\n*Ushauri:* Panga rasilimali na wafanyakazi kuendana na saa ya kilele (Peak Hours) ili kuhakikisha wateja wanahudumiwa haraka na kwa usahihi wa hali ya juu kabisa!`;
      return analysis;
    }

    // 3. Customer behavior loyalty & debtor lists
    if (text.match(/mteja|wateja|debtor|loyalty|customer|nani\s+anadaiwa|wadaiwa|deni|sugu/i)) {
      const cust = AdvancedAnalytics.getCustomerAnalytics(sales || [], saleItems || [], debtPayments);
      let analysis = `### 👥 ripoti ya kujiimarisha na wateja wetu wa duka\n`;
      analysis += `Habari Boss ${user?.name || ''}, nimechambua tabia na mienendo ya wateja duka letu ili kukupa uelewa wa nani anayesaidia biashara kukua:\n\n`;

      if (cust.topCustomers.length > 0) {
        analysis += `**Wafalme wa Duka (Top 5 Spenders):**\n`;
        cust.topCustomers.slice(0, 5).forEach((c, i) => {
          analysis += `${i+1}. **${c.name}** - Jumla ya fedha aliyoleta: **${formatCurrency(c.totalSpent, currency)}** (Kipindi cha kufanya fursa: mara ${c.visitCount})\n`;
        });
        analysis += `\n`;
      }

      if (cust.potentialChurn.length > 0) {
        analysis += `**🚨 Tahadhari: Wateja Waliolala (Potential Churn):**\n`;
        analysis += `Wafuatao ni wateja wetu wazuri ambao hawajarudi katika siku 30 zilizopita:\n`;
        cust.potentialChurn.slice(0, 4).forEach(c => {
          analysis += `- **${c.name}** (Hajafanya ununuzi kwa zaidi ya siku **${c.daysInactive}**! Inashauriwa kuwapigia simu au kuwatumia ujumbe kuuliza kama kuna bidhaa mbadala wanayovutiwa nayo).\n`;
        });
        analysis += `\n`;
      }

      if (cust.debtors.length > 0) {
        analysis += `**💸 Wadaiwa Wetu (Debtors):**\n`;
        cust.debtors.slice(0, 5).forEach((c, i) => {
          analysis += `${i+1}. **${c.name}** - Ana deni la **${formatCurrency(c.debtAmount, currency)}** (Hajamaliza deni hili, mara ya mwisho amerekodiwa siku ${c.daysInactive} zilizopita).\n`;
        });
        analysis += `\n`;
      }

      if (cust.popularPairs.length > 0) {
        analysis += `**🛒 Uchambuzi wa Kikapu Pamoja (Complementary Products):**\n`;
        analysis += `Wateja wako wanapenda kununua bidhaa hizi pamoja katika muamala mmoja:\n`;
        cust.popularPairs.forEach((pairObj, i) => {
          analysis += `- ${i+1}. **${pairObj.pair}** (Zimenunuliwa pamoja mara **${pairObj.count}**)\n`;
        });
        analysis += `*Ushauri wa Mpangilio:* Ziweke bidhaa hizi karibu-karibu ila wateja wazione kwa pamoja kwa urahisi, au watengenezee ofa ya pamoja!\n\n`;
      } else {
        analysis += `*Uchambuzi wa Kikapu:* Hakuna bidhaa zilizorekodiwa kununuliwa pamoja bado mwezi huu.\n\n`;
      }

      analysis += `*Ushauri Mkuu:* Jenga tabia ya kurekodi majina ya wateja wanunuao kwa mikopo au kwa jumla ili kuendelea kuimarisha utambuzi huu na kupanga mikakati ya uhifadhi (retention)!`;
      return analysis;
    }

    // 4. Strategic Investment opportunities & ROI Restocking
    if (text.match(/wekeza|tangaza|promote|roi|nunua\s+nini|fursa/i)) {
      const strategy = AdvancedAnalytics.getInvestmentAndPromoStrategy(products || [], saleItems || []);
      let analysis = `### 🚀 mchanganuo wa mianya ya uwekezaji na matangazo duka letu\n`;
      analysis += `Habari Boss ${user?.name || ''}, nimepima kila bidhaa kwa kuangalia faida inayochangia direct (profit contribution) pamoja na kasi ya uuzaji ili uweze kuona wapi pa kuweka nguvu zako:\n\n`;

      if (strategy.investCandidates.length > 0) {
        analysis += `**📈 1. Bidhaa za Uwekezaji wa Haraka (High Profit & High Velocity):**\n`;
        analysis += `Bidhaa hizi huchangia faida kubwa zaidi kwa sababu zinateleza haraka. Wekeza mtaji mkubwa wa bulk buying hapa ili kupata faida ya bei ya jumla:\n`;
        strategy.investCandidates.forEach((p, i) => {
          analysis += `${i+1}. **${p.name}**\n   - Jumla ya unit zilizouzwa: **${p.totalUnitsSold}** pcs\n   - Thamani ya Faida niliyopata: **${formatCurrency(p.profitContribution, currency)}**\n   - Margin ya Faida ya Bidhaa: **${p.marginPct.toFixed(1)}%**\n`;
        });
        analysis += `\n`;
      }

      if (strategy.promoteCandidates.length > 0) {
        analysis += `**📢 2. Hazina Zilizofichwa (High Margin but Low Volume - Promote/Advertise):**\n`;
        analysis += `Bidhaa hizi zina faida nzuri sana kwa kila unit lakini wateja hawazinunui kwa wingi. Fanya harakati za kuzitangaza, kuziweka sehemu ya wazi au kuhimiza wahudumu wazizungumzie:\n`;
        strategy.promoteCandidates.forEach((p, i) => {
          analysis += `${i+1}. **${p.name}**\n   - Bei ya Kuuzia: **${formatCurrency(p.sell_price, currency)}** (Margin: **${formatCurrency(p.margin, currency)}** au **${p.marginPct.toFixed(1)}%**)\n   - Units zilizouzwa hivi karibuni: **${p.totalUnitsSold}** pcs pekee\n`;
        });
        analysis += `\n`;
      }

      analysis += `*Mkakati wa Leo:* Anza kwa kuhakikisha bidhaa za kundi la kwanza zimejaa kwenye stoo na hazipungui ili kulinda msingi thabiti wa duka lako. Kisha washawishi wahudumu wa duka watoe ofa kidogo kwenye bidhaa za kundi la pili ili kukomboa mtaji kibiashara!`;
      return analysis;
    }

    // 5. Product margins, pricing, markups and profitability
    if (text.match(/faida\s+ya\s+bidhaa|faida.*nyepesi|margin|asilimia|net\s+profit\s+margin|profitability/i)) {
      const fin = AdvancedAnalytics.getFinancialHealth(sales || [], expenses || []);
      const intellectual = AdvancedAnalytics.getProductIntelligence(products || [], sales || [], saleItems || []);
      
      let analysis = `### 📊 tathmini ya viwango vya faida na margin duka letu\n`;
      analysis += `Habari Boss ${user?.name || ''}, hapa kuna mchanganuo wa kina wa kiwango cha faida na tija ya bidhaa zetu:\n\n`;

      analysis += `**Utendaji Halisi vya Kifedha (Profitability KPIs):**\n`;
      analysis += `- **Jumla ya Faida ya Jumla (Gross Profit):** **${formatCurrency(fin.totalProfit, currency)}**\n`;
      analysis += `- **Faida Halisi Baada ya Matumizi (Net Profit):** **${formatCurrency(fin.netProfit, currency)}**\n`;
      analysis += `- **Net Profit Margin:** **${fin.netProfitMarginPct.toFixed(1)}%** (Kiwango salama ni zaidi ya 15%).\n\n`;

      analysis += `**Hali ya Tija ya Bidhaa:**\n`;
      if (intellectual.negativeMargins.length > 0) {
        analysis += `**🚨 Alamu ya hasara ya bei (Zero or Negative Margin):**\n`;
        analysis += `Kuna bidhaa zifuatazo zinazouzwa kwa hasara au pasipo faida kabisa kulinganisha bei ya kununulia:\n`;
        intellectual.negativeMargins.forEach(p => {
          analysis += `- **${p.name}** (Bei ya kununulia: ${formatCurrency(p.buy_price, currency)} | Bei ya Kuuzia: ${formatCurrency(p.sell_price, currency)}).\n`;
        });
        analysis += `*Ushauri:* Badilisha bei za kuuzia za bidhaa hizi mara moja bosi!\n\n`;
      } else {
        analysis += `- **Ukaguzi wa Bei:** Safi kabisa! Bidhaa zako zote zimewekewa bei za kuuzia zilizo juu ya bei ya kununulia (Kila moja inaleta faida).\n\n`;
      }

      analysis += `**Mbinu za Kuongeza Margin:**\n`;
      analysis += `1. **Ondoa Ununuzi mdogo mdogo:** Jaribu kununua mzigo kwa bei ya jumla kubwa ili kupunguza bei ya kununulia.\n`;
      analysis += `2. **Acha kutoa mapunguzo holela:** Wafunze wahudumu kutumia bei sahihi zilizosajiliwa kuzuia upotevu wa peni za faida duka letu.`;
      return analysis;
    }

    // 6. Overstocked items
    if (text.match(/overstock|mzigo\s+mwingi|baki\s+nyingi|stoo\s+nyingi|sitting/i)) {
      const intell = AdvancedAnalytics.getProductIntelligence(products || [], sales || [], saleItems || []);
      let analysis = `### 📦 uchambuzi wa bidhaa zilizozidi kiwango duka (overstocked items)\n`;
      analysis += `Habari Boss ${user?.name || ''}, nimechunguza bidhaa zenye mrundikano mkubwa katika stoo yako, ambazo zimefunga mtaji wako badala ya kusaidia liquidity ya duka:\n\n`;

      analysis += `- **Idadi ya Bidhaa zilizolundikana:** **${intell.overstocked.length}** bidhaa tofauti hivi sasa.\n\n`;
      
      if (intell.overstocked.length > 0) {
        analysis += `**Orodha ya Bidhaa zenye Mrundikano Mkubwa zaidi (Overstock List):**\n`;
        intell.overstocked.slice(0, 5).forEach((p, i) => {
          const capitalLocked = p.buy_price * p.stock;
          analysis += `${i+1}. **${p.name}**\n   - Units zilizopo: **${p.stock}** ${p.unit || 'pcs'}\n   - Kiwango Salama cha Chini: **${p.min_stock}** pcs\n   - Mtaji uliofungwa hapa: **${formatCurrency(capitalLocked, currency)}**\n`;
        });
        analysis += `\n`;
      } else {
        analysis += `*Hongera sana! Hakuna bidhaa yoyote iliyorekodi mrundikano wa juu kiasi cha kukosesha ukwasi. Stock zako zipo na uwiano mzuri mno.*\n\n`;
      }

      analysis += `**Ushauri wa Kushusha Overstock:**\n`;
      analysis += `1. **Sitisha ununuzi mpya wetu:** Usiongeze mzigo wa bidhaa hizi mpaka sasa unit zilizopo zishuke kufikia kiwango salama.\n`;
      analysis += `2. **Tengeneza Ofa za Pamoja (Combinatory bundles):** Toa punguzo dogo ila kuzisogeza kwa wateja haraka kabla hazijachakaa au kuharibika stoo.`;
      return analysis;
    }

    // 7. Comparative Product VS Analysis
    if (text.includes('vs') || text.includes('dhidi ya') || text.includes('linganisha')) {
      const compRes = AdvancedAnalytics.performComparison(query, products || [], sales || [], saleItems || [], currency);
      if (compRes.found && compRes.type === 'product_comparison') {
        const p1 = compRes.p1!;
        const p2 = compRes.p2!;
        let analysis = `### 🆚 kulinganisha bidhaa: ${p1.name} dhidi ya ${p2.name}\n`;
        analysis += `Habari Boss ${user?.name || ''}, hapa kuna kulinganisha kwa kina wa mzigo wote wetu kulingana na mauzo halisi:\n\n`;
        
        analysis += `| Kipimo | ${p1.name} | ${p2.name} |\n`;
        analysis += `|---|---|---|\n`;
        analysis += `| **Bei ya Kuuzia** | ${formatCurrency(p1.price, currency)} | ${formatCurrency(p2.price, currency)} |\n`;
        analysis += `| **Margin ya Unit** | ${formatCurrency(p1.margin, currency)} | ${formatCurrency(p2.margin, currency)} |\n`;
        analysis += `| **Vitengo Vilivyouzwa** | **${p1.qty}** pcs | **${p2.qty}** pcs |\n`;
        analysis += `| **Jumla ya Mapato** | **${formatCurrency(p1.revenue, currency)}** | **${formatCurrency(p2.revenue, currency)}** |\n\n`;

        if (p1.qty > p2.qty) {
          analysis += `👉 **${p1.name}** inafanya vizuri kwa kuwa imeuzwa kwa asilimia **${p2.qty > 0 ? (((p1.qty - p2.qty) / p2.qty) * 100).toFixed(0) : 100}%** zaidi kuliko **${p2.name}**!\n\n`;
        } else if (p2.qty > p1.qty) {
          analysis += `👉 **${p2.name}** inafanya vizuri kwa kuwa imeuzwa kwa asilimia **${p1.qty > 0 ? (((p2.qty - p1.qty) / p1.qty) * 100).toFixed(0) : 100}%** zaidi kuliko **${p1.name}**!\n\n`;
        } else {
          analysis += `👉 Bidhaa zote mbili zina mauzo sawa kabisa ya **${p1.qty}** vitengo!\n\n`;
        }

        analysis += `*Ushauri Mkuu:* Una uwezo wa kuongeza margin ya ile bidhaa inayotoka zaidi ya pili, au chagua ile yenye faida kubwa zaidi kuwa kipaumbele cha kuitangaza!`;
        return analysis;
      }
    }

    // Compute current live state metrics
    const totalProducts = products.length;
    const lowStock = products.filter(p => p.stock <= p.min_stock);
    const totalValueBuy = products.reduce((acc, p) => acc + (p.buy_price * p.stock), 0);
    const totalValueSell = products.reduce((acc, p) => acc + (p.sell_price * p.stock), 0);

    const totalSalesVol = sales.reduce((acc, s) => acc + s.total_amount, 0);
    const totalProfitVol = sales.reduce((acc, s) => acc + (s.total_profit || 0), 0);
    const totalExpensesVol = expenses.reduce((acc, e) => acc + e.amount, 0);
    // Subtract partial debtPayments so this matches the authoritative
    // remaining-balance calc used in the DEBTS_INTENT branch above.
    const outstandingDebts = sales
      .filter(s => s.payment_method === 'credit' && s.status === 'pending')
      .reduce((acc, s) => {
        const totalPaid = debtPayments.filter(p => p.sale_id === s.id).reduce((sum, p) => sum + p.amount, 0);
        return acc + Math.max(0, s.total_amount - totalPaid);
      }, 0);

    // A. WHY AM I LOSING MONEY / GETTING A LOSS OR SLOWING DOWN?
    if (text.match(/mbona.*hasara|hasara|kusuasua|kupoteza.*pesa|loss|losing/i)) {
      let analysis = `### uchambuzi wa hasara na uwezo wa duka\n`;
      analysis += `Habari Boss ` + (user?.name || '') + `, nimefanya uchambuzi wa kina wa hesabu za duka letu ili kubainisha ni wapi faida inapotea au biashara inapata mdororo.\n\n`;
      
      analysis += `**Taarifa Muhimu za Kifedha:**\n`;
      analysis += `- **Jumla ya Faida ya Mauzo:** ${formatCurrency(totalProfitVol, currency)}\n`;
      analysis += `- **Jumla ya Matumizi ya Uendeshaji:** ${formatCurrency(totalExpensesVol, currency)}\n`;
      
      const balance = totalProfitVol - totalExpensesVol;
      if (balance < 0) {
        analysis += `- **Hasara Halisi ya Uendeshaji (Net Loss):** **${formatCurrency(Math.abs(balance), currency)}** ⚠️ matumizi yamezidi faida ya biashara!\n\n`;
      } else {
        analysis += `- **Faida Halisi ya Uendeshaji (Net Profit):** **${formatCurrency(balance, currency)}** (Biasharia ina faida ndogo ya mzunguko wa uendeshaji).\n\n`;
      }

      analysis += `**Vyanzo Vikuu vya Upotevu wa Mtaji:**\n`;
      
      if (outstandingDebts > 0) {
        analysis += `1. **Mtaji Uliokwama Kwenye Madeni:** Jumla ya **${formatCurrency(outstandingDebts, currency)}** imezuiliwa kwa wateja walioruhusiwa kukopa. Hii inapunguza uhuru wa kununua mzigo mpya (Working Capital depletion).\n`;
      } else {
        analysis += `1. **Mzunguko wa Mikopo:** Hakuna madeni makubwa nje kwa sasa, hili ni jambo zuri upande wa ukwasi (liquidity).\n`;
      }

      if (lowStock.length > 0) {
        analysis += `2. **Kukosa Bidhaa Katika Stock (Lost Revenue):** Kuna bidhaa **${lowStock.length}** ambazo zimeisha au ziko chini ya kiwango salama. Wateja wanapokuja na kukuta bidhaa hizi hazipo, unajikuta unapoteza mauzo ya papo kwa papo.\n`;
      } else {
        analysis += `2. **Hali ya bidhaa kwenye Stock:** Bidhaa zako zote zina kiwango cha kutosha cha stock, hakuna upotevu mikubwa wa mauzo kwa sababu ya kukosa bidhaa.\n`;
      }

      if (expenses.length > 0) {
        const cats: Record<string, number> = {};
        expenses.forEach(e => { cats[e.category] = (cats[e.category] || 0) + e.amount; });
        const highest = Object.entries(cats).sort((a,b) => b[1]-a[1])[0];
        if (highest) {
          analysis += `3. **Matumizi Yakorofi ya Uendeshaji:** Kundi la **"${highest[0]}"** ndilo linaloongoza kwa kula mtaji, likiwa limetumia **${formatCurrency(highest[1], currency)}** mwezi huu.\n\n`;
        }
      } else {
        analysis += `3. **Udhibiti wa Matumizi:** Hakuna matumizi ya uendeshaji yaliyorekodiwa kupitia mfumo hivi karibuni. Hakikisha matumizi yote yanarekodiwa kwa uwazi ili kupata uwiano halisi wa uendeshaji.\n\n`;
      }

      analysis += `### Mapendekezo ya Haraka ya Kubomoa Hasara:\n`;
      analysis += `1. **Weka Kikomo cha Mikopo (Credit Cap):** Simamisha kwa muda mikopo mipya kwa wateja sugu na upigie simu wateja wenye madeni yanayozidi wiki 2.\n`;
      analysis += `2. **Punguza Gharama za Uendeshaji:** Fanya tathmini upya ya kundi linaloongoza kwa matumizi ili kubana matumizi kwa angalau asilimia 15%.\n`;
      analysis += `3. **Revesha Mtaji Kwenye Fast Movers:** Tumia faida inayopatikana kununua mzigo wa bidhaa zinazouzwa kwa wingi zaidi ili kuongeza mzunguko wa pesa haraka.`;

      return analysis;
    }

    // B. HOW TO GROW SALES / WHAT TO DO TO BOOST SALES TODAY?
    if (text.match(/nifanye nini|kukuza|grow|kuongeza|mauzo|boost|sales|mapendekezo/i)) {
      let analysis = `### mbinu za kukuza mauzo leo na kuongeza faida\n`;
      analysis += `Boss ` + (user?.name || '') + `, kuongeza mauzo kwa kasi bila kuongeza gharama za uendeshaji, hapa kuna mchanganuo wa duka letu:\n\n`;

      const listQty: Record<string, {name: string, qty: number}> = {};
      saleItems.forEach(item => {
        if (item.isDeleted !== 1) {
          listQty[item.product_id] = { name: item.product_name, qty: (listQty[item.product_id]?.qty || 0) + item.qty };
        }
      });
      const localBestsellers = Object.values(listQty).sort((a,b) => b.qty - a.qty).slice(0, 3);

      if (localBestsellers.length > 0) {
        analysis += `**1. Panua bidhaa zinazopendwa sana (Champion Products):**\n`;
        analysis += `Data inaonyesha wateja wako wanapendelea zaidi kununua bidhaa zifuatazo:\n`;
        localBestsellers.forEach(item => {
          analysis += `- **${item.name}** (Imeuza jumla ya vitengo **${item.qty}** hivi karibuni).\n`;
        });
        analysis += `Hakikisha bidhaa hizi hazikosekani hata siku moja. Unaweza kuongeza nafasi yake ya kuonekana (display placement) karibu na mlango au kaunta ya duka ili kuvutia wanunuzi wengi zaidi kwa haraka.\n\n`;
      }

      if (lowStock.length > 0) {
        analysis += `**2. Wahi Kununua Bidhaa Inazoisha Mapema:**\n`;
        analysis += `Zipo bidhaa **${lowStock.length}** zenye hatari ya kuisha kabisa. Ukiziruhusu ziishe kabisa hautafanya mauzo kwenye sekta hiyo. Agiza haraka bidhaa kama:\n`;
        lowStock.slice(0, 3).forEach(p => {
          analysis += `- **${p.name}** (Imebaki vitengo **${p.stock}** pekee).\n`;
        });
        analysis += `\n`;
      }

      analysis += `**3. Mbinu ya Cross-Selling (Kununua kwa Pamoja):**\n`;
      analysis += `Wafundishe wahudumu wa duka kupendekeza bidhaa inayosaidiana (mfululizo) mteja anaponunua bidhaa fulani. Mfano, nikinunua bidhaa ya chakula basi mhudumu amshauri mteja ununuzi wa kinywaji au bidhaa nyingine inayohusiana kabla ya kukamilisha muamala.\n\n`;

      analysis += `**4. Udhibiti wa Bei na Ofa Ndogo duka letu:**\n`;
      analysis += `Kama kuna mzigo mzito ambao haujasogea kwa zaidi ya siku 30, weka ofa ya punguzo la bei la asilimia 5% kurejesha gharama ya kununulia na kupata mtaji wa kutosha kununulia bidhaa inayotoka haraka.`;

      return analysis;
    }

    // C. ROADMAP / WHERE DO YOU SEE MY BUSINESS IN X MONTHS/YEARS?
    if (text.match(/mwelekeo|forecast|projection|road\s*map|kesho|tomorrow|siku|days|wiki|week|mwezi|month|miezi|mwaka|year|miaka|ijayo/i)) {
      const parseForecastDays = (queryStr: string): { days: number; label: string } => {
        const q = queryStr.toLowerCase().trim();

        // Support years + months combination first, e.g. "miaka 2 na miezi 4" or "2 years and 4 months"
        const complexMatch = q.match(/(?:miaka|years?)\s*(\d+)\s*(?:na|and)\s*(?:miezi|months?)\s*(\d+)/i);
        if (complexMatch) {
          const years = parseInt(complexMatch[1], 10);
          const months = parseInt(complexMatch[2], 10);
          const totalDays = (years * 365) + (months * 30);
          const label = `${years} ${years === 1 ? 'mwaka' : 'miaka'} na miezi ${months}`;
          return { days: totalDays, label };
        }

        // Years match
        const yearsPluralMatch = q.match(/(?:miaka|years?)\s*(\d+)/i);
        if (yearsPluralMatch) {
          const years = parseInt(yearsPluralMatch[1], 10);
          return { days: years * 365, label: `${years} ${years === 1 ? 'mwaka' : 'miaka'}` };
        } else if (q.match(/mwaka mmoja|one year|1 year|mwaka 1/i)) {
          return { days: 365, label: 'mwaka 1' };
        } else if (q.match(/miaka miwili|two years|2 years|miaka 2/i)) {
          return { days: 730, label: 'miaka 2' };
        }

        // Months match
        const monthsPluralMatch = q.match(/(?:miezi|months?)\s*(\d+)/i);
        if (monthsPluralMatch) {
          const months = parseInt(monthsPluralMatch[1], 10);
          return { days: months * 30, label: `miezi ${months}` };
        }

        // Swahili word numbers for months & English numbers
        if (q.match(/mwezi mmoja|one month|1 month|mwezi 1/i)) {
          return { days: 30, label: 'mwezi 1' };
        } else if (q.match(/miezi miwili|two months|2 months|miezi 2/i)) {
          return { days: 60, label: 'miezi 2' };
        } else if (q.match(/miezi mitatu|three months|3 months|miezi 3/i)) {
          return { days: 90, label: 'miezi 3' };
        } else if (q.match(/miezi minne|four months|4 months|miezi 4/i)) {
          return { days: 120, label: 'miezi 4' };
        } else if (q.match(/miezi tano|five months|5 months|miezi 5/i)) {
          return { days: 150, label: 'miezi 5' };
        } else if (q.match(/miezi sita|six months|6 months|miezi 6/i)) {
          return { days: 180, label: 'miezi 6' };
        } else if (q.match(/miezi tisa|nine months|9 months|miezi 9/i)) {
          return { days: 270, label: 'miezi 9' };
        }

        // Single month fallback (e.g., "mwezi ujao", "next month", "this month")
        if (q.match(/mwezi|month/i)) {
          return { days: 30, label: 'mwezi 1' };
        }

        // Weeks match
        const weeksPluralMatch = q.match(/(?:wiki|weeks?)\s*(\d+)/i);
        if (weeksPluralMatch) {
          const weeks = parseInt(weeksPluralMatch[1], 10);
          return { days: weeks * 7, label: `wiki ${weeks}` };
        } else if (q.match(/wiki mmoja|one week|1 week|wiki 1/i)) {
          return { days: 7, label: 'wiki 1' };
        } else if (q.match(/wiki mbili|two weeks|2 weeks|wiki 2/i)) {
          return { days: 14, label: 'wiki 2' };
        }

        // Days match
        if (q.match(/kesho|tomorrow/i)) {
          return { days: 1, label: 'siku ya kesho' };
        } else {
          const daysMatch = q.match(/siku\s*(\d+)/i) || q.match(/(\d+)\s*days/i);
          if (daysMatch) {
            const dCount = parseInt(daysMatch[1], 10);
            return { days: dCount, label: `siku ${dCount}` };
          }
        }

        // Default to 6 months (180 days)
        return { days: 180, label: 'miezi 6' };
      };

      const { days, label } = parseForecastDays(text);
      let analysis = `### mwelekeo wa duka na mtazamo wa ${label} ijayo\n`;
      analysis += `Habari Boss ` + (user?.name || '') + `, kulingana na takwimu za sasa za duka la **` + (settings?.shopName || 'duka letu') + `**, nimefanya makadirio ya mzunguko wako wa kibiashara kwa siku **${days}** zijazo (kipindi cha **${label}**):\n\n`;

      const totalSales = sales.reduce((acc, s) => acc + s.total_amount, 0);
      const totalProfit = sales.reduce((acc, s) => acc + (s.total_profit || 0), 0);
      const daysCount = sales.length > 0 ? Math.max(7, Math.ceil((Date.now() - new Date(sales[sales.length - 1].created_at).getTime()) / (1000*60*60*24))) : 30;
      
      const avgDailySales = totalSales / daysCount;
      const avgDailyProfit = totalProfit / daysCount;

      const projectSales = avgDailySales * days;
      const projectProfit = avgDailyProfit * days;

      analysis += `**Makadirio ya Kifedha ya ${label} ijayo:**\n`;
      analysis += `- **Makadirio ya Mapato ya Mauzo katika siku ${days}:** Kiasi cha **${formatCurrency(projectSales || (totalSales * (days / daysCount) || (500000 * (days / 30))), currency)}**\n`;
      analysis += `- **Makadirio ya Faida Salama katika siku ${days}:** Kiasi cha **${formatCurrency(projectProfit || (totalProfit * (days / daysCount) || (150000 * (days / 30))), currency)}**\n`;
      analysis += `- **Kiwango cha Thamani ya mzigo kwenye stoo kwa sasa:** **${formatCurrency(totalValueSell, currency)}**\n\n`;

      analysis += `**Mambo Matatu (3) Yanayoweza Kukwamisha Mwelekeo Huu wa ${label}:**\n`;
      if (outstandingDebts > 0) {
        analysis += `1. **Upanuzi wa Mikopo Holela:** Ikiwa madeni yanaendelea kukua (kuna **${formatCurrency(outstandingDebts, currency)}** nje hivi sasa), mwelekeo wako unaweza kukosa liquidity, na hivyo kupunguza uwezo wa kununua bidhaa mpya zinazotakiwa kila mwezi.\n`;
      } else {
        analysis += `1. **Kasi ya Liquid Capital:** Una ukwasi mzuri mkuu, hakikisha huingii kwenye mikopo holela ili kudumisha ubora huu.\n`;
      }

      if (lowStock.length > 0) {
        analysis += `2. **Bidhaa Kupungua (Low Stock):** Sababu kuna bidhaa zinaisha, zisipojazwa haraka utapoteza mauzo kwa wateja wanaotafuta mzigo huo.\n`;
      } else {
        analysis += `2. **Uthabiti wa Bidhaa:** Stock yako iko thabiti sana sasa hivi. Kudumisha hili kutafanya mwelekeo wako uwe na mafanikio kwa 100%.\n`;
      }

      analysis += `3. **Usalama na Usimamizi Madhubuti:** Usimamizi na ufuatiliaji duka letu utasaidia kuzuia hasara za uendeshaji ili kusaidia duka kukua kulingana na dira mpango.\n\n`;

      analysis += `**Ushauri wa Kitaalamu wa ${label} ijayo:**\n`;
      analysis += `Boss ` + (user?.name || '') + `, duka hili lina msingi mzuri sana (total active products: **${totalProducts}**). Ukizingatia kuzuia upotevu wa bidhaa, kuzuia mikopo mikubwa, na kuagiza fast movers mapema, biashara yako itafikia kiwango kikubwa cha ukuaji katika kipindi cha **${label}** kijacho!`;

      return analysis;
    }

    // D. EXPENSES & MATUMIZI OVERVIEW YAKOJE?
    if (text.match(/matumizi/i)) {
      let analysis = `### mchanganuo wa matumizi ya duka letu\n`;
      analysis += `Boss ` + (user?.name || '') + `, hapa kuna mchanganuo kamili na tathmini ya matumizi yaliyosajiliwa katika mifumo yetu hivi karibuni:\n\n`;

      analysis += `- **Jumla ya Matumizi Yote:** **${formatCurrency(totalExpensesVol, currency)}**\n`;
      analysis += `- **Uwiano wa Matumizi vs Mauzo:** **${totalSalesVol > 0 ? ((totalExpensesVol / totalSalesVol) * 100).toFixed(1) : 0}%** (Ya mapato ya mauzo hutumika kulipia gharama).\n\n`;

      if (expenses.length > 0) {
        const cats: Record<string, number> = {};
        expenses.forEach(e => { cats[e.category] = (cats[e.category] || 0) + e.amount; });
        const sortedCats = Object.entries(cats).sort((a,b) => b[1]-a[1]);

        analysis += `**Orodha ya Makundi ya Matumizi (Kuanzia makubwa zaidi):**\n`;
        sortedCats.forEach(([category, val]) => {
          analysis += `- **${category}:** ${formatCurrency(val, currency)} (${((val / totalExpensesVol) * 100).toFixed(1)}%)\n`;
        });
        analysis += `\n`;
      } else {
        analysis += `*Hakuna rekodi za matumizi hivi karibuni kwenye mfumo. Nakushauri uanze kurekodi ili uweze kubaini makundi makorofi yanayochukua mtaji!*\n\n`;
      }

      analysis += `**Ushauri wa Kitaalamu wa Kubana Matumizi:**\n`;
      analysis += `1. **Gharama zisizo za lazima:** Fanya marudio ya malipo ya usafirishaji au uendeshaji ya mara kwa mara na uone kama kuna uwezekano wa kufanya manunuzi ya pamoja (bulk buying) kupunguza nauli.\n`;
      analysis += `2. **Weka Bajeti Madhubuti:** Usitoe pesa duka bila kuiandika na kuifanyia tathmini kwanza. Kila kiasi kinachotoka duka kinapunguza direct profit na uwekezaji wa stoo yetu.`;

      return analysis;
    }

    // E. DEAD STOCK & LOCKED CAPITAL (Bidhaa zisizouza na mtaji uliolala)
    if (text.match(/lala|haitembei|zisizouza|dead\s*stock|slow\s*stock/i)) {
      const thirtyDaysAgo = subDays(new Date(), 30);
      const thirtyDaysSaleIds = new Set(
        sales
          .filter(s => new Date(s.created_at) >= thirtyDaysAgo && s.isDeleted !== 1)
          .map(s => s.id)
      );
      
      const soldProductIds = new Set(
        saleItems
          .filter(item => item.isDeleted !== 1 && thirtyDaysSaleIds.has(item.sale_id))
          .map(item => item.product_id)
      );

      const deadStockProducts = products.filter(p => p.stock > 0 && !soldProductIds.has(p.id));
      const deadStockTotalValue = deadStockProducts.reduce((acc, p) => acc + (p.buy_price * p.stock), 0);
      const deadStockTotalSellValue = deadStockProducts.reduce((acc, p) => acc + (p.sell_price * p.stock), 0);

      let analysis = `### uchambuzi wa bidhaa zisizouza na mtaji uliolala (dead stock)\n`;
      analysis += `Habari Boss ` + (user?.name || '') + `, nimefanya ukaguzi wa bidhaa ambazo hazijafanya mauzo yoyote katika siku 30 zilizopita. Hizi ni bidhaa zenye mtaji uliolala stoo:\n\n`;

      analysis += `- **Idadi ya Bidhaa zisizouza:** **${deadStockProducts.length}** tofauti\n`;
      analysis += `- **Thamani ya Mtaji uliolala (kwa bei ya kununulia):** **${formatCurrency(deadStockTotalValue, currency)}** ⚠️\n`;
      analysis += `- **Makadirio ya Mauzo yaliyosimama (bei ya kuuzia):** **${formatCurrency(deadStockTotalSellValue, currency)}**\n\n`;

      if (deadStockProducts.length > 0) {
        analysis += `**Orodha ya Bidhaa zilizolala Zaidi (Top 4 kwa Thamani ya Mtaji):**\n`;
        const sortedDead = [...deadStockProducts]
          .sort((a, b) => (b.buy_price * b.stock) - (a.buy_price * a.stock))
          .slice(0, 4);

        sortedDead.forEach((p, idx) => {
          const buyVal = p.buy_price * p.stock;
          analysis += `${idx + 1}. **${p.name}**\n   - Units zilizopo: **${p.stock}** pcs\n   - Mtaji uliolala: **${formatCurrency(buyVal, currency)}**\n`;
        });
        analysis += `\n`;
      } else {
        analysis += `*Hongera sana! Bidhaa zako zote zina mzunguko mzuri wa mauzo na hakuna uliolala zaidi ya siku 30!*\n\n`;
      }

      analysis += `**Mbinu za Haraka za Kurejesha Mtaji Mzunguko (Liquidity):**\n`;
      analysis += `1. **Ofa ya Pamoja (Bundling):** Chukua bidhaa iliyolala uunganishe na bidhaa inayouzwa sana (Fast-mover) kisha uziuza kama kifurushi kimoja kwa bei yenye punguzo kidogo.\n`;
      analysis += `2. **Punguzo la bei la "Clearance Sale" (10% - 15%):** Punguza bei karibu na gharama ya kununulia ili uunde mauzo ya haraka. Ni bora kupata kiasi kidogo cha pesa mkononi kuliko kubaki na mzigo usiosogea mwezi mzima.\n`;
      analysis += `3. **Badilisha Mpangilio wa Stoo:** Wakati mwingine bidhaa haziuzi kwa sababu wateja hawazioni. Ziweke kwenye kaunta ya mbele au karibu na mlango ili ziandikishwe na macho ya wateja.`;

      return analysis;
    }

    // F. LOST REVENUE PROJECTION
    if (text.match(/lost\s*revenue|poteza\s*mauzo|mauzo\s*yanayopotea|mapato\s*yanayopotea/i)) {
      const lowStockProducts = products.filter(p => p.stock <= p.min_stock);

      const thirtyDaysAgo = subDays(new Date(), 30);
      const thirtyDaysSales = sales.filter(s => new Date(s.created_at) >= thirtyDaysAgo && s.isDeleted !== 1);
      const saleIdsSet = new Set(thirtyDaysSales.map(s => s.id));
      
      const itemQtySold: Record<string, number> = {};
      saleItems.forEach(item => {
        if (item.isDeleted !== 1 && saleIdsSet.has(item.sale_id)) {
          itemQtySold[item.product_id] = (itemQtySold[item.product_id] || 0) + item.qty;
        }
      });

      let analysis = `### makadirio ya mauzo yanayopotea kwa sababu ya stoo kuisha (lost revenue)\n`;
      analysis += `Habari Boss ` + (user?.name || '') + `, duka linapoteza fursa nyingi za mapato pale wateja wanapokuja kuulizia bidhaa inayopendwa wakakuta imeisha. Hapa kuna makadirio ya mauzo unayoweza kuyapoteza katika siku 15 zijazo ikiwa hautoagiza mzigo upya:\n\n`;

      let totalProjectedLoss = 0;
      const lossList: Array<{ name: string; lossValue: number; velocity: number; currentStock: number; reorderQty: number }> = [];

      lowStockProducts.forEach(p => {
        const qtySold30 = itemQtySold[p.id] || 0;
        const velocity = qtySold30 / 30; // units/day
        
        if (velocity > 0) {
          const daysLeft = p.stock / velocity;
          const outOfStockDaysInPeriod = Math.max(0, 15 - daysLeft);
          const projectedLossUnits = outOfStockDaysInPeriod * velocity;
          const projectedLossVal = projectedLossUnits * p.sell_price;

          if (projectedLossVal > 100) {
            totalProjectedLoss += projectedLossVal;
            lossList.push({
              name: p.name,
              lossValue: projectedLossVal,
              velocity: velocity,
              currentStock: p.stock,
              reorderQty: Math.ceil(velocity * 30)
            });
          }
        }
      });

      analysis += `- **Jumla ya Bidhaa zilizo chini ya kiwango salama (Low Stock):** **${lowStockProducts.length}** bidhaa\n`;
      analysis += `- **Makadirio ya Mauzo yanayopotea (Next 15 days):** **${formatCurrency(totalProjectedLoss, currency)}** ⚠️\n\n`;

      if (lossList.length > 0) {
        analysis += `**Orodha ya Bidhaa zenye hatari kubwa zaidi ya Kupoteza Mapato:**\n`;
        const sortedLoss = lossList.sort((a,b) => b.lossValue - a.lossValue).slice(0, 4);
        
        sortedLoss.forEach((item, idx) => {
          analysis += `${idx + 1}. **${item.name}**\n`;
          analysis += `   - Kasi ya Uuzaji: **${item.velocity.toFixed(1)}** vitengo kwa siku\n`;
          analysis += `   - Stock ya sasa: **${item.currentStock}** pcs pekee\n`;
          analysis += `   - Hatari ya Upotevu: Mapato ya **${formatCurrency(item.lossValue, currency)}** yatapotea kabisa katika wiki 2 zijazo ikiwa mzigo hautajazwa haraka.\n`;
          analysis += `   - Ushauri wa Kununua: Agiza angalau vitengo **${item.reorderQty}** kufunika mauzo ya mwezi mzima.\n`;
        });
        analysis += `\n`;
      } else {
        if (lowStockProducts.length > 0) {
          analysis += `*Kumbuka:* Una bidhaa ${lowStockProducts.length} zenye stock ndogo, lakini kasi yake ya uuzaji ni ndogo sana au haijasajiliwa kwa mwezi huu. Bado ni vizuri kuziwekea macho.\n\n`;
        } else {
          analysis += `*Hongera sana! Bidhaa zako zote zipo katika hali salama (hakuna zilizo chini ya kiwango cha kuisubiri).* Hakuna fursa inayopotea sasa hivi!\n\n`;
        }
      }

      analysis += `**Ushauri wa Kibiashara:**\n`;
      analysis += `Usiruhusu "Fast-Movers" (bidhaa zinazotoka kwa kasi) ziishe kabisa stoo. Mapato yanayopotea hapa hayarejei, na wateja wakizoea kukosa bidhaa duka letu wanaweza kuhamia kwa washindani wako kabisa.`;

      return analysis;
    }

    // G. PURCHASE BUDGET ESTIMATOR
    if (text.match(/purchase\s*budget|restock|agiza\s*mpya|kununua\s*mzigo|bajeti|ununuzi\s*ujao/i)) {
      (window as any).__lastMshauriAction = { label: 'Agiza Mpya Sasa', path: '/bidhaa' };
      
      const thirtyDaysAgo = subDays(new Date(), 30);
      const thirtyDaysSales = sales.filter(s => new Date(s.created_at) >= thirtyDaysAgo && s.isDeleted !== 1);
      const saleIdsSet = new Set(thirtyDaysSales.map(s => s.id));
      
      const itemQtySold: Record<string, number> = {};
      saleItems.forEach(item => {
        if (item.isDeleted !== 1 && saleIdsSet.has(item.sale_id)) {
          itemQtySold[item.product_id] = (itemQtySold[item.product_id] || 0) + item.qty;
        }
      });

      let analysis = `### mshauri wa bajeti ya ununuzi na orodha ya kujaza stock (restock calculator)\n`;
      analysis += `Habari Boss ` + (user?.name || '') + `, nimepiga hesabu ya mzigo unaotakiwa kuagizwa haraka duka letu kulingana na kasi ya kila bidhaa ili kuzuia kukata kwa stock, pamoja na makadirio ya mtaji unaohitajika:\n\n`;

      let totalBudgetRequired = 0;
      let totalItemsToBuy = 0;
      const reorderList: Array<{ name: string; currentStock: number; needed: number; buyPrice: number; totalCost: number }> = [];

      products.forEach(p => {
        if (p.stock <= p.min_stock) {
          const qtySold30 = itemQtySold[p.id] || 0;
          const dVelocity = qtySold30 / 30;
          
          const desiredCoverageUnits = Math.ceil(Math.max(15, dVelocity * 30));
          const recommendedOrder = Math.max(0, desiredCoverageUnits - p.stock);
          
          if (recommendedOrder > 0) {
            const cost = recommendedOrder * p.buy_price;
            totalBudgetRequired += cost;
            totalItemsToBuy += recommendedOrder;
            reorderList.push({
              name: p.name,
              currentStock: p.stock,
              needed: recommendedOrder,
              buyPrice: p.buy_price,
              totalCost: cost
            });
          }
        }
      });

      analysis += `- **Bajeti Unayotakiwa Kutenga (Makadirio):** **${formatCurrency(totalBudgetRequired, currency)}** kwa jumla ya bei ya ununuzi.\n`;
      analysis += `- **Doti ya Bidhaa zinazopaswa kununuliwa kwenda stoo:** **${totalItemsToBuy} units** jumla kwa bidhaa **${reorderList.length}** tofauti.\n\n`;

      if (reorderList.length > 0) {
        analysis += `**Orodha ya Ununuzi Inayopendekezwa (Next Purchase Order):**\n`;
        const sortedList = reorderList.sort((a,b) => b.totalCost - a.totalCost).slice(0, 5);

        sortedList.forEach((item, idx) => {
          analysis += `${idx + 1}. **${item.name}**\n`;
          analysis += `   - Mzigo wa sasa: **${item.currentStock}** pcs | Bei ya Kununulia: **${item.buyPrice > 0 ? formatCurrency(item.buyPrice, currency) : 'haijawekwa'}**\n`;
          analysis += `   - Agiza mpya: **${item.needed}** pcs\n`;
          analysis += `   - Thamani ya Ununuzi: **${formatCurrency(item.totalCost, currency)}**\n`;
        });
        analysis += `\n`;
      } else {
        analysis += `*Hongera sana! Hakuna mapendekezo ya ununuzi mkubwa wa dharura kwa sasa kwa kuwa stock zote zipo salama au bidhaa hazina mauzo makubwa bado.*\n\n`;
      }

      analysis += `**Mpango Mkakati wa Ununuzi (Vendor Strategy):**\n`;
      analysis += `1. **Omba Punguzo la Jumla (Bulk Discount):** Unaponunua hizi bidhaa kwa pamoja kama orodha moja, tumia tathmini hii kuomba punguzo la 2% hadi 5% kwa mtoaji mzigo wako (supplier).\n`;
      analysis += `2. **Gawanya Ununuzi (Priority Order):** Ikiwa hauna mtaji mwingi kwa mara moja hapa, anza kwa kufanikisha manunuzi ya bidhaa ya kwanza na ya pili kwenye orodha husika kwani ndizo zinazozuia hasara kubwa zaidi!`;

      return analysis;
    }

    // H. SECURITY & AUDITING RISK SCORE AND LEAKS
    if (text.match(/ulinzi|salama|wizi|wizi\s*wa\s*hela|anomal|upotevu|mianya/i)) {
      (window as any).__lastMshauriAction = { label: 'Kagua Mabadiliko (Audit)', path: '/audit-logs' };
      
      const today = startOfDay(new Date());
      const todayAuditLogs = auditLogs.filter(log => log.created_at && new Date(log.created_at) >= today);
      
      const chatAnomalies = auditLogs.filter(log => (log.action as string).startsWith('anomaly_'));
      const cartVoidsCount = auditLogs.filter(log => 
        (log.action as string).includes('delete') || 
        (log.action as string) === 'anomaly_frequent_voids' ||
        log.details?.warning?.includes('Cart Voids') || 
        log.details?.warning?.includes('futa bidhaa kwenye kikapu')
      ).length;
      
      const salesDeletesCount = auditLogs.filter(log => 
        (log.action as string) === 'refund_sale' || 
        (log.action as string) === 'delete_all_products' ||
        ((log.action as string).includes('delete') && ((log.action as string).includes('sale') || (log.action as string).includes('mauzo')))
      ).length;
      
      const todayVoids = todayAuditLogs.filter(log => 
        (log.action as string) === 'anomaly_frequent_voids' ||
        log.details?.warning?.includes('Cart Void') || 
        log.details?.warning?.includes('futa bidhaa kwenye kikapu')
      ).length;
      
      const todayDeletes = todayAuditLogs.filter(log => 
        (log.action as string) === 'refund_sale' || 
        ((log.action as string).includes('delete') && ((log.action as string).includes('sale') || (log.action as string).includes('mauzo')))
      ).length;

      const scoreWeight = (chatAnomalies.length * 2) + (cartVoidsCount * 1.5) + (salesDeletesCount * 3);
      
      let riskLevel = 'SALAMA ✅';
      if (scoreWeight >= 15) {
        riskLevel = 'HATARI KUBWA 🚨';
      } else if (scoreWeight > 4) {
        riskLevel = 'TAHADHARI/MASHAKA ⚠️';
      }

      let analysis = `### ripoti ya tathmini na usalama wa duka (security audit)\n`;
      analysis += `Habari Boss ` + (user?.name || '') + `, nimefanya ukaguzi wa mabadiliko na mienendo duka mbalimbali ili kubaini ikiwa kuna mianya ya upotevu wa fedha:\n\n`;

      analysis += `**Kiwango cha Usalama (Mabadiliko ya Mfumo):**\n`;
      analysis += `- **Hali ya Usalama wetu:** **${riskLevel}**.\n`;
      analysis += `- **Leo:** Miamala yiliyofutwa/kurejeshwa: **${todayDeletes}** | Kufuta bidhaa kikapuni: **${todayVoids}**.\n`;
      analysis += `- **Jumla (Matukio 200 yaliyopita):** Mabadiliko yenye mashaka: **${chatAnomalies.length}** | Kufuta kikapu: **${cartVoidsCount}** | Mauzo yaliyofutwa: **${salesDeletesCount}**.\n\n`;

      analysis += `**Viashiria vya Mabadiliko Yaliyobainishwa:**\n`;
      
      let flagCount = 0;
      if (todayDeletes > 0 || todayVoids > 0) {
        flagCount++;
        analysis += `${flagCount}. **Mabadiliko ya Leo (Real-time Alert):** Kuna mabadiliko ya miamala/kikapu yaliyofanyika leo. Hakikisha yalikuwa na idhini yako.\n`;
      }
      
      if (cartVoidsCount > 5) {
        flagCount++;
        analysis += `${flagCount}. **Kufuta bidhaa kwenye kikapu mara kwa mara:** Idadi kubwa ya kufuta bidhaa kabla ya malipo (${cartVoidsCount}) ni kiashiria kinachohitaji kufuatiliwa kwa karibu ili kuzuia mhudumu kuchukua pesa za mauzo.\n`;
      }

      if (flagCount === 0) {
        analysis += `*Hongera sana! Hakuna viashiria vyovyote vya mashaka duka letu hivi karibuni. Wahudumu wako wanaonyesha uaminifu mzuri sana.*\n\n`;
      } else {
        analysis += `\n`;
      }

      analysis += `**Mapendekezo ya Kuboresha Usalama:**\n`;
      analysis += `1. **Zuia Ufutaji wa Kikapu:** Wazuie au dhibiti uwezo wa wafanyakazi kufuta mauzo/bidhaa zilizopo kikapuni bila nenosiri lako.\n`;
      analysis += `2. **Pitia Mabadiliko Kila Wiki:** Fungua ukurasa wa **Ripoti ya Mabadiliko duka** mara moja kwa wiki kulinganisha stock halisi na mfumo.`;

      return analysis;
    }

    // Default Fallback
    return `### uchambuzi wa takwimu na ushauri wa kitaalamu\n\nHabari Boss ` + (user?.name || '') + `, hapa kuna tathmini ya haraka ya duka la **` + (settings?.shopName || 'duka letu') + `** kulingana na vigezo vilivyopo:\n\n- **Jumla ya Bidhaa zilipo:** ${totalProducts} tofauti\n- **Thamani ya Mzigo wetu:** ${formatCurrency(totalValueSell, currency)} (kwa bei ya kuuzia)\n- **Kiwango cha Madeni Nje:** ${formatCurrency(outstandingDebts, currency)} (madeni ya mikopo ya wateja)\n- **Bidhaa zinazoisha stock:** ${lowStock.length} bidhaa\n\n*Boss ` + (user?.name || '') + `, tafadhali chagua mojawapo ya maswali hapa chini au chapa swali kama "zinazouza sana", "bidhaa zilizolala", "makadirio ya mzigo ujao" au "mianya ya upotevu"!*`;
  };

  const saveMessageToDb = async (
    id: string,
    sender: 'user' | 'bot' | 'ai',
    text: string | React.ReactNode,
    type: string = 'text',
    additionalMetadata: any = {},
    isUnresolved: boolean = false
  ) => {
    if (!user?.shopId) return;

    let textToStore = '';
    if (typeof text === 'string') {
      textToStore = text;
    } else {
      textToStore = '[Uchambuzi maalum wa Venics Smart]';
    }

    try {
      const chatRecord: AssistantChat = {
        id,
        shop_id: user.shopId,
        user_id: user.id || '',
        session_id: 'default',
        message_type: sender === 'user' ? 'user' : 'assistant',
        content: textToStore,
        is_unresolved: isUnresolved ? 1 : 0,
        metadata: {
          type,
          ...additionalMetadata
        },
        isDeleted: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        synced: 0
      };

      await db.assistantChats.add(chatRecord);
      SyncService.scheduleCriticalSync();
    } catch (e) {
      console.error('Failed to save message to db:', e);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;

    const userMsgId = uuidv4();
    const userMsg: Message = {
      id: userMsgId,
      sender: 'user',
      text: text,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMsg]);
    const cleanText = text.toLowerCase().trim();

    // Find previous intent from message history (Stateful Context Tracking)
    let previousIntent: any = undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].intent && messages[i].intent !== 'UNKNOWN') {
        previousIntent = messages[i].intent;
        break;
      }
    }

    // --- LAYER 1: INTENT CLASSIFICATION ---
    const intentRes = IntentEngine.classify(cleanText, previousIntent);
    const intent = intentRes.intent;

    // Detect specialized UI results
    const foundEmployee = users.find(u => {
      if (!u.name) return false;
      const uNameParts = u.name.toLowerCase().split(/\s+/).filter(part => part.length >= 2);
      return uNameParts.some(part => {
        if (part === 'boss') return false;
        const regex = new RegExp(`\\b${part}\\b`, 'i');
        return cleanText.match(regex);
      });
    });

    const isWafanyakaziGeneral = intent === 'REPORT_EMPLOYEE' && !foundEmployee;
    const isSingleEmployeeReport = intent === 'REPORT_EMPLOYEE' && !!foundEmployee;
    const isSync = intent === 'ACTION_SYNC';

    let initialPeriod: 'week' | 'month' | 'months6' = 'week';
    if (cleanText.match(/mwezi|siku 30|30 days/i)) {
      initialPeriod = 'month';
    } else if (cleanText.match(/miezi sita|miezi 6|miezi 3|miezi 2/i)) {
      initialPeriod = 'months6';
    }

    setIsTyping(true);

    const isHardQuery = intent === 'UNKNOWN';
    const isGeminiEnabledAndFound = isAiEnabled;
    const isUnresolvedQuery = isHardQuery && !isGeminiEnabledAndFound;

    // Save user prompt to IndexedDB
    await saveMessageToDb(userMsgId, 'user', text, 'text', { intent }, isUnresolvedQuery);

    // Track usage
    TelemetryService.trackAssistantQuery(
      isAiEnabled && isHardQuery ? 'custom_ai' : 'pre_calculated_intent',
      intent
    );

    if (isAiEnabled && isHardQuery) {
      // ... existing Gemini logic ...
      try {
        const totalProductsCount = products.length;
        const lowStockProductsText = products.filter(p => p.stock <= p.min_stock).slice(0, 15).map(p => `${p.name} (Baki: ${p.stock}, Min: ${p.min_stock})`).join(", ");
        const totalRevenueVal = sales.filter(s => s.isDeleted !== 1).reduce((acc, s) => acc + s.total_amount, 0);
        const totalProfitsVal = sales.filter(s => s.isDeleted !== 1).reduce((acc, s) => acc + (s.total_profit || 0), 0);
        const totalExpVal = expenses.filter(e => e.isDeleted !== 1).reduce((acc, e) => acc + e.amount, 0);
        // Subtract partial debtPayments so this matches the authoritative
        // remaining-balance calc used in the DEBTS_INTENT branch above.
        const activeDebtsTotalVal = sales
          .filter(s => s.payment_method === 'credit' && s.status === 'pending' && s.isDeleted !== 1)
          .reduce((acc, s) => {
            const totalPaid = debtPayments.filter(p => p.sale_id === s.id).reduce((sum, p) => sum + p.amount, 0);
            return acc + Math.max(0, s.total_amount - totalPaid);
          }, 0);

        const shopContext = `
Wewe ni Mshauri wa Biashara mwenye ujuzi wa hali ya juu na msaidizi wa kipekee (virtual business advisor) anayeitwa "Venics Smart".
Takwimu duka hivi sasa:
- Duka: ${settings?.shopName || 'duka letu'} | Sarafu: ${currency}
- Bidhaa: ${totalProductsCount} | Low Stock: [${lowStockProductsText || 'Hakuna'}]
- Mauzo: ${formatCurrency(totalRevenueVal, currency)} | Faida: ${formatCurrency(totalProfitsVal, currency)}
- Madeni: ${formatCurrency(activeDebtsTotalVal, currency)} | Matumizi: ${formatCurrency(totalExpVal, currency)}

Maelekezo: Jibu kwa Kiswahili safi, fupi, na cha usaidizi.
`;

        const response = await generateContentViaProxy({
          model: "gemini-2.5-flash",
          contents: text,
          config: {
            systemInstruction: shopContext,
            temperature: 0.7,
          }
        });

        const replyText = response.text || "Samahani Boss, nilipata hitilafu kidogo wakati wa kuchambua data yako halisi ya mifumo. Tafadhali jaribu tena.";
        const botMsgId = uuidv4();
        const botResponse: Message = {
          id: botMsgId,
          sender: 'ai',
          text: replyText,
          type: 'text',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, botResponse]);
        setIsTyping(false);
        await saveMessageToDb(botMsgId, 'ai', replyText, 'text', {});

      } catch (err) {
        console.error("Gemini API call failed:", err);
        setTimeout(async () => {
          const botMsgId = uuidv4();
          const botResponseText = `Hitilafu ya Kiufundi: Nimeshindwa kuunganisha huduma ya AI hivi sasa. Tafadhali hakikisha una mtandao wa kutosha kisha ujaribu tena.`;
          const botResponse: Message = { id: botMsgId, sender: 'bot', text: botResponseText, timestamp: new Date() };
          setMessages(prev => [...prev, botResponse]);
          setIsTyping(false);
          await saveMessageToDb(botMsgId, 'bot', botResponseText, 'text', {});
        }, 600);
      }
    } else {
      // --- LOCAL INTELLIGENCE LAYERS (2 & 3) ---
      setTimeout(async () => {
        let type: 'sync' | 'employee_general' | 'employee_single' | 'text' | 'react_node' = 'text';
        let botResponseText: string | React.ReactNode = '';
        let employeeId: string | undefined;

        const kbMatch = KnowledgeBase.findBestMatch(cleanText);
        const isHowToQuery = cleanText.startsWith('jinsi') || cleanText.startsWith('how') || cleanText.startsWith('namna') || cleanText.startsWith('nawezaje') || cleanText.includes('mbona') || cleanText.includes('msaada');
        const isAdvancedStrategic = cleanText.match(/hali\s+ya\s+duka|hali.*duka|shop\s+okay|business\s+okay|am\s+i\s+doing|niko\s+sawa|kuna\s+shida|afya\s+ya\s+duka|kagua\s+duka|afya\s+ya\s+biashara|asubuhi|morning|noon|mchana|jioni|evening|muda.*mauzo|peak\s+hour|peak.*saa|average\s+daily|daily\s+average|wastani|mteja|wateja|debtor|loyalty|customer|nani\s+anadaiwa|wadaiwa|deni|sugu|wekeza|tangaza|promote|roi|nunua\s+nini|fursa|faida\s+ya\s+bidhaa|faida.*nyepesi|margin|asilimia|net\s+profit\s+margin|profitability|overstock|mzigo\s+mwingi|baki\s+nyingi|stoo\s+nyingi|sitting|dhidi ya/i) || ['REPORT_DEAD_STOCK', 'REPORT_FORECAST'].includes(intent) || cleanText.includes('hasara');

        if (intent === 'ACTION_ADD_STAFF') {
          type = 'react_node';
          botResponseText = 'Sajili Mfanyakazi';
        } else if (intent === 'ACTION_TOGGLE_FEATURES') {
          type = 'react_node';
          botResponseText = 'Udhibiti wa Vipengele';
        } else if (isSync) {
          type = 'sync';
          botResponseText = 'Ukaguzi wa Usawazishaji';
        } else if (isAdvancedStrategic) {
          botResponseText = formatResponseText(processStrategicQuery(text));
          type = 'react_node';
        } else if (kbMatch && (isHowToQuery || !['REPORT_SALES', 'REPORT_EXPENSES', 'REPORT_STOCK', 'REPORT_DEBTS', 'REPORT_SECURITY', 'REPORT_COMPARISON', 'REPORT_EMPLOYEE', 'REPORT_BEST_SELLING', 'ACTION_ADD_STAFF', 'ACTION_TOGGLE_FEATURES'].includes(intent))) {
          // Elite local knowledge base match covering specific duka FAQs
          botResponseText = kbMatch.answer;
          type = 'text';
          if (kbMatch.action) {
            (window as any).__lastMshauriAction = kbMatch.action;
          }
        } else if (isWafanyakaziGeneral) {
          type = 'employee_general';
          botResponseText = 'Ripoti ya Wafanyakazi';
        } else if (isSingleEmployeeReport && foundEmployee) {
          type = 'employee_single';
          employeeId = foundEmployee.id;
          botResponseText = `Ripoti ya ${foundEmployee.name}`;
        } else if (intent !== 'UNKNOWN' && intent !== 'GENERAL_HELP' && intent !== 'REPORT_DEAD_STOCK' && intent !== 'REPORT_FORECAST') {
          // --- LAYER 2: BUSINESS LOGIC ---
          let data: any = {};
          if (intent === 'REPORT_SALES') {
            data = BusinessLogic.getSalesReport(sales, expenses, intentRes.params.period);
          } else if (intent === 'REPORT_EXPENSES') {
            data = BusinessLogic.getSalesReport(sales, expenses, intentRes.params.period);
          } else if (intent === 'REPORT_STOCK') {
            data = BusinessLogic.getStockStatus(products);
          } else if (intent === 'REPORT_DEBTS') {
            data = BusinessLogic.getDebtsStatus(sales, debtPayments);
          } else if (intent === 'REPORT_SECURITY') {
            data = BusinessLogic.getSecurityStatus(auditLogs);
          } else if (intent === 'REPORT_COMPARISON') {
            data = BusinessLogic.getComparisonReport(sales, expenses, intentRes.params.comparePeriod);
          } else if (intent === 'REPORT_BUSINESS') {
            data = BusinessLogic.getBusinessSummary(sales, expenses, products, intentRes.params.period, debtPayments);
          }

          // --- LAYER 3: RESPONSE GENERATION ---
          botResponseText = formatResponseText(ResponseGenerator.generate(intent, data, currency, user?.name));
          type = 'react_node';
        } else if (kbMatch) {
          // Fallback KB match
          botResponseText = kbMatch.answer;
          type = 'text';
          if (kbMatch.action) {
            (window as any).__lastMshauriAction = kbMatch.action;
          }
        } else if (intent === 'REPORT_DEAD_STOCK' || intent === 'REPORT_FORECAST' || cleanText.includes('hasara')) {
          // Existing strategic logic fallback
          const strategicReply = processStrategicQuery(text);
          botResponseText = formatResponseText(strategicReply);
          type = 'react_node';
        } else {
          // General help or unknown
          botResponseText = formatResponseText(ResponseGenerator.generate(intent, {}, currency, user?.name));
          type = 'react_node';
        }

        const botMsgId = uuidv4();
        const lastAction = (window as any).__lastMshauriAction;
        const lastFollowUps = (window as any).__lastMshauriFollowUps || FollowUpEngine.getFollowUps(intent as any, undefined, isAiEnabled);
        
        (window as any).__lastMshauriAction = null;
        (window as any).__lastMshauriFollowUps = null;

        const botResponse: Message = {
          id: botMsgId,
          sender: 'bot',
          text: botResponseText,
          type,
          employeeId,
          initialPeriod: isWafanyakaziGeneral ? initialPeriod : undefined,
          intent: intent,
          query: cleanText,
          timestamp: new Date(),
          action: lastAction,
          followUps: lastFollowUps
        };
        
        setMessages(prev => [...prev, botResponse]);
        setIsTyping(false);

        await saveMessageToDb(botMsgId, 'bot', botResponseText, type, {
          employeeId,
          initialPeriod: isWafanyakaziGeneral ? initialPeriod : undefined,
          action: lastAction,
          followUps: lastFollowUps,
          intent: intent,
          query: cleanText
        });
      }, 700);
    }
  };

  // Listen to external triggers (e.g. clicking "reply" on a notification)
  const prevTriggerRef = useRef<string | null>(null);
  useEffect(() => {
    if (isMshauriOpen && mshauriTriggerQuery && mshauriTriggerQuery !== prevTriggerRef.current) {
      prevTriggerRef.current = mshauriTriggerQuery;
      sendMessage(mshauriTriggerQuery);
      // Reset trigger to null but keep open
      useStore.getState().setMshauriOpen(true, null);
    }
  }, [isMshauriOpen, mshauriTriggerQuery]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isTyping) return;
    sendMessage(inputValue);
    setInputValue('');
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`${isOpen ? 'hidden' : 'flex'} fixed bottom-24 right-4 sm:bottom-6 sm:right-6 bg-white  active:scale-95 transition-all z-50 animate-bounce cursor-pointer justify-center items-center rounded-full shadow-[0_20px_50px_rgba(79,70,229,0.45),_0_0_0_4px_rgba(255,255,255,1),_0_0_20px_4px_rgba(99,102,241,0.25)] border border-slate-100 duration-200 p-1`}
        style={{ width: '64px', height: '64px' }}
      >
        <VenicsLogo size={54} animate="idle" outerGradient={['#4f46e5', '#06b6d4']} innerGradient={['#10b981', '#3b82f6']} />
      </button>

      {/* Chat Interface Overlay - Perfectly fits ANY dynamic viewport height/width and safe areas on phones */}
      {isOpen && (
        <div className="fixed inset-x-0 bottom-0 top-0 sm:inset-auto sm:bottom-6 sm:right-6 w-full sm:w-[440px] md:w-[450px] max-w-full h-[100dvh] sm:h-[700px] max-h-[92vh] z-[100] flex flex-col bg-white sm:rounded-2xl shadow-2xl border-0 sm:border border-gray-200 overflow-hidden transform transition-all pb-safe md:mr-4 font-sans ring-1 ring-slate-200/50 animate-in fade-in slide-in-from-bottom duration-200">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-700 to-indigo-900 p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] sm:pt-4 flex items-center justify-between shadow-md z-10 shrink-0">
            <div className="flex items-center space-x-2.5">
              <div className="bg-white/10 p-1 rounded-xl flex items-center justify-center shrink-0">
                <VenicsLogo size={24} animate="idle" vGradient={['#ffffff', '#e0e7ff']} outerGradient={['#38bdf8', '#06b6d4']} innerGradient={['#10b981', '#3b82f6']} />
              </div>
              <div>
                <h3 className="font-bold text-white text-[15px] leading-tight flex items-center gap-1.5">
                  Venics Smart
                  <span className="inline-block w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
                </h3>
              </div>
            </div>
            
            <div className="flex items-center space-x-2.5">
              <button 
                onClick={() => setIsOpen(false)} 
                className="bg-red-500 text-white hover:bg-red-600 active:scale-90 p-2 rounded-full transition-all cursor-pointer shadow-md select-none touch-manipulation flex items-center justify-center border border-red-400/30 shrink-0"
                title="Funga gumzo"
              >
                <X className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50/20">
            {messages.map((msg, msgIdx) => {
              const isUser = msg.sender === 'user';
              const isOpeningMsg = msgIdx === 0 || msg.id === 'welcome_msg' || msg.id === 'empty_state_msg';
              
              return (
                <div 
                  key={msg.id} 
                  className="message-item flex w-full border-b border-slate-100/70 pb-5 last:border-0 last:pb-2"
                >
                  {isUser ? (
                    <div className="flex max-w-[85%] ml-auto items-start">
                      {/* User Content Wrapper */}
                      <div className="flex-1 min-w-0">
                        {/* User Bubble */}
                        <div className="p-3.5 rounded-2xl bg-indigo-600 text-white rounded-tr-none shadow-md text-[15px] sm:text-base leading-relaxed relative">
                          {msg.text}
                        </div>
                        
                        {/* Time */}
                        <span className="text-[10px] mt-1.5 block opacity-70 text-indigo-600 text-right mr-1">
                          {format(msg.timestamp, 'HH:mm')}
                        </span>
                      </div>
                      
                      {/* User Avatar on Right */}
                      <div className="flex-shrink-0 ml-3">
                        <div className="w-8.5 h-8.5 rounded-full flex items-center justify-center bg-indigo-50 shadow-sm border border-slate-100/50">
                          <User className="w-4 h-4 text-indigo-600" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full items-start">
                      {/* Bot/Assistant Content Wrapper - SPREADS FULL WIDTH without any robot icon */}
                      <div className="flex-1 min-w-0">
                        {/* Bot Response Bubble */}
                        <div className="bg-transparent text-slate-800 text-base sm:text-[17px] leading-relaxed relative w-full pr-2">
                          {(() => {
                            if (msg.id === 'welcome_msg') {
                              return (
                                <div className="bg-indigo-50/50 border border-indigo-100/80 p-4.5 rounded-2xl relative shadow-sm text-slate-800 text-[15px] sm:text-[16px] leading-relaxed w-full">
                                  <button 
                                    onClick={handleDismissWelcome}
                                    title="Usionyeshe tena"
                                    className="absolute top-2.5 right-2.5 text-slate-400 p-1.5 rounded-full transition-colors cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                  <div className="flex items-start gap-2.5 pr-6">
                                    <Sparkles className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                                    <div>
                                      {msg.text}
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                            if (msg.type === 'sync') {
                              return <SyncDiagResponse />;
                            }
                            if (msg.type === 'employee_general') {
                              return (
                                <EmployeeBreakdownResponse 
                                  users={users} 
                                  sales={sales} 
                                  expenses={expenses} 
                                  auditLogs={auditLogs} 
                                  initialPeriod={msg.initialPeriod || 'week'} 
                                  onSelectEmployee={(name) => sendMessage(`ripoti ya ${name}`)} 
                                />
                              );
                            }
                            if (msg.type === 'employee_single') {
                              const emp = users.find(u => u.id === msg.employeeId);
                              if (emp) {
                                return (
                                  <SingleEmployeeReport 
                                    employee={emp} 
                                    sales={sales} 
                                    expenses={expenses} 
                                    auditLogs={auditLogs} 
                                    onBackToGeneral={() => sendMessage('ripoti ya wafanyakazi')} 
                                  />
                                );
                              }
                            }
                            
                            if (msg.type === 'react_node') {
                              if (msg.intent && msg.query) {
                                const cleanQ = msg.query.toLowerCase().trim();
                                const isStrategic = cleanQ.match(/hali\s+ya\s+duka|hali.*duka|shop\s+okay|business\s+okay|am\s+i\s+doing|niko\s+sawa|kuna\s+shida|afya\s+ya\s+duka|kagua\s+duka|afya\s+ya\s+biashara|asubuhi|morning|noon|mchana|jioni|evening|muda.*mauzo|peak\s+hour|peak.*saa|average\s+daily|daily\s+average|wastani|mteja|wateja|debtor|loyalty|customer|nani\s+anadaiwa|wadaiwa|deni|sugu|wekeza|tangaza|promote|roi|nunua\s+nini|fursa|faida\s+ya\s+bidhaa|faida.*nyepesi|margin|asilimia|net\s+profit\s+margin|profitability|overstock|mzigo\s+mwingi|baki\s+nyingi|stoo\s+nyingi|sitting|dhidi ya/i) || 
                                  ['REPORT_DEAD_STOCK', 'REPORT_FORECAST'].includes(msg.intent) || 
                                  cleanQ.includes('hasara');
                                if (isStrategic) {
                                  const strategicReply = processStrategicQuery(msg.query);
                                  return (
                                    <div className="flex flex-col gap-3 text-inherit">
                                      <div className="prose prose-slate prose-sm max-w-none">
                                        {formatResponseText(strategicReply)}
                                      </div>
                                    </div>
                                  );
                                }
                                return <>{processQuery(msg.query, msg.intent as any)}</>;
                              } else {
                                return <div className="text-slate-500 italic text-sm">💡 Ripoti maalum imehifadhiwa. Uliza swali upya ili kupata takwimu za sasa.</div>;
                              }
                            }
                            
                            let content: React.ReactNode;
                            if (typeof msg.text === 'string') {
                              const cleanText = msg.text.replace('[ST-INSIGHT]\n', '');
                              content = formatResponseText(cleanText);
                            } else {
                              content = msg.text;
                            }

                            return (
                              <div className="flex flex-col gap-3 text-inherit">
                                <div className="prose prose-slate prose-sm max-w-none">
                                  {content}
                                </div>
                                {msg.action && (
                                  <div className="flex flex-wrap items-center gap-2 mt-1">
                                    <button
                                      onClick={() => {
                                        if (msg.isInsight) {
                                          markMessageAsSeen(msg.id);
                                        }
                                        if (msg.action?.path) {
                                          navigate(msg.action.path);
                                          setIsOpen(false);
                                        }
                                      }}
                                      className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
                                    >
                                      <span className="text-sm">🚀</span>
                                      {msg.action.label.startsWith('Fungua') || msg.action.label.startsWith('Angalia') ? msg.action.label : `Fungua ${msg.action.label}`}
                                    </button>

                                    {msg.isInsight && (
                                      <button
                                        onClick={() => {
                                          markMessageAsSeen(msg.id);
                                          setMessages(prev => prev.filter(m => m.id !== msg.id));
                                        }}
                                        className="flex items-center gap-1.5 bg-slate-100 text-slate-600 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 cursor-pointer border border-slate-200/40"
                                      >
                                        <span>Nimeelewa / Funga</span>
                                      </button>
                                    )}
                                  </div>
                                )}

                                {msg.followUps && msg.followUps.length > 0 && messages[messages.length - 1].id === msg.id && (
                                  <div className={`flex ${isOpeningMsg ? 'flex-wrap' : 'flex-col'} gap-2 mt-4 pt-3 border-t border-slate-200/60`}>
                                    <span className="w-full text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Maswali Mbadala:</span>
                                    {msg.followUps.map((fu, idx) => (
                                       <button
                                         key={idx}
                                         onClick={() => {
                                           sendMessage(fu);
                                          }}
                                         className={`text-xs bg-white  border border-slate-200  text-slate-700  ${isOpeningMsg ? 'px-3 py-2 rounded-full' : 'px-3 py-2.5 rounded-xl text-left'} transition-all cursor-pointer font-medium shadow-sm  active:scale-95 flex items-center group`}
                                       >
                                         <span className="opacity-70 mr-2 group- transition-transform">👉</span>{fu}
                                       </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        
                        {/* Time */}
                        <div className="flex items-center space-x-2 mt-1.5 opacity-70">
                          <span className="text-[10px] text-slate-400 text-left">
                            {format(msg.timestamp, 'HH:mm')}
                          </span>
                          {msg.sender === 'ai' && (
                            <span className="text-[9px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider select-none animate-pulse flex items-center gap-0.5">
                              <Sparkles className="w-2.5 h-2.5 text-emerald-600 inline" />
                              Venics Smart ✨
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            
            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex justify-start">
                <div className="flex w-full flex-row items-start">
                  <div className="p-3 bg-white text-slate-700 rounded-2xl shadow-sm border border-slate-100 italic text-[14px] sm:text-[15px] flex items-center space-x-3">
                    <VenicsLogo size={24} animate="loading" vGradient={['#4f46e5', '#818cf8']} />
                    <span className="font-medium text-slate-600">Venics Smart anachambua data...</span>
                    <span className="flex space-x-1 ml-1 items-center">
                      <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce"></span>
                      <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                      <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Suggested strategic & data Chips */}
          <div className="px-4 pb-3 pt-1.5 flex overflow-x-auto gap-2 no-scrollbar shrink-0 bg-slate-50 border-t border-slate-100">
            <button onClick={() => setInputValue('Ripoti ya upotevu na ulinzi duka letu')} className="whitespace-nowrap text-xs bg-red-50 border border-red-100/50 text-red-700 px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer">🚨 Mianya ya Upotevu & Ulinzi</button>
            <button onClick={() => setInputValue('Nifanye nini kukuza mauzo yangu leo?')} className="whitespace-nowrap text-xs bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer">🚀 Kukuza Mauzo?</button>
            <button onClick={() => setInputValue('Makadirio ya bidhaa zilizolala na mtaji uliolala duka letu')} className="whitespace-nowrap text-xs bg-amber-50 border border-amber-100/50 text-amber-700 px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer">📦 Mtaji Uliolala (Dead Stock)</button>
            <button onClick={() => setInputValue('Makadirio ya mauzo yanayopotea kutokana na low stock')} className="whitespace-nowrap text-xs bg-rose-50 border border-rose-100/50 text-rose-700 px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer">💸 Mauzo Yanayopotea (Lost Revenue)</button>
            <button onClick={() => setInputValue('Makadirio ya bajeti ya ununuzi wa mzigo ujao')} className="whitespace-nowrap text-xs bg-blue-50 border border-blue-100/50 text-blue-700 px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer">📋 Kikokotoo cha Mzigo Ujao</button>
            <button onClick={() => setInputValue('Naomba ripoti ya wafanyakazi wiki hii')} className="whitespace-nowrap text-xs bg-indigo-50 border border-indigo-100/50 text-indigo-700 px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer">👥 Ripoti ya Wafanyakazi</button>
            <button onClick={() => setInputValue('Mwelekeo wa biashara yangu miezi 6 ijayo?')} className="whitespace-nowrap text-xs bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer">🔮 Miezi 6 ijayo?</button>
            <button onClick={() => setInputValue('Kwanini mauzo/data nikiuza hazionekani kwa mfanyakazi wangu au kuna shida ya sync?')} className="whitespace-nowrap text-xs bg-slate-100 border border-slate-200 text-slate-700 px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer">🔄 Shida ya Sync</button>
          </div>

          {/* Input Area with bottom-safe padding for mobile layout */}
          <div className="p-2.5 bg-white border-t border-gray-100 shrink-0 pb-3.5 sm:pb-2.5">
            <form onSubmit={handleSend} className="flex flex-row items-center relative">
              <input
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={isTyping ? "Tafadhali subiri Venics..." : "Muulize Venics..."}
                disabled={isTyping}
                className="w-full bg-gray-50 border border-gray-200 text-gray-700 text-xs sm:text-sm rounded-full pl-4 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/55 focus:bg-white transition-all shadow-inner disabled:opacity-50 font-medium"
              />
              <button 
                type="submit" 
                disabled={!inputValue.trim() || isTyping}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 bg-indigo-600 text-white rounded-full disabled:opacity-50 disabled:bg-gray-300 transition-all shadow-sm cursor-pointer flex items-center justify-center w-7.5 h-7.5"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}