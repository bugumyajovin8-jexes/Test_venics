import { subDays, startOfDay, isWithinInterval } from 'date-fns';
import { Product, Sale, Expense, SaleItem, DebtPayment } from '../../db';

export class AdvancedAnalytics {
  /**
   * 1. Hourly and Weekly Sales Performance
   */
  static getHourlyAndWeeklyPerformance(sales: Sale[], currency: string) {
    const validSales = sales.filter(s => s.isDeleted !== 1 && s.status === 'completed');
    
    // Group by hour
    const hourlyRevenue: Record<number, number> = {};
    const hourlyCount: Record<number, number> = {};
    for (let i = 0; i < 24; i++) {
      hourlyRevenue[i] = 0;
      hourlyCount[i] = 0;
    }

    // Group by day of week (0 = Sunday, 1 = Monday, etc.)
    const weekdayRevenue: Record<number, number> = {};
    const weekdayCount: Record<number, number> = {};
    const weekdayNames = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];
    for (let i = 0; i < 7; i++) {
      weekdayRevenue[i] = 0;
      weekdayCount[i] = 0;
    }

    let morningEarningsToday = 0;
    const today = startOfDay(new Date());

    validSales.forEach(s => {
      const date = new Date(s.date || s.created_at);
      const hour = date.getHours();
      const dayOfWeek = date.getDay();

      hourlyRevenue[hour] += s.total_amount;
      hourlyCount[hour] += 1;

      weekdayRevenue[dayOfWeek] += s.total_amount;
      weekdayCount[dayOfWeek] += 1;

      // Check if it's today morning (before 12 PM)
      if (date >= today && hour < 12) {
        morningEarningsToday += s.total_amount;
      }
    });

    // Find busiest hour
    let peakHour = 17; // Default fallback 5 PM
    let peakRevenue = 0;
    Object.entries(hourlyRevenue).forEach(([hr, rev]) => {
      if (rev > peakRevenue) {
        peakRevenue = rev;
        peakHour = parseInt(hr, 10);
      }
    });

    // Find best & worst weekdays
    let bestDayIdx = 5; // Friday
    let worstDayIdx = 0; // Sunday
    let maxDayRev = 0;
    let minDayRev = Infinity;

    for (let i = 0; i < 7; i++) {
      if (weekdayRevenue[i] > maxDayRev) {
        maxDayRev = weekdayRevenue[i];
        bestDayIdx = i;
      }
      if (weekdayRevenue[i] < minDayRev && weekdayCount[i] > 0) {
        minDayRev = weekdayRevenue[i];
        worstDayIdx = i;
      }
    }
    if (minDayRev === Infinity) minDayRev = 0;

    // Calculate overall average sales per transaction
    const totalRevenue = validSales.reduce((acc, s) => acc + s.total_amount, 0);
    const avgSaleAmount = validSales.length > 0 ? totalRevenue / validSales.length : 0;

    // Average daily sales
    const uniqueDays = new Set(validSales.map(s => startOfDay(new Date(s.date || s.created_at)).getTime()));
    const avgDailySales = uniqueDays.size > 0 ? totalRevenue / uniqueDays.size : 0;

    return {
      peakHour,
      peakRevenue,
      bestDay: weekdayNames[bestDayIdx],
      bestDayRevenue: maxDayRev,
      worstDay: weekdayNames[worstDayIdx],
      worstDayRevenue: minDayRev,
      morningEarningsToday,
      avgDailySales,
      avgSaleAmount,
      weekdayDistribution: weekdayNames.map((name, i) => ({
        name,
        revenue: weekdayRevenue[i],
        count: weekdayCount[i]
      }))
    };
  }

  /**
   * 2. Products and Inventory Intelligence & 3. Product Trends
   */
  static getProductIntelligence(products: Product[], sales: Sale[], saleItems: SaleItem[]) {
    const activeProducts = products.filter(p => p.isDeleted !== 1);
    const validSales = sales.filter(s => s.isDeleted !== 1 && s.status === 'completed');
    const validSaleIds = new Set(validSales.map(s => s.id));
    const validItems = saleItems.filter(item => item.isDeleted !== 1 && validSaleIds.has(item.sale_id));

    // Calculate product quantities sold in last 30 days
    const thirtyDaysAgo = subDays(new Date(), 30);
    const productSales30Days: Record<string, number> = {};
    const productRevenue30Days: Record<string, number> = {};
    const productProfit30Days: Record<string, number> = {};

    validItems.forEach(item => {
      const s = validSales.find(sale => sale.id === item.sale_id);
      if (s) {
        const date = new Date(s.date || s.created_at);
        if (date >= thirtyDaysAgo) {
          productSales30Days[item.product_id] = (productSales30Days[item.product_id] || 0) + item.qty;
          productRevenue30Days[item.product_id] = (productRevenue30Days[item.product_id] || 0) + (item.sell_price * item.qty);
          productProfit30Days[item.product_id] = (productProfit30Days[item.product_id] || 0) + ((item.sell_price - item.buy_price) * item.qty);
        }
      }
    });

    // Overstocked products (e.g. stock is 5x min_stock and stock > 50, OR stock > 100)
    const overstocked = activeProducts.filter(p => p.stock > 0 && (p.stock > p.min_stock * 5 || p.stock > 100));

    // Dead Stock (unmoving): Stock > 0 but 0 sales in last 30 days
    const deadStock = activeProducts.filter(p => p.stock > 0 && (!productSales30Days[p.id] || productSales30Days[p.id] === 0));

    // Fast and Slow Movers
    const moversList = activeProducts.map(p => ({
      ...p,
      qtySold30Days: productSales30Days[p.id] || 0,
      revenue30Days: productRevenue30Days[p.id] || 0,
      profit30Days: productProfit30Days[p.id] || 0
    }));

    const fastMovers = [...moversList]
      .filter(m => m.qtySold30Days > 0)
      .sort((a, b) => b.qtySold30Days - a.qtySold30Days);

    const slowMovers = [...moversList]
      .filter(m => m.stock > 0)
      .sort((a, b) => a.qtySold30Days - b.qtySold30Days);

    // Negative margins
    const negativeMargins = activeProducts.filter(p => p.sell_price <= p.buy_price);

    // Dynamic Trending Products (comparing last 7 days vs previous 7 days)
    const sevenDaysAgo = subDays(new Date(), 7);
    const fourteenDaysAgo = subDays(new Date(), 14);

    const salesThisWeek: Record<string, number> = {};
    const salesLastWeek: Record<string, number> = {};

    validItems.forEach(item => {
      const s = validSales.find(sale => sale.id === item.sale_id);
      if (s) {
        const date = new Date(s.date || s.created_at);
        if (date >= sevenDaysAgo) {
          salesThisWeek[item.product_id] = (salesThisWeek[item.product_id] || 0) + item.qty;
        } else if (date >= fourteenDaysAgo) {
          salesLastWeek[item.product_id] = (salesLastWeek[item.product_id] || 0) + item.qty;
        }
      }
    });

    const trendingProducts = activeProducts.map(p => {
      const thisW = salesThisWeek[p.id] || 0;
      const lastW = salesLastWeek[p.id] || 0;
      let trendPct = 0;
      if (lastW > 0) {
        trendPct = ((thisW - lastW) / lastW) * 100;
      } else if (thisW > 0) {
        trendPct = 100; // First time trending
      }

      return {
        ...p,
        thisWeekQty: thisW,
        lastWeekQty: lastW,
        trendPct
      };
    }).filter(t => t.trendPct > 0 || t.thisWeekQty > 0)
      .sort((a, b) => b.trendPct - a.trendPct);

    const decliningProducts = activeProducts.map(p => {
      const thisW = salesThisWeek[p.id] || 0;
      const lastW = salesLastWeek[p.id] || 0;
      let declinePct = 0;
      if (lastW > 0 && thisW < lastW) {
        declinePct = ((lastW - thisW) / lastW) * 100;
      }

      return {
        ...p,
        thisWeekQty: thisW,
        lastWeekQty: lastW,
        declinePct
      };
    }).filter(d => d.declinePct > 0)
      .sort((a, b) => b.declinePct - a.declinePct);

    return {
      overstocked,
      deadStock,
      fastMovers,
      slowMovers,
      negativeMargins,
      trendingProducts,
      decliningProducts
    };
  }

  /**
   * 4. Financial Health, Profit Margins, and KPI Metrics
   */
  static getFinancialHealth(sales: Sale[], expenses: Expense[]) {
    const validSales = sales.filter(s => s.isDeleted !== 1 && s.status === 'completed');
    const validExpenses = expenses.filter(e => e.isDeleted !== 1);

    const totalRevenue = validSales.reduce((acc, s) => acc + s.total_amount, 0);
    const totalProfit = validSales.reduce((acc, s) => acc + (s.total_profit || 0), 0);
    const totalExpenses = validExpenses.reduce((acc, e) => acc + e.amount, 0);
    const netProfit = totalProfit - totalExpenses;

    // Profit margins
    const profitMarginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const netProfitMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return {
      totalRevenue,
      totalProfit,
      totalExpenses,
      netProfit,
      profitMarginPct,
      netProfitMarginPct,
      expenseToRevenueRatio: totalRevenue > 0 ? (totalExpenses / totalRevenue) * 100 : 0
    };
  }

  /**
   * 5. Customer Loyalty and Behavior Analytics
   */
  static getCustomerAnalytics(sales: Sale[], saleItems: SaleItem[], debtPayments: DebtPayment[] = []) {
    const validSales = sales.filter(s => s.isDeleted !== 1 && s.status === 'completed');

    // Group sales by customer name
    const customerSpends: Record<string, number> = {};
    const customerCounts: Record<string, number> = {};
    const customerLastActive: Record<string, string> = {};
    const customerDebts: Record<string, number> = {};

    const isRealCustomerName = (name?: string) =>
      !!name && name !== '' && name.toLowerCase() !== 'mteja' && name.toLowerCase() !== 'cash' && name.toLowerCase() !== 'mteja wa kawaida';

    validSales.forEach(s => {
      const name = s.customer_name?.trim();
      if (!isRealCustomerName(name)) return;

      customerSpends[name!] = (customerSpends[name!] || 0) + s.total_amount;
      customerCounts[name!] = (customerCounts[name!] || 0) + 1;

      const prevDate = customerLastActive[name!] ? new Date(customerLastActive[name!]) : new Date(0);
      const curDate = new Date(s.date || s.created_at);
      if (curDate > prevDate) {
        customerLastActive[name!] = s.date || s.created_at;
      }
    });

    // Debts come from PENDING credit sales (not 'completed' — a debt is by
    // definition unpaid), minus any partial payments already recorded. Computed
    // separately from validSales above since a sale with an open debt is never
    // 'completed' and would otherwise be excluded entirely.
    sales
      .filter(s => s.isDeleted !== 1 && s.payment_method === 'credit' && s.status === 'pending')
      .forEach(s => {
        const name = s.customer_name?.trim();
        if (!isRealCustomerName(name)) return;

        const paid = debtPayments.filter(p => p.sale_id === s.id).reduce((sum, p) => sum + p.amount, 0);
        const remaining = s.total_amount - paid;
        if (remaining > 0.1) {
          customerDebts[name!] = (customerDebts[name!] || 0) + remaining;
          // A customer whose only transaction is a still-open debt may have no
          // entry yet (validSales only includes 'completed' sales).
          const saleDate = s.date || s.created_at;
          const prevDate = customerLastActive[name!] ? new Date(customerLastActive[name!]) : new Date(0);
          if (new Date(saleDate) > prevDate) {
            customerLastActive[name!] = saleDate;
          }
        }
      });

    // Union of everyone who has either spend history or an open debt.
    const allCustomerNames = new Set([...Object.keys(customerSpends), ...Object.keys(customerDebts)]);

    const activeCustomersList = Array.from(allCustomerNames).map(name => {
      const lastActiveDate = new Date(customerLastActive[name]);
      const daysSinceLastPurchase = Math.ceil((Date.now() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24));

      return {
        name,
        totalSpent: customerSpends[name] || 0,
        visitCount: customerCounts[name] || 0,
        lastPurchase: customerLastActive[name],
        daysInactive: daysSinceLastPurchase,
        isChurned: daysSinceLastPurchase > 30,
        debtAmount: customerDebts[name] || 0
      };
    });

    const topCustomers = [...activeCustomersList].sort((a, b) => b.totalSpent - a.totalSpent);
    const frequentBuyers = [...activeCustomersList].sort((a, b) => b.visitCount - a.visitCount);
    const potentialChurn = activeCustomersList.filter(c => c.isChurned && c.visitCount > 1).sort((a, b) => a.daysInactive - b.daysInactive);
    const debtors = activeCustomersList.filter(c => c.debtAmount > 0).sort((a, b) => b.debtAmount - a.debtAmount);

    // Association / Basket analysis (find items bought together)
    const transactionBaskets: Record<string, string[]> = {};
    const validSaleIds = new Set(validSales.map(s => s.id));
    
    saleItems.filter(item => item.isDeleted !== 1 && validSaleIds.has(item.sale_id)).forEach(item => {
      if (!transactionBaskets[item.sale_id]) {
        transactionBaskets[item.sale_id] = [];
      }
      transactionBaskets[item.sale_id].push(item.product_name);
    });

    // Count item pairs
    const pairFrequencies: Record<string, number> = {};
    Object.values(transactionBaskets).forEach(basket => {
      if (basket.length > 1) {
        const uniqueItems = Array.from(new Set(basket));
        for (let i = 0; i < uniqueItems.length; i++) {
          for (let j = i + 1; j < uniqueItems.length; j++) {
            const pairKey = [uniqueItems[i], uniqueItems[j]].sort().join(" + ");
            pairFrequencies[pairKey] = (pairFrequencies[pairKey] || 0) + 1;
          }
        }
      }
    });

    const popularPairs = Object.entries(pairFrequencies)
      .map(([pair, count]) => ({ pair, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      topCustomers,
      frequentBuyers,
      potentialChurn,
      debtors,
      popularPairs
    };
  }

  /**
   * 6. Strategic Growth & Investment Calculations
   */
  static getInvestmentAndPromoStrategy(products: Product[], saleItems: SaleItem[]) {
    const activeProducts = products.filter(p => p.isDeleted !== 1);
    
    // Agg qty sold to see volume
    const itemQtySold: Record<string, number> = {};
    saleItems.filter(item => item.isDeleted !== 1).forEach(item => {
      itemQtySold[item.product_id] = (itemQtySold[item.product_id] || 0) + item.qty;
    });

    const withMetrics = activeProducts.map(p => {
      const margin = p.sell_price - p.buy_price;
      const marginPct = p.buy_price > 0 ? (margin / p.buy_price) * 100 : 0;
      const totalUnitsSold = itemQtySold[p.id] || 0;
      
      return {
        ...p,
        margin,
        marginPct,
        totalUnitsSold,
        profitContribution: margin * totalUnitsSold
      };
    });

    // 1. High Margin but Low Volume (Excellent items to ADVERTISE / PROMOTE)
    // MarginPct > 30% and sold less than 5 units
    const promoteCandidates = [...withMetrics]
      .filter(p => p.marginPct >= 20 && p.totalUnitsSold < 5)
      .sort((a, b) => b.marginPct - a.marginPct)
      .slice(0, 5);

    // 2. High ROI and High Velocity (Best items to INVEST in restocking / bulk buy)
    // Sorted by profit contribution
    const investCandidates = [...withMetrics]
      .filter(p => p.totalUnitsSold > 2)
      .sort((a, b) => b.profitContribution - a.profitContribution)
      .slice(0, 5);

    return {
      promoteCandidates,
      investCandidates
    };
  }

  /**
   * 7. Comparison Questions (item-to-item or day-to-day)
   */
  static performComparison(query: string, products: Product[], sales: Sale[], saleItems: SaleItem[], currency: string) {
    const text = query.toLowerCase();

    // Word comparisons: coke vs pepsi, fanta vs sprite etc.
    const vsMatch = text.match(/(.+)\s+(?:vs|versus|sawa\s*na|kulinganisha\s*na|na)\s+(.+)/i);
    if (vsMatch) {
      const term1 = vsMatch[1].replace(/gani|bainisha|linganisha/g, '').trim();
      const term2 = vsMatch[2].replace(/gani|bainisha|linganisha/g, '').trim();

      const prod1 = products.find(p => p.name.toLowerCase().includes(term1) && p.isDeleted !== 1);
      const prod2 = products.find(p => p.name.toLowerCase().includes(term2) && p.isDeleted !== 1);

      if (prod1 && prod2) {
        // Tally sales
        const qty1 = saleItems.filter(item => item.product_id === prod1.id && item.isDeleted !== 1).reduce((acc, item) => acc + item.qty, 0);
        const qty2 = saleItems.filter(item => item.product_id === prod2.id && item.isDeleted !== 1).reduce((acc, item) => acc + item.qty, 0);

        const rev1 = qty1 * prod1.sell_price;
        const rev2 = qty2 * prod2.sell_price;

        return {
          type: 'product_comparison',
          found: true,
          p1: { name: prod1.name, qty: qty1, revenue: rev1, price: prod1.sell_price, margin: prod1.sell_price - prod1.buy_price },
          p2: { name: prod2.name, qty: qty2, revenue: rev2, price: prod2.sell_price, margin: prod2.sell_price - prod2.buy_price }
        };
      }
    }

    return { found: false, type: 'unknown' };
  }

  /**
   * 8. Business Health Score (0 - 100) and Multi-point Audit Checklist
   */
  static getStoreHealthScore(products: Product[], sales: Sale[], expenses: Expense[], debtPayments: DebtPayment[] = []) {
    let score = 90; // Start with baseline
    const auditPoints: Array<{ status: 'success' | 'warn' | 'danger'; desc: string; advice: string }> = [];

    const activeProducts = products.filter(p => p.isDeleted !== 1);
    const validSales = sales.filter(s => s.isDeleted !== 1 && s.status === 'completed');
    const validExpenses = expenses.filter(e => e.isDeleted !== 1);

    const totalRevenue = validSales.reduce((acc, s) => acc + s.total_amount, 0);
    const totalProfit = validSales.reduce((acc, s) => acc + (s.total_profit || 0), 0);
    const totalExpenses = validExpenses.reduce((acc, e) => acc + e.amount, 0);
    const netProfit = totalProfit - totalExpenses;

    // Subtract partial debtPayments so the liquidity check below reflects the
    // actual remaining balance, not the original sale totals.
    const activeDebts = sales.filter(s => s.isDeleted !== 1 && s.payment_method === 'credit' && s.status === 'pending');
    const outstandingAmount = activeDebts.reduce((acc, s) => {
      const paid = debtPayments.filter(p => p.sale_id === s.id).reduce((sum, p) => sum + p.amount, 0);
      return acc + Math.max(0, s.total_amount - paid);
    }, 0);

    const lowStock = activeProducts.filter(p => p.stock <= p.min_stock);
    const outOfStock = activeProducts.filter(p => p.stock <= 0);

    // 1. Profitability check
    if (netProfit < 0) {
      score -= 25;
      auditPoints.push({
        status: 'danger',
        desc: 'Matumizi yamezidi Faida (Hasara)',
        advice: 'Kagua matumizi yako haraka sana au rekebisha bei za bidhaa ili uongeze margin.'
      });
    } else if (netProfit === 0) {
      score -= 10;
      auditPoints.push({
        status: 'warn',
        desc: 'Biashara haisongi (Break-Even)',
        advice: 'Faida yako ya bidhaa imeishia kabisa kulipia gharama za uendeshaji mwezi huu.'
      });
    } else {
      auditPoints.push({
        status: 'success',
        desc: `Biashara ina Faida Halisi chanya`,
        advice: `Umetengeneza faida halisi pacha ya ${netProfit.toFixed(0)} katika kipindi hiki!`
      });
    }

    // 2. Debts / liquidity level check
    const debtRatio = totalRevenue > 0 ? outstandingAmount / totalRevenue : 0;
    if (debtRatio > 0.35) {
      score -= 20;
      auditPoints.push({
        status: 'danger',
        desc: 'Mtaji Umefungwa Kwenye Mikopo (Mteja Debts)',
        advice: `Unawadai wateja kiasi kikubwa sana (${outstandingAmount.toFixed(0)}), ambacho ni ${ (debtRatio * 100).toFixed(0) }% ya mauzo yote ya leo. Kusanya haya deni kuokoa ukata!`
      });
    } else if (debtRatio > 0.1) {
      score -= 8;
      auditPoints.push({
        status: 'warn',
        desc: 'Kiwango cha Madeni kipo cha wasiwasi',
        advice: 'Usiwape wateja wengine mikopo bila mkataba madhubuti ili mzunguko usitetemeke.'
      });
    } else {
      auditPoints.push({
        status: 'success',
        desc: 'Kiwango cha mikopo duka ni salama',
        advice: 'Umedhibiti kwa ufanisi mkubwa sana uuzaji wa kukopesha na kulinda ukwasi duka!'
      });
    }

    // 3. Low stock and out of stock check
    if (outOfStock.length > 0) {
      score -= 10;
      auditPoints.push({
        status: 'danger',
        desc: `Kuna bidhaa ${outOfStock.length} zimeisha kabisa`,
        advice: 'Agiza haraka hizi bidhaa ili usipoteze wateja na mapato duka.'
      });
    } else if (lowStock.length > 2) {
      score -= 5;
      auditPoints.push({
        status: 'warn',
        desc: `Bidhaa ${lowStock.length} zipatazo wasiwasi wa kuisha`,
        advice: 'Tenga bajeti ya kuagiza mapema kidogo bidhaa hizi zisiishe.'
      });
    } else {
      auditPoints.push({
        status: 'success',
        desc: 'Usimamizi wa Stoo upo imara',
        advice: 'Bidhaa zako zipo kwenye viwango salama vya kutosheleza wateja kwa sasa!'
      });
    }

    // 4. Missing buy prices audit
    const zeroBuyPrices = activeProducts.filter(p => p.buy_price <= 0);
    if (zeroBuyPrices.length > 0) {
      score -= 10;
      auditPoints.push({
        status: 'warn',
        desc: 'Bidhaa bila Bei ya Kununulia',
        advice: `Kuna bidhaa ${zeroBuyPrices.length} zisizo na bei ya kununulia (buy price). Hii husababisha upotoshaji wa hesabu ya faida katika ripoti na kupunguza uwezo wa Assistant kutoa ripoti sahihi.`
      });
    }

    score = Math.max(10, Math.min(100, score));

    return {
      score,
      badge: score >= 85 ? 'IMARA KABISA 🥇' : score >= 65 ? 'WASTANI SALAMA 📈' : 'TAHADHARI KUBWA 🚨',
      auditPoints
    };
  }
}
