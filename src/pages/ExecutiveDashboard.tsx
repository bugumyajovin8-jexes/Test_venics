import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { format, subDays, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { AlertCircle, Zap, TrendingUp, TrendingDown, Star, Users, AlertTriangle, Lightbulb, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';

import EmployeeReports from '../components/EmployeeReports';
import MshauriChat from '../components/MshauriChat';

export default function ExecutiveDashboard() {
  const { user } = useStore();
  const navigate = useNavigate();
  const [showEmployeeReports, setShowEmployeeReports] = useState(false);
  
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
      if (u.role === 'admin' || u.role === 'superadmin' || u.role === 'boss') return; // Only show employees
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
      opportunities,
      employeeActivity
    };
  }, [sales, products, saleItems, auditLogs, users]);

  if (user?.role !== 'admin' && user?.role !== 'superadmin' && user?.role !== 'boss') {
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
      {(insights.refundsToday > 0 || insights.discountAlerts.length > 0) && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-red-50 p-6 rounded-[2rem] border border-red-100"
        >
          <h3 className="text-sm font-black text-red-800 uppercase tracking-widest mb-3 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2" /> Tahadhari
          </h3>
          <ul className="space-y-3">
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
            onClick={() => setShowEmployeeReports(true)}
            className="w-full bg-blue-50 text-blue-700 font-bold py-4 rounded-2xl flex items-center justify-center transition-colors hover:bg-blue-100"
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
          onClick={() => navigate('/audit-logs')}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white p-5 rounded-[2rem] shadow-sm flex items-center justify-between transition-colors"
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
