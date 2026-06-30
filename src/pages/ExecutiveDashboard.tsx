import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { format, subDays, startOfDay, endOfDay, isWithinInterval, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { AlertCircle, Zap, TrendingUp, TrendingDown, Star, Users, AlertTriangle, Lightbulb, ArrowLeft, Smartphone, Wallet, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { SyncService } from '../services/sync';

import EmployeeReports from '../components/EmployeeReports';
import MshauriChat from '../components/MshauriChat';

function PaymentBreakdownWidget({ shopId }: { shopId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [period, setPeriod] = useState<'today' | 'yesterday' | 'this_month' | 'last_month'>('today');

  const paymentData = useLiveQuery(async () => {
    if (!shopId) return { cash: 0, mobile: 0 };
    
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
    
    // Using a faster index based approach to just grab sales for the period
    const sales = await db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([shopId, 0, startIso], [shopId, 0, endIso])
      .toArray();

    let cash = 0;
    let mobile = 0;
    
    sales.forEach(s => {
      // Exclude cancelled/refunded if they are not considered valid revenue
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

  return (
    <div className="space-y-4">
      <button 
        onClick={(e) => { e.preventDefault(); setIsOpen(!isOpen); }}
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
            <button
              onClick={(e) => { e.preventDefault(); setPeriod('today'); }}
              className={`flex-shrink-0 px-4 py-2 text-xs font-bold rounded-full transition-all cursor-pointer touch-manipulation select-none active:scale-95 ${
                period === 'today' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Leo
            </button>
            <button
              onClick={(e) => { e.preventDefault(); setPeriod('yesterday'); }}
              className={`flex-shrink-0 px-4 py-2 text-xs font-bold rounded-full transition-all cursor-pointer touch-manipulation select-none active:scale-95 ${
                period === 'yesterday' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Jana
            </button>
            <button
              onClick={(e) => { e.preventDefault(); setPeriod('this_month'); }}
              className={`flex-shrink-0 px-4 py-2 text-xs font-bold rounded-full transition-all cursor-pointer touch-manipulation select-none active:scale-95 ${
                period === 'this_month' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Mwezi Huu
            </button>
            <button
              onClick={(e) => { e.preventDefault(); setPeriod('last_month'); }}
              className={`flex-shrink-0 px-4 py-2 text-xs font-bold rounded-full transition-all cursor-pointer touch-manipulation select-none active:scale-95 ${
                period === 'last_month' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Mwezi Uliopita
            </button>
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

export default function ExecutiveDashboard() {
  const { user } = useStore();
  const navigate = useNavigate();
  const [showEmployeeReports, setShowEmployeeReports] = useState(false);

  const handleVerifyProductPricing = async (productId: string) => {
    try {
      await db.products.update(productId, { pricing_verified: 1, synced: 0 });
      SyncService.sync();
    } catch (err) {
      console.error('Failed to verify product price in ExecutiveDashboard:', err);
    }
  };

  const handleVerifyAllProductPricing = async () => {
    try {
      if (!user?.shopId) return;
      const productsToVerify = products.filter(p => {
        if (p.pricing_verified === 1) return false;
        if (p.buy_price > 0) {
          if (p.sell_price <= p.buy_price) return true;
          const ratio = p.sell_price / p.buy_price;
          if (ratio > 5) return true;
        }
        return false;
      });
      
      if (productsToVerify.length === 0) return;

      await db.transaction('rw', [db.products], async () => {
        for (const p of productsToVerify) {
          await db.products.update(p.id, { pricing_verified: 1, synced: 0 });
        }
      });
      SyncService.sync();
    } catch (err) {
      console.error('Failed to verify all product prices in ExecutiveDashboard:', err);
    }
  };
  
  // Fetch all necessary data - Optimized to load only yesterday and today's sales to support large scales
  const sales = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const twoDaysAgoIso = startOfDay(subDays(new Date(), 1)).toISOString();
    return db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, twoDaysAgoIso], [user.shopId, 0, '\uffff'])
      .toArray();
  }, [user?.shopId]) || [];

  const products = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.products.where('[shop_id+isDeleted]').equals([user.shopId, 0]).toArray();
  }, [user?.shopId]) || [];

  const saleItems = useLiveQuery(async () => {
    if (!user?.shopId || sales.length === 0) return [];
    const saleIds = sales.map(s => s.id);
    return db.saleItems
      .where('sale_id')
      .anyOf(saleIds)
      .filter(i => i.isDeleted === 0)
      .toArray();
  }, [user?.shopId, sales]) || [];

  const auditLogs = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const twoDaysAgoIso = startOfDay(subDays(new Date(), 1)).toISOString();
    return db.auditLogs
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, twoDaysAgoIso], [user.shopId, 0, '\uffff'])
      .toArray();
  }, [user?.shopId]) || [];

  const users = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.users.where('shop_id').equals(user.shopId).toArray();
  }, [user?.shopId]) || [];

  const insights = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const yesterdayStart = startOfDay(subDays(now, 1));
    const yesterdayEnd = endOfDay(subDays(now, 1));

    const todayInterval = { start: todayStart, end: todayEnd };
    const yesterdayInterval = { start: yesterdayStart, end: yesterdayEnd };

    // 1. Sales & Profit Comparison
    const todaySales = sales.filter(s => isWithinInterval(new Date(s.created_at), todayInterval));
    const yesterdaySales = sales.filter(s => isWithinInterval(new Date(s.created_at), yesterdayInterval));

    const todayRevenue = todaySales.reduce((acc, s) => acc + s.total_amount, 0);
    const todayProfit = todaySales.reduce((acc, s) => acc + (s.total_profit || 0), 0);
    
    const yesterdayRevenue = yesterdaySales.reduce((acc, s) => acc + s.total_amount, 0);
    const yesterdayProfit = yesterdaySales.reduce((acc, s) => acc + (s.total_profit || 0), 0);

    let profitGrowth = 0;
    if (yesterdayProfit > 0) {
      profitGrowth = ((todayProfit - yesterdayProfit) / yesterdayProfit) * 100;
    } else if (yesterdayProfit === 0 && todayProfit > 0) {
      profitGrowth = 100;
    }

    // 2. Top Drivers (Today's Sale Items)
    const todaySaleItems = saleItems.filter(item => {
      const sale = todaySales.find(s => s.id === item.sale_id);
      return !!sale;
    });

    const productStats: Record<string, { name: string, qty: number, profit: number }> = {};
    todaySaleItems.forEach(item => {
      if (!productStats[item.product_id]) {
        productStats[item.product_id] = { name: item.product_name, qty: 0, profit: 0 };
      }
      productStats[item.product_id].qty += item.qty;
      productStats[item.product_id].profit += (item.sell_price - item.buy_price) * item.qty;
    });

    const topDrivers = Object.values(productStats)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 3);

    // 3. Alerts (Tahadhari)
    const refundsToday = auditLogs.filter(log => 
      log.action === 'refund_sale' && isWithinInterval(new Date(log.created_at), todayInterval)
    ).length;

    const creditAlerts: { name: string, count: number }[] = [];
    const creditSalesByUser: Record<string, number> = {};
    todaySales.forEach(s => {
      if (s.payment_method === 'credit') {
        creditSalesByUser[s.user_id] = (creditSalesByUser[s.user_id] || 0) + 1;
      }
    });
    
    Object.entries(creditSalesByUser).forEach(([userId, count]) => {
      if (count >= 3) { // Alert if 3 or more credit sales given by a single user today
        const u = users.find(u => u.id === userId);
        creditAlerts.push({ name: u?.name || 'Mfanyakazi', count });
      }
    });

    const lossProductsAlerts: { id: string, name: string, buyPrice: number, sellPrice: number, loss: number }[] = [];
    const implausibleProductsAlerts: { id: string, name: string, buyPrice: number, sellPrice: number, ratio: number }[] = [];
    products.forEach(p => {
      if (p.pricing_verified === 1) return;
      if (p.buy_price > 0) {
        if (p.sell_price <= p.buy_price) {
          lossProductsAlerts.push({
            id: p.id,
            name: p.name,
            buyPrice: p.buy_price,
            sellPrice: p.sell_price,
            loss: p.buy_price - p.sell_price
          });
        } else {
          const ratio = p.sell_price / p.buy_price;
          if (ratio > 5) {
            implausibleProductsAlerts.push({
              id: p.id,
              name: p.name,
              buyPrice: p.buy_price,
              sellPrice: p.sell_price,
              ratio
            });
          }
        }
      }
    });

    // 4. Opportunities (Fursa)
    const opportunities: string[] = [];
    
    // Fast movers running low
    Object.entries(productStats).forEach(([productId, stats]) => {
      const product = products.find(p => p.id === productId);
      if (product && stats.qty > 0 && product.stock <= (product.min_stock + 5)) {
        opportunities.push(`🔥 ${product.name} inauzwa haraka sana, stock iliyobaki ni ${product.stock} tu. Ongeza haraka ili usikose mauzo!`);
      }
    });

    // High margin, slow movers
    const highMarginProducts = products.filter(p => {
      if (p.buy_price === 0) return false;
      const margin = (p.sell_price - p.buy_price) / p.buy_price;
      return margin > 0.4; // 40% margin
    });

    const slowHighMargin = highMarginProducts.filter(p => !productStats[p.id!]).slice(0, 2);
    slowHighMargin.forEach(p => {
      opportunities.push(`💡 Fikiria kufanya promotion kwa ${p.name}. Ina faida kubwa lakini haijauzwa leo.`);
    });

    // 5. Employee Summary
    const employeeActivity: { id: string, name: string, role: string, revenue: number, percentage: number, loginTime?: string, logoutTime?: string, openTime?: string }[] = [];
    const revenueByUser: Record<string, number> = {};
    
    todaySales.forEach(s => {
      revenueByUser[s.user_id] = (revenueByUser[s.user_id] || 0) + s.total_amount;
    });

    users.forEach(u => {
      if (u.role === 'admin' || u.role === 'boss') return; // Only show employees
      const rev = revenueByUser[u.id] || 0;
      const percentage = todayRevenue > 0 ? Math.round((rev / todayRevenue) * 100) : 0;
      
      const userLogs = auditLogs.filter(log => log.user_id === u.id && isWithinInterval(new Date(log.created_at), todayInterval));
      
      // Get the earliest login today
      const loginLog = userLogs.filter(l => l.action === 'login').sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
      
      // Get the latest logout today
      const logoutLog = userLogs.filter(l => l.action === 'logout').sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      
      // Get the earliest app opened today
      const appOpenedLog = userLogs.filter(l => l.action === 'app_opened').sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];

      employeeActivity.push({ 
        id: u.id,
        name: u.name, 
        role: u.role,
        revenue: rev, 
        percentage,
        loginTime: loginLog ? format(new Date(loginLog.created_at), 'h:mm a') : undefined,
        logoutTime: logoutLog ? format(new Date(logoutLog.created_at), 'h:mm a') : undefined,
        openTime: appOpenedLog ? format(new Date(appOpenedLog.created_at), 'h:mm a') : undefined
      });
    });

    employeeActivity.sort((a, b) => b.revenue - a.revenue);

    return {
      todayRevenue,
      todayProfit,
      profitGrowth,
      topDrivers,
      refundsToday,
      discountAlerts: creditAlerts,
      lossProductsAlerts,
      implausibleProductsAlerts,
      opportunities,
      employeeActivity
    };
  }, [sales, products, saleItems, auditLogs, users]);

  if (user?.role !== 'admin' && user?.role !== 'boss') {
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

  const renderGreeting = () => {
    if (insights.profitGrowth > 0) {
      return (
        <div className="bg-green-50 border border-green-100 p-5 rounded-3xl mb-6">
          <h2 className="text-xl font-black text-green-800 mb-2 flex items-center">
            Hongera! 🎉 <TrendingUp className="w-6 h-6 ml-2" />
          </h2>
          <p className="text-green-700 font-medium leading-relaxed">
            Leo umefanya vizuri sana 📈<br/>
            Faida imeongezeka kwa <strong className="text-green-900 text-lg">+{insights.profitGrowth.toFixed(1)}%</strong> kutoka jana.<br/>
            Endelea hivyo! 🔥
          </p>
        </div>
      );
    } else if (insights.profitGrowth < 0) {
      return (
        <div className="bg-orange-50 border border-orange-100 p-5 rounded-3xl mb-6">
          <h2 className="text-xl font-black text-orange-800 mb-2 flex items-center">
            Ongeza Juhudi! 💪 <TrendingDown className="w-6 h-6 ml-2" />
          </h2>
          <p className="text-orange-700 font-medium leading-relaxed">
            Leo mauzo yameshuka kidogo 📉<br/>
            Faida: <strong className="text-orange-900 text-lg">Tsh {insights.todayProfit.toLocaleString()}</strong><br/>
            (<span className="text-red-600">{insights.profitGrowth.toFixed(1)}%</span> kutoka jana).
          </p>
        </div>
      );
    } else {
      return (
        <div className="bg-blue-50 border border-blue-100 p-5 rounded-3xl mb-6">
          <h2 className="text-xl font-black text-blue-800 mb-2 flex items-center">
            Siku Inaendelea ⚖️ <Zap className="w-6 h-6 ml-2" />
          </h2>
          <p className="text-blue-700 font-medium leading-relaxed">
            Mauzo yako yapo sawa na jana au bado hujaanza kuuza sana leo.<br/>
            Faida: <strong className="text-blue-900 text-lg">Tsh {insights.todayProfit.toLocaleString()}</strong><br/>
            Fikiria mbinu mpya za kuvutia wateja leo! 🎯
          </p>
        </div>
      );
    }
  };

  return (
    <div className="p-4 space-y-6 pb-24 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center mb-2">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Ripoti ya Bosi</h1>
          <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">Hali ya Biashara Leo</p>
        </div>
      </div>

      {renderGreeting()}

      {/* Summary */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100"
      >
        <p className="text-gray-800 font-medium leading-relaxed mb-4">
          Leo biashara yako imeingiza <strong className="text-gray-900">Tsh {insights.todayRevenue.toLocaleString()}</strong>, 
          na faida ya <strong className="text-blue-600">Tsh {insights.todayProfit.toLocaleString()}</strong> 📈
        </p>

        {insights.topDrivers.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center">
              <Star className="w-4 h-4 mr-2 text-yellow-500" /> Mauzo makubwa yalitokana na:
            </h3>
            <ul className="space-y-3">
              {insights.topDrivers.map((item, idx) => (
                <li key={idx} className="flex items-start">
                  <span className="text-blue-500 mr-2">🔹</span>
                  <span className="text-gray-700 text-sm">
                    <strong>{item.name}</strong>: {item.qty} units, faida ya Tsh {item.profit.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </motion.div>

      {/* Alerts */}
      {(insights.refundsToday > 0 || insights.discountAlerts.length > 0 || insights.lossProductsAlerts.length > 0 || insights.implausibleProductsAlerts.length > 0) && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-red-50 p-6 rounded-[2rem] border border-red-100 space-y-4"
        >
          <div className="flex justify-between items-center flex-wrap gap-2 mb-1">
            <h3 className="text-sm font-black text-red-800 uppercase tracking-widest flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 animate-bounce" /> Tahadhari za Duka
            </h3>
            {(insights.lossProductsAlerts.length > 0 || insights.implausibleProductsAlerts.length > 0) && (
              <button
                onClick={(e) => { e.preventDefault(); handleVerifyAllProductPricing(); }}
                className="bg-red-200 text-red-950 px-4 py-2 rounded-2xl text-xs font-black hover:bg-red-300 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                title="Sema bei zote za bidhaa zilizoorodheshwa zipo sawa"
              >
                <Check className="w-3.5 h-3.5" /> Zote Zipo Sawa
              </button>
            )}
          </div>
          <ul className="space-y-3.5">
            {insights.refundsToday > 0 && (
              <li className="flex items-start">
                <span className="text-red-500 mr-2">⚠️</span>
                <span className="text-red-900 text-sm font-medium">
                  Refunds (Rudisha Mauzo) <strong>{insights.refundsToday}</strong> zimefanyika leo.
                </span>
              </li>
            )}
            {insights.discountAlerts.map((alert, idx) => (
              <li key={idx} className="flex items-start">
                <span className="text-red-500 mr-2">🛑</span>
                <span className="text-red-900 text-sm font-medium">
                  Mfanyakazi <strong>{alert.name}</strong> amefanya mauzo ya mkopo (credit) mara {alert.count} leo. Fuatilia madeni.
                </span>
              </li>
            ))}
            
            {insights.lossProductsAlerts.map((alert, idx) => (
              <li key={`loss-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-red-100/50 rounded-2xl">
                <div className="flex items-start">
                  <span className="text-red-600 mr-2 mt-0.5">⚠️</span>
                  <span className="text-red-900 text-sm font-semibold">
                    Hasara Inayoweza Kuepukika: Bidhaa <span className="text-red-700">[{alert.name}]</span> inauzwa kwa TZS {alert.sellPrice.toLocaleString()} wakati ilinunuliwa kwa TZS {alert.buyPrice.toLocaleString()}. Kila mauzo yataleta hasara ya TZS {alert.loss.toLocaleString()}.
                  </span>
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); handleVerifyProductPricing(alert.id); }}
                  className="shrink-0 bg-red-200 text-red-900 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-red-300 active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" /> Bei ipo Sawa
                </button>
              </li>
            ))}

            {insights.implausibleProductsAlerts.map((alert, idx) => (
              <li key={`imp-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-amber-100/40 rounded-2xl">
                <div className="flex items-start">
                  <span className="text-amber-600 mr-2 mt-0.5">🛑</span>
                  <span className="text-amber-900 text-sm font-medium">
                    Uhakiki wa Bei: Bidhaa <span className="text-amber-850">[{alert.name}]</span> ina bei ya kununulia TZS {alert.buyPrice.toLocaleString()} na kuuza TZS {alert.sellPrice.toLocaleString()}. Uwiano wa bei hii haueleweki (zaidi ya mara {Math.round(alert.ratio)} ya bei ya kununulia).
                  </span>
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); handleVerifyProductPricing(alert.id); }}
                  className="shrink-0 bg-amber-200 text-amber-905 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-amber-300 active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" /> Bei ipo Sawa
                </button>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Opportunities */}
      {insights.opportunities.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-yellow-50 p-6 rounded-[2rem] border border-yellow-100"
        >
          <h3 className="text-sm font-black text-yellow-800 uppercase tracking-widest mb-3 flex items-center">
            <Lightbulb className="w-5 h-5 mr-2" /> Fursa
          </h3>
          <ul className="space-y-4">
            {insights.opportunities.map((opp, idx) => (
              <li key={idx} className="text-yellow-900 text-sm font-medium leading-relaxed">
                {opp}
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Employee Summary Button */}
      {insights.employeeActivity.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center">
              <Users className="w-5 h-5 mr-2 text-blue-500" /> Wafanyakazi
            </h3>
          </div>
          <button
            onClick={(e) => { e.preventDefault(); setShowEmployeeReports(true); }}
            className="w-full bg-blue-50 text-blue-700 font-bold py-4 rounded-2xl flex items-center justify-center transition-colors"
          >
            Tazama Ripoti za Wafanyakazi (Zamu)
            <ArrowLeft className="w-4 h-4 ml-2 rotate-180" />
          </button>
        </motion.div>
      )}

      {/* Quick Links */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <button
          onClick={(e) => { e.preventDefault(); navigate('/audit-logs'); }}
          className="w-full bg-blue-600 text-white p-5 rounded-[2rem] shadow-sm flex items-center justify-between transition-colors"
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

      {/* Payment Breakdown */}
      {user?.shopId && <PaymentBreakdownWidget shopId={user.shopId} />}

      {/* Footer Message */}
      <div className="text-center pt-6 pb-4">
        <p className="text-sm text-gray-500 font-medium italic mb-6">
          "Endelea kuangalia biashara yako kila siku ili kuchukua hatua za haraka na kukuza faida. 🔥"
        </p>
        <div className="text-center py-4 border-t border-gray-100">
          <p className="text-lg font-bold text-blue-600">Venics Sales</p>
          <p className="text-xs text-gray-400 mt-1">Version 1.0.0</p>
          <p className="text-[10px] text-gray-300 mt-4">Made by Venics Software Company</p>
        </div>
      </div>
      <MshauriChat />
    </div>
  );
}
