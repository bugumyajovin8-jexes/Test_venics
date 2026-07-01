import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { TelemetryService } from '../services/telemetry';
import { 
  Users, 
  User, 
  ArrowLeft, 
  Clock, 
  DollarSign, 
  LogIn, 
  LogOut, 
  Calendar, 
  ChevronDown, 
  ChevronUp, 
  Wallet, 
  Smartphone, 
  CreditCard, 
  Landmark, 
  ArrowUpRight, 
  ArrowDownRight,
  TrendingDown,
  Info,
  AlertTriangle,
  Trash2,
  ShieldAlert,
  Percent,
  Award,
  Trophy,
  Sparkles,
  Medal,
  Flame,
  TrendingUp
} from 'lucide-react';
import { format, isWithinInterval, startOfDay, endOfDay, differenceInHours, differenceInMinutes, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { motion } from 'motion/react';
import { formatCurrency } from '../utils/format';

interface Shift {
  id: string;
  loginTime: Date;
  logoutTime: Date | null;
  sales: any[];
  expenses: any[];
  debtPayments: any[];
  audits?: any[];
  revenue: number;
  profit: number;
}

export default function EmployeeReports({ onClose }: { onClose: () => void }) {
  const { user } = useStore();

  useEffect(() => {
    TelemetryService.trackEmployeeReportsView();
  }, []);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [filterPeriod, setFilterPeriod] = useState<'this_week' | 'this_month' | 'last_month' | 'all_time'>('this_week');
  const [expandedShiftIds, setExpandedShiftIds] = useState<Record<string, boolean>>({});

  const users = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.users.where('shop_id').equals(user.shopId).toArray();
  }, [user?.shopId]) || [];

  const employees = users.filter(u => u.role !== 'boss');

  // Optimized: Calculate start of the date range from selection to prevent pulling redundant historical periods
  const minDateIso = useMemo(() => {
    const now = new Date();
    if (filterPeriod === 'this_week') {
      return startOfWeek(now, { weekStartsOn: 1 }).toISOString();
    } else if (filterPeriod === 'this_month') {
      return startOfMonth(now).toISOString();
    } else if (filterPeriod === 'last_month') {
      const lastMonth = subMonths(now, 1);
      return startOfMonth(lastMonth).toISOString();
    } else {
      return new Date(0).toISOString(); // all_time
    }
  }, [filterPeriod]);

  const auditLogs = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.auditLogs
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, minDateIso], [user.shopId, 0, '\uffff'])
      .toArray();
  }, [user?.shopId, minDateIso]) || [];

  const sales = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, minDateIso], [user.shopId, 0, '\uffff'])
      .toArray();
  }, [user?.shopId, minDateIso]) || [];

  const expenses = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.expenses
      .where('[shop_id+isDeleted+date]')
      .between([user.shopId, 0, minDateIso], [user.shopId, 0, '\uffff'])
      .toArray();
  }, [user?.shopId, minDateIso]) || [];

  const debtPayments = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.debtPayments.filter(dp => dp.shop_id === user.shopId && dp.isDeleted === 0).toArray();
  }, [user?.shopId]) || [];

  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  const toggleShiftExpand = (id: string) => {
    setExpandedShiftIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const employeeShifts = useMemo(() => {
    if (!selectedEmployeeId) return [];
    
    const userLogs = auditLogs
      .filter(l => l.user_id === selectedEmployeeId && (l.action === 'login' || l.action === 'logout' || l.action === 'app_opened'))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
    const userSales = sales.filter(s => s.user_id === selectedEmployeeId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const fallbackShifts: Shift[] = [];
    
    // Fallback if no logs exist but there are sales
    if (userLogs.length === 0 && userSales.length > 0) {
      const shiftsByDay: Record<string, Shift> = {};
      userSales.forEach(s => {
        const dateStr = format(new Date(s.created_at), 'yyyy-MM-dd');
        if (!shiftsByDay[dateStr]) {
          shiftsByDay[dateStr] = {
            id: dateStr,
            loginTime: startOfDay(new Date(s.created_at)),
            logoutTime: endOfDay(new Date(s.created_at)),
            sales: [],
            expenses: [],
            debtPayments: [],
            revenue: 0,
            profit: 0
          };
        }
        shiftsByDay[dateStr].sales.push(s);
        shiftsByDay[dateStr].revenue += s.total_amount;
        shiftsByDay[dateStr].profit += (s.total_profit || 0);
      });

      const processedFallback = Object.values(shiftsByDay);
      processedFallback.forEach(shift => {
        const shiftExpenses = expenses.filter(e => {
          const expTime = new Date(e.created_at || e.date);
          return expTime >= shift.loginTime && (shift.logoutTime ? expTime <= shift.logoutTime : true);
        });
        shift.expenses = shiftExpenses;

        const shiftDebtPayments = debtPayments.filter(dp => {
          const dpTime = new Date(dp.created_at || dp.date);
          return dpTime >= shift.loginTime && (shift.logoutTime ? dpTime <= shift.logoutTime : true);
        });
        shift.debtPayments = shiftDebtPayments;

        const shiftAudits = auditLogs.filter(log => {
          const logTime = new Date(log.created_at);
          return log.user_id === selectedEmployeeId && 
                 logTime >= shift.loginTime && 
                 (shift.logoutTime ? logTime <= shift.logoutTime : true);
        });
        shift.audits = shiftAudits;
      });

      return processedFallback.sort((a, b) => b.loginTime.getTime() - a.loginTime.getTime());
    }

    const shifts: Shift[] = [];
    let currentShift: Shift | null = null;

    userLogs.forEach((log) => {
      const logTime = new Date(log.created_at);
      
      if (log.action === 'login' || log.action === 'app_opened') {
        if (!currentShift) {
          currentShift = {
            id: log.id,
            loginTime: logTime,
            logoutTime: null,
            sales: [],
            expenses: [],
            debtPayments: [],
            revenue: 0,
            profit: 0
          };
        }
      } else if (log.action === 'logout') {
        if (currentShift) {
          currentShift.logoutTime = logTime;
          shifts.push(currentShift);
          currentShift = null;
        }
      }
    });

    if (currentShift) {
      (currentShift as Shift).logoutTime = new Date(); // Active shift up to now
      shifts.push(currentShift);
    }

    // Assign sales, expenses and debt payments to shifts
    shifts.forEach(shift => {
      const shiftSales = userSales.filter(s => {
        const saleTime = new Date(s.created_at);
        return saleTime >= shift.loginTime && (shift.logoutTime ? saleTime <= shift.logoutTime : true);
      });
      shift.sales = shiftSales;
      shift.revenue = shiftSales.reduce((sum, s) => sum + s.total_amount, 0);
      shift.profit = shiftSales.reduce((sum, s) => sum + (s.total_profit || 0), 0);

      const shiftExpenses = expenses.filter(e => {
        const expTime = new Date(e.created_at || e.date);
        return expTime >= shift.loginTime && (shift.logoutTime ? expTime <= shift.logoutTime : true);
      });
      shift.expenses = shiftExpenses;

      const shiftDebtPayments = debtPayments.filter(dp => {
        const dpTime = new Date(dp.created_at || dp.date);
        return dpTime >= shift.loginTime && (shift.logoutTime ? dpTime <= shift.logoutTime : true);
      });
      shift.debtPayments = shiftDebtPayments;

      const shiftAudits = auditLogs.filter(log => {
        const logTime = new Date(log.created_at);
        return log.user_id === selectedEmployeeId && 
               logTime >= shift.loginTime && 
               (shift.logoutTime ? logTime <= shift.logoutTime : true);
      });
      shift.audits = shiftAudits;
    });

    // Clean up empty shifts unless it's the most recent one
    const activeOrWithSales = shifts.filter((s, i) => s.sales.length > 0 || i === shifts.length - 1);

    // Apply period filter
    const now = new Date();
    let startDate: Date;
    let endDate: Date = endOfDay(now);

    if (filterPeriod === 'this_week') {
      startDate = startOfWeek(now, { weekStartsOn: 1 }); // Starts Monday
    } else if (filterPeriod === 'this_month') {
      startDate = startOfMonth(now);
    } else if (filterPeriod === 'last_month') {
      const lastMonth = subMonths(now, 1);
      startDate = startOfMonth(lastMonth);
      endDate = endOfMonth(lastMonth);
    } else {
      startDate = new Date(0); // all_time
    }

    const filteredShifts = activeOrWithSales.filter(s => {
      return s.loginTime >= startDate && s.loginTime <= endDate;
    });

    return filteredShifts.sort((a, b) => b.loginTime.getTime() - a.loginTime.getTime());
  }, [selectedEmployeeId, auditLogs, sales, expenses, debtPayments, filterPeriod]);

  const summary = useMemo(() => {
    return employeeShifts.reduce((acc, shift) => {
      acc.revenue += shift.revenue;
      acc.profit += shift.profit;
      acc.salesCount += shift.sales.length;
      if (shift.logoutTime && shift.logoutTime.getTime() !== shift.loginTime.getTime()) {
        acc.minutes += differenceInMinutes(shift.logoutTime, shift.loginTime);
      }
      return acc;
    }, { revenue: 0, profit: 0, salesCount: 0, minutes: 0 });
  }, [employeeShifts]);

  const leaderboardData = useMemo(() => {
    const sevenDaysAgo = startOfDay(new Date());
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const weeklySales = sales.filter(s => {
      const saleTime = new Date(s.created_at);
      return saleTime >= sevenDaysAgo && s.status !== 'cancelled';
    });

    const totalWeeklyProfit = weeklySales.reduce((sum, s) => sum + (s.total_profit || 0), 0);
    const totalWeeklyRevenue = weeklySales.reduce((sum, s) => sum + s.total_amount, 0);

    const stats = employees.map(emp => {
      const empSales = weeklySales.filter(s => s.user_id === emp.id);
      const revenue = empSales.reduce((sum, s) => sum + s.total_amount, 0);
      const profit = empSales.reduce((sum, s) => sum + (s.total_profit || 0), 0);
      const count = empSales.length;

      const sortedSales = [...empSales].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      let intervals: number[] = [];
      for (let i = 1; i < sortedSales.length; i++) {
        const diffMs = new Date(sortedSales[i].created_at).getTime() - new Date(sortedSales[i-1].created_at).getTime();
        const diffMins = diffMs / 1000 / 60;
        if (diffMins < 90) {
          intervals.push(diffMins);
        }
      }
      const avgMins = intervals.length > 0 ? (intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0;
      
      let speedText = '';
      if (avgMins > 0) {
        if (avgMins < 1) {
          speedText = `${Math.round(avgMins * 60)} sekunde`;
        } else {
          speedText = `${Math.round(avgMins * 60)} sekunde`;
        }
      } else {
        const uniqueDays = new Set(empSales.map(s => format(new Date(s.created_at), 'yyyy-MM-dd'))).size;
        const speedSeed = (count > 0 && uniqueDays > 0) ? Math.max(31, Math.min(115, 230 / (count / uniqueDays))) : 45;
        speedText = `${Math.round(speedSeed)} sekunde`;
      }

      const profitShare = totalWeeklyProfit > 0 ? (profit / totalWeeklyProfit) * 100 : 0;
      const revenueShare = totalWeeklyRevenue > 0 ? (revenue / totalWeeklyRevenue) * 100 : 0;

      return {
        employee: emp,
        revenue,
        profit,
        count,
        profitShare,
        revenueShare,
        speedText
      };
    });

    const ranked = stats.sort((a, b) => b.profit - a.profit);
    
    return {
      ranked,
      totalWeeklyProfit,
      totalWeeklyRevenue
    };
  }, [employees, sales]);

  if (selectedEmployeeId) {
    const emp = employees.find(e => e.id === selectedEmployeeId);
    return (
      <div className="fixed inset-0 bg-gray-50 z-50 flex flex-col overflow-hidden pt-safe pt-safe-standalone">
        <div className="bg-white px-4 py-4 flex items-center border-b border-gray-100 shadow-sm shrink-0">
          <button 
            onClick={() => setSelectedEmployeeId(null)}
            className="p-2 rounded-full transition-colors mr-2"
          >
            <ArrowLeft className="w-6 h-6 text-gray-700" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{emp?.name}</h1>
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-widest">Ripoti ya Zamu (Shifts)</p>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
          <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-hide -mx-4 px-4">
            <button
              onClick={() => setFilterPeriod('this_week')}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all ${filterPeriod === 'this_week' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-100 '}`}
            >
              Wiki Hii
            </button>
            <button
              onClick={() => setFilterPeriod('this_month')}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all ${filterPeriod === 'this_month' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-100 '}`}
            >
              Mwezi Huu
            </button>
            <button
              onClick={() => setFilterPeriod('last_month')}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all ${filterPeriod === 'last_month' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-100 '}`}
            >
              Mwezi Uliopita
            </button>
            <button
              onClick={() => setFilterPeriod('all_time')}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all ${filterPeriod === 'all_time' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-100 '}`}
            >
              Wakati Wote
            </button>
          </div>

          <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 mb-6">
            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4">Muhtasari</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 font-bold uppercase">Jumla Mapato</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(summary.revenue, currency)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-bold uppercase">Jumla Maoni Faida</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(summary.profit, currency)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-bold uppercase">Jumla Mauzo</p>
                <p className="text-sm font-bold text-gray-700">{summary.salesCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-bold uppercase">Muda Kazini</p>
                <p className="text-sm font-bold text-gray-700">{Math.floor(summary.minutes / 60)}h {summary.minutes % 60}m</p>
              </div>
            </div>
          </div>

          {employeeShifts.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-gray-500">Hakuna kumbukumbu za zamu kwa sasa.</p>
            </div>
          ) : (
            employeeShifts.map((shift, idx) => {
              const durationHrs = shift.logoutTime ? differenceInHours(shift.logoutTime, shift.loginTime) : 0;
              const durationMins = shift.logoutTime ? differenceInMinutes(shift.logoutTime, shift.loginTime) % 60 : 0;
              
              // 1. Splitting transactions by payment method
              const cashSales = shift.sales
                .filter(s => s.status !== 'cancelled' && (s.payment_method === 'cash' || !s.payment_method))
                .reduce((sum, s) => sum + s.total_amount, 0);

              const mobileSales = shift.sales
                .filter(s => s.status !== 'cancelled' && (s.payment_method === 'mobile_money' || s.payment_method === 'mobile'))
                .reduce((sum, s) => sum + s.total_amount, 0);

              const bankSales = shift.sales
                .filter(s => s.status !== 'cancelled' && s.payment_method === 'card')
                .reduce((sum, s) => sum + s.total_amount, 0);

              const creditSales = shift.sales
                .filter(s => s.status !== 'cancelled' && s.payment_method === 'credit')
                .reduce((sum, s) => sum + s.total_amount, 0);

              // 2. Extra inputs/outputs (Expenses, collected old debts during timeframe)
              const totalExpenses = (shift.expenses || []).reduce((sum, e) => sum + e.amount, 0);
              const totalDebtCollected = (shift.debtPayments || []).reduce((sum, dp) => sum + dp.amount, 0);

              // 3. Expected cash in hand calculation:
              // (Cash Sales + Debt Payments Paid by Cash) - Expenses during timeframe
              const expectedCash = Math.max(0, cashSales + totalDebtCollected - totalExpenses);

              const isExpanded = !!expandedShiftIds[shift.id];

              const fraudAudits = (shift.audits || []).filter(a => 
                ['refund_sale', 'delete_product', 'delete_all_products', 'edit_product', 'discounted_sale'].includes(a.action)
              );
              const hasAlerts = fraudAudits.length > 0;

              return (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  key={shift.id} 
                  className="bg-white rounded-[2rem] p-5 shadow-sm border border-gray-100"
                >
                  <div className="flex items-center justify-between mb-4 border-b border-gray-50 pb-3">
                    <div className="flex items-center">
                      <div className="bg-blue-50 p-2 rounded-xl mr-3">
                        <Calendar className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{format(shift.loginTime, 'do MMM yyyy')}</p>
                        {shift.logoutTime && format(shift.loginTime, 'yyyy-MM-dd') !== format(shift.logoutTime, 'yyyy-MM-dd') && (
                          <p className="text-[10px] text-gray-500 font-semibold mt-0.5">Hadi: {format(shift.logoutTime, 'do MMM yyyy')}</p>
                        )}
                      </div>
                    </div>
                    {hasAlerts && (
                      <span className="bg-red-50 text-red-700 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full border border-red-100 flex items-center shadow-sm animate-pulse">
                        <ShieldAlert className="w-3.5 h-3.5 mr-1" />
                        Hitilafu {fraudAudits.length}
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100">
                      <div className="flex items-center mb-1">
                        <LogIn className="w-3 h-3 text-green-500 mr-1" />
                        <span className="text-[10px] uppercase font-bold text-gray-500">Kuingia</span>
                      </div>
                      <p className="font-bold text-gray-900">{format(shift.loginTime, 'h:mm a')}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100">
                      <div className="flex items-center mb-1">
                        <LogOut className="w-3 h-3 text-red-500 mr-1" />
                        <span className="text-[10px] uppercase font-bold text-gray-500">Kutoka</span>
                      </div>
                      <p className="font-bold text-gray-900">
                        {shift.logoutTime && shift.logoutTime.getTime() !== shift.loginTime.getTime() ? format(shift.logoutTime, 'h:mm a') : 'Bado yupo'}
                      </p>
                    </div>
                  </div>

                  <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-50">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs text-blue-800 font-black uppercase tracking-widest">Mapato</p>
                        <p className="text-xl font-bold text-blue-900">{formatCurrency(shift.revenue, currency)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-green-800 font-black uppercase tracking-widest">Faida</p>
                        <p className="text-xl font-bold text-green-600">{formatCurrency(shift.profit, currency)}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-blue-700 bg-white/60 p-2 rounded-xl mt-3">
                      <span className="font-semibold flex items-center"><DollarSign className="w-3 h-3 mr-1"/> {shift.sales.length} Mauzo</span>
                      {shift.logoutTime && shift.logoutTime.getTime() !== shift.loginTime.getTime() && (
                        <span className="font-semibold flex items-center"><Clock className="w-3 h-3 mr-1"/> Masaa {durationHrs} Dak {durationMins}</span>
                      )}
                    </div>
                  </div>

                  {/* Drawer Reconciliation & Payment Breakdowns section */}
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => toggleShiftExpand(shift.id)}
                      className="w-full flex items-center justify-between p-3 bg-slate-50 text-slate-800 rounded-2xl text-xs font-black transition-colors"
                    >
                      <span className="flex items-center">
                        <Wallet className="w-4 h-4 mr-2 text-blue-600" />
                        📊 Kikokotoo cha Fedha za Droo
                      </span>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </button>

                    {isExpanded && (
                      <div className="mt-3 space-y-3 animation-fade-in">
                        <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
                          <div className="bg-white p-3 rounded-2xl border border-gray-100 flex flex-col justify-between">
                            <span className="text-gray-400 uppercase tracking-wider text-[8px] flex items-center">
                              <Wallet className="w-3.5 h-3.5 mr-1 text-emerald-500" /> Taslimu (Cash)
                            </span>
                            <span className="text-gray-900 text-xs font-black mt-1.5">{formatCurrency(cashSales, currency)}</span>
                          </div>
                          
                          <div className="bg-white p-3 rounded-2xl border border-gray-100 flex flex-col justify-between">
                            <span className="text-gray-400 uppercase tracking-wider text-[8px] flex items-center">
                              <Smartphone className="w-3.5 h-3.5 mr-1 text-blue-500" /> Lipa/M-Pesa/Tigo_Pesa
                            </span>
                            <span className="text-gray-900 text-xs font-black mt-1.5">{formatCurrency(mobileSales, currency)}</span>
                          </div>

                          <div className="bg-white p-3 rounded-2xl border border-gray-100 flex flex-col justify-between">
                            <span className="text-gray-400 uppercase tracking-wider text-[8px] flex items-center">
                              <CreditCard className="w-3.5 h-3.5 mr-1 text-purple-500" /> Benki (Bank/Card)
                            </span>
                            <span className="text-gray-900 text-xs font-black mt-1.5">{formatCurrency(bankSales, currency)}</span>
                          </div>

                          <div className="bg-white p-3 rounded-2xl border border-gray-100 flex flex-col justify-between">
                            <span className="text-gray-400 uppercase tracking-wider text-[8px] flex items-center">
                              <TrendingDown className="w-3.5 h-3.5 mr-1 text-orange-500" /> Mikopo Mipya
                            </span>
                            <span className="text-orange-600 text-xs font-black mt-1.5">{formatCurrency(creditSales, currency)}</span>
                          </div>
                        </div>

                        {/* Extra indicators: debt collections (+) and expenses (-) */}
                        <div className="bg-amber-50/50 p-3 rounded-2xl border border-amber-100/60 text-xs space-y-2">
                          <div className="flex items-center justify-between text-gray-700">
                            <span className="flex items-center font-bold text-[11px] text-amber-950">
                              <ArrowUpRight className="w-4 h-4 mr-1.5 text-green-600 shrink-0" /> Madeni Yajulikayo yaliyolipwa (+)
                            </span>
                            <span className="font-black text-green-700">{formatCurrency(totalDebtCollected, currency)}</span>
                          </div>
                          <div className="flex items-center justify-between text-gray-700 border-t border-amber-100/50 pt-1.5">
                            <span className="flex items-center font-bold text-[11px] text-amber-950">
                              <ArrowDownRight className="w-4 h-4 mr-1.5 text-red-500 shrink-0" /> Matumizi / Expenses (-)
                            </span>
                            <span className="font-black text-red-600">-{formatCurrency(totalExpenses, currency)}</span>
                          </div>
                        </div>

                        {/* Expected Cash in Hand */}
                        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-4 rounded-[2rem] border border-emerald-100/80 shadow-inner">
                          <div className="flex items-start">
                            <Info className="w-4 h-4 text-emerald-600 mr-2 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[10px] uppercase font-black tracking-widest text-emerald-800">Taslimu Inayotarajiwa Drooni (Drawer Cash)</p>
                              <p className="text-xl font-black text-emerald-950 mt-1">{formatCurrency(expectedCash, currency)}</p>
                              <p className="text-[9px] text-emerald-700 mt-1 font-semibold italic">Mlinganisho: (Mauzo ya Taslimu + Madeni Yaliyolipwa) - Matumizi</p>
                            </div>
                          </div>
                        </div>

                        {/* 4. Kigunduzi cha Hitilafu za Kiulizi / Audit Alerts */}
                        <div className="border border-red-100 bg-red-50/10 rounded-[2rem] p-4 space-y-3">
                          <div className="flex items-center justify-between border-b border-red-100/30 pb-2">
                            <span className="flex items-center font-black text-red-950 text-xs uppercase tracking-wider">
                              <ShieldAlert className="w-4 h-4 mr-1.5 text-red-600 shrink-0" />
                              Hitilafu na Udhibiti wa Wizi
                            </span>
                            <span className="bg-red-500 text-white text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full">
                              Matukio {fraudAudits.length}
                            </span>
                          </div>

                          {fraudAudits.length === 0 ? (
                            <p className="text-xs text-gray-500 font-semibold italic">
                              Nzuri sana! Hakuna mauzo au bidhaa zilizofutwa wakati wa zamu hii. ✅
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {fraudAudits.map((audit: any) => {
                                let actionLabel = '';
                                let colorClass = '';
                                let auditIcon = <AlertTriangle className="w-4 h-4" />;
                                
                                if (audit.action === 'refund_sale') {
                                  actionLabel = 'Mauzo Yaliyolipiwa Kisha Kufutwa/Kurudishwa (Refunded Sale)';
                                  colorClass = 'text-red-700 bg-red-50/50 border border-red-100/50';
                                  auditIcon = <Trash2 className="w-4 h-4 text-red-500 shrink-0" />;
                                } else if (audit.action === 'delete_product') {
                                  actionLabel = 'Mfutaji wa Bidhaa (Deleted Product)';
                                  colorClass = 'text-red-700 bg-red-50/50 border border-red-100/50';
                                  auditIcon = <Trash2 className="w-4 h-4 text-red-500 shrink-0" />;
                                } else if (audit.action === 'discounted_sale') {
                                  actionLabel = 'Mauzo Yenye Punguzo (Custom Discount Applied)';
                                  colorClass = 'text-amber-700 bg-amber-50/50 border border-amber-100/50';
                                  auditIcon = <Percent className="w-4 h-4 text-amber-500 shrink-0" />;
                                } else if (audit.action === 'edit_product') {
                                  actionLabel = 'Ilihaririwa (Edited Product)';
                                  colorClass = 'text-blue-700 bg-blue-50/50 border border-blue-100/50';
                                  auditIcon = <Info className="w-4 h-4 text-blue-500 shrink-0" />;
                                } else {
                                  actionLabel = `Kazi: ${audit.action}`;
                                  colorClass = 'text-gray-700 bg-gray-50 border border-gray-100';
                                }

                                return (
                                  <div key={audit.id} className={`p-3 rounded-2xl text-[11px] font-bold ${colorClass} space-y-1.5`}>
                                    <div className="flex items-start justify-between">
                                      <span className="flex items-center font-black">
                                        {auditIcon}
                                        <span className="ml-1.5 text-[11px] leading-snug">{actionLabel}</span>
                                      </span>
                                      <span className="text-[9px] font-black text-gray-500">
                                        {format(new Date(audit.created_at), 'hh:mm a')}
                                      </span>
                                    </div>
                                    
                                    {audit.action === 'refund_sale' && (
                                      <div className="text-stone-700 font-semibold bg-white/75 p-2 rounded-xl border border-stone-100 space-y-0.5 mt-1">
                                        <p>💵 Jumla ya Hela: <span className="font-extrabold text-red-600">{formatCurrency(audit.details?.amount || 0, currency)}</span></p>
                                        <p>👤 Mteja: <span className="font-bold">{audit.details?.customer || 'Siojulikana'}</span></p>
                                        {audit.details?.items && audit.details.items.length > 0 && (
                                          <p className="mt-1 pt-1 border-t border-gray-100/50 text-[10px]">
                                            Bidhaa: {audit.details.items.map((i: any) => `${i.name} (x${i.qty})`).join(', ')}
                                          </p>
                                        )}
                                      </div>
                                    )}

                                    {audit.action === 'discounted_sale' && (
                                      <div className="text-stone-700 font-semibold bg-white/75 p-2 rounded-xl border border-stone-100 space-y-0.5 mt-1">
                                        <p>💸 Punguzo Lilitolewa: <span className="font-extrabold text-amber-600">{formatCurrency(audit.details?.discount || 0, currency)}</span></p>
                                        <p>💵 Jumla ya Baada ya Punguzo: <span className="font-bold text-gray-800">{formatCurrency(audit.details?.amount || 0, currency)}</span></p>
                                        {audit.details?.product_name && (
                                          <p>📦 Bidhaa: <span className="font-bold">{audit.details?.product_name}</span></p>
                                        )}
                                      </div>
                                    )}

                                    {audit.action === 'delete_product' && (
                                      <div className="text-stone-700 font-semibold bg-white/75 p-2 rounded-xl border border-stone-100 space-y-0.5 mt-1">
                                        <p>📦 Jina la Bidhaa: <span className="font-bold text-red-600">{audit.details?.name}</span></p>
                                      </div>
                                    )}

                                    {audit.action === 'edit_product' && (
                                      <div className="text-stone-700 font-semibold bg-white/75 p-2 rounded-xl border border-stone-100 space-y-0.5 mt-1">
                                        <p>📦 Jina: <span className="font-bold">{audit.details?.name}</span></p>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-50 z-40 flex flex-col overflow-hidden pt-safe pt-safe-standalone">
      <div className="bg-white px-4 py-4 flex items-center border-b border-gray-100 shadow-sm shrink-0">
        <button 
          onClick={onClose}
          className="p-2 rounded-full transition-colors mr-2"
        >
          <ArrowLeft className="w-6 h-6 text-gray-700" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ripoti za Wafanyakazi</h1>
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-widest">Mshauri na Zamu</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
        {/* Leaderboard Table for the shop owner */}
        {leaderboardData.ranked.length > 0 && (
          <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm mb-6">
            <div className="flex items-center justify-between mb-4 border-b border-gray-50 pb-3">
              <span className="flex items-center text-xs font-black text-gray-400 uppercase tracking-widest">
                <Medal className="w-4 h-4 mr-2 text-amber-500" />
                Msimamo wa Wafanyakazi (Leaderboard)
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-black uppercase">
                Siku 7 zilizopita
              </span>
            </div>

            <div className="space-y-4">
              {leaderboardData.ranked.map((player, index) => {
                const colors = [
                  'from-amber-100 to-yellow-100 text-amber-800 border-amber-200',
                  'from-slate-100 to-zinc-100 text-slate-800 border-slate-200',
                  'from-orange-100 to-amber-50 text-orange-800 border-orange-200',
                ];
                const badgeStyle = index < 3 ? colors[index] : 'bg-gray-50 text-gray-600 border-gray-100';
                
                return (
                  <div key={player.employee.id} className="flex items-center justify-between text-xs font-bold">
                    <div className="flex items-center space-x-3">
                      <div className={`w-7 h-7 rounded-lg border flex items-center justify-center font-black ${badgeStyle}`}>
                        {index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                      </div>
                      <div>
                        <p className="text-sm font-black text-gray-800 leading-none">{player.employee.name}</p>
                        <p className="text-[10px] text-gray-400 mt-1 font-semibold">Ushiriki katika faida: {Math.round(player.profitShare)}%</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-black text-gray-900">{formatCurrency(player.revenue, currency)}</p>
                      <p className="text-[10px] text-green-600 mt-1 font-semibold flex items-center justify-end">
                        <TrendingUp className="w-3.5 h-3.5 mr-1 text-green-500" />
                        Faida: {formatCurrency(player.profit, currency)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 pb-1">
          <span className="text-xs font-black text-gray-400 uppercase tracking-widest">
            Fungua Kumbukumbu Kamili/Zamu
          </span>
          <span className="text-[10px] font-bold text-blue-600">
            Chagua chini 👇
          </span>
        </div>

        {employees.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-500">Hakuna wafanyakazi walioko kwenye duka hili.</p>
          </div>
        ) : (
          employees.map((emp, idx) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              key={emp.id}
            >
              <button
                onClick={() => setSelectedEmployeeId(emp.id)}
                className="w-full bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 flex items-center justify-between text-left transition-colors"
              >
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-bold text-lg mr-4 pb-0.5">
                    {emp.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg mb-0.5">{emp.name}</h3>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-widest">{emp.email}</p>
                  </div>
                </div>
                <Users className="w-5 h-5 text-gray-300" />
              </button>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
