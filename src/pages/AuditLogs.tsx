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

  const getActionIcon = (action: string) => {
    if (action.startsWith('anomaly_')) return <AlertCircle className="w-4 h-4 text-red-600" />;
    switch (action) {
      case 'add_product': return <Plus className="w-4 h-4 text-green-500" />;
      case 'edit_product': return <Edit className="w-4 h-4 text-blue-500" />;
      case 'delete_product': return <Trash2 className="w-4 h-4 text-red-500" />;
      case 'import_products': return <Package className="w-4 h-4 text-orange-500" />;
      case 'refund_sale': return <RotateCcw className="w-4 h-4 text-red-600" />;
      case 'add_expense': return <Wallet className="w-4 h-4 text-orange-600" />;
      case 'discounted_sale': return <Tag className="w-4 h-4 text-purple-500" />;
      case 'login': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'logout': return <XCircle className="w-4 h-4 text-gray-500" />;
      case 'app_opened': return <MonitorSmartphone className="w-4 h-4 text-blue-500" />;
      default: return <AlertCircle className="w-4 h-4 text-gray-500" />;
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
          {monthLogs.map((log) => (
            <div key={log.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-gray-50 rounded-lg">
                    {getActionIcon(log.action)}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">{getActionText(log.action)}</p>
                    <p className="text-sm text-gray-500 font-medium whitespace-pre-wrap">
                      {(() => {
                        if (log.action === 'delete_all_products') {
                          return `Alifuta bidhaa ${log.details?.count || 0} kwa mkupuo`;
                        }
                        if (log.action === 'refund_sale') {
                          return `Rejesho la mauzo la ${formatCurrency(log.details?.amount || 0, currency)}`;
                        }
                        if (log.action === 'add_expense') {
                          return `Kibali cha matumizi ya Mfumo`;
                        }
                        if (log.action === 'login') {
                          return 'Ameingia kwenye mfumo';
                        }
                        if (log.action === 'logout') {
                          return 'Ametoka kwenye mfumo';
                        }
                        if (log.action === 'app_opened') {
                          return 'Amefungua programu';
                        }
                        return log.details?.name || 'Maelezo ya jumla ya mfumo';
                      })()}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center text-[10px] sm:text-xs text-gray-400 font-medium">
                    <Clock className="w-3 h-3 mr-1" />
                    {format(new Date(log.created_at), 'HH:mm, dd MMM')}
                  </div>
                  <div className="flex items-center justify-end text-[10px] sm:text-xs text-blue-500 font-bold mt-1">
                    <User className="w-3 h-3 mr-1" />
                    {log.user_name || 'Mfanyakazi'}
                  </div>
                </div>
              </div>

              {/* Action specific details */}
              {log.action === 'refund_sale' && (
                <div className="mt-3 pt-3 border-t border-gray-50 grid grid-cols-2 gap-2">
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Kiasi Kilichorudishwa</span>
                    <span className="font-bold text-red-600">{formatCurrency(log.details?.amount, currency)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Mteja</span>
                    <span className="font-bold text-gray-700">{log.details?.customer || 'Taslimu'}</span>
                  </div>
                  <div className="col-span-2 text-xs mt-1">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Bidhaa Zilizoathirika</span>
                    <span className="font-medium text-gray-600">
                      {log.details?.items?.map((i: any) => `${i.name} (${i.qty})`).join(', ')}
                    </span>
                  </div>
                </div>
              )}

              {log.action === 'add_expense' && (
                <div className="mt-3 pt-3 border-t border-gray-50 grid grid-cols-2 gap-2">
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Kiasi</span>
                    <span className="font-bold text-red-600">{formatCurrency(log.details?.amount, currency)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Kundi</span>
                    <span className="font-bold text-gray-700">{log.details?.category}</span>
                  </div>
                  <div className="col-span-2 text-xs mt-1">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Maelezo</span>
                    <span className="font-medium text-gray-600">{log.details?.description}</span>
                  </div>
                </div>
              )}

              {log.action === 'discounted_sale' && (
                <div className="mt-3 pt-3 border-t border-gray-50 flex flex-col gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-xs">
                      <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Bei ya Asili</span>
                      <span className="font-bold text-gray-400 line-through">{formatCurrency(log.details?.original_price, currency)}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Bei Mpya</span>
                      <span className="font-bold text-green-600">{formatCurrency(log.details?.price_on_discount, currency)}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Idadi</span>
                      <span className="font-bold text-gray-700">{log.details?.number_of_items_sold}</span>
                    </div>
                  </div>
                  <div className="text-xs mt-1">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Bidhaa</span>
                    <span className="font-medium text-gray-600">{log.details?.name_of_product}</span>
                  </div>
                  <div className="text-xs mt-1">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Muuzaji</span>
                    <span className="font-medium text-gray-600">{log.details?.name_of_person_who_sold}</span>
                  </div>
                </div>
              )}

              {log.action === 'edit_product' && log.details?.changes && (
                <div className="mt-3 pt-3 border-t border-gray-50 grid grid-cols-2 gap-3">
                  {Object.entries(log.details.changes).map(([key, value]: [string, any]) => {
                    const isComparison = value && typeof value === 'object' && 'old' in value && 'new' in value;
                    const isPrice = key === 'sell_price' || key === 'buy_price';
                    
                    return (
                      <div key={key} className="text-xs">
                        <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">
                          {key === 'sell_price' ? 'Bei ya Kuuza' : 
                            key === 'buy_price' ? 'Bei ya Kununua' : 
                            key === 'stock' ? 'Idadi/Stock' : 
                            key === 'name' ? 'Jina' : 
                            key === 'expiry_date' ? 'Tarehe ya Kuisha' :
                            key === 'notify_expiry_days' ? 'Siku za Tahadhari' :
                            key === 'stock_added' ? 'Stock Iliyoongezwa' : key}
                        </span>
                        <div className="font-bold text-gray-700">
                          {isComparison ? (
                            <div className="flex items-center flex-wrap gap-1">
                              <span className="text-red-400 line-through decoration-red-200">
                                {isPrice ? formatCurrency(value.old, currency) : value.old}
                              </span>
                              <span className="text-gray-300">→</span>
                              <span className="text-green-600">
                                {isPrice ? formatCurrency(value.new, currency) : value.new}
                              </span>
                            </div>
                          ) : (
                            <span>{isPrice ? formatCurrency(value as number, currency) : value}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {log.action === 'add_product' && (
                <div className="mt-3 pt-3 border-t border-gray-50 grid grid-cols-3 gap-2">
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Idadi</span>
                    <span className="font-bold text-gray-700">{log.details?.stock}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Kuuza</span>
                    <span className="font-bold text-gray-700">{formatCurrency(log.details?.sell_price, currency)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5 tracking-tight">Kununua</span>
                    <span className="font-bold text-gray-700">{formatCurrency(log.details?.buy_price, currency)}</span>
                  </div>
                </div>
              )}
              
              {/* Anomaly styling */}
              {log.action.startsWith('anomaly_') && (
                <div className="mt-3 pt-3 border-t border-red-100 bg-red-50/50 -mx-4 -mb-4 p-4 rounded-b-xl flex flex-col gap-2 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-red-400/5 rounded-bl-[40px] pointer-events-none" />
                  <div className="text-sm font-medium text-red-700">
                    {log.details?.warning}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-1">
                    {log.details?.amount !== undefined && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Kiasi Kilichoathiriwa</span>
                        <span className="font-bold text-red-600">{formatCurrency(log.details.amount, currency)}</span>
                      </div>
                    )}
                    {log.details?.reduction !== undefined && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Stock Iliyopunguzwa</span>
                        <span className="font-bold text-red-600">{log.details.reduction} pcs</span>
                      </div>
                    )}
                    {log.details?.ghost_items && log.details.ghost_items.length > 0 && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Bidhaa Tatanishi</span>
                        <span className="font-bold text-red-600">{log.details.ghost_items.length} Aina</span>
                      </div>
                    )}
                    {log.details?.employee_name && log.user_id !== 'system' && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Mhusika</span>
                        <span className="font-bold text-red-800">{log.details.employee_name}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
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
        <div className="flex items-center">
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
