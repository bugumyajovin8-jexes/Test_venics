/**
 * The LLM tail.
 *
 * The 67-skill registry answers the predictable questions locally — free,
 * instant, and offline. Only an `unknown` outcome reaches this file, so the
 * model handles the genuinely open-ended tail ("kwa nini faida imeshuka mwezi
 * huu?") and nothing else.
 *
 * THE CONTRACT: the shop's own code does the arithmetic; the model does the
 * reasoning. Every figure is computed by BusinessLogic and handed over as
 * fact, and the model is told never to calculate or invent one. A confidently
 * wrong shilling amount in front of a shop owner is worse than no answer.
 */

import { generateContent, GeminiGuardError } from '../geminiProxy';
import { BusinessLogic } from './BusinessLogic';
import { AdvancedAnalytics } from './AdvancedAnalytics';
import { formatCurrency } from '../../utils/format';
import { CHAT_MODEL } from '../aiModels';
import type { Product, Sale, SaleItem, Expense, DebtPayment } from '../../db';



export { GeminiGuardError };

export interface SnapshotInput {
  shopName: string;
  currency: string;
  sales: Sale[];
  saleItems: SaleItem[];
  products: Product[];
  expenses: Expense[];
  debtPayments: DebtPayment[];
}

/**
 * Master switch for the CHAT model.
 *
 * OFF while the conversational side is still being developed, so the improved
 * app can ship without it. The chat itself stays fully present: every question
 * the skill registry recognises is still answered locally, offline and free —
 * only the open-ended tail that would have gone to Gemini now offers suggestion
 * chips instead.
 *
 * The AI SCANNER is deliberately unaffected. It calls services/geminiProxy
 * directly and never consults this file, so photo-to-product keeps working.
 *
 * To re-enable the chat model, set this back to true. Nothing else changes.
 */
export const CHAT_LLM_ENABLED = false;

/**
 * Whether the chat may reach the model at all: the feature has to be switched
 * on AND there has to be internet.
 */
export function canUseAi(): boolean {
  if (!CHAT_LLM_ENABLED) return false;
  return typeof navigator === 'undefined' ? false : navigator.onLine !== false;
}

/**
 * Everything the shop already knows about itself.
 *
 * This app computes serious analytics locally — product intelligence, customer
 * churn, basket pairs, peak trading days, margin health — and the first version
 * of this snapshot sent almost none of it, to save tokens. That was the wrong
 * trade: the model's advice can only be as good as what it can see, and a
 * generic answer costs the same as a sharp one.
 *
 * Every figure here is computed by our own code and handed over as fact.
 */
export function buildShopSnapshot(input: SnapshotInput): string {
  const { currency, sales, saleItems, products, expenses, debtPayments } = input;
  const money = (n: number) => formatCurrency(n, currency);
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const names = (arr: any[], n = 5) =>
    arr.slice(0, n).map((p: any) => p?.name).filter(Boolean).join(', ');

  const today = BusinessLogic.getSalesReport(sales, expenses, 'today');
  const month = BusinessLogic.getSalesReport(sales, expenses, 'month');
  const lastMonth = BusinessLogic.getSalesReport(sales, expenses, 'lastMonth');
  const stock = BusinessLogic.getStockStatus(products);
  const debts = BusinessLogic.getDebtsStatus(sales, debtPayments);

  const health = AdvancedAnalytics.getFinancialHealth(sales, expenses);
  const productIntel = AdvancedAnalytics.getProductIntelligence(products, sales, saleItems);
  const timing = AdvancedAnalytics.getHourlyAndWeeklyPerformance(sales, currency);
  const customers = AdvancedAnalytics.getCustomerAnalytics(sales, saleItems, debtPayments);
  const scored = AdvancedAnalytics.getStoreHealthScore(products, sales, expenses, debtPayments);

  const monthDelta = lastMonth.revenue > 0
    ? ((month.revenue - lastMonth.revenue) / lastMonth.revenue) * 100
    : null;

  const lines = [
    `DUKA: ${input.shopName || 'duka'} | Sarafu: ${currency} | Tarehe: ${new Date().toLocaleDateString('en-GB')}`,
    '',
    `— FEDHA —`,
    `Leo: mauzo ${money(today.revenue)}, faida ${money(today.profit)}, matumizi ${money(today.expenses)}, faida halisi ${money(today.netProfit)}, miamala ${today.transactionCount}`,
    `Mwezi huu: mauzo ${money(month.revenue)}, faida ${money(month.profit)}, matumizi ${money(month.expenses)}, faida halisi ${money(month.netProfit)}`,
    `Mwezi uliopita: mauzo ${money(lastMonth.revenue)}, faida halisi ${money(lastMonth.netProfit)}`,
    monthDelta !== null
      ? `Mwenendo wa mwezi: ${monthDelta >= 0 ? '+' : ''}${pct(monthDelta)} ukilinganisha na mwezi uliopita`
      : `Mwenendo wa mwezi: hakuna takwimu za kutosha`,
    `Margin ya bidhaa: ${pct(health.profitMarginPct)} | Margin halisi: ${pct(health.netProfitMarginPct)} | Matumizi ni ${pct(health.expenseToRevenueRatio)} ya mauzo`,
    `Alama ya afya ya duka: ${scored.score}/100 (${scored.badge})`,
  ];

  if (Array.isArray(scored.auditPoints) && scored.auditPoints.length) {
    lines.push(
      `Vikwazo vilivyobainika: ${scored.auditPoints
        .slice(0, 4)
        .map((a: any) => `${a.desc}`)
        .filter(Boolean)
        .join(' | ')}`,
    );
  }

  lines.push('', `— BIDHAA —`);
  lines.push(`Stoo: bidhaa ${stock.totalProducts}, zinazoisha ${stock.lowStockCount}, zimeisha ${stock.outOfStockCount}, thamani ya mzigo ${money(stock.totalValueSell)}`);
  if (stock.lowStockItems.length) {
    lines.push(`Zinazoisha sasa: ${stock.lowStockItems.map(p => `${p.name} (baki ${p.stock})`).join(', ')}`);
  }
  if (productIntel.fastMovers?.length)      lines.push(`Zinauzwa haraka: ${names(productIntel.fastMovers)}`);
  if (productIntel.trendingProducts?.length) lines.push(`Zinapanda wiki hii: ${names(productIntel.trendingProducts)}`);
  if (productIntel.decliningProducts?.length) lines.push(`Zinashuka wiki hii: ${names(productIntel.decliningProducts)}`);
  const deadNames = new Set((productIntel.deadStock ?? []).map((p: any) => p?.name));
  const slowOnly = (productIntel.slowMovers ?? []).filter((p: any) => !deadNames.has(p?.name));
  if (productIntel.deadStock?.length) lines.push(`Hazijauzwa kabisa: ${names(productIntel.deadStock)}`);
  if (slowOnly.length)                lines.push(`Zinatembea polepole: ${names(slowOnly)}`);
  if (productIntel.overstocked?.length)     lines.push(`Mzigo mwingi kupita kiasi: ${names(productIntel.overstocked)}`);
  if (productIntel.negativeMargins?.length) lines.push(`Zinauzwa kwa hasara: ${names(productIntel.negativeMargins)}`);

  // Restocking needs three things the sections above do not carry: how fast a
  // product actually sells, what it costs to buy, and how long the shelf will
  // last. Without these, "what budget do I need for the next order?" can only
  // be guessed at — and the model is forbidden from guessing numbers.
  const WINDOW_DAYS = 30;
  const since = Date.now() - WINDOW_DAYS * 86_400_000;
  const recentQty = new Map<string, number>();
  for (const item of saleItems) {
    if (new Date(item.created_at).getTime() < since) continue;
    recentQty.set(item.product_id, (recentQty.get(item.product_id) ?? 0) + item.qty);
  }

  const restock = products
    .map((p) => {
      const perWeek = ((recentQty.get(p.id) ?? 0) / WINDOW_DAYS) * 7;
      const daysLeft = perWeek > 0 ? (p.stock / (perWeek / 7)) : Infinity;
      return { p, perWeek, daysLeft };
    })
    .filter((r) => r.perWeek > 0 && r.daysLeft < 21)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 8);

  if (restock.length) {
    lines.push('', `— MAHITAJI YA MZIGO (siku 30 zilizopita) —`);
    for (const { p, perWeek, daysLeft } of restock) {
      lines.push(
        `${p.name}: baki ${p.stock}, inauzwa ~${perWeek.toFixed(1)}/wiki, ` +
        `itaisha baada ya siku ~${Math.round(daysLeft)}, bei ya kununua ${money(p.buy_price)}`,
      );
    }
  }

  lines.push('', `— MADENI —`);
  lines.push(`Jumla ya madeni: ${money(debts.totalAmount)} kwa miamala ${debts.debtCount}`);

  // The ONLY grounded list of who owes money. Without it the model was left to
  // infer debt from the spender/churn lists below — which name people who owe
  // nothing. This list already excludes anyone who paid in full, subtracts
  // partial payments, and drops refunded sales.
  const owing = (customers.debtors ?? []).filter((c: any) => (c.debtAmount ?? 0) > 0);
  if (owing.length) {
    lines.push(
      `WANAODAIWA (baki halisi baada ya malipo): ${owing
        .slice(0, 8)
        .map((c: any) => `${c.name} ${money(c.debtAmount)}`)
        .join(', ')}`,
    );
  } else {
    lines.push(`WANAODAIWA: hakuna mteja anayedaiwa kwa sasa.`);
  }

  lines.push('', `— WATEJA (hawa HAWADAIWI; ni takwimu za manunuzi tu) —`);
  const spenders = (customers.topCustomers ?? []).filter((c: any) => (c.totalSpent ?? 0) > 0);
  if (spenders.length) {
    lines.push(`Wanaonunua zaidi: ${spenders.slice(0, 5).map((c: any) => `${c.name} (${money(c.totalSpent)})`).join(', ')}`);
  }
  if (customers.potentialChurn?.length) {
    lines.push(`Hawajarudi kwa muda: ${customers.potentialChurn.slice(0, 5).map((c: any) => `${c.name} (siku ${c.daysInactive})`).join(', ')}`);
  }
  if (customers.popularPairs?.length) {
    lines.push(`Bidhaa zinazonunuliwa pamoja: ${customers.popularPairs.slice(0, 4).map((p: any) => `${p.pair} (mara ${p.count})`).join(', ')}`);
  }

  lines.push('', `— MUDA —`);
  lines.push(`Siku bora: ${timing.bestDay} (${money(timing.bestDayRevenue)}) | Siku dhaifu: ${timing.worstDay} (${money(timing.worstDayRevenue)})`);

  return lines.filter(Boolean).join('\n');
}

const SYSTEM_INSTRUCTION = `Wewe ni "Venics Smart", mshauri wa biashara wa duka dogo nchini Tanzania. Unaongea na mmiliki au mfanyakazi wa duka.

SHERIA MUHIMU:
0. LUGHA: Jibu kwa lugha ILE ILE aliyotumia mtumiaji. Akiuliza kwa Kiswahili, jibu kwa Kiswahili. Akiuliza kwa Kiingereza, jibu kwa Kiingereza (English). Akichanganya, tumia lugha iliyotumika zaidi kwenye swali lake.
1. Tumia TU takwimu ulizopewa hapa chini. USIHESABU, USIKADIRIE, na USITUNGE namba yoyote.
2. Kama swali linahitaji namba usiyopewa, sema huna takwimu hiyo na mwelekeze mahali pa kuiona kwenye app (mfano: Historia ya Mauzo, Ripoti ya Siku, Madeni, Bidhaa).
3. USITAJE kipengele ambacho hujui kama kipo kwenye app. Usiahidi kitu ambacho huna uhakika nacho.
4. UREFU WA JIBU UFUATE SWALI LENYEWE:
   - Swali la moja kwa moja ("faida ya leo ikoje?") → jibu fupi, sentensi 2 hadi 4.
   - Akiomba orodha au idadi maalum ("nipe sababu 10", "njia 5 za...") → TOA IDADI KAMILI aliyoomba, kila moja kwenye mstari wake, kwa ufupi.
   - Swali pana la ushauri → panga hivi: **Hali** (takwimu zinaonyesha nini) → **Fanya hivi** (hatua ya kuchukua) → **Kwa nini** (sababu).
5. Kuwa wa vitendo. Kila ushauri uwe na kitu anachoweza kukifanya leo dukani, siyo nadharia.
6. Kama swali si la biashara wala matumizi ya duka, sema kwa upole kuwa wewe ni mshauri wa duka na umuulize aulize kuhusu biashara yake.
7. Usirudie takwimu zote — chagua zinazojibu swali lake.
8. MADENI — kuwa MWANGALIFU SANA: usiseme mtu yeyote anadaiwa isipokuwa jina lake lipo kwenye orodha ya **WANAODAIWA**. Orodha ya "Wanaonunua zaidi" na "Hawajarudi kwa muda" ni takwimu za manunuzi TU — watu hao HAWADAIWI. Kumtaja mteja kimakosa kuwa anadaiwa kunaweza kumuaibisha na kuharibu uhusiano wake na duka.`;

/**
 * Renders a stored Swahili answer in English.
 *
 * The 65 skill answers stay single-source in Swahili — they are hand-verified
 * against the real UI, and keeping a second copy is exactly how the old
 * KnowledgeBase drifted into describing features that did not exist. English
 * is derived from that verified source instead of maintained beside it.
 *
 * Returns null on any failure so the caller can simply show the Swahili.
 */
export async function translateAnswer(swahiliMarkdown: string): Promise<string | null> {
  if (!CHAT_LLM_ENABLED) return null;
  try {
    const response = await generateContent({
      model: CHAT_MODEL,
      contents:
        `Translate the following Swahili in-app help text into clear, simple English for a shop owner.\n\n` +
        `RULES:\n` +
        `- Keep the markdown structure exactly (headings, numbered steps, bold, quotes).\n` +
        `- Do NOT translate UI labels in **bold** — button and page names stay in Swahili ` +
        `because that is what the shop owner sees on screen. You may add a short English ` +
        `gloss in brackets the first time, e.g. **Ongeza Bidhaa** (Add Product).\n` +
        `- Do not add, remove or invent any step.\n` +
        `- Output only the translated text.\n\n` +
        swahiliMarkdown,
      config: {
        temperature: 0.1, // faithful rendering, not rewriting
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 1500,
      },
    });
    const text = (response.text ?? '').trim();
    return text.length ? text : null;
  } catch (err) {
    console.error('[mshauri] translation failed:', err);
    return null;
  }
}

/**
 * Asks the model. Returns the answer, or null when it produced nothing.
 * Throws GeminiGuardError for quota / kill-switch refusals so the caller can
 * surface the shop-owner-facing message unchanged.
 */
export async function askVenicsSmart(
  question: string,
  snapshot: string,
  userName?: string,
): Promise<string | null> {
  // Fails closed here as well as at the call site, so a future caller that
  // forgets canUseAi() cannot quietly start spending again.
  if (!CHAT_LLM_ENABLED) return null;

  const response = await generateContent({
    model: CHAT_MODEL,
    contents: `Takwimu za duka sasa hivi:\n${snapshot}\n\nSwali${userName ? ` la ${userName}` : ''}: ${question}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      // Low enough to stay anchored to the figures, high enough to reason
      // about them rather than reciting them back.
      temperature: 0.6,
      // Thinking ON, deliberately. It is the single biggest quality lever on
      // these models, and the brief here is a genuinely smart answer rather
      // than a cheap one. Its tokens share the ceiling below, which is why the
      // ceiling is generous.
      thinkingConfig: { thinkingBudget: 2048 },
      // A ceiling, not a charge — you pay for tokens actually generated, so
      // this is set high enough for a full 10-item list plus thinking overhead
      // if the budget above cannot be disabled.
      maxOutputTokens: 4000,
    },
  });

  const text = (response.text ?? '').trim();
  return text.length ? text : null;
}
