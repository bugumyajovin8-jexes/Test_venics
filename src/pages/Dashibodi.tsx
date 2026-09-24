import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { isOpenCreditSale, paidOn, hasOutstanding, outstanding } from '../utils/debt';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { format, startOfDay, startOfMonth, startOfYear, subMonths, isBefore, isAfter, addDays } from 'date-fns';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, TrendingUp, DollarSign, Package, ShieldCheck, CreditCard, ChevronRight, Calendar, Clock, X, Plus, Trash2, ShoppingCart, Phone, RefreshCw } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SyncService } from '../services/sync';
import { LicenseService } from '../services/license';
import { v4 as uuidv4 } from 'uuid';
import { getSales30DaysVelocityMap, getDynamicThreshold, isLowStock, isProductStockTracked, isBatchExpired, isBatchExpiringSoon } from '../utils/stock';
import { useHideStock } from '../hooks/useHideStock';
import { useBlockHistoria } from '../hooks/useBlockHistoria';
import ExpiryDatePicker from '../components/ExpiryDatePicker';
import { nowIso } from '../services/clock';

export default function Dashibodi() {
  const { user, showAlert, showToast, isBoss, isFeatureEnabled } = useStore();
  const hideStock = useHideStock();
  const historiaBlocked = useBlockHistoria();
  const navigate = useNavigate();
  const location = useLocation();
  const boss = isBoss();
  const hasMapatoAccess = boss || isFeatureEnabled('show_mapato_to_staff');

  useEffect(() => {
    if (location.state && (location.state as any).openLowStock) {
      setShowLowStockModal(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const settings = useLiveQuery(() => db.settings.get(1));
  const shopId = user?.shopId || user?.shop_id;
  const shop = useLiveQuery(() => shopId ? db.shops.get(shopId) : Promise.resolve(undefined), [shopId]);
  const currency = settings?.currency || 'TZS';

  const sales = useLiveQuery(async () => {
    if (!shopId) return [];
    const minDateIso = new Date(Math.min(subMonths(new Date(), 6).getTime(), startOfYear(new Date()).getTime())).toISOString();
    const queryResult = await db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([shopId, 0, minDateIso], [shopId, 0, '\uffff'])
      .toArray();
    return boss ? queryResult : queryResult.filter(s => s.user_id === user?.id);
  }, [shopId, boss, user?.id]) || [];

  const totalDebt = useLiveQuery(async () => {
    if (!shopId) return 0;
    
    // One shared definition with Madeni (utils/debt.ts). These two screens each
    // had their own and disagreed on rows with no status and on sub-0.1
    // residues, so the dashboard figure and the list total did not match.
    const sales = await db.sales
      .where('[shop_id+isDeleted]')
      .equals([shopId, 0])
      .filter(s => isOpenCreditSale(s))
      .toArray();

    if (sales.length === 0) return 0;

    const saleIds = sales.map(s => s.id);
    const payments = await db.debtPayments
      .where('sale_id')
      .anyOf(saleIds)
      .toArray();

    let total = 0;
    sales.forEach(s => {
      const paid = paidOn(s.id, payments);
      if (hasOutstanding(s.total_amount, paid)) {
        total += outstanding(s.total_amount, paid);
      }
    });

    return total;
  }, [shopId]) || 0;

  const productsResult = useLiveQuery(async () => {
    if (!shopId) return { products: [], velocityMap: {}, lowStockProducts: [] };
    const prods = await db.products
      .where('[shop_id+isDeleted]')
      .equals([shopId, 0])
      .toArray();

    const velocityMap = await getSales30DaysVelocityMap(shopId);
    const isExpiry = shop?.enable_expiry === true;
    const lowStock = prods.filter(p => {
      if (!isProductStockTracked(p, shop)) return false; // untracked products can't be "low on stock"
      return isLowStock(p, isExpiry, velocityMap);
    });

    return { products: prods, velocityMap, lowStockProducts: lowStock };
  }, [shopId, shop?.enable_expiry]) || { products: [], velocityMap: {}, lowStockProducts: [] };

  const products = productsResult.products;
  const velocityMap = productsResult.velocityMap;
  const lowStockProducts = productsResult.lowStockProducts;

  const expenses = useLiveQuery(async () => {
    if (!shopId) return [];
    const monthStartIso = new Date(startOfMonth(new Date())).toISOString();
    const queryResult = await db.expenses
      .where('[shop_id+isDeleted+date]')
      .between([shopId, 0, monthStartIso], [shopId, 0, '\uffff'])
      .toArray();
    return boss ? queryResult : queryResult.filter(e => e.user_id === user?.id);
  }, [shopId, boss, user?.id]) || [];
  const license = useLiveQuery(() => db.license.get(1));

  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const monthStart = startOfMonth(now).getTime();
  const sixMonthsAgo = subMonths(now, 6).getTime();
  const yearStart = startOfYear(now).getTime();

  const isExpiryEnabled = shop?.enable_expiry === true;
  const expiredBatchesCount = isExpiryEnabled ? products.reduce((count, p) => {
    return count + (p.batches?.filter(b => Number(b.stock) > 0 && isBatchExpired(b.expiry_date)).length || 0);
  }, 0) : 0;

  const expiringSoonBatchesCount = isExpiryEnabled ? products.reduce((count, p) => {
    return count + (p.batches?.filter(b => Number(b.stock) > 0 && isBatchExpiringSoon(b.expiry_date, shop?.notify_expiry_days ?? 30)).length || 0);
  }, 0) : 0;

  const todaySales = sales.filter(s => new Date(s.created_at).getTime() >= todayStart);
  const monthSales = sales.filter(s => new Date(s.created_at).getTime() >= monthStart);
  const sixMonthSales = sales.filter(s => new Date(s.created_at).getTime() >= sixMonthsAgo);
  const yearSales = sales.filter(s => new Date(s.created_at).getTime() >= yearStart);
  const monthExpenses = expenses.filter(e => new Date(e.date).getTime() >= monthStart);

  const calcTotal = (arr: any[]) => arr.reduce((sum, s) => sum + s.total_amount, 0);
  const calcProfit = (arr: any[]) => arr.reduce((sum, s) => sum + s.total_profit, 0);
  const totalMonthExpenses = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const monthNetProfit = calcProfit(monthSales) - totalMonthExpenses;

  const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
  const canManageStock = isBoss() || isFeatureEnabled('staff_product_management');

  // License calculation
  const daysRemaining = license ? Math.max(0, Math.ceil((license.expiryDate - Date.now()) / (24 * 60 * 60 * 1000))) : 0;

  // Chart data (last 7 days) — memoized so the chart isn't fed a new array
  // reference on every render (which would restart the Recharts animation).
  const chartData = useMemo(() => Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dayStart = startOfDay(d).getTime();
    const dayEnd = dayStart + 86400000;
    const daySales = sales.filter(s => {
      const saleTime = new Date(s.created_at).getTime();
      return saleTime >= dayStart && saleTime < dayEnd;
    });
    return {
      name: d.toLocaleDateString('sw-TZ', { weekday: 'short' }),
      Mapato: calcTotal(daySales),
    };
  }), [sales]);

  const [showLowStockModal, setShowLowStockModal] = useState(false);
  const [selectedProductForStock, setSelectedProductForStock] = useState<any>(null);
  const [stockToAdd, setStockToAdd] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [isSyncingLicense, setIsSyncingLicense] = useState(false);

  const handleLicenseSync = async () => {
    if (!navigator.onLine) {
      showToast('Hakuna mtandao (Offline)', 'error');
      return;
    }
    setIsSyncingLicense(true);
    try {
      LicenseService.clearStatusCache();
      await LicenseService.syncLicense(true);
      LicenseService.clearStatusCache();
      showToast('Leseni imesawazishwa kikamilifu', 'success');
      await SyncService.sync(true, 'critical');
    } catch (err: any) {
      showToast('Imeshindwa kusawazisha leseni', 'error');
    } finally {
      setIsSyncingLicense(false);
    }
  };

  const formatInputNumber = (val: string) => {
    const numeric = val.replace(/[^0-9]/g, '');
    return numeric;
  };

  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductForStock || !stockToAdd) return;

    const quantity = parseInt(stockToAdd);
    if (isNaN(quantity) || quantity <= 0) return;

    try {
      await db.transaction('rw', db.products, async () => {
        const currentProduct = await db.products.get(selectedProductForStock.id);
        if (!currentProduct) throw new Error('Bidhaa haikupatikana');

        if (isExpiryEnabled) {
          if (!expiryDate) {
            throw new Error('Tafadhali weka tarehe ya kuisha muda.');
          }
          const newBatch = {
            id: uuidv4(),
            batch_number: `B-${Date.now()}`,
            stock: quantity,
            expiry_date: new Date(expiryDate).toISOString(),
            created_at: nowIso()
          };
          const updatedBatches = [...(currentProduct.batches || []), newBatch];
          await db.products.update(currentProduct.id, {
            stock: currentProduct.stock + quantity,
            stock_delta: (currentProduct.stock_delta || 0) + quantity,
            batches: updatedBatches,
            updated_at: nowIso(),
            synced: 0
          });
        } else {
          await db.products.update(currentProduct.id, {
            stock: currentProduct.stock + quantity,
            stock_delta: (currentProduct.stock_delta || 0) + quantity,
            updated_at: nowIso(),
            synced: 0
          });
        }
      });

      setStockToAdd('');
      setExpiryDate('');
      setSelectedProductForStock(null);
      showToast('Stock imeongezwa!', 'success');
      SyncService.sync();
    } catch (error: any) {
      console.error('Error adding stock:', error);
      showToast(error.message || 'Kuna tatizo wakati wa kuongeza stock', 'error');
    }
  };

  return (
    <div className="p-4 space-y-6">
      <header className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{shop?.name || settings?.shopName || 'Venics Sales'}</h1>
          <div className="flex flex-col space-y-1 mt-1">
            {license ? (
              <>
                <button
                  type="button"
                  onClick={handleLicenseSync}
                  disabled={isSyncingLicense}
                  className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold w-fit transition-all duration-200 select-none cursor-pointer active:scale-95 disabled:opacity-75 ${
                    daysRemaining > 5 
                      ? 'bg-green-100 text-green-800 hover:bg-green-200 border border-green-200' 
                      : 'bg-orange-100 text-orange-800 hover:bg-orange-200 border border-orange-200'
                  }`}
                  title="Gusa hapa kuhakiki leseni sasa hivi"
                >
                  {isSyncingLicense ? (
                    <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                  ) : daysRemaining > 5 ? (
                    <ShieldCheck className="w-3 h-3 mr-1 text-green-600" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 mr-1 text-orange-600" />
                  )}
                  Siku {daysRemaining} zimebaki (Leseni)
                </button>
                {daysRemaining <= 5 && (
                  <a href="tel:0787979273" className="inline-flex mt-1 items-center px-3 py-1.5 rounded-full text-xs font-bold bg-green-500 text-white w-fit shadow-sm hover:bg-green-600 active:scale-95 transition-all">
                    <Phone className="w-3.5 h-3.5 mr-1.5" />
                    Bonyeza hapa kupiga simu kulipia
                  </a>
                )}
              </>
            ) : null}
            <div className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 w-fit">
              <Calendar className="w-3 h-3 mr-1" />
              {format(now, 'dd MMMM, yyyy')}
            </div>
          </div>
        </div>
        <div className="flex space-x-2">
          {isExpiryEnabled && (expiredBatchesCount > 0 || expiringSoonBatchesCount > 0) && (
            <div 
              onClick={() => navigate('/zaidi', { state: { openExpiryList: true } })}
              className="relative cursor-pointer"
            >
              <div className={`${expiredBatchesCount > 0 ? 'bg-red-100' : 'bg-orange-100'} p-2 rounded-full`}>
                <Clock className={`w-6 h-6 ${expiredBatchesCount > 0 ? 'text-red-600' : 'text-orange-600'}`} />
              </div>
              <span className={`absolute -top-1 -right-1 ${expiredBatchesCount > 0 ? 'bg-red-600' : 'bg-orange-600'} text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white`}>
                {expiredBatchesCount + expiringSoonBatchesCount}
              </span>
            </div>
          )}
          {lowStockProducts.length > 0 && (
            <div 
              onClick={() => setShowLowStockModal(true)}
              className="relative cursor-pointer"
            >
              <div className="bg-red-100 p-2 rounded-full">
                <Package className="w-6 h-6 text-red-600" />
              </div>
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white">
                {lowStockProducts.length}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
        {hasMapatoAccess && (
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white p-5 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center space-x-2 opacity-90 mb-1.5">
              <DollarSign className="w-4 h-4" />
              <span className="text-sm font-semibold tracking-wide">Mapato (Leo)</span>
            </div>
            <div className="text-2xl font-extrabold tracking-tight">{formatCurrency(calcTotal(todaySales), currency)}</div>
          </div>
        )}
        {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') ? (
          <div className="bg-gradient-to-br from-green-500 to-green-600 text-white p-5 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center space-x-2 opacity-90 mb-1.5">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-semibold tracking-wide">Faida (Leo)</span>
            </div>
            <div className="text-2xl font-extrabold tracking-tight">{formatCurrency(calcProfit(todaySales), currency)}</div>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white p-5 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center space-x-2 opacity-90 mb-1.5">
              <ShoppingCart className="w-4 h-4" />
              <span className="text-sm font-semibold tracking-wide">Mauzo (Leo)</span>
            </div>
            <div className="text-2xl font-extrabold tracking-tight">{todaySales.length} Mauzo</div>
          </div>
        )}
        <div className="bg-gradient-to-br from-red-500 to-red-600 text-white p-5 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center space-x-2 opacity-90 mb-1.5">
            <CreditCard className="w-4 h-4" />
            <span className="text-sm font-semibold tracking-wide">Madeni Kamili</span>
          </div>
          <div className="text-2xl font-extrabold tracking-tight">{formatCurrency(totalDebt, currency)}</div>
        </div>
      </div>

      {/* Main Desktop Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Side (2 Columns in lg) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Monthly Stats Card */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-bold text-gray-900 tracking-tight">Muhtasari wa Mwezi Huu</h2>
              {!historiaBlocked && (
                <button 
                  onClick={() => navigate('/historia')}
                  className="text-xs font-bold text-blue-600 flex items-center bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors"
                >
                  Tazama Historia <ChevronRight className="w-4 h-4 ml-0.5" />
                </button>
              )}
            </div>
            
            <div className={`grid ${hasMapatoAccess ? 'grid-cols-2' : 'grid-cols-1'} gap-6`}>
              {hasMapatoAccess ? (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">Mapato ya Jumla</p>
                  <p className="text-xl font-extrabold text-gray-900">{formatCurrency(calcTotal(monthSales), currency)}</p>
                </div>
              ) : (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">Mauzo Mwezi Huu</p>
                  <p className="text-xl font-extrabold text-purple-600">{monthSales.length}</p>
                </div>
              )}
              {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">Faida ya Jumla</p>
                  <p className="text-xl font-extrabold text-green-600">{formatCurrency(calcProfit(monthSales), currency)}</p>
                </div>
              )}
              {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
                <div className="col-span-2 pt-4 border-t border-gray-100 flex justify-between items-center gap-4">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase font-extrabold tracking-wider">Faida Halisi baada ya matumizi</p>
                    <p className={`text-2xl font-black ${monthNetProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      {formatCurrency(monthNetProfit, currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 uppercase font-extrabold tracking-wider">Jumla Matumizi</p>
                    <p className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 px-2.5 py-1 rounded-lg mt-0.5 inline-block">{formatCurrency(totalMonthExpenses, currency)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Chart Card */}
          {hasMapatoAccess && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 mb-5 tracking-tight">Kielelezo cha Mapato (Siku 7 Zilizopita)</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip 
                      formatter={(value: number) => formatCurrency(value, currency)}
                      cursor={{fill: '#f3f4f6'}}
                    />
                    <Bar dataKey="Mapato" fill="#3b82f6" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Right Side (1 Column in lg) */}
        <div className="space-y-6">
          {/* Quick Actions Buttons */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">Njia za Mkato</h3>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => {
                  if (!boss && !isFeatureEnabled('staff_expense_management')) {
                    showToast('Hauna ruhusa ya kuona/kuongeza matumizi.', 'error');
                  } else {
                    navigate('/matumizi');
                  }
                }}
                className={`flex items-center justify-center py-3 bg-white border border-gray-200 rounded-xl shadow-sm text-xs font-bold transition-all ${
                  !boss && !isFeatureEnabled('staff_expense_management') 
                    ? 'opacity-50 text-gray-400 cursor-not-allowed' 
                    : 'text-gray-700 hover:border-red-200 active:scale-95'
                }`}
              >
                <DollarSign className={`w-4 h-4 mr-1.5 ${!boss && !isFeatureEnabled('staff_expense_management') ? 'text-gray-400' : 'text-red-500'}`} />
                <span>Matumizi</span>
              </button>
              {!historiaBlocked && (
                <button 
                  onClick={() => navigate('/historia')}
                  className="flex items-center justify-center py-3 bg-white border border-gray-200 rounded-xl shadow-sm text-xs font-bold text-gray-700 hover:border-blue-200 active:scale-95 transition-all"
                >
                  <Clock className="w-4 h-4 mr-1.5 text-blue-500" />
                  <span>Historia</span>
                </button>
              )}
            </div>
          </div>

          {/* Product and Batch Stock Card */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-800">Hali ya Bidhaa na Stock</h2>
              <Package className="text-gray-400 w-5 h-5" />
            </div>
            
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-sm text-gray-600 font-medium">Jumla Bidhaa Zilizohesabiwa</span>
              <span className="font-extrabold text-gray-900 text-base">{totalStock}</span>
            </div>
            
            <div className="space-y-3 mt-4">
              {lowStockProducts.length > 0 && (
                <div 
                  onClick={() => setShowLowStockModal(true)}
                  className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-start space-x-3 cursor-pointer hover:bg-red-100 transition-colors"
                >
                  <AlertTriangle className="text-red-500 w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-red-800 uppercase tracking-wide">Stock Inapungua</p>
                    <p className="text-xs text-red-600 mt-0.5">
                      Kuna bidhaa {lowStockProducts.length} zinakaribia kuisha kabisa.
                    </p>
                  </div>
                </div>
              )}

              {isExpiryEnabled && expiredBatchesCount > 0 && (
                <div 
                  onClick={() => navigate('/zaidi', { state: { openExpiryList: true } })}
                  className="p-3 bg-red-100 rounded-xl border border-red-200 flex items-start space-x-3 cursor-pointer hover:bg-red-200 transition-colors"
                >
                  <Clock className="text-red-600 w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-red-900 uppercase tracking-wide">Zimekwisha Muda (Expired)</p>
                    <p className="text-xs text-red-700 mt-0.5">
                      Batches {expiredBatchesCount} zimefikia kikomo cha muda.
                    </p>
                  </div>
                </div>
              )}

              {isExpiryEnabled && expiringSoonBatchesCount > 0 && (
                <div 
                  onClick={() => navigate('/zaidi', { state: { openExpiryList: true } })}
                  className="p-3 bg-orange-50 rounded-xl border border-orange-100 flex items-start space-x-3 cursor-pointer hover:bg-orange-100 transition-colors"
                >
                  <Clock className="text-orange-500 w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-orange-800 uppercase tracking-wide">Zinaisha Hivi Karibuni</p>
                    <p className="text-xs text-orange-600 mt-0.5">
                      Batches {expiringSoonBatchesCount} zinaisha muda ndani ya siku {shop?.notify_expiry_days ?? 30}.
                    </p>
                  </div>
                </div>
              )}
              
              {lowStockProducts.length === 0 && (!isExpiryEnabled || (expiredBatchesCount === 0 && expiringSoonBatchesCount === 0)) && (
                <div className="p-4 bg-green-50 rounded-xl border border-green-100 text-center">
                  <p className="text-xs font-bold text-green-700">Afya ya Duka: Safi Kabisa! 🎉</p>
                  <p className="text-[11px] text-green-600 mt-0.5">Hakuna tahadhari za stock ola expiry hivi sasa.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Low Stock Modal */}
      {showLowStockModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-red-600">
                <AlertTriangle className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Bidhaa Zinazoisha</h2>
              </div>
              <button onClick={() => { setShowLowStockModal(false); setSelectedProductForStock(null); }} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {lowStockProducts.length > 0 ? (
                lowStockProducts.map((product) => {
                  const qtySold30 = velocityMap[product.id] || 0;
                  const dailySpeed = (qtySold30 / 30).toFixed(1);
                  const dynThreshold = getDynamicThreshold(product.id, product.min_stock, velocityMap);

                  return (
                    <div key={product.id} className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-bold text-gray-800 text-lg">{product.name}</p>
                          {/* The alert itself still reaches staff — they need to
                              know what is running out — but every figure behind
                              it is withheld: the count, the reorder threshold and
                              the sales trend below. */}
                          {!hideStock && (
                            <div className="flex flex-wrap gap-2 mt-1.5">
                              <span className="text-xs bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">
                                Stoki Iliyopo: {product.stock} {product.unit || 'pcs'}
                              </span>
                              <span className="text-xs bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full flex items-center">
                                📊 Kikomo cha Mauzo (Siku 7): {dynThreshold} {product.unit || 'pcs'}
                              </span>
                            </div>
                          )}
                          
                          {!hideStock && qtySold30 > 0 && (
                            <p className="text-xs text-slate-500 mt-2 font-medium">
                              Mwenendo: Siku 30 zilizopita uliuza <strong className="text-slate-700">{qtySold30}</strong> (wastani wa <strong className="text-slate-700">{dailySpeed}/siku</strong>)
                            </p>
                          )}
                        </div>
                        {canManageStock && (
                          <button 
                            onClick={() => setSelectedProductForStock(selectedProductForStock?.id === product.id ? null : product)}
                            className={`p-2 rounded-xl transition-colors ${selectedProductForStock?.id === product.id ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}
                          >
                            {selectedProductForStock?.id === product.id ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                          </button>
                        )}
                      </div>

                      {selectedProductForStock?.id === product.id && (
                        <form onSubmit={handleAddStock} className="mt-4 pt-4 border-t border-gray-200 space-y-4 animate-in fade-in slide-in-from-top-2">
                          <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Idadi ya Kuongeza</label>
                            <input 
                              autoFocus
                              required
                              type="text"
                              inputMode="numeric"
                              placeholder="Mfano: 10"
                              value={stockToAdd}
                              onChange={e => setStockToAdd(formatInputNumber(e.target.value))}
                              className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                            />
                          </div>

                          {isExpiryEnabled && (
                            <div>
                              <label className="block text-xs font-bold text-gray-400 uppercase mb-1 flex items-center">
                                <Calendar className="w-3 h-3 mr-1" /> Tarehe ya Kuisha (Expiry)
                              </label>
                              <ExpiryDatePicker value={expiryDate} onChange={setExpiryDate} allowClear={false} />
                            </div>
                          )}

                          <button 
                            type="submit"
                            className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-100"
                          >
                            Hifadhi Stock Mpya
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ShieldCheck className="w-8 h-8 text-green-600" />
                  </div>
                  <p className="text-gray-500 font-medium">Bidhaa zote zina stock ya kutosha!</p>
                </div>
              )}
            </div>
            
            <button 
              onClick={() => { setShowLowStockModal(false); setSelectedProductForStock(null); }}
              className="w-full mt-6 py-4 bg-gray-100 text-gray-600 font-bold rounded-2xl"
            >
              Funga
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
