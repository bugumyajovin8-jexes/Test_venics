import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency, formatInputNumber, parseInputNumber } from '../utils/format';
import { format, startOfDay, startOfMonth, startOfYear, subMonths, isBefore, isAfter, addDays } from 'date-fns';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, AlertCircle, TrendingUp, DollarSign, Package, ShieldCheck, CreditCard, ChevronRight, Calendar, Clock, X, Plus, Trash2, ShoppingCart, Phone, RefreshCw, Check } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SyncService } from '../services/sync';
import { LicenseService } from '../services/license';
import { v4 as uuidv4 } from 'uuid';
import { getValidStock, getSales30DaysVelocityMap, getDynamicThreshold } from '../utils/stock';
import VenicsLogo from '../components/VenicsLogo';

export default function Dashibodi() {
  const { user, showAlert, showToast, isBoss, isFeatureEnabled } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const boss = isBoss();

  useEffect(() => {
    if (location.state && (location.state as any).openLowStock) {
      setShowLowStockModal(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);
  const hasMapatoAccess = boss || isFeatureEnabled('show_mapato_to_staff');

  const settings = useLiveQuery(() => db.settings.get(1));
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const currency = settings?.currency || 'TZS';

  const sales = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const minDateIso = new Date(Math.min(subMonths(new Date(), 6).getTime(), startOfYear(new Date()).getTime())).toISOString();
    const queryResult = await db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, minDateIso], [user.shopId, 0, '\uffff'])
      .toArray();
    return boss ? queryResult : queryResult.filter(s => s.user_id === user?.id);  
  }, [user?.shopId, boss, user?.id]) || [];

  const totalDebt = useLiveQuery(async () => {
    if (!user?.shopId) return 0;
    
    // Get all pending credit sales
    const sales = await db.sales
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .filter(s => s.payment_method === 'credit' && s.status !== 'completed')
      .toArray();
    
    if (sales.length === 0) return 0;
    
    // Get all payments for these sales
    const saleIds = sales.map(s => s.id);
    const payments = await db.debtPayments
      .where('sale_id')
      .anyOf(saleIds)
      .toArray();
      
    let total = 0;
    sales.forEach(s => {
      const salePayments = payments.filter(p => p.sale_id === s.id && p.isDeleted === 0);
      const paidAmount = salePayments.reduce((sum, p) => sum + p.amount, 0);
      const remaining = s.total_amount - paidAmount;
      if (remaining > 0) {
        total += remaining;
      }
    });
    
    return total;
  }, [user?.shopId]) || 0;

  const products = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    return db.products
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .toArray();
  }, [user?.shopId]) || [];

  const expenses = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const monthStartIso = new Date(startOfMonth(new Date())).toISOString();
    const queryResult = await db.expenses
      .where('[shop_id+isDeleted+date]')
      .between([user.shopId, 0, monthStartIso], [user.shopId, 0, '\uffff'])
      .toArray();
    return boss ? queryResult : queryResult.filter(e => e.user_id === user?.id);  
  }, [user?.shopId, boss, user?.id]) || [];
  const license = useLiveQuery(() => db.license.get(1));

  const velocityMap = useLiveQuery(async () => {
    if (!user?.shopId) return {};
    return getSales30DaysVelocityMap(user.shopId);
  }, [user?.shopId]) || {};

  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const monthStart = startOfMonth(now).getTime();
  const sixMonthsAgo = subMonths(now, 6).getTime();
  const yearStart = startOfYear(now).getTime();

  const isExpiryEnabled = shop?.enable_expiry === true;
  const expiredBatchesCount = isExpiryEnabled ? products.reduce((count, p) => {
    return count + (p.batches?.filter(b => isBefore(new Date(b.expiry_date), now)).length || 0);
  }, 0) : 0;

  const expiringSoonBatchesCount = isExpiryEnabled ? products.reduce((count, p) => {
    return count + (p.batches?.filter(b => {
      const expiry = new Date(b.expiry_date);
      return isAfter(expiry, now) && isBefore(expiry, addDays(now, 30));
    }).length || 0);
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
  const lowStockProducts = products.filter(p => {
    const validStock = getValidStock(p, isExpiryEnabled);
    const threshold = getDynamicThreshold(p.id, p.min_stock, velocityMap);
    return validStock <= threshold;
  });

  // License calculation
  const daysRemaining = license ? Math.max(0, Math.ceil((license.expiryDate - Date.now()) / (24 * 60 * 60 * 1000))) : 0;

  // Chart data (last 7 days)
  const chartData = Array.from({ length: 7 }).map((_, i) => {
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
  });

  const [showLowStockModal, setShowLowStockModal] = useState(false);
  const [selectedProductForStock, setSelectedProductForStock] = useState<any>(null);
  const [stockToAdd, setStockToAdd] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [isSyncingLicense, setIsSyncingLicense] = useState(false);

  const pricingLossProducts = useMemo(() => {
    return products.filter(p => p.pricing_verified !== 1 && p.buy_price > 0 && p.sell_price <= p.buy_price);
  }, [products]);

  const pricingImplausibleProducts = useMemo(() => {
    return products.filter(p => {
      if (p.pricing_verified === 1) return false;
      if (p.buy_price <= 0) return false;
      const ratio = p.sell_price / p.buy_price;
      return ratio > 5 || ratio < 1;
    });
  }, [products]);

  const [showLossModal, setShowLossModal] = useState(false);
  const [showImplausibleModal, setShowImplausibleModal] = useState(false);

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
      showToast('Njia ya Mfumo imesawazishwa kikamilifu', 'success');
      await SyncService.sync(true, 'critical');
    } catch (err: any) {
      showToast('Imeshindwa kusawazisha taarifa za Mfumo', 'error');
    } finally {
      setIsSyncingLicense(false);
    }
  };

  const handleVerifyProductPricing = async (productId: string) => {
    try {
      await db.products.update(productId, { pricing_verified: 1, synced: 0 });
      SyncService.sync();
      showToast('Bei ya bidhaa imethibitishwa kuwa ipo sahihi!', 'success');
    } catch (err) {
      console.error('Failed to verify product pricing in Dashibodi:', err);
    }
  };

  const handleVerifyAllProductPricing = async () => {
    try {
      const productsToVerify = [
        ...pricingLossProducts,
        ...pricingImplausibleProducts
      ];
      
      if (productsToVerify.length === 0) return;

      const uniqueIds = Array.from(new Set(productsToVerify.map(p => p.id)));

      await db.transaction('rw', [db.products], async () => {
        for (const id of uniqueIds) {
          await db.products.update(id, { pricing_verified: 1, synced: 0 });
        }
      });
      SyncService.sync();
      showToast('Bei za bidhaa zote zimethibitishwa kuwa zipo sahihi!', 'success');
      setShowLossModal(false);
      setShowImplausibleModal(false);
    } catch (err) {
      console.error('Failed to verify all product pricing in Dashibodi:', err);
    }
  };



  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductForStock || !stockToAdd) return;

    const quantity = parseInputNumber(stockToAdd);
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
            created_at: new Date().toISOString()
          };
          const updatedBatches = [...(currentProduct.batches || []), newBatch];
          await db.products.update(currentProduct.id, {
            stock: currentProduct.stock + quantity,
            stock_delta: (currentProduct.stock_delta || 0) + quantity,
            batches: updatedBatches,
            updated_at: new Date().toISOString(),
            synced: 0
          });
        } else {
          await db.products.update(currentProduct.id, {
            stock: currentProduct.stock + quantity,
            stock_delta: (currentProduct.stock_delta || 0) + quantity,
            updated_at: new Date().toISOString(),
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
      <header className="flex justify-between items-start mb-6 w-full">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2.5 tracking-tight">
            <VenicsLogo size={32} animate="loading" outerGradient={['#1e3a8a', '#06b6d4']} innerGradient={['#10b981', '#3b82f6']} className="shrink-0" />
            <span>{settings?.shopName || 'Venics Sales'}</span>
          </h1>
          <div className="flex flex-col space-y-1 mt-1">
            {license ? (
              <>
                <div
                  role="button"
                  onClick={(e) => { e.preventDefault(); handleLicenseSync(); }}
                  className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium w-fit cursor-pointer  transition-opacity active:scale-[0.98] select-none ${daysRemaining > 5 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}
                  style={{ touchAction: 'manipulation' }}
                >
                  {isSyncingLicense ? (
                    <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                  ) : daysRemaining > 5 ? (
                    <ShieldCheck className="w-3 h-3 mr-1" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 mr-1" />
                  )}
                  Siku {daysRemaining} zimebaki.
                </div>
                {daysRemaining <= 5 && (
                  <a 
                    href="tel:0787979273" 
                    className="inline-flex mt-1 items-center px-3 py-1.5 rounded-full text-xs font-bold bg-green-500 text-white w-fit shadow-sm transition-all select-none touch-manipulation cursor-pointer active:scale-95"
                    style={{ 
                      WebkitTapHighlightColor: 'transparent',
                      WebkitTouchCallout: 'none',
                      touchAction: 'manipulation'
                    }}
                  >
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
              role="button"
              onClick={(e) => { e.preventDefault(); navigate('/zaidi', { state: { openExpiryList: true } }); }}
              className="relative cursor-pointer"
              style={{ touchAction: 'manipulation' }}
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
              role="button"
              onClick={(e) => { e.preventDefault(); setShowLowStockModal(true); }}
              className="relative cursor-pointer"
              style={{ touchAction: 'manipulation' }}
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

      {/* Quick Stats - Flexible wrap to prevent overlapping under screen magnification */}
      <div className="flex flex-wrap gap-3">
        {hasMapatoAccess && (
          <div className="bg-blue-500 text-white p-4 rounded-2xl shadow-sm flex-1 min-w-[140px]">
            <div className="flex items-center space-x-2 opacity-80 mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-sm font-medium">Mapato (Leo)</span>
            </div>
            <div className="text-lg font-bold break-all">{formatCurrency(calcTotal(todaySales), currency)}</div>
          </div>
        )}
        {(user?.role === 'admin' || user?.role === 'boss') ? (
          <div className="bg-green-500 text-white p-4 rounded-2xl shadow-sm flex-1 min-w-[140px]">
            <div className="flex items-center space-x-2 opacity-80 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">Faida (Leo)</span>
            </div>
            <div className="text-lg font-bold break-all">{formatCurrency(calcProfit(todaySales), currency)}</div>
          </div>
        ) : (
          <div className="bg-purple-500 text-white p-4 rounded-2xl shadow-sm flex-1 min-w-[140px]">
            <div className="flex items-center space-x-2 opacity-80 mb-1">
              <ShoppingCart className="w-4 h-4" />
              <span className="text-sm font-medium">Mauzo (Leo)</span>
            </div>
            <div className="text-lg font-bold break-all">{todaySales.length} Mauzo</div>
          </div>
        )}
      </div>

      {/* Debt Summary */}
      <div className="bg-red-500 text-white p-4 rounded-2xl shadow-sm">
        <div className="flex items-center space-x-2 opacity-80 mb-1">
          <CreditCard className="w-4 h-4" />
          <span className="text-sm font-medium">Madeni</span>
        </div>
        <div className="text-xl font-bold">{formatCurrency(totalDebt, currency)}</div>
      </div>

      {/* Quick Access Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button 
          onClick={(e) => {
            e.preventDefault();
            if (!boss && !isFeatureEnabled('staff_expense_management')) {
              showToast('Hauna ruhusa ya kuona/kuongeza matumizi.', 'error');
            } else {
              navigate('/matumizi');
            }
          }}
          className={`flex items-center justify-center py-3.5 bg-white border border-gray-200 rounded-xl shadow-sm text-xs font-bold transition-all cursor-pointer select-none touch-manipulation ${
            !boss && !isFeatureEnabled('staff_expense_management') 
              ? 'opacity-50 text-gray-400 cursor-not-allowed' 
              : 'text-gray-700 active:bg-gray-50'
          }`}
          style={{ 
            WebkitTapHighlightColor: 'transparent',
            WebkitTouchCallout: 'none',
            touchAction: 'manipulation'
          }}
        >
          <DollarSign className={`w-4 h-4 mr-1.5 ${!boss && !isFeatureEnabled('staff_expense_management') ? 'text-gray-400' : 'text-red-500'}`} />
          {!boss && !isFeatureEnabled('staff_expense_management') ? 'Matumizi (Zuiwa)' : 'Matumizi'}
        </button>
        <button 
          onClick={(e) => { e.preventDefault(); navigate('/historia'); }}
          className="flex items-center justify-center py-3.5 bg-white border border-gray-200 rounded-xl shadow-sm text-xs font-bold text-gray-700 active:bg-gray-50 transition-all cursor-pointer select-none touch-manipulation"
          style={{ 
            WebkitTapHighlightColor: 'transparent',
            WebkitTouchCallout: 'none',
            touchAction: 'manipulation'
          }}
        >
          <Clock className="w-4 h-4 mr-1.5 text-blue-500" />
          Historia
        </button>
      </div>

      {/* Monthly Stats */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Muhtasari wa Mwezi</h2>
          <button 
            onClick={(e) => { e.preventDefault(); navigate('/historia'); }}
            className="text-sm font-medium text-blue-600 flex items-center bg-blue-50 px-3 py-1 rounded-full"
          >
            Historia <ChevronRight className="w-4 h-4 ml-1" />
          </button>
        </div>
        <div className="flex flex-wrap gap-4">
          {hasMapatoAccess ? (
            <div className="flex-1 min-w-[120px]">
              <p className="text-sm text-gray-500">Mapato</p>
              <p className="text-lg font-bold text-gray-900 break-all">{formatCurrency(calcTotal(monthSales), currency)}</p>
            </div>
          ) : (
            <div className="flex-1 min-w-[120px]">
              <p className="text-sm text-gray-500">Mauzo Mwezi Huu</p>
              <p className="text-lg font-bold text-purple-600 break-all">{monthSales.length}</p>
            </div>
          )}
          {(user?.role === 'admin' || user?.role === 'boss') && (
            <div className="flex-1 min-w-[120px]">
              <p className="text-sm text-gray-500">Faida</p>
              <p className="text-lg font-bold text-green-600 break-all">{formatCurrency(calcProfit(monthSales), currency)}</p>
            </div>
          )}
          {(user?.role === 'admin' || user?.role === 'boss') && (
            <div className="w-full pt-3 border-t border-gray-50 flex justify-between items-center flex-wrap gap-2">
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Faida Halisi</p>
                <p className={`text-xl font-bold break-all ${monthNetProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {formatCurrency(monthNetProfit, currency)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-400 uppercase">Matumizi</p>
                <p className="text-xs font-bold text-gray-600 break-all">{formatCurrency(totalMonthExpenses, currency)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      {hasMapatoAccess && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Mapato (Siku 7 Zilizopita)</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  formatter={(value: number) => formatCurrency(value, currency)}
                  cursor={{fill: '#f3f4f6'}}
                />
                <Bar dataKey="Mapato" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Inventory Summary */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Hali ya Stock</h2>
          <Package className="text-gray-400 w-5 h-5" />
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-600">Jumla ya Bidhaa:</span>
          <span className="font-bold text-gray-900">{totalStock}</span>
        </div>
        
        <div className="space-y-3 mt-4">
          {pricingLossProducts.length > 0 && (
            <div
              role="button"
              onClick={(e) => { e.preventDefault(); setShowLossModal(true); }}
              className="p-3 bg-red-100 rounded-xl border border-red-200 flex items-start space-x-3 cursor-pointer transition-colors"
              style={{ touchAction: 'manipulation' }}
            >
              <AlertCircle className="text-red-600 w-5 h-5 shrink-0 mt-0.5 animate-pulse" />
              <div>
                <p className="text-sm font-bold text-red-900">Hasara Inayoweza Kuepukika</p>
                <p className="text-xs text-red-700 mt-1">
                  Kuna bidhaa {pricingLossProducts.length} zinazouzwa kwa hasara au kosa la bei! Gusa kuona.
                </p>
              </div>
            </div>
          )}

          {pricingImplausibleProducts.length > 0 && (
            <div
              role="button"
              onClick={(e) => { e.preventDefault(); setShowImplausibleModal(true); }}
              className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start space-x-3 cursor-pointer transition-colors"
              style={{ touchAction: 'manipulation' }}
            >
              <AlertCircle className="text-amber-600 w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-900">Uhakiki wa Bei (Uwiano usio wa kawaida)</p>
                <p className="text-xs text-amber-700 mt-1">
                  Kuna bidhaa {pricingImplausibleProducts.length} zenye bei zisizoeleweka (ratio zaidi ya 5x au chini ya 1x).
                </p>
              </div>
            </div>
          )}

          {lowStockProducts.length > 0 && (
            <div
              role="button"
              onClick={(e) => { e.preventDefault(); setShowLowStockModal(true); }}
              className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-start space-x-3 cursor-pointer transition-colors"
              style={{ touchAction: 'manipulation' }}
            >
              <AlertTriangle className="text-red-500 w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Tahadhari ya Bidhaa</p>
                <p className="text-xs text-red-600 mt-1">
                  Kuna bidhaa {lowStockProducts.length} zinakaribia kuisha.
                </p>
              </div>
            </div>
          )}

          {isExpiryEnabled && expiredBatchesCount > 0 && (
            <div
              role="button"
              onClick={(e) => { e.preventDefault(); navigate('/zaidi', { state: { openExpiryList: true } }); }}
              className="p-3 bg-red-100 rounded-xl border border-red-200 flex items-start space-x-3 cursor-pointer transition-colors"
              style={{ touchAction: 'manipulation' }}
            >
              <Clock className="text-red-600 w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-900">Zimekwisha Muda (Expired)</p>
                <p className="text-xs text-red-700 mt-1">
                  Kuna batches {expiredBatchesCount} zimekwisha muda.
                </p>
              </div>
            </div>
          )}

          {isExpiryEnabled && expiringSoonBatchesCount > 0 && (
            <div
              role="button"
              onClick={(e) => { e.preventDefault(); navigate('/zaidi', { state: { openExpiryList: true } }); }}
              className="p-3 bg-orange-50 rounded-xl border border-orange-100 flex items-start space-x-3 cursor-pointer transition-colors"
              style={{ touchAction: 'manipulation' }}
            >
              <Clock className="text-orange-500 w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-orange-800">Zinakaribia Kuisha Muda</p>
                <p className="text-xs text-orange-600 mt-1">
                  Kuna batches {expiringSoonBatchesCount} zitakwisha muda ndani ya siku 30.
                </p>
              </div>
            </div>
          )}
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
                lowStockProducts.map((product) => (
                  <div key={product.id} className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-bold text-gray-800 text-lg">{product.name}</p>
                        <p className="text-sm text-red-600 font-medium">
                          Stoki: {getValidStock(product, isExpiryEnabled)}
                        </p>
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
                            <input 
                              type="date"
                              required
                              value={expiryDate}
                              onChange={e => setExpiryDate(e.target.value)}
                              className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        )}

                        <button 
                          type="submit"
                          className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-100 cursor-pointer touch-manipulation select-none transition-all"
                          style={{ 
                            WebkitTapHighlightColor: 'transparent',
                            WebkitTouchCallout: 'none',
                            touchAction: 'manipulation'
                          }}>
                          Hifadhi Stock Mpya
                        </button>
                      </form>
                    )}
                  </div>
                ))
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
      {/* Loss Products Modal */}
      {showLossModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-red-600">
                <AlertCircle className="w-6 h-6 mr-2 flex-shrink-0" />
                <h2 className="text-xl font-bold">Hasara Inayoweza Kuepukika</h2>
              </div>
              <button onClick={() => setShowLossModal(false)} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {pricingLossProducts.map((product) => (
                <div key={product.id} className="p-4 bg-red-50/50 border border-red-100 rounded-2xl">
                  <p className="font-bold text-gray-800 text-lg mb-2">{product.name}</p>
                  <p className="text-sm text-red-850 font-medium">
                    Inauzwa kwa <span className="font-extrabold text-red-750">TZS {product.sell_price.toLocaleString()}</span> wakati ilinunuliwa kwa <span className="font-extrabold text-gray-700">TZS {product.buy_price.toLocaleString()}</span>.
                  </p>
                  <div className="flex justify-between items-end mt-2 pt-2 border-t border-red-100 gap-3">
                    <p className="text-xs text-red-600 font-semibold">
                      Kila mauzo yataleta hasara ya TZS {(product.buy_price - product.sell_price).toLocaleString()}.
                    </p>
                    <button
                      onClick={() => handleVerifyProductPricing(product.id)}
                      className="bg-red-200 text-red-900 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-red-300 transition-all flex items-center gap-1 cursor-pointer shrink-0 select-none touch-manipulation"
                      style={{ 
                        WebkitTapHighlightColor: 'transparent',
                        WebkitTouchCallout: 'none',
                        touchAction: 'manipulation'
                      }}
                    >
                      <Check className="w-3.5 h-3.5" /> Bei ipo Sawa
                    </button>
                  </div>
                </div>
              ))}
              {pricingLossProducts.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">Inapendeza! Hakuna bidhaa kwenye orodha hii.</p>
              )}
            </div>
            
            <div className="flex space-x-3 mt-6">
              <button 
                onClick={() => setShowLossModal(false)}
                className="flex-1 py-4 bg-gray-200 text-gray-800 font-bold rounded-2xl cursor-pointer hover:bg-gray-300 transition-all select-none touch-manipulation"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                Funga
              </button>
              {pricingLossProducts.length > 0 && (
                <button 
                  onClick={handleVerifyAllProductPricing}
                  className="flex-1 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl cursor-pointer transition-all flex items-center justify-center gap-1.5 select-none touch-manipulation"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}
                >
                  <Check className="w-4 h-4" /> Zote zipo Sawa
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Implausible Products Modal */}
      {showImplausibleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-amber-600">
                <AlertCircle className="w-6 h-6 mr-2 flex-shrink-0" />
                <h2 className="text-xl font-bold text-amber-700">Uhakiki wa Bei (Uwiano)</h2>
              </div>
              <button onClick={() => setShowImplausibleModal(false)} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {pricingImplausibleProducts.map((product) => {
                const ratio = product.sell_price / product.buy_price;
                return (
                  <div key={product.id} className="p-4 bg-amber-50/50 border border-amber-100 rounded-2xl">
                    <p className="font-bold text-gray-800 text-lg mb-2">{product.name}</p>
                    <p className="text-sm text-amber-900 font-medium">
                      Inanunuliwa kwa <span className="font-bold text-gray-700">TZS {product.buy_price.toLocaleString()}</span> na kuuzwa kwa <span className="font-bold text-gray-900">TZS {product.sell_price.toLocaleString()}</span>.
                    </p>
                    <div className="flex justify-between items-end mt-2 pt-2 border-t border-amber-100 gap-3">
                      <p className="text-xs text-amber-700 font-semibold">
                        Uwiano wa bei hii ni tofauti (zaidi ya mara {Math.round(ratio)} ya kununulia). Tafadhali hakikisha kama si hitilafu ya kiuandishi.
                      </p>
                      <button
                        onClick={() => handleVerifyProductPricing(product.id)}
                        className="bg-amber-200 text-amber-905 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-amber-300 transition-all flex items-center gap-1 cursor-pointer shrink-0 select-none touch-manipulation"
                        style={{ 
                          WebkitTapHighlightColor: 'transparent',
                          WebkitTouchCallout: 'none',
                          touchAction: 'manipulation'
                        }}
                      >
                        <Check className="w-3.5 h-3.5" /> Bei ipo Sawa
                      </button>
                    </div>
                  </div>
                );
              })}
              {pricingImplausibleProducts.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">Inapendeza! Hakuna bidhaa kwenye orodha hii.</p>
              )}
            </div>
            
            <div className="flex space-x-3 mt-6">
              <button 
                onClick={() => setShowImplausibleModal(false)}
                className="flex-1 py-4 bg-gray-200 text-gray-800 font-bold rounded-2xl cursor-pointer hover:bg-gray-300 transition-all select-none touch-manipulation"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                Funga
              </button>
              {pricingImplausibleProducts.length > 0 && (
                <button 
                  onClick={handleVerifyAllProductPricing}
                  className="flex-1 py-4 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-2xl cursor-pointer transition-all flex items-center justify-center gap-1.5 select-none touch-manipulation"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}
                >
                  <Check className="w-4 h-4" /> Zote zipo Sawa
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
