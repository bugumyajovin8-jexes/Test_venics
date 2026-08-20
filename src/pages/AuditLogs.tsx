import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { format, isSameMonth } from 'date-fns';
import { 
  Trash2, Clock, User, Package, Edit, Plus, AlertCircle, RotateCcw, 
  Wallet, Tag, CheckCircle2, XCircle, MonitorSmartphone,
  ChevronDown, ChevronRight, Calendar, ArrowLeft
} from 'lucide-react';
import { useStore } from '../store';
import { describeAudit, ACCENT_STYLES } from '../utils/auditNarrative';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { formatCurrency } from '../utils/format';
import { useNavigate } from 'react-router-dom';

function MonthSection({ 
  monthKey, 
  count, 
  isExpanded, 
  onToggle, 
  isCurrentMonth, 
  currency 
}: { 
  monthKey: string; 
  count: number; 
  isExpanded: boolean; 
  onToggle: () => void;
  isCurrentMonth: boolean;
  currency: string;
}) {
  const shopId = useStore(state => state.user?.shopId);

  const monthLogs = useLiveQuery(
    async () => {
      if (!isExpanded || !shopId) return [];

      // Parse monthKey to get start/end range
      const [yearStr, monthStr] = monthKey.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10) - 1;
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0, 23, 59, 59);

      return db.auditLogs
        .where('created_at')
        .between(startDate.toISOString(), endDate.toISOString())
        // Scope to the active shop: the local cache keeps rows from every shop this device has
        // logged into, so an unscoped read mixes another shop's history into this one.
        .filter(log => log.shop_id === shopId && log.isDeleted === 0 && !['login', 'logout', 'app_opened'].includes(log.action))
        .reverse()
        .sortBy('created_at');
    },
    [isExpanded, monthKey, shopId]
  ) || [];

  /**
   * Icons inherit the card's calm accent. This page is for review, not alarm —
   * the boss already knows why they opened it, so red on every entry only adds
   * pressure. (Genuinely destructive controls, like "Futa Zote", stay red.)
   */
  const getActionIcon = (action: string) => {
    if (action.startsWith('anomaly_')) return <AlertCircle className="w-4 h-4" />;
    switch (action) {
      case 'add_product': return <Plus className="w-4 h-4" />;
      case 'edit_product': return <Edit className="w-4 h-4" />;
      case 'delete_product': return <Trash2 className="w-4 h-4" />;
      case 'import_products': return <Package className="w-4 h-4" />;
      case 'refund_sale': return <RotateCcw className="w-4 h-4" />;
      case 'add_expense': return <Wallet className="w-4 h-4" />;
      case 'discounted_sale': return <Tag className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };

  const getActionText = (action: string) => {
    switch (action) {
      case 'add_product': return 'Aliongeza Bidhaa';
      case 'edit_product': return 'Alihariri Bidhaa';
      case 'delete_product': return 'Alifuta Bidhaa';
      case 'delete_all_products': return 'Alifuta Bidhaa Zote';
      case 'import_products': return 'Aliingiza Bidhaa (Excel)';
      case 'refund_sale': return 'Alirudisha Mauzo (Rejesho)';
      case 'add_expense': return 'Aliongeza Matumizi';
      case 'discounted_sale': return 'Alitoa Punguzo la Bei';
      case 'login': return 'Ameingia Kwenye Mfumo';
      case 'logout': return 'Ametoka Kwenye Mfumo';
      case 'app_opened': return 'Amefungua Programu';
      case 'anomaly_delayed_delete': return '🚨 Mashaka: Mauzo Yaliyofutwa Baada ya Muda Kupita';
      case 'anomaly_heavy_discount': return '🚨 Mashaka: Mapunguzo ya Bei Kupita Kiasi';
      case 'anomaly_backdated': return '🚨 Mashaka: Mauzo Yaliyoingizwa kwa Tarehe ya Nyuma';
      case 'anomaly_frequent_voids': return '🚨 Mashaka: Kufuta Bidhaa Kikapuni Mara kwa Mara';
      case 'anomaly_stock_reduction': return '🚨 Mashaka: Kupunguza Bidhaa Stoo bila Maelezo';
      case 'anomaly_ghost_items': return '🚨 Mashaka: Kuna bidhaa hazina rekodi ya mauzo';
      case 'anomaly_off_hours': return '🚨 Mashaka: Shughuli za Mfumo Muda wa Usiku';
      case 'anomaly_expense_late': return '🚨 Mashaka: Matumizi ya Ghafla Karibu na Kufunga Duka';
      case 'anomaly_expense_vague_round': return '🚨 Mashaka: Matumizi Yenye Nambari za Pande Zote';
      case 'anomaly_expense_spike': return '🚨 Mashaka: Ongezeko Kubwa na la Ghafla la Matumizi';
      case 'anomaly_fake_debt': return '🚨 Mashaka: Madeni yenye Mashaka kwa Wateja Wapya';
      case 'anomaly_debt_settle': return '🚨 Mashaka: Kufuta Madeni ya Wateja bila Ushahidi wa Malipo';
      default: return action;
    }
  };

  const [yearStr, monthStr] = monthKey.split('-');
  const monthLabel = format(new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1), 'MMMM yyyy');

  return (
    <div className="flex flex-col space-y-2">
      {/* Month Header */}
      <button
        onClick={onToggle}
        className={`flex items-center justify-between p-4 rounded-2xl transition-all ${
          isCurrentMonth 
            ? 'bg-indigo-600 text-white shadow-md' 
            : 'bg-white text-gray-700 shadow-sm border border-gray-100 '
        }`}
      >
        <div className="flex items-center space-x-3">
          <Calendar className={`w-5 h-5 ${isCurrentMonth ? 'text-indigo-200' : 'text-indigo-500'}`} />
          <div className="text-left">
            <h3 className="font-bold text-sm sm:text-base uppercase tracking-wide">
              {monthLabel}
            </h3>
            <p className={`text-[10px] sm:text-xs font-medium ${isCurrentMonth ? 'text-indigo-100' : 'text-gray-400'}`}>
              Mabadiliko {count} yaliyorekodiwa
            </p>
          </div>
        </div>
        {isExpanded ? <ChevronDown className="w-5 h-5 opacity-70" /> : <ChevronRight className="w-5 h-5 opacity-70" />}
      </button>

      {/* Logs within Month */}
      {isExpanded && (
        <div className="space-y-3 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
          {monthLogs.length === 0 && count > 0 && (
            <div className="py-10 text-center text-gray-400">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-20 animate-spin" />
              <p className="text-xs">Inapakia mabadiliko ya {monthLabel}...</p>
            </div>
          )}
          {monthLogs.map((log) => {
            const narrative = describeAudit(log, currency);
            return (
              <div key={log.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex">
                {/* Calm accent stripe instead of an alarming card */}
                <div className={`w-1.5 shrink-0 ${ACCENT_STYLES[narrative.accent].bar}`} />
  
                <div className="flex-1 p-4 min-w-0">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-xl shrink-0 ${ACCENT_STYLES[narrative.accent].chip}`}>
                      {getActionIcon(log.action)}
                    </div>
  
                    <div className="min-w-0 flex-1">
                      {/* Everything in one sentence: who, what, how much, which item, when */}
                      <p className="text-[13.5px] leading-relaxed text-gray-800 font-medium">
                        {narrative.sentence}
                      </p>
  
                      {narrative.note && (
                        <p className="text-[11.5px] leading-relaxed text-gray-500 mt-1.5">
                          {narrative.note}
                        </p>
                      )}
  
                      <div className="flex items-center gap-3 mt-2.5 text-[10.5px] text-gray-400 font-semibold">
                        <span className="flex items-center">
                          <User className="w-3 h-3 mr-1" />
                          {log.user_name || log.details?.employee_name || 'Mfanyakazi'}
                        </span>
                        <span className="flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          {format(new Date(log.created_at), 'HH:mm, dd MMM')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AuditLogs() {
  const { isBoss, showAlert, showConfirm, user } = useStore();
  const shopId = user?.shopId;
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  const navigate = useNavigate();

  useEffect(() => {
    TelemetryService.trackMabadilikoYaBidhaaView();
  }, []);

  // Track expanded months
  const currentMonthKey = format(new Date(), 'yyyy-MM');
  const [expandedMonths, setExpandedMonths] = useState<string[]>([currentMonthKey]);

  // Fetch only the structure/available months first (efficient index scan)
  const availableMonths = useLiveQuery(
    async () => {
      if (!shopId) return {};
      // Scope to the active shop — otherwise months from a previously logged-in shop appear here.
      const logs = await db.auditLogs
        .where('[shop_id+isDeleted]').equals([shopId, 0])
        .reverse()
        .sortBy('created_at');

      // Filter out system actions
      const filtered = logs.filter(log => !['login', 'logout', 'app_opened'].includes(log.action));
      
      const groups: Record<string, number> = {};
      filtered.forEach(log => {
        const mKey = format(new Date(log.created_at), 'yyyy-MM');
        groups[mKey] = (groups[mKey] || 0) + 1;
      });
      return groups;
    },
    [shopId]
  ) || {};

  const sortedMonthKeys = useMemo(() => {
    return Object.keys(availableMonths).sort((a, b) => b.localeCompare(a));
  }, [availableMonths]);

  const toggleMonth = (month: string) => {
    setExpandedMonths(prev => 
      prev.includes(month) 
        ? prev.filter(m => m !== month)
        : [...prev, month]
    );
  };

  const handleDeleteAll = () => {
    showConfirm(
      'Futa Kumbukumbu Zote',
      'Je, una uhakika unataka kufuta kumbukumbu zote za mabadiliko? Kitendo hiki hakiwezi kutenguliwa.',
      async () => {
        if (!shopId) return;
        // Scope to the active shop — unscoped this soft-deleted the audit history of EVERY shop
        // cached on this device, not just the one the user is looking at.
        await db.auditLogs.where('[shop_id+isDeleted]').equals([shopId, 0]).modify({
          isDeleted: 1,
          synced: 0,
          updated_at: new Date().toISOString()
        });
        SyncService.sync();
        showAlert('Mafanikio', 'Kumbukumbu zote zimefutwa.');
      }
    );
  };

  if (!isBoss()) {
    return (
      <div className="p-10 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-800">Huna Ruhusa</h2>
        <p className="text-gray-500 mt-2">Ukurasa huu ni kwa ajili ya mmiliki wa duka pekee.</p>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col h-full bg-gray-50 pt-safe pt-safe-standalone">
      <div className="flex justify-between items-center mb-6">
        <div data-tour="audit-list" className="flex items-center">
          <button onClick={() => navigate(-1)} className="mr-3 p-2 bg-white rounded-full shadow-sm">
             <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Mabadiliko ya Bidhaa</h1>
        </div>
        {sortedMonthKeys.length > 0 && (
          <button 
            onClick={handleDeleteAll}
            className="flex items-center space-x-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl transition-colors border border-red-100"
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-sm font-bold">Futa Zote</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pb-10">
        {sortedMonthKeys.length > 0 ? (
          sortedMonthKeys.map((monthKey) => (
            <MonthSection
              key={monthKey}
              monthKey={monthKey}
              count={availableMonths[monthKey]}
              isExpanded={expandedMonths.includes(monthKey)}
              onToggle={() => toggleMonth(monthKey)}
              isCurrentMonth={monthKey === currentMonthKey}
              currency={currency}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Clock className="w-12 h-12 mb-4 opacity-20" />
            <p className="font-medium">Hakuna mabadiliko yaliyoripotiwa bado.</p>
            <p className="text-xs mt-1">Mabadiliko ya wafanyakazi yataonekana hapa.</p>
          </div>
        )}
      </div>
    </div>
  );
}
