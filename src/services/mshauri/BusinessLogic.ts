import { subDays, startOfDay, isWithinInterval, startOfWeek, subMonths } from 'date-fns';
import { Product, Sale, Expense, AuditLog, SaleItem, DebtPayment, User } from '../../db';

export class BusinessLogic {
  static getSalesReport(sales: Sale[], expenses: Expense[], period: string) {
    const filter = this.getPeriodFilter(period);
    const filteredSales = sales.filter(s => filter(new Date(s.date || s.created_at)));
    const filteredExpenses = expenses.filter(e => filter(new Date(e.date || e.created_at)));

    const revenue = filteredSales.reduce((acc, s) => acc + s.total_amount, 0);
    const profit = filteredSales.reduce((acc, s) => acc + (s.total_profit || 0), 0);
    const expenseTotal = filteredExpenses.reduce((acc, e) => acc + e.amount, 0);

    return {
      revenue,
      profit,
      expenses: expenseTotal,
      netProfit: profit - expenseTotal,
      transactionCount: filteredSales.length
    };
  }

  static getComparisonReport(sales: Sale[], expenses: Expense[], type: string) {
    const now = new Date();
    const today = startOfDay(now);
    
    let isCurrent: (d: Date) => boolean;
    let isPrevious: (d: Date) => boolean;
    let periodNameCurrent: string;
    let periodNamePrevious: string;

    if (type === 'month') {
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const previousMonthStart = subMonths(currentMonthStart, 1);
      const previousMonthEnd = currentMonthStart;
      
      isCurrent = (d: Date) => d >= currentMonthStart;
      isPrevious = (d: Date) => d >= previousMonthStart && d < previousMonthEnd;
      periodNameCurrent = 'Mwezi Huu';
      periodNamePrevious = 'Mwezi Uliopita';
    } else if (type === 'day') {
      const yesterday = startOfDay(subDays(now, 1));
      isCurrent = (d: Date) => d >= today;
      isPrevious = (d: Date) => d >= yesterday && d < today;
      periodNameCurrent = 'Leo';
      periodNamePrevious = 'Jana';
    } else {
      // Default to 'week'
      const currentWeekStart = startOfWeek(now, { weekStartsOn: 0 });
      const previousWeekStart = subDays(currentWeekStart, 7);
      
      isCurrent = (d: Date) => d >= currentWeekStart;
      isPrevious = (d: Date) => d >= previousWeekStart && d < currentWeekStart;
      periodNameCurrent = 'Wiki Hii';
      periodNamePrevious = 'Wiki Iliopita';
    }

    const currentSales = sales.filter(s => isCurrent(new Date(s.date || s.created_at)));
    const previousSales = sales.filter(s => isPrevious(new Date(s.date || s.created_at)));

    const currentExpenses = expenses.filter(e => isCurrent(new Date(e.date || e.created_at)));
    const previousExpenses = expenses.filter(e => isPrevious(new Date(e.date || e.created_at)));

    const curRevenue = currentSales.reduce((acc, s) => acc + s.total_amount, 0);
    const prevRevenue = previousSales.reduce((acc, s) => acc + s.total_amount, 0);

    const curProfit = currentSales.reduce((acc, s) => acc + (s.total_profit || 0), 0);
    const prevProfit = previousSales.reduce((acc, s) => acc + (s.total_profit || 0), 0);

    const curExpense = currentExpenses.reduce((acc, e) => acc + e.amount, 0);
    const prevExpense = previousExpenses.reduce((acc, e) => acc + e.amount, 0);

    const curNet = curProfit - curExpense;
    const prevNet = prevProfit - prevExpense;

    return {
      periodNameCurrent,
      periodNamePrevious,
      current: {
        revenue: curRevenue,
        profit: curProfit,
        expenses: curExpense,
        netProfit: curNet,
        count: currentSales.length
      },
      previous: {
        revenue: prevRevenue,
        profit: prevProfit,
        expenses: prevExpense,
        netProfit: prevNet,
        count: previousSales.length
      },
      changes: {
        revenuePct: prevRevenue > 0 ? ((curRevenue - prevRevenue) / prevRevenue) * 100 : 0,
        profitPct: prevProfit > 0 ? ((curProfit - prevProfit) / prevProfit) * 100 : 0,
        expensesPct: prevExpense > 0 ? ((curExpense - prevExpense) / prevExpense) * 100 : 0,
        netProfitPct: prevNet !== 0 ? ((curNet - prevNet) / Math.abs(prevNet)) * 100 : 0
      }
    };
  }

  static getStockStatus(products: Product[]) {
    const lowStock = products.filter(p => p.stock <= p.min_stock);
    const outOfStock = products.filter(p => p.stock <= 0);
    const totalValueBuy = products.reduce((acc, p) => acc + (p.buy_price * p.stock), 0);
    const totalValueSell = products.reduce((acc, p) => acc + (p.sell_price * p.stock), 0);

    return {
      totalProducts: products.length,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      lowStockItems: lowStock.slice(0, 5).map(p => ({ name: p.name, stock: p.stock })),
      totalValueBuy,
      totalValueSell
    };
  }

  static getDebtsStatus(sales: Sale[], debtPayments: DebtPayment[] = []) {
    // Subtract partial payments so this reflects the actual remaining balance,
    // not the original sale totals.
    const activeDebts = sales
      .filter(s => s.payment_method === 'credit' && s.status === 'pending')
      .map(s => {
        const paid = debtPayments.filter(p => p.sale_id === s.id).reduce((sum, p) => sum + p.amount, 0);
        return { sale: s, remaining: s.total_amount - paid };
      })
      .filter(item => item.remaining > 0.1);
    const totalAmount = activeDebts.reduce((acc, item) => acc + item.remaining, 0);

    return {
      totalAmount,
      debtCount: activeDebts.length,
      topDebtors: activeDebts.slice(0, 5).map(item => ({ name: item.sale.customer_name || 'Mteja', amount: item.remaining }))
    };
  }

  static getSecurityStatus(auditLogs: AuditLog[]) {
    const now = new Date();
    const today = startOfDay(now);
    
    const todayLogs = auditLogs.filter(l => new Date(l.created_at) >= today);
    const anomalies = auditLogs.filter(l => l.action.startsWith('anomaly_'));
    const deletes = auditLogs.filter(l => l.action === 'refund_sale' || l.action === 'delete_all_products');

    const score = (anomalies.length * 2) + (deletes.length * 3);
    
    return {
      score,
      riskLevel: score > 15 ? 'HIGH' : score > 5 ? 'MEDIUM' : 'LOW',
      todayAnomalies: todayLogs.filter(l => l.action.startsWith('anomaly_')).length,
      totalAnomalies: anomalies.length,
      totalDeletes: deletes.length
    };
  }

  static getBusinessSummary(sales: Sale[], expenses: Expense[], products: Product[], period: string, debtPayments: DebtPayment[] = []) {
    const salesReport = this.getSalesReport(sales, expenses, period);
    const stockStatus = this.getStockStatus(products);
    const debtsStatus = this.getDebtsStatus(sales, debtPayments);

    return {
      period,
      revenue: salesReport.revenue,
      profit: salesReport.profit,
      expenses: salesReport.expenses,
      netProfit: salesReport.netProfit,
      transactionCount: salesReport.transactionCount,
      totalProducts: stockStatus.totalProducts,
      lowStockCount: stockStatus.lowStockCount,
      outOfStockCount: stockStatus.outOfStockCount,
      totalValueBuy: stockStatus.totalValueBuy,
      totalValueSell: stockStatus.totalValueSell,
      totalDebts: debtsStatus.totalAmount,
      debtCount: debtsStatus.debtCount
    };
  }

  private static getPeriodFilter(period: string) {
    const now = new Date();
    const today = startOfDay(now);
    
    switch (period) {
      case 'today':
        return (d: Date) => d >= today;
      case 'yesterday':
        const yesterday = startOfDay(subDays(now, 1));
        const endOfYesterday = today;
        return (d: Date) => d >= yesterday && d < endOfYesterday;
      case 'week':
        return (d: Date) => d >= startOfWeek(now, { weekStartsOn: 0 });
      case 'month':
        return (d: Date) => d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      case 'lastMonth':
        const lastM = subMonths(now, 1);
        return (d: Date) => d.getMonth() === lastM.getMonth() && d.getFullYear() === lastM.getFullYear();
      case '6months':
        return (d: Date) => d >= subMonths(now, 6);
      default:
        return (d: Date) => d >= today;
    }
  }
}
