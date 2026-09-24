import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { format } from 'date-fns';
import { Trash2, Clock, User, Package, Edit, Plus, AlertCircle, RotateCcw, Wallet, Tag, CheckCircle2, XCircle, MonitorSmartphone } from 'lucide-react';
import { useStore } from '../store';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { formatCurrency } from '../utils/format';
import { nowIso } from '../services/clock';

export default function AuditLogs() {
  const { isBoss, showAlert, showConfirm, user } = useStore();
  const shopId = user?.shopId || user?.shop_id;
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  useEffect(() => {
    TelemetryService.trackMabadilikoYaBidhaaView();
  }, []);

  // Scope to the active shop: the local cache keeps rows from every shop this device has logged
  // into, so an unscoped read mixed another shop's history into this page.
  const rawLogs = useLiveQuery(
    () => shopId
      ? db.auditLogs
          .where('[shop_id+isDeleted]')
          .equals([shopId, 0])
          .reverse()
          .sortBy('created_at')
      : Promise.resolve([]),
    [shopId]
  ) || [];

  // Exclude system actions from standard audit logs
  const logs = rawLogs.filter(log => !['login', 'logout', 'app_opened'].includes(log.action));

  const handleDeleteAll = () => {
    showConfirm(
      'Futa Kumbukumbu Zote',
      'Je, una uhakika unataka kufuta kumbukumbu zote za mabadiliko? Kitendo hiki hakiwezi kutenguliwa.',
      async () => {
        const logIds = logs.map(l => l.id);
        await Promise.all(logIds.map(id => 
          db.auditLogs.update(id, { 
            isDeleted: 1, 
            synced: 0, 
            updated_at: nowIso() 
          })
        ));
        SyncService.sync();
        showAlert('Mafanikio', 'Kumbukumbu zote zimefutwa.');
      }
    );
  };

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
      case 'refund_sale': return 'Alirudisha Mauzo (Refund)';
      case 'add_expense': return 'Aliongeza Matumizi';
      case 'discounted_sale': return 'Alitoa Punguzo la Bei';
      case 'login': return 'Ameingia Kwenye Mfumo (Login)';
      case 'logout': return 'Ametoka Kwenye Mfumo (Logout)';
      case 'app_opened': return 'Amefungua Programu (App Opened)';
      case 'anomaly_delayed_delete': return '🚨 Tishio: Mauzo Yamefutwa Kwa Kuchelewa';
      case 'anomaly_heavy_discount': return '🚨 Tishio: Punguzo Kubwa la Bei (Hasara)';
      case 'anomaly_backdated': return '🚨 Tishio: Mauzo ya Siku za Nyuma (Backdated)';
      case 'anomaly_frequent_voids': return '🚨 Tishio: Kufuta Bidhaa Nyingi Kwenye Kikapu';
      case 'anomaly_stock_reduction': return '🚨 Tishio: Kupunguza Stock Bila Maelezo';
      case 'anomaly_ghost_items': return '🚨 Tishio: Bidhaa Zinazouzwa Hazionekani Kwenye Mfumo (Ghost Items)';
      case 'anomaly_off_hours': return '🚨 Tishio: Matumizi Usiku wa Manane (Off-Hours Operations)';
      case 'anomaly_expense_late': return '🚨 Tishio: Matumizi ya Dakika za Mwisho (End-of-Day Sudden Expenses)';
      case 'anomaly_expense_vague_round': return '🚨 Tishio: Matumizi Yenye Namba Kamili Bila Maelezo (Vague / Round-Number Expenses)';
      case 'anomaly_expense_spike': return '🚨 Tishio: Ongezeko Kubwa La Matumizi (Spike kwenye matumizi)';
      case 'anomaly_fake_debt': return '🚨 Tishio: Madeni Hewa (High Ratio of Debt Sales to New Customers)';
      case 'anomaly_debt_settle': return '🚨 Tishio: Kufuta Madeni Kimyakimya (Self-Settling Debts)';
      default: return action;
    }
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
    <div className="p-4 flex flex-col h-full bg-gray-50">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold text-gray-900">Mabadiliko ya Bidhaa</h1>
        </div>
        {logs.length > 0 && (
          <button 
            onClick={handleDeleteAll}
            className="flex items-center space-x-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors border border-red-100"
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-sm font-bold">Futa Zote</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3">
        {logs.length > 0 ? (
          logs.map((log) => (
            <div key={log.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-gray-50 rounded-lg">
                    {getActionIcon(log.action)}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">{getActionText(log.action)}</p>
                    <p className="text-sm text-gray-500 font-medium">
                      {log.action === 'delete_all_products' 
                        ? `Alifuta bidhaa ${log.details?.count || 0} kwa mkupuo`
                        : (log.details?.name || 'Bidhaa isiyojulikana')}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center text-xs text-gray-400 font-medium">
                    <Clock className="w-3 h-3 mr-1" />
                    {format(new Date(log.created_at), 'HH:mm, dd MMM')}
                  </div>
                  <div className="flex items-center text-xs text-blue-500 font-bold mt-1">
                    <User className="w-3 h-3 mr-1" />
                    {log.user_name || 'Mfanyakazi'}
                  </div>
                </div>
              </div>

              {log.action === 'refund_sale' && (
                <div className="mt-3 pt-3 border-t border-gray-50 grid grid-cols-2 gap-2">
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Kiasi Kilichorudishwa</span>
                    <span className="font-bold text-red-600">{formatCurrency(log.details?.amount, currency)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Mteja</span>
                    <span className="font-bold text-gray-700">{log.details?.customer || 'Taslimu'}</span>
                  </div>
                  <div className="col-span-2 text-xs mt-1">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Bidhaa Zilizoathirika</span>
                    <span className="font-medium text-gray-600">
                      {log.details?.items?.map((i: any) => `${i.name} (${i.qty})`).join(', ')}
                    </span>
                  </div>
                </div>
              )}

              {log.action === 'add_expense' && (
                <div className="mt-3 pt-3 border-t border-gray-50 grid grid-cols-2 gap-2">
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Kiasi</span>
                    <span className="font-bold text-red-600">{formatCurrency(log.details?.amount, currency)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Kundi</span>
                    <span className="font-bold text-gray-700">{log.details?.category}</span>
                  </div>
                  <div className="col-span-2 text-xs mt-1">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Maelezo</span>
                    <span className="font-medium text-gray-600">{log.details?.description}</span>
                  </div>
                </div>
              )}

              {log.action === 'discounted_sale' && (
                <div className="mt-3 pt-3 border-t border-gray-50 flex flex-col gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-xs">
                      <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Bei ya Asili</span>
                      <span className="font-bold text-gray-400 line-through">{formatCurrency(log.details?.original_price, currency)}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Bei Mpya</span>
                      <span className="font-bold text-green-600">{formatCurrency(log.details?.price_on_discount, currency)}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Idadi</span>
                      <span className="font-bold text-gray-700">{log.details?.number_of_items_sold}</span>
                    </div>
                  </div>
                  <div className="text-xs mt-1">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Bidhaa</span>
                    <span className="font-medium text-gray-600">{log.details?.name_of_product}</span>
                  </div>
                  <div className="text-xs mt-1">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Muzaji</span>
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
                        <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">
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
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Idadi</span>
                    <span className="font-bold text-gray-700">{log.details?.stock}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Bei ya Kuuza</span>
                    <span className="font-bold text-gray-700">{formatCurrency(log.details?.sell_price, currency)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-400 uppercase font-bold text-[10px] block mb-0.5">Bei ya Kununua</span>
                    <span className="font-bold text-gray-700">{formatCurrency(log.details?.buy_price, currency)}</span>
                  </div>
                </div>
              )}

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
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Idadi ya Bidhaa Tatanishi</span>
                        <span className="font-bold text-red-600">{log.details.ghost_items.length} Aina</span>
                      </div>
                    )}
                    {log.details?.description && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Maelezo Yaliyoandikwa</span>
                        <span className="font-bold text-red-600">"{log.details.description}"</span>
                      </div>
                    )}
                    {log.details?.today_total !== undefined && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Jumla ya Leo</span>
                        <span className="font-bold text-red-600">{formatCurrency(log.details.today_total, currency)}</span>
                      </div>
                    )}
                    {log.details?.average_daily !== undefined && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Wastani (Siku 30)</span>
                        <span className="font-bold text-red-600">{formatCurrency(log.details.average_daily, currency)} / Siku</span>
                      </div>
                    )}
                    {log.details?.trigger_action && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Tukio Lililosababisha</span>
                        <span className="font-bold text-red-600">{getActionIcon(log.details.trigger_action as string)}</span>
                      </div>
                    )}
                    {log.details?.customer_name && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Jina la Mteja (Deni)</span>
                        <span className="font-bold text-red-600">{log.details.customer_name}</span>
                      </div>
                    )}
                    {log.details?.amount_paid !== undefined && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Kiasi Kilicholipwa</span>
                        <span className="font-bold text-red-600">{formatCurrency(log.details.amount_paid, currency)}</span>
                      </div>
                    )}
                    {log.details?.employee_name && (
                      <div className="text-xs">
                        <span className="text-red-400/80 uppercase font-bold text-[9px] tracking-wider block mb-0.5">Mhusika</span>
                        <span className="font-bold text-red-800">{log.details.employee_name}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
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
