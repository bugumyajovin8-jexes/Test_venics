import { formatCurrency } from '../../utils/format';

export class ResponseGenerator {
  static generate(intent: string, data: any, currency: string, userName: string = ''): string {
    const greeting = `Habari Boss ${userName}, `;

    switch (intent) {
      case 'REPORT_SALES':
        return `### Ripoti ya Mauzo na Faida\n${greeting}nimechambua mauzo yako na hapa kuna mchanganuo:\n\n` +
               `- **Mauzo Ghafi (Revenue):** ${formatCurrency(data.revenue, currency)}\n` +
               `- **Faida ya Bidhaa (Profit):** ${formatCurrency(data.profit, currency)}\n` +
               `- **Matumizi (Expenses):** ${formatCurrency(data.expenses, currency)}\n` +
               `--- \n` +
               `- **Faida Halisi (Net Profit):** **${formatCurrency(data.netProfit, currency)}**\n\n` +
               `Miamala iliyofanyika ni **${data.transactionCount}**. Kumbuka, faida halisi ni baada ya kutoa gharama zote za uendeshaji.`;

      case 'REPORT_STOCK':
        let stockMsg = `### Hali ya Stoo na Bidhaa\n${greeting}hali ya mzigo wako stoo ni kama ifuatavyo:\n\n` +
               `- **Jumla ya Bidhaa:** ${data.totalProducts} tofauti\n` +
               `- **Bidhaa zilizoisha (Out of Stock):** **${data.outOfStockCount}** ⚠️\n` +
               `- **Bidhaa zinazoisha (Low Stock):** **${data.lowStockCount}**\n` +
               `- **Thamani ya Mzigo (Bei ya Kununua):** ${formatCurrency(data.totalValueBuy, currency)}\n` +
               `- **Thamani ya Mzigo (Bei ya Kuuza):** **${formatCurrency(data.totalValueSell, currency)}**\n\n`;
        
        if (data.lowStockItems.length > 0) {
          stockMsg += `**Bidhaa zinazohitaji kuagizwa haraka:**\n`;
          data.lowStockItems.forEach((p: any) => stockMsg += `- ${p.name} (Baki: ${p.stock})\n`);
        }
        return stockMsg;

      case 'REPORT_DEBTS':
        let debtMsg = `### Ripoti ya Madeni ya Wateja\n${greeting}hivi sasa duka linawadai wateja jumla ya **${formatCurrency(data.totalAmount, currency)}**.\n\n` +
               `- **Idadi ya Madeni:** ${data.debtCount} miamala\n\n`;
        
        if (data.topDebtors.length > 0) {
          debtMsg += `**Wadaiwa wakubwa wa duka:**\n`;
          data.topDebtors.forEach((d: any) => debtMsg += `- **${d.name}:** ${formatCurrency(d.amount, currency)}\n`);
        }
        debtMsg += `\nUshauri: Boss, jaribu kufuatilia haya madeni ili kuongeza mzunguko wa pesa duka (Cash Flow).`;
        return debtMsg;

      case 'REPORT_SECURITY':
        const riskLabel = data.riskLevel === 'HIGH' ? 'HATARI KUBWA 🚨' : data.riskLevel === 'MEDIUM' ? 'TAHADHARI/MASHAKA ⚠️' : 'SALAMA ✅';
        return `### Uchambuzi wa Tathmini na Usalama\n${greeting}nimechunguza mienendo duka na hapa kuna ripoti ya mabadiliko ya mfumo:\n\n` +
               `- **Kiwango cha Usalama wa Duka:** **${riskLabel}**\n` +
               `- **Mabadiliko ya Shaka Leo:** ${data.todayAnomalies}\n` +
               `- **Jumla ya Matukio ya Mashaka:** ${data.totalAnomalies}\n` +
               `- **Miamala iliyofutwa/Kurejeshwa:** ${data.totalDeletes}\n\n` +
               `Ushauri: Hakikisha unapekua "Ripoti ya Mabadiliko duka" mara kwa mara kuona nani amefuta nini na kwa nini. Uangalizi wa karibu unazuia upotevu wa mtaji.`;

      case 'ACTION_SYNC':
        return `### Msaada wa Usawazishaji (Sync Support)\n${greeting}inaonekana unahitaji msaada wa kusawazisha data kati ya vifaa vyako.\n\n` +
               `**Mambo ya kufanya:**\n` +
               `1. Hakikisha vifaa vyote (Simu na Kompyuta) vina **Internet**.\n` +
               `2. Hakikisha duka lipo "Active" (usije ukawa umeiacha app imelala).\n` +
               `3. Ikiwa bado sioni mauzo, bofya kitufe cha **"Sync Now"** kwenye menyu ya pembeni.\n\n` +
               `Nitajibu "Ukaguzi wa Usawazishaji" hapa chini kukusaidia zaidi...`;

      case 'REPORT_BEST_SELLING':
        return `### Bidhaa Zinazouzwa Sana (Best Selling Products)\n${greeting}nimepiga hesabu ya bidhaa zinazoongoza kwa mauzo duka kwako hivi sasa.\n\n` +
               `Hapa kuna orodha ya bidhaa zilizokimbizwa zaidi hivi sasa:`;

      case 'REPORT_COMPARISON': {
        const cur = data.current;
        const prev = data.previous;
        const chg = data.changes;

        const revDir = chg.revenuePct >= 0 ? '▲ +' : '▼ ';
        const profDir = chg.profitPct >= 0 ? '▲ +' : '▼ ';
        const expDir = chg.expensesPct >= 0 ? '▲ +' : '▼ ';
        const netDir = chg.netProfitPct >= 0 ? '▲ +' : '▼ ';

        let report = `### Ripoti ya Ulinganisho Biashara (${data.periodNameCurrent} Vs ${data.periodNamePrevious})\n`;
        report += `${greeting}Nimefanya hesabu ya kulinganisha metrics zako na hapa kuna mchanganuo kamili:\n\n`;

        report += `| Kipimo (Metric) | ${data.periodNamePrevious} | ${data.periodNameCurrent} | Mabadiliko (%) |\n`;
        report += `| :--- | :--- | :--- | :--- |\n`;
        report += `| **Mauzo (Revenue)** | ${formatCurrency(prev.revenue, currency)} | ${formatCurrency(cur.revenue, currency)} | **${revDir}${chg.revenuePct.toFixed(1)}%** |\n`;
        report += `| **Faida ya Bidhaa** | ${formatCurrency(prev.profit, currency)} | ${formatCurrency(cur.profit, currency)} | **${profDir}${chg.profitPct.toFixed(1)}%** |\n`;
        report += `| **Gharama za Matumizi** | ${formatCurrency(prev.expenses, currency)} | ${formatCurrency(cur.expenses, currency)} | **${expDir}${chg.expensesPct.toFixed(1)}%** |\n`;
        report += `| **Faida Halisi (Net Profit)** | **${formatCurrency(prev.netProfit, currency)}** | **${formatCurrency(cur.netProfit, currency)}** | **${netDir}${chg.netProfitPct.toFixed(1)}%** |\n\n`;

        report += `### Mapendekezo ya Kuboresha (Business Actions):\n`;

        if (chg.expensesPct > chg.revenuePct && chg.expensesPct > 0) {
          report += `1. ⚠️ **Matumizi Nje ya Mpangilio:** Gharama za matumizi zimekua kwa **${chg.expensesPct.toFixed(1)}%** wakati mauzo yamekua kwa **${chg.revenuePct.toFixed(1)}%** pekee. Hii inadondosha faida yako halisi. Fanya ukaguzi wa matumizi hivi sasa uone wapi unaweza kubana gharama ya uendeshaji.\n`;
        } else if (chg.expensesPct > 15) {
          report += `1. ⚠️ **Gharama Kubwa:** Matumizi ya uendeshaji yamepunzika kwa kasi (**${chg.expensesPct.toFixed(1)}%**). Hakikisha matumizi yote yanarekodiwa kwa kiyakinifu na kupunguza posho au gharama zisizo za lazima.\n`;
        } else {
          report += `1. ✅ **Udhibiti wa Matumizi:** Umedhibiti vizuri gharama zako za matumizi kipindi hiki ukiwiana na mzunguko wa mauzo.\n`;
        }

        if (chg.revenuePct < 0) {
          report += `2. 📉 **Kuongeza Kasi ya Mauzo:** Mauzo yameshuka kwa **${Math.abs(chg.revenuePct).toFixed(1)}%**. Mapendekezo:\n`;
          report += `   - Agiza bidhaa zinazouzwa sana (*bestsellers*) kuondoa ombwe la wateja kukosa vitu.\n`;
          report += `   - Rekodi mauzo ya mikopo kwa umakini ili kutoacha kumbukumbu kando.\n`;
        } else if (chg.revenuePct > 0) {
          report += `2. 📈 **Mwenendo Chanya wa Mauzo:** Mauzo yako yameongezeka kwa **${chg.revenuePct.toFixed(1)}%**! Mbinu sahihi sasa ni kuhamasisha wateja kupitia punguzo ndogo (discounts) la ununuzi mfululizo au kutoa huduma bora zaidi kuendeleza kasi hii.\n`;
        }

        if (cur.netProfit <= 0) {
          report += `3. 🚨 **Hatari ya Ukata wa Faida:** Faida yako halisi kwa sasa hivi ipo upande wa hasara au ni ndogo sana (Net Profit: **${formatCurrency(cur.netProfit, currency)}**). Weka kipaumbele sasa kwenye kubadilisha bei za bidhaa zenye margin ndogo au kupunguza matumizi yasiyo na tija kwanza kabisa.\n`;
        } else if (chg.netProfitPct > 0) {
          report += `3. 🎉 **Hongera!** Faida yako halisi imekua kwa **${chg.netProfitPct.toFixed(1)}%**. Hii inathibitisha duka lina afya nzuri na uamuzi wako hivi karibuni umeanza kuleta matunda mwanana. Endelea hivi hivi!\n`;
        }

        return report;
      }

      case 'REPORT_BUSINESS': {
        const p = data.period;
        let periodName = 'Leo';
        if (p === 'yesterday') periodName = 'Jana';
        else if (p === 'week') periodName = 'Wiki Hii';
        else if (p === 'month') periodName = 'Mwezi Huu';
        else if (p === 'lastMonth') periodName = 'Mwezi Uliopita';
        else if (p === '6months') periodName = 'Miezi 6 Iliopita';

        // Tailor advice
        let tailoredAdvice = '';
        if (data.netProfit <= 0) {
          tailoredAdvice = `🚨 **Tahadhari ya Faida:** Biashara inapoteza au haijatengeneza faida ya kutosha katika kipindi hiki. Boss, tafadhali kagua matumizi yako ya hivi karibuni au ongeza msisitizo kwenye mzunguko wa bidhaa zenye kiasi kikubwa cha faida.`;
        } else if (data.outOfStockCount > 0 || data.lowStockCount > 3) {
          tailoredAdvice = `⚠️ **Agiza Bidhaa Mpya:** Kuna bidhaa zipatazo **${data.outOfStockCount}** ambazo zimeisha stoo na zingine **${data.lowStockCount}** zilizobaki kidogo. Boss, mzunguko wa bidhaa hizi ukisita unaweza kupunguza kasi ya faida yako. Agiza mzigo sasa!`;
        } else if (data.totalDebts > 0 && (data.revenue > 0 ? (data.totalDebts / data.revenue) > 0.3 : true)) {
          tailoredAdvice = `💳 **Kusanya Madeni:** Unawadai wateja jumla ya **${formatCurrency(data.totalDebts, currency)}** hivi sasa. Thamani ya madeni haya ni kubwa kulinganisha na mzunguko wa pesa duka. Boss, anza kuwafuatilia wadeni wako sasa kuokoa ukata!`;
        } else {
          tailoredAdvice = `✅ **Mwenendo Unaoridhisha:** Biashara yako ina sifa zote za afya njema ya kifedha kipindi hiki. Boss, endelea kufuatilia kwa makini na kurekodi kila miamala ya duka kwa uaminifu huohuo!`;
        }

        return `### 📊 Mchanganuo wa Biashara (${periodName})\n` +
               `${greeting}hapa kuna muhtasari na mchanganuo wa jumla wa afya ya biashara yako:\n\n` +
               `#### 💰 Afya ya Kifedha & Faida:\n` +
               `- **Mauzo (Revenue):** **${formatCurrency(data.revenue, currency)}** _(${data.transactionCount} miamala)_\n` +
               `- **Matumizi (Expenses):** **${formatCurrency(data.expenses, currency)}**\n` +
               `- **Faida Halisi (Net Profit):** **${formatCurrency(data.netProfit, currency)}** — _Hizi ni fedha safi zilizobaki baada ya kutoa gharama zote za uendeshaji._\n\n` +
               `#### 📦 Mzigo wa Stoo & Thamani (Stock Status):\n` +
               `- **Thamani ya Mzigo (Bei ya Kuuza):** **${formatCurrency(data.totalValueSell, currency)}** _(Makadirio ya mtaji wako uko hapa)_\n` +
               `- **Bidhaa Zinazokwenda Chini stoo:** **${data.lowStockCount}** zimepungua | **${data.outOfStockCount}** zimeisha\n\n` +
               `#### 💳 Mzunguko wa Madeni (Debts):\n` +
               `- **Jumla ya Madeni ya Wateja:** **${formatCurrency(data.totalDebts, currency)}** _(${data.debtCount} wa miamala/mikopo)_\n\n` +
               `#### 💡 Maoni ya Mshauri Shupavu:\n` +
               `${tailoredAdvice}`;
      }

      case 'GENERAL_HELP':
        return `### Habari, Mimi ni Venics Smart!\nNimeundwa kukusaidia kusimamia duka lako kwa akili zaidi. Unaweza kuniuliza mambo kama:\n\n` +
               `- "Mauzo ya leo yakoje?"\n` +
               `- "Bidhaa gani zinaisha?"\n` +
               `- "Nani ananidai kiasi gani?"\n` +
               `- "Matumizi ya mwezi huu?"\n` +
               `- "Kuna viashiria vya wizi?"\n\n` +
               `Nipo hapa kukuza mtaji wako! Naweza pia kutoa ushauri wa kibiashara ukiuliza "Nifanye nini kukuza duka?"`;

      default:
        return `${greeting}Samahani, sijaelewa swali lako vizuri. Tafadhali uliza kuhusu mauzo, stock, madeni, au ulinzi wa duka.`;
    }
  }
}
