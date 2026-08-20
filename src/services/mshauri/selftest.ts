/**
 * Routing fixture.
 *
 * Real questions → the skill that must answer them. The old engine had zero
 * tests, which is why every regex tweak silently broke something else. Run it:
 *
 *   npx tsx src/services/mshauri/selftest.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { match, debugRank } from './matcher';
import { validateRegistry, SKILLS } from './registry';
import {
  recordUnresolved, recordAlias, lookupAlias, getUnresolved, clearAliases, clearUnresolved,
} from './learning';

/**
 * Every `spotlight` a skill points at must exist as a `data-tour` attribute on
 * a real control. Without this check a renamed button silently turns the
 * "show me the button" promise into a no-op — the same failure mode as the old
 * engine's dead follow-up ids.
 */
function validateSpotlights(): string[] {
  const pagesDir = join(import.meta.dirname, '..', '..', 'pages');
  const present = new Set<string>();

  for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.tsx'))) {
    const src = readFileSync(join(pagesDir, file), 'utf8');
    for (const m of src.matchAll(/data-tour="([^"]+)"/g)) present.add(m[1]);
  }

  const problems: string[] = [];
  for (const skill of SKILLS) {
    const id = skill.destination?.spotlight;
    if (id && !present.has(id)) {
      problems.push(`${skill.id}: spotlight "${id}" has no data-tour target in any page`);
    }
  }
  return problems;
}

/** [question, expected skill, skill that answered the previous turn] */
type Case = [question: string, expectedSkillId: string, contextSkillId?: string];

export const CASES: Case[] = [
  // --- Regressions the old engine got wrong -----------------------------
  ['nifutaje bidhaa?', 'product.delete'],
  ['jinsi ya kufuta bidhaa', 'product.delete'],
  ['nataka kuondoa bidhaa kwenye orodha', 'product.delete'],
  ['futa mauzo', 'sale.refund'],
  ['jinsi ya kufuta muamala wa mauzo', 'sale.refund'],
  ['habari za asubuhi', 'system.greeting'],
  ['mambo vipi', 'system.greeting'],
  ['jinsi ya kusajili mteja', 'customer.credit'],

  // --- The headline ask -------------------------------------------------
  ['nawezaje kuongeza mfanyakazi', 'staff.add'],
  ['how can i add employee', 'staff.add'],
  ['jinsi ya kuongeza mfanyakazi', 'staff.add'],
  ['nataka kuajiri mhudumu mpya', 'staff.add'],
  ['ruhusa za mfanyakazi', 'staff.permissions'],

  // --- How-to vs data separation ----------------------------------------
  ['jinsi ya kufanya mauzo', 'sale.howto'],
  ['mauzo ya leo', 'data.sales'],
  ['faida ya leo kiasi gani', 'data.sales'],
  ['nimeuza kiasi gani wiki hii', 'data.sales'],
  ['jinsi ya kurekodi matumizi', 'expense.add'],
  ['matumizi ya leo', 'data.expenses'],
  ['jinsi ya kuongeza bidhaa', 'product.add'],
  ['bidhaa gani zinaisha stoo', 'data.stock'],

  // --- Inventory --------------------------------------------------------
  ['ongeza mzigo wa bidhaa', 'product.restock'],
  ['jinsi ya kubadilisha bei ya bidhaa', 'product.edit_price'],
  ['bidhaa gani zimedoda', 'data.dead_stock'],
  ['bidhaa zinazouzwa sana', 'data.bestselling'],
  ['expiry date ya bidhaa', 'product.expiry'],
  ['jinsi ya kutumia barcode', 'product.barcode'],

  // --- Money / customers -------------------------------------------------
  ['nani anadaiwa hela nyingi', 'data.debts'],
  ['jinsi ya kupokea malipo ya deni', 'customer.pay_debt'],
  ['jinsi ya kukopesha mteja', 'customer.credit'],
  ['jinsi ya kutoa punguzo', 'sale.discount'],
  ['jinsi ya kuchapa risiti', 'sale.receipt'],

  // --- Reports / security / system ---------------------------------------
  ['kuna viashiria vya wizi', 'data.security'],
  ['linganisha wiki hii na iliyopita', 'data.comparison'],
  ['ripoti ya siku', 'report.daily_page'],
  ['jinsi ya kupakua ripoti excel', 'report.export'],
  ['printa haichapi risiti', 'error.printer'],
  ['siwezi kuingia kwenye akaunti', 'error.login'],
  ['data hazisync', 'system.sync'],
  ['leseni imeisha', 'license.renew'],
  ['nifanye nini kukuza duka', 'unknown'],
  ['unafanya nini', 'system.help'],

  // --- Generalization: phrasings that appear in NO skill phrase list -----
  ['niongezeje mhudumu', 'staff.add'],
  ['nataka kumsajili muuzaji mpya', 'staff.add'],
  ['nifanyeje niondoe bidhaa iliyoharibika', 'product.delete'],
  ['leo nimepata faida kiasi gani', 'data.sales'],
  ['nionyeshe matumizi ya mwezi huu', 'data.expenses'],
  ['mzigo umeisha', 'data.stock'],
  ['bei ya bidhaa nibadilishe vipi', 'product.edit_price'],
  ['ninawezaje kuweka tarehe ya kuisha muda', 'product.expiry'],
  ['nisaidie kuongeza mauzo', 'unknown'],
  ['nimekosea kuuza nifanyeje', 'sale.refund'],
  ['wafanyakazi wangu wanauza vipi', 'data.employees'],
  ['nionyeshe wanaodaiwa', 'data.debts'],

  // --- Phase 2: newly covered features ---------------------------------
  ['andika mauzo nyuma', 'sale.backdated'],
  ['nilisahau kuandika matumizi ya jana', 'expense.backdated'],
  ['nibadilishe idadi kikapuni', 'cart.quantity'],
  ['pakua risiti pdf', 'sale.pdf_receipt'],
  ['zima ufuatiliaji wa stoki', 'product.stock_tracking'],
  ['simamia batches', 'product.batches'],
  ['kizuizi cha bidhaa', 'product.min_stock'],
  ['bidhaa zinazouzwa kwa hasara', 'product.price_check'],
  ['nitafutaje bidhaa', 'product.search'],
  ['bidhaa haionekani kwenye mauzo', 'sale.product_missing'],
  ['tuma whatsapp kwa mdeni', 'debt.whatsapp'],
  ['madeni yaliyolipwa', 'debt.paid'],
  ['kundi la matumizi', 'expense.categories'],
  ['historia ya mauzo', 'report.history'],
  ['pokea ripoti kila siku', 'report.daily_email'],
  ['zuia mfanyakazi', 'staff.edit'],
  ['ongeza duka jingine', 'shop.add'],
  ['duka la saa 24', 'shop.hours24'],
  ['hariri wasifu', 'settings.profile'],
  ['futa historia', 'settings.clear_history'],
  ['huduma kwa wateja', 'support.contact'],
  ['nani amebadilisha bei ya bidhaa', 'audit.price_changes'],
  ['dashibodi inaonyesha nini', 'dashboard.overview'],
  ['faida halisi ni nini', 'explain.net_profit'],
  ['faida ya bidhaa inahesabiwaje', 'explain.margin'],
  ['thamani ya mzigo maana yake', 'explain.capital'],
  ['naweza kutumia bila internet', 'explain.offline'],

  // --- Phase 2: follow-up context ---------------------------------------
  // Time-only replies stay on the previous skill.
  ['na mwezi huu?', 'data.sales', 'data.sales'],
  ['je jana?', 'data.expenses', 'data.expenses'],
  ['vipi wiki hii', 'data.debts', 'data.debts'],
  // Without context the same fragment must NOT resolve.
  ['na mwezi huu?', 'unknown'],

  // --- Guard: Phase 1 answers must not regress --------------------------
  ['mauzo ya leo', 'data.sales', 'staff.add'],
  ['jinsi ya kuongeza mfanyakazi', 'staff.add', 'data.sales'],

  // --- Strategy and diagnosis belong to the model, never to a canned answer.
  //     These were previously answered locally by advice.grow / advice.health,
  //     which gave generic advice in place of real reasoning.
  ['Nifanye nini ili kukuza mauzo yangu leo?', 'unknown'],
  ['Mwelekeo wa biashara yangu miezi 6 ijayo', 'unknown'],
  ['nitawezaje kushinda mshindani wangu', 'unknown'],
  ['niwekeze wapi faida yangu', 'unknown'],
  ['duka langu liko sawa?', 'unknown'],
  ['kuna shida gani kwenye duka langu', 'unknown'],
  ['kwa nini mauzo yameshuka', 'unknown'],
  ['nitegemee mauzo kiasi gani mwezi ujao', 'unknown'],
  ['nianze kuuza bidhaa gani mpya', 'unknown'],

  // --- Phase 4: the assistant reporting its own gaps --------------------
  ['maswali usiyoelewa', 'system.unknowns'],
  ['nionyeshe mapungufu yako', 'system.unknowns'],
  ['unafanya nini', 'system.help'],
];

/** localStorage stand-in so the learning store is exercised under Node. */
function installMemoryStorage() {
  const data = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

/** Unknown → user rephrases → the original wording is learned. */
function testLearning(): string[] {
  const problems: string[] = [];
  installMemoryStorage();

  const gibberish = 'nataka kumuweka mtu wa kunisaidia dukani';

  const before = match(gibberish);
  if (before.type === 'answer') {
    problems.push(`learning: "${gibberish}" should not resolve before teaching (got ${before.skill.id})`);
  } else {
    recordUnresolved(gibberish, before.type === 'unknown' ? before.nearest.map((s) => s.id) : []);
    if (getUnresolved().length !== 1) problems.push('learning: unresolved question was not recorded');
  }

  recordAlias(gibberish, 'staff.add');

  const after = match(gibberish);
  if (after.type !== 'answer' || after.skill.id !== 'staff.add') {
    problems.push(`learning: alias not applied (got ${after.type === 'answer' ? after.skill.id : after.type})`);
  }
  if (getUnresolved().length !== 0) {
    problems.push('learning: resolved gap should stop being reported');
  }

  // A single word is too ambiguous to bind.
  recordAlias('kitu', 'data.sales');
  if (lookupAlias('kitu')) problems.push('learning: single-token alias should be rejected');

  clearAliases();
  clearUnresolved();
  return problems;
}

function run() {
  const problems = [...validateRegistry(), ...validateSpotlights(), ...testLearning()];
  if (problems.length) {
    console.log('\n❌ Registry integrity:');
    for (const p of problems) console.log('   ', p);
  } else {
    console.log('\n✅ Integrity: registry + spotlight targets + learning loop');
  }

  let pass = 0;
  const failures: string[] = [];

  for (const [question, expected, contextSkillId] of CASES) {
    const outcome = match(question, { lastSkillId: contextSkillId });
    const actual =
      outcome.type === 'answer' ? outcome.skill.id
      : outcome.type === 'clarify' ? `clarify(${outcome.candidates.map((c) => c.id).join('|')})`
      : 'unknown';

    if (actual === expected) {
      pass++;
    } else {
      failures.push(`   "${question}"\n      expected: ${expected}\n      actual:   ${actual}`);
    }
  }

  console.log(`\n📊 Routing: ${pass}/${CASES.length} passed\n`);
  if (failures.length) {
    console.log('❌ Failures:\n' + failures.join('\n\n'));
    console.log('\n--- Rankings for the first failure ---');
    const firstFailed = CASES.find(([q, e, c]) => {
      const o = match(q, { lastSkillId: c });
      return (o.type === 'answer' ? o.skill.id : o.type) !== e;
    });
    if (firstFailed) console.dir(debugRank(firstFailed[0]), { depth: null });
  }

  return failures.length === 0 && problems.length === 0;
}

// Executed directly via tsx.
const ok = run();
process.exitCode = ok ? 0 : 1;
