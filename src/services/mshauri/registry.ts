/**
 * Skill registry.
 *
 * Every capability the assistant has is one self-describing entry. There is no
 * ordered rule cascade — the matcher scores all of these in parallel and the
 * best one wins, so adding a skill can never silently shadow an existing one
 * the way inserting an `if` branch used to.
 *
 * Concept guards:
 *   must  — ALL required
 *   any   — at least ONE required
 *   boost — each present one adds score
 *   block — any present one disqualifies
 */

import { C } from './concepts';
import type { Skill } from './types';

export const SKILLS: Skill[] = [
  // =====================================================================
  // SALES — how to
  // =====================================================================
  {
    id: 'sale.howto',
    kind: 'howto',
    domain: 'sales',
    title: 'Jinsi ya kufanya mauzo',
    phrases: ['jinsi ya kufanya mauzo', 'nawezaje kuuza', 'nifanyeje mauzo', 'how to sell', 'kuuza bidhaa', 'piga mauzo'],
    must: [C.SALE],
    // REFUND/DELETE mean they want to undo a sale, not learn how to make one.
    block: [C.STAFF, C.DEBT, C.EXPENSE, C.SECURITY, C.REFUND, C.DELETE, C.BACKDATE, C.GROW],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Jinsi ya Kufanya Mauzo
1. Nenda kwenye ukurasa wa **Mauzo (Kikapu)**.
2. Gusa bidhaa unayotaka kuuza ili iingie kwenye kikapu. Kila mguso unaongeza idadi kwa moja.
3. Chini ya kikapu chagua namna mteja anavyolipa:
   - **UZA (CASH)** — malipo ya taslimu.
   - **UZA (SIMU/BANK)** — M-Pesa, Tigo Pesa, Airtel Money au benki.
   - **MKOPO** — mteja anachukua kwa deni.
4. Ukichagua **MKOPO**, jaza **Jina la Mteja**, **Namba ya Simu** na **Tarehe ya Kulipa**, kisha bofya **"Kamilisha Mkopo"**.
5. Mauzo yatahifadhiwa na stoo itapungua yenyewe.`,
    destination: { route: '/kikapu', spotlight: 'checkout-btn', label: 'Nipeleke kwenye Mauzo' },
    related: ['sale.discount', 'sale.receipt', 'customer.credit'],
  },
  {
    id: 'sale.cart',
    kind: 'howto',
    domain: 'sales',
    title: 'Kuongeza bidhaa kwenye kikapu',
    phrases: ['jinsi ya kuongeza bidhaa kwenye kikapu', 'add to cart', 'ongeza kwenye kikapu'],
    must: [C.CART],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kutumia Kikapu
- **Kuingiza bidhaa:** gusa jina la bidhaa kwenye orodha. Kila mguso unaongeza idadi kwa moja (+1).
- **Kubadilisha idadi:** gusa namba ya idadi (mfano *3x*) kwenye safu ya bidhaa — kibodi itafunguka uandike idadi unayotaka.
- **Kubadilisha bei:** gusa bei kwenye safu ya **"Bei / Punguzo"**.
- **Kuondoa bidhaa:** gusa ikoni nyekundu ya **tupio (🗑)** upande wa kushoto wa jina la bidhaa.`,
    destination: { route: '/kikapu', spotlight: 'cart-list', label: 'Nipeleke kwenye Kikapu' },
    related: ['sale.howto', 'sale.discount'],
  },
  {
    id: 'sale.discount',
    kind: 'howto',
    domain: 'sales',
    title: 'Kutoa punguzo (discount)',
    phrases: ['jinsi ya kutoa punguzo', 'discount', 'punguza bei kwenye mauzo', 'nifanyeje discount'],
    must: [C.DISCOUNT],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kutoa Punguzo (Discount)
Punguzo hutolewa kwa **kubadilisha bei ya bidhaa moja kwa moja kikapuni**.

1. Ingiza bidhaa kwenye **Kikapu**.
2. Kwenye safu ya **"Bei / Punguzo"**, gusa **bei** ya bidhaa husika — kibodi ndogo itafunguka.
3. Andika bei mpya (iliyopunguzwa) kisha thibitisha.
4. Jumla itahesabika upya papo hapo, na faida itahesabiwa kwa bei mpya uliyoweka.

> ⚠️ Ukipunguza bei chini ya bei ya kununua, mauzo hayo yataleta hasara — na mabadiliko yataonekana kwenye **Mabadiliko ya Bidhaa**.`,
    destination: { route: '/kikapu', spotlight: 'cart-list', label: 'Nipeleke kwenye Kikapu' },
    related: ['sale.howto', 'product.edit_price'],
  },
  {
    id: 'sale.mobile_money',
    kind: 'howto',
    domain: 'sales',
    title: 'Malipo ya simu (M-Pesa / Tigo / Airtel)',
    phrases: ['jinsi ya kurekodi mpesa', 'malipo ya simu', 'mobile money', 'lipa namba', 'tigo pesa'],
    must: [C.MOBILE_MONEY],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kurekodi Malipo ya Simu (Mobile Money)
1. Baada ya kujaza kikapu, bofya **"Kamilisha Mauzo"**.
2. Kwenye njia za malipo, chagua **"Simu (Mobile Money)"**.
3. Muamala utarekodiwa kama malipo ya mtandao, na utaonekana tofauti na taslimu kwenye ripoti yako ya **Miamala (Cash / Simu)**.`,
    destination: { route: '/kikapu', spotlight: 'checkout-btn', label: 'Nipeleke kwenye Mauzo' },
    related: ['sale.howto', 'report.payment_breakdown'],
  },
  {
    id: 'sale.receipt',
    kind: 'howto',
    domain: 'sales',
    title: 'Kuchapa au kurudia risiti',
    phrases: ['jinsi ya kuchapa risiti', 'print receipt', 'rudia risiti', 'reprint', 'chapa stakabadhi'],
    must: [C.RECEIPT],
    block: [C.EXPIRY],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Risiti za Mauzo
Kwenye simu, risiti hutengenezwa kama **PDF** — siyo kwa kuchapisha moja kwa moja.

- **Risiti mpya:** kwenye **Zaidi** kuna **"Pakua Risiti (PDF)"**, na chaguo la **"Ipakue ukikamilisha mauzo"** ili risiti ipakuliwe yenyewe kila unapomaliza mauzo.
- **Risiti ya zamani:** nenda **Historia ya Mauzo**, gusa muamala husika kisha bofya **"Risiti"**.
- Risiti ya PDF unaweza kumtumia mteja kwa WhatsApp moja kwa moja kutoka kwenye simu yako.`,
    destination: { route: '/historia', spotlight: 'sales-list', label: 'Nipeleke kwenye Historia' },
    related: ['error.printer', 'sale.refund'],
  },
  {
    id: 'sale.refund',
    kind: 'howto',
    domain: 'sales',
    title: 'Kufuta au kurejesha mauzo',
    phrases: ['jinsi ya kufuta mauzo', 'refund', 'rudisha hela ya mteja', 'futa muamala', 'cancel sale', 'rejesha bidhaa'],
    any: [C.REFUND, C.SALE],
    block: [C.PRODUCT, C.STAFF, C.EXPENSE],
    boost: [C.DELETE, C.RECEIPT, C.CUSTOMER],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kufuta Mauzo au Kurejesha (Refund)
1. Nenda kwenye **Historia ya Mauzo**.
2. Gusa muamala unaotaka kuufuta au kuurekebisha.
3. Bofya **"Refund"** (kurudisha bidhaa stoo) au **"Futa"**.
4. Weka sababu ya marekebisho (mfano: mteja amebadili mawazo, bidhaa ina kasoro).
5. Bidhaa zitarudi stoo na mauzo yataondolewa kwenye ripoti ya siku — lakini rekodi yake itahifadhiwa kwenye **Mabadiliko ya Bidhaa** kwa ajili ya ulinzi.`,
    destination: { route: '/historia', spotlight: 'sales-list', label: 'Nipeleke kwenye Historia' },
    related: ['data.security', 'sale.receipt'],
  },

  // =====================================================================
  // PRODUCTS & STOCK — how to
  // =====================================================================
  {
    id: 'product.add',
    kind: 'howto',
    domain: 'inventory',
    title: 'Kusajili bidhaa mpya',
    phrases: ['jinsi ya kuongeza bidhaa', 'sajili bidhaa mpya', 'add new product', 'weka bidhaa mpya', 'ingiza bidhaa'],
    must: [C.CREATE],
    any: [C.PRODUCT],
    block: [C.STAFF, C.CUSTOMER, C.EXPENSE, C.DEBT, C.LOW_STOCK, C.GROW],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kusajili Bidhaa Mpya
1. Nenda kwenye ukurasa wa **Bidhaa**.
2. Bofya kitufe cha **"+"** (Ongeza Bidhaa).
3. Jaza taarifa:
   - **Jina la bidhaa** (mfano: "Coke ya kopo 350ml")
   - **Bei ya kununulia** — inasaidia kupata faida halisi.
   - **Bei ya kuuzia**
   - **Kiasi kilichopo stoo**
   - **Kiwango cha tahadhari** — mfumo utakuonya baki ikifika hapa.
4. Bofya **"Hifadhi"**.`,
    destination: { route: '/bidhaa', spotlight: 'add-product-btn', label: 'Nionyeshe kitufe cha kuongeza bidhaa' },
    related: ['product.edit_price', 'product.restock', 'product.expiry'],
  },
  {
    id: 'product.edit_price',
    kind: 'howto',
    domain: 'inventory',
    title: 'Kubadilisha bei ya bidhaa',
    phrases: ['jinsi ya kubadilisha bei', 'rekebisha bei ya bidhaa', 'change product price', 'badili bei'],
    must: [C.PRICE],
    any: [C.EDIT, C.PRODUCT],
    block: [C.DISCOUNT, C.STAFF, C.SECURITY],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kubadilisha Bei ya Bidhaa
1. Nenda kwenye ukurasa wa **Bidhaa**.
2. Tafuta bidhaa kwa kuandika jina lake kwenye sehemu ya kutafuta.
3. Bofya ikoni ya **kalamu (Edit)** karibu na bidhaa hiyo.
4. Badilisha **Bei ya Kuuza** au **Bei ya Kununua**.
5. Bofya **"Hifadhi"** — bei mpya itaanza kutumika mara moja.

> 💡 Mabadiliko ya bei yanarekodiwa kwenye **Mabadiliko ya Bidhaa**, hivyo utajua nani alibadilisha nini.`,
    destination: { route: '/bidhaa', spotlight: 'product-search', label: 'Nipeleke kwenye Bidhaa' },
    related: ['product.add', 'data.security'],
  },
  {
    id: 'product.restock',
    kind: 'howto',
    domain: 'inventory',
    title: 'Kuongeza mzigo (restock)',
    phrases: ['jinsi ya kuongeza stock', 'restock', 'ongeza mzigo', 'update stock', 'nimepokea mzigo'],
    must: [C.STOCK, C.CREATE],
    block: [C.STAFF, C.EXPENSE, C.LOW_STOCK, C.DEAD_STOCK],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kuongeza Mzigo (Restock)
1. Nenda kwenye ukurasa wa **Bidhaa**.
2. Gusa bidhaa uliyopokea mzigo wake.
3. Bofya **"Badilisha"** kisha rekebisha sehemu ya **Stoo**.
4. Ongeza kiasi kilichowasili juu ya baki ya zamani.
5. Bofya **"Hifadhi"** — mfumo utarekodi muamala huu kwenye historia ya mzigo.`,
    destination: { route: '/bidhaa', spotlight: 'product-search', label: 'Nipeleke kwenye Bidhaa' },
    related: ['product.add', 'data.stock', 'product.expiry'],
  },
  {
    id: 'product.delete',
    kind: 'howto',
    domain: 'inventory',
    title: 'Kufuta bidhaa',
    phrases: ['jinsi ya kufuta bidhaa', 'delete product', 'ondoa bidhaa', 'nifutaje bidhaa', 'remove item'],
    must: [C.DELETE],
    any: [C.PRODUCT, C.STOCK],
    block: [C.SALE, C.REFUND, C.STAFF, C.DEBT, C.EXPENSE, C.CART],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kufuta Bidhaa
1. Nenda kwenye ukurasa wa **Bidhaa**.
2. Tafuta bidhaa husika na bofya ikoni ya **kalamu (Edit)**.
3. Chini ya skrini ya uhariri kuna kitufe chekundu cha **"Futa Bidhaa"**.
4. Gusa hapo na uthibitishe.

> ⚠️ Bidhaa itaondolewa kwenye orodha, lakini historia ya mauzo yake ya zamani itabaki salama kwenye ripoti zako.`,
    destination: { route: '/bidhaa', spotlight: 'product-search', label: 'Nipeleke kwenye Bidhaa' },
    related: ['product.edit_price', 'data.security'],
  },
  {
    id: 'product.expiry',
    kind: 'howto',
    domain: 'inventory',
    title: 'Tarehe ya kuisha muda (expiry)',
    phrases: ['jinsi ya kuweka expiry', 'tarehe ya kuisha muda', 'bidhaa zilizoisha muda', 'expiry date', 'muda wa matumizi'],
    must: [C.EXPIRY],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Tarehe ya Kuisha Muda (Expiry)
1. Nenda **Zaidi** na hakikisha kipengele cha **Expiry** kimewashwa.
2. Unapoongeza au kubadilisha bidhaa, jaza sehemu ya **Tarehe ya Kuisha Muda**.
3. Kwenye **Zaidi** kuna orodha ya bidhaa **zisizo na tarehe** — unaweza kuzijazia hapo hapo kwa haraka.
4. Mfumo utakuonya kabla bidhaa hazijaisha muda, kulingana na idadi ya siku uliyoweka.

> 📌 Bidhaa ambazo mzigo wake wote umeisha muda huonekana kwenye **Mauzo** kama kadi iliyozimwa yenye alama ya **"Imeisha muda"**, hivyo huwezi kuiuza kimakosa.`,
    destination: { route: '/zaidi', spotlight: 'expiry-section', label: 'Nipeleke kwenye mipangilio ya Expiry' },
    related: ['product.add', 'product.restock'],
  },
  {
    id: 'product.barcode',
    kind: 'howto',
    domain: 'inventory',
    title: 'Kutumia barcode scanner',
    phrases: ['jinsi ya kutumia barcode', 'barcode scanner', 'skani msimbo'],
    must: [C.BARCODE],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kutumia Barcode
1. Unaposajili au kubadilisha bidhaa, jaza uwanja wa **"Barcode / Msimbo"**.
2. Skani msimbo wa bidhaa kwa kamera au mashine ya barcode — msimbo utajaza wenyewe.
3. Wakati wa kuuza, skani tu bidhaa na itaingia kikapuni moja kwa moja bila kukosea.`,
    destination: { route: '/bidhaa', spotlight: 'add-product-btn', label: 'Nipeleke kwenye Bidhaa' },
    related: ['product.add', 'sale.cart'],
  },

  // =====================================================================
  // CUSTOMERS & DEBT — how to
  // =====================================================================
  {
    id: 'customer.credit',
    kind: 'howto',
    domain: 'customers',
    title: 'Kumkopesha mteja (mauzo ya deni)',
    phrases: ['jinsi ya kukopesha mteja', 'sajili mteja na deni', 'mpe mteja deni', 'mauzo ya mkopo', 'ongeza mteja'],
    // No CREATE requirement: "kukopesha mteja" carries the intent in the verb
    // itself. Separation from data.debts comes from question form, not concepts.
    any: [C.CUSTOMER, C.DEBT],
    boost: [C.CREATE, C.SALE],
    block: [C.STAFF, C.PRODUCT, C.EXPENSE, C.PAYMENT],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kumkopesha Mteja (Mauzo ya Deni)
1. Jaza bidhaa kwenye **Kikapu**, kisha bofya **"Kamilisha Mauzo"**.
2. Chagua njia ya malipo ya **"Mkopo (Deni)"**.
3. Andika **jina la mteja** na namba yake ya simu.
4. Bofya **"Kamilisha Mkopo"**.
5. Deni litarekodiwa kwenye ukurasa wa **Madeni** na utaweza kulifuatilia hadi litakapolipwa.`,
    destination: { route: '/madeni', spotlight: 'debts-list', label: 'Nipeleke kwenye Madeni' },
    related: ['customer.pay_debt', 'data.debts'],
  },
  {
    id: 'customer.pay_debt',
    kind: 'howto',
    domain: 'customers',
    title: 'Kupokea malipo ya deni',
    phrases: ['jinsi ya kupokea malipo ya deni', 'mteja kalipa deni', 'punguza deni', 'rejesha deni'],
    must: [C.DEBT, C.PAYMENT],
    block: [C.STAFF],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kupokea Malipo ya Deni
1. Nenda kwenye ukurasa wa **Madeni**.
2. Tafuta jina la mteja aliyekuja kulipa na gusa wasifu wake.
3. Bofya **"Pokea Malipo"**.
4. Weka kiasi alicholipa na uchague njia ya malipo.
5. Bofya **"Hifadhi"** — baki yake mpya itasasishwa papo hapo.`,
    destination: { route: '/madeni', spotlight: 'debts-list', label: 'Nipeleke kwenye Madeni' },
    related: ['data.debts', 'customer.credit'],
  },

  // =====================================================================
  // STAFF — how to + actions
  // =====================================================================
  {
    id: 'staff.add',
    kind: 'howto',
    domain: 'staff',
    title: 'Kuongeza mfanyakazi',
    phrases: ['jinsi ya kuongeza mfanyakazi', 'nawezaje kuongeza mfanyakazi', 'sajili mhudumu mpya', 'how to add employee', 'ajiri mfanyakazi', 'alika mfanyakazi'],
    must: [C.STAFF, C.CREATE],
    block: [C.PRODUCT, C.CUSTOMER, C.EXPENSE],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    handler: 'inline_add_staff',
    answer: `### Jinsi ya Kuongeza Mfanyakazi
1. Nenda kwenye ukurasa wa **Zaidi**.
2. Tembea hadi sehemu ya **Wafanyakazi**.
3. Bofya **"Ongeza Mfanyakazi"**.
4. Ingiza **barua pepe (email)** yake — hakikisha ni sahihi kabisa, usikosee hata herufi moja.
5. Mpe app kwenye simu yake, kisha mwambie **ajisajili (Register)** kwa kutumia email hiyo hiyo.
6. Baada ya kujisajili, atajiunga na duka lako moja kwa moja.

> 🔐 Baada ya hapo unaweza kupanga **ruhusa zake** — kama aone mapato, abadilishe bidhaa, au arekodi matumizi.

Unaweza pia kumualika hapa hapa kwenye fomu iliyo chini 👇`,
    destination: { route: '/zaidi', spotlight: 'add-staff-btn', label: 'Nionyeshe kitufe cha kuongeza mfanyakazi' },
    related: ['staff.permissions', 'data.employees'],
  },
  {
    id: 'staff.permissions',
    kind: 'howto',
    domain: 'staff',
    title: 'Kupanga ruhusa za wafanyakazi',
    phrases: ['jinsi ya kubadilisha ruhusa', 'ruhusa za mfanyakazi', 'staff permissions', 'mpe ruksa mfanyakazi', 'zima ruhusa'],
    must: [C.PERMISSION],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    handler: 'inline_toggle_features',
    answer: `### Kupanga Ruhusa za Wafanyakazi
1. Nenda kwenye ukurasa wa **Zaidi**.
2. Tafuta sehemu ya **Ruhusa / Vipengele**.
3. Washa au zima ruhusa unayotaka:
   - **Ruhusu Wafanyakazi Kubadili Bidhaa** — waweze kuongeza au kubadili bei.
   - **Ruhusu Wafanyakazi Kurekodi Matumizi**
   - **Onyesha Mapato/Faida kwa Wafanyakazi**
4. Mabadiliko yataenda kwenye vifaa vyao mara moja.

Unaweza kubadilisha ruhusa hapa hapa 👇`,
    destination: { route: '/zaidi', spotlight: 'permissions-section', label: 'Nionyeshe sehemu ya Ruhusa' },
    related: ['staff.add', 'data.security'],
  },

  // =====================================================================
  // EXPENSES
  // =====================================================================
  {
    id: 'expense.add',
    kind: 'howto',
    domain: 'money',
    title: 'Kurekodi matumizi ya duka',
    phrases: ['jinsi ya kurekodi matumizi', 'ongeza matumizi', 'record expense', 'andika gharama', 'nimelipia umeme'],
    must: [C.EXPENSE, C.CREATE],
    block: [C.BACKDATE],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kurekodi Matumizi ya Duka
1. Nenda kwenye ukurasa wa **Matumizi**.
2. Bofya **"Ongeza Matumizi"**.
3. Jaza:
   - **Kiasi** kilichotumika
   - **Aina** (mfano: umeme, usafiri, kodi ya fremu, chakula)
   - **Maelezo mafupi**
4. Bofya **"Hifadhi"**.

> 💡 Matumizi haya yanakatwa kwenye faida ghafi ili kupata **faida halisi**. Ukiyaacha, ripoti yako ya faida itakuwa kubwa kuliko uhalisia.`,
    destination: { route: '/matumizi', spotlight: 'add-expense-btn', label: 'Nionyeshe kitufe cha kuongeza matumizi' },
    related: ['data.expenses', 'data.sales'],
  },

  // =====================================================================
  // REPORTS — how to
  // =====================================================================
  {
    id: 'report.daily_page',
    kind: 'howto',
    domain: 'reports',
    title: 'Ripoti ya Siku',
    phrases: ['ripoti ya siku', 'ripoti ya tarehe fulani', 'mauzo ya tarehe', 'daily report page', 'nionyeshe ripoti ya siku'],
    must: [C.REPORT],
    boost: [C.SALE, C.PROFIT],
    block: [C.STAFF, C.SECURITY, C.EXPORT, C.APP],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Ripoti ya Siku
Hii inakuwezesha kuchagua **tarehe yoyote** na kuona kila kitu kilichotokea siku hiyo.

1. Nenda kwenye **Historia ya Mauzo**.
2. Juu kabisa, bofya **"Ripoti ya Siku"**.
3. Chagua tarehe kwenye kalenda (unaweza pia kutelezesha kwenda mwezi mwingine).
4. Utaona **mapato, faida, faida halisi na matumizi** ya siku hiyo, pamoja na orodha ya risiti zote.`,
    destination: { route: '/ripoti-ya-siku', spotlight: 'date-picker', label: 'Nipeleke kwenye Ripoti ya Siku' },
    related: ['data.sales', 'report.export'],
  },
  {
    id: 'report.payment_breakdown',
    kind: 'howto',
    domain: 'reports',
    title: 'Mchanganuo wa malipo (cash vs simu)',
    phrases: ['nimepokea kiasi gani kwa cash', 'malipo ya taslimu na simu', 'cash vs mobile', 'mchanganuo wa malipo'],
    must: [C.PAYMENT],
    block: [C.DEBT, C.CREATE, C.MOBILE_MONEY],
    forms: ['DATA', 'PLAIN', 'WHERE'],
    answer: `### Mchanganuo wa Malipo (Taslimu vs Simu)
1. Nenda kwenye ukurasa wa **V Smart**.
2. Tembea chini hadi sanduku la **"Miamala (Cash / Simu)"** na uligonge lifunguke.
3. Chagua kipindi: **Leo**, **Jana**, **Mwezi Huu** au **Mwezi Uliopita**.
4. Utaona kiasi kilichoingia kwa **taslimu** na kwa **simu**, pamoja na asilimia ya kila kimoja.`,
    destination: { route: '/executive', spotlight: 'payment-breakdown', label: 'Nionyeshe mchanganuo wa malipo' },
    related: ['data.sales', 'report.daily_page'],
  },
  {
    id: 'report.export',
    kind: 'howto',
    domain: 'reports',
    title: 'Kupakua ripoti (Excel / PDF)',
    phrases: ['jinsi ya kupakua ripoti', 'export excel', 'download pdf', 'shusha ripoti'],
    must: [C.EXPORT],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kupakua Ripoti
1. Nenda kwenye **Historia ya Mauzo** au **Matumizi**.
2. Juu ya orodha, tafuta kitufe cha **"Pakua"** au **"Export"**.
3. Faili litapakuliwa kwenye kifaa chako tayari kumtumia mhasibu wako.`,
    destination: { route: '/historia', spotlight: 'period-filter', label: 'Nipeleke kwenye Historia' },
    related: ['report.daily_page', 'data.sales'],
  },

  // =====================================================================
  // TROUBLESHOOTING
  // =====================================================================
  {
    id: 'error.printer',
    kind: 'howto',
    domain: 'troubleshooting',
    title: 'Printa haichapi risiti',
    phrases: ['printa haichapi', 'printer haifanyi kazi', 'bluetooth printer', 'mbona risiti haitoki'],
    must: [C.PRINTER],
    boost: [C.PROBLEM],
    forms: ['WHY', 'HOWTO', 'PLAIN'],
    answer: `### Kuhusu Printa
App ya **simu haichapishi moja kwa moja kwenye printa**. Badala yake hutengeneza risiti ya **PDF** ambayo unaweza kumtumia mteja kwa WhatsApp au kuihifadhi.

Kama unataka kuchapisha risiti kwenye printa ya karatasi, tumia **Venics Sales ya kompyuta (Desktop)** — hapo ndipo printa huunganishwa.`,
    destination: { route: '/zaidi', spotlight: 'receipt-settings', label: 'Fungua mipangilio ya risiti' },
    related: ['sale.receipt', 'sale.pdf_receipt'],
  },
  {
    id: 'error.login',
    kind: 'howto',
    domain: 'troubleshooting',
    title: 'Shida ya kuingia (login)',
    phrases: ['siwezi kuingia', 'password imekataa', 'login problem', 'akaunti imezuiwa'],
    must: [C.LOGIN],
    boost: [C.PROBLEM],
    forms: ['WHY', 'HOWTO', 'PLAIN'],
    answer: `### Shida ya Kuingia Kwenye Akaunti
- **Barua pepe au nywila:** hakikisha hakuna nafasi (space) mwanzoni au mwishoni, na herufi kubwa/ndogo ziko sahihi.
- **Umesahau nywila:** bofya **"Umesahau Nywila?"** kwenye ukurasa wa kuingia ili upate link ya kubadilisha.
- **Akaunti imezuiwa:** wasiliana na bosi/mmiliki wa duka aliyekusajili ili akufungulie.`,
    related: ['staff.add'],
  },

  // =====================================================================
  // SETTINGS / ACCOUNT
  // =====================================================================
  {
    id: 'settings.shop',
    kind: 'howto',
    domain: 'setup',
    title: 'Kubadilisha jina la duka au sarafu',
    phrases: ['badilisha jina la duka', 'change shop name', 'sarafu ya duka', 'currency'],
    must: [C.SETTINGS],
    any: [C.BUSINESS, C.EDIT],
    block: [C.STAFF, C.PERMISSION, C.PRINTER],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Usimamizi wa Duka
1. Nenda kwenye ukurasa wa **Zaidi**.
2. Tembea hadi sehemu ya **Usimamizi wa Maduka**.
3. Hapo utaona duka lako — au maduka yako yote kama una zaidi ya moja.
4. Unaweza **kuongeza duka jipya** au **kubadili** kutoka duka moja kwenda lingine.

> 📌 Jina la duka huwekwa wakati wa kusajili duka. Kulibadilisha baadaye, tumia **Venics Sales ya kompyuta (Desktop)**.`,
    destination: { route: '/zaidi', spotlight: 'shops-section', label: 'Fungua Usimamizi wa Maduka' },
    related: ['license.renew'],
  },
  {
    id: 'license.renew',
    kind: 'howto',
    domain: 'subscription',
    title: 'Leseni na malipo ya mfumo',
    phrases: ['leseni imeisha', 'lipa app', 'subscription', 'muda wa mfumo', 'bando la app'],
    must: [C.LICENSE],
    forms: ['HOWTO', 'WHERE', 'PLAIN', 'WHY'],
    answer: `### Leseni na Malipo ya Mfumo
- Kuona **siku zilizosalia**, nenda kwenye **Zaidi** — utaona muda wa leseni yako.
- Leseni ikikaribia kuisha, mfumo utakuonya mapema ili duka lisisimame.
- Kwa kulipia au kuongeza muda, tumia sehemu ya **Malipo ya Mfumo** kwenye **Zaidi**.`,
    destination: { route: '/zaidi', spotlight: 'license-section', label: 'Fungua Malipo ya Mfumo' },
    related: ['settings.shop'],
  },

  // =====================================================================
  // DATA — computed from the shop's own numbers
  // =====================================================================
  {
    id: 'data.sales',
    kind: 'data',
    domain: 'reports',
    title: 'Mauzo na faida',
    phrases: ['mauzo ya leo', 'faida ya leo kiasi gani', 'nimeuza kiasi gani', 'mapato ya wiki', 'faida ya mwezi'],
    any: [C.SALE, C.REVENUE, C.PROFIT],
    // DELETE/REFUND mean the user is asking about undoing a sale, never about
    // revenue figures — that ambiguity sent "futa mauzo" to the wrong skill.
    block: [C.STAFF, C.SECURITY, C.DEBT, C.EXPIRY, C.BEST_SELLING, C.DEAD_STOCK, C.DELETE, C.REFUND, C.CART, C.GROW, C.BACKDATE, C.HISTORY, C.DEFINE, C.PROBLEM],
    forms: ['DATA', 'PLAIN'],
    handler: 'report_sales',
    related: ['data.expenses', 'data.bestselling', 'data.comparison'],
  },
  {
    id: 'data.expenses',
    kind: 'data',
    domain: 'reports',
    title: 'Matumizi ya duka',
    phrases: ['matumizi ya leo', 'gharama za mwezi', 'nimetumia kiasi gani'],
    must: [C.EXPENSE],
    block: [C.CREATE, C.STAFF, C.SETTINGS, C.DEFINE, C.BACKDATE, C.GROW],
    forms: ['DATA', 'PLAIN'],
    handler: 'report_expenses',
    related: ['data.sales', 'expense.add'],
  },
  {
    id: 'data.stock',
    kind: 'data',
    domain: 'inventory',
    title: 'Hali ya stoo',
    phrases: ['hali ya stoo', 'bidhaa zinazoisha', 'stock iliyobaki', 'thamani ya mzigo', 'bidhaa ngapi zimeisha'],
    any: [C.STOCK, C.LOW_STOCK, C.CAPITAL],
    // LICENSE blocked because "imeisha" (has finished) is shared between
    // "bidhaa imeisha" and "leseni imeisha".
    block: [C.CREATE, C.DELETE, C.EDIT, C.DEAD_STOCK, C.EXPIRY, C.STAFF, C.LICENSE, C.DEFINE, C.TRACKING, C.BATCH, C.MIN_STOCK, C.GROW],
    forms: ['DATA', 'PLAIN'],
    handler: 'report_stock',
    related: ['data.dead_stock', 'product.restock'],
  },
  {
    id: 'data.debts',
    kind: 'data',
    domain: 'customers',
    title: 'Madeni ya wateja',
    phrases: ['nani anadaiwa', 'madeni ya wateja', 'wadaiwa wakubwa', 'deni la duka ni kiasi gani'],
    must: [C.DEBT],
    block: [C.CREATE, C.PAYMENT, C.STAFF, C.DEFINE, C.WHATSAPP, C.GROW],
    forms: ['DATA', 'PLAIN'],
    handler: 'report_debts',
    related: ['customer.pay_debt', 'customer.credit'],
  },
  {
    id: 'data.security',
    kind: 'data',
    domain: 'security',
    title: 'Ulinzi na mabadiliko ya duka',
    phrases: ['kuna viashiria vya wizi', 'ulinzi wa duka', 'mabadiliko ya bidhaa', 'audit logs', 'nani amefuta mauzo'],
    must: [C.SECURITY],
    block: [C.PRICE],
    forms: ['DATA', 'PLAIN', 'WHY'],
    handler: 'report_security',
    destination: { route: '/audit-logs', spotlight: 'audit-list', label: 'Fungua Mabadiliko ya Bidhaa' },
    related: ['staff.permissions', 'sale.refund'],
  },
  {
    id: 'data.bestselling',
    kind: 'data',
    domain: 'inventory',
    title: 'Bidhaa zinazouzwa sana',
    phrases: ['bidhaa gani zinauzwa sana', 'best selling', 'bidhaa maarufu', 'zinazokimbizwa'],
    must: [C.BEST_SELLING],
    forms: ['DATA', 'PLAIN'],
    handler: 'report_bestselling',
    related: ['data.dead_stock', 'data.stock'],
  },
  {
    id: 'data.dead_stock',
    kind: 'data',
    domain: 'inventory',
    title: 'Bidhaa zilizolala (dead stock)',
    phrases: ['bidhaa gani zimedoda', 'dead stock', 'bidhaa zisizouza', 'mzigo uliolala'],
    must: [C.DEAD_STOCK],
    forms: ['DATA', 'PLAIN'],
    handler: 'report_dead_stock',
    related: ['data.bestselling', 'data.stock'],
  },
  {
    id: 'data.comparison',
    kind: 'data',
    domain: 'reports',
    title: 'Kulinganisha vipindi',
    phrases: ['linganisha wiki hii na iliyopita', 'tofauti ya mwezi huu na uliopita', 'compare sales'],
    must: [C.COMPARE],
    forms: ['DATA', 'PLAIN'],
    handler: 'report_comparison',
    related: ['data.sales', 'data.business'],
  },
  {
    id: 'data.business',
    kind: 'data',
    domain: 'reports',
    title: 'Mchanganuo wa biashara',
    phrases: ['hali ya biashara', 'mchanganuo wa duka', 'ripoti ya biashara', 'duka linaendaje'],
    must: [C.BUSINESS],
    boost: [C.REPORT],
    block: [C.STAFF, C.SECURITY, C.CREATE, C.BRANCH, C.GROW, C.DEFINE, C.PROBLEM],
    forms: ['DATA', 'PLAIN'],
    handler: 'report_business',
    related: ['data.business', 'data.sales'],
  },
  {
    id: 'data.employees',
    kind: 'action',
    domain: 'staff',
    title: 'Ripoti za wafanyakazi',
    phrases: ['ripoti ya wafanyakazi', 'mfanyakazi ameuza kiasi gani', 'utendaji wa wahudumu'],
    must: [C.STAFF],
    block: [C.CREATE, C.PERMISSION, C.EDIT, C.DELETE],
    forms: ['DATA', 'PLAIN'],
    handler: 'employee_report',
    related: ['staff.add', 'data.security'],
  },

  // =====================================================================
  // ADVICE
  // =====================================================================



  // =====================================================================
  // SYSTEM
  // =====================================================================
  {
    id: 'system.sync',
    kind: 'action',
    domain: 'system',
    title: 'Ukaguzi wa usawazishaji (sync)',
    phrases: ['data hazisync', 'sioni mauzo ya mfanyakazi', 'sync haifanyi kazi', 'kusawazisha'],
    must: [C.SYNC],
    forms: ['WHY', 'HOWTO', 'PLAIN'],
    handler: 'sync_diagnostic',
    related: ['data.security'],
  },
  {
    id: 'system.unknowns',
    kind: 'action',
    domain: 'system',
    title: 'Maswali nisiyoyaelewa',
    phrases: ['maswali usiyoelewa', 'ni maswali gani hujui', 'umeshindwa kujibu nini', 'nionyeshe mapungufu yako'],
    must: [C.HELP],
    any: [C.PROBLEM, C.REPORT],
    forms: ['DATA', 'PLAIN', 'HOWTO'],
    handler: 'unresolved_list',
    related: ['system.help', 'support.contact'],
  },
  {
    id: 'system.greeting',
    kind: 'system',
    domain: 'system',
    title: 'Salamu',
    phrases: ['habari', 'mambo vipi', 'shikamoo', 'habari za asubuhi', 'hello'],
    must: [C.GREETING],
    block: [C.SALE, C.PROFIT, C.STOCK, C.DEBT, C.STAFF, C.EXPENSE, C.SECURITY, C.BUSINESS, C.REPORT],
    forms: ['PLAIN'],
    answer: `Habari yako Bosi! 👋 Mimi ni **Venics Smart**, mshauri wako wa duka.

Naweza kukusaidia kwa mambo makuu matatu:
- **Takwimu** — "Faida ya leo kiasi gani?", "Nani anadaiwa?"
- **Maelekezo** — "Nawezaje kuongeza mfanyakazi?", "Nifutaje bidhaa?"
- **Ushauri** — "Nifanye nini kukuza duka?"

Niulize chochote.`,
    related: ['data.sales', 'system.help'],
  },
  {
    id: 'system.help',
    kind: 'system',
    domain: 'system',
    title: 'Msaada — naweza kufanya nini',
    phrases: ['unafanya nini', 'unajua nini', 'msaada', 'nisaidie', 'unaweza kunisaidia vipi'],
    must: [C.HELP],
    // "What can you do?" only. Any concrete domain concept means the user is
    // asking a real question, so this catch-all must stand aside.
    block: [
      C.SALE, C.STOCK, C.DEBT, C.STAFF, C.EXPENSE, C.PRINTER, C.SYNC, C.LOGIN,
      C.PRODUCT, C.GROW, C.PROFIT, C.REVENUE, C.BUSINESS, C.PERMISSION,
      C.EXPIRY, C.LICENSE, C.SECURITY, C.RECEIPT, C.CUSTOMER, C.PROBLEM,
    ],
    forms: ['PLAIN', 'HOWTO'],
    answer: `### Naweza Kukusaidia Nini?
**Takwimu za duka lako:**
- "Mauzo ya leo yakoje?"
- "Faida ya mwezi huu?"
- "Bidhaa gani zinaisha stoo?"
- "Nani anadaiwa hela nyingi?"

**Maelekezo ya kutumia app:**
- "Nawezaje kuongeza mfanyakazi?"
- "Jinsi ya kufuta bidhaa?"
- "Nifanyeje kurekodi matumizi?"

**Ushauri wa biashara:**
- "Nifanye nini kukuza duka?"
- "Duka langu liko sawa?"

Niulize kwa Kiswahili au Kiingereza — nitaelewa.`,
    related: ['data.sales', 'staff.add', 'data.business'],
  },

  // =====================================================================
  // PHASE 2 — features verified present in the mobile UI
  // =====================================================================
  {
    id: 'sale.backdated',
    kind: 'howto',
    domain: 'sales',
    title: 'Kuandika mauzo ya siku iliyopita',
    phrases: ['andika mauzo nyuma', 'nilisahau kuandika mauzo ya jana', 'mauzo ya siku ya zamani', 'backdated sale'],
    must: [C.BACKDATE],
    any: [C.SALE, C.CREATE],
    block: [C.EXPENSE],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Kuandika Mauzo ya Siku Iliyopita
Ukisahau kurekodi mauzo siku fulani, unaweza kuyaandika baadaye.

1. Nenda kwenye **Historia ya Mauzo**.
2. Bofya **"Andika Mauzo Nyuma"**.
3. Chagua **tarehe** halisi mauzo yalipotokea.
4. Ingiza bidhaa kama kawaida, kisha chagua njia ya malipo (Cash, Simu/Bank au Mkopo).
5. Bofya **"Hifadhi Mauzo ya Siku ya Zamani"**.

> 📌 Mauzo haya yataingia kwenye ripoti ya tarehe uliyochagua, siyo ya leo.`,
    destination: { route: '/historia', spotlight: 'backdated-sale-btn', label: 'Nionyeshe kitufe cha kuandika nyuma' },
    related: ['expense.backdated', 'report.daily_page'],
  },
  {
    id: 'expense.backdated',
    kind: 'howto',
    domain: 'money',
    title: 'Kuandika matumizi ya siku iliyopita',
    phrases: ['andika matumizi nyuma', 'nilisahau kuandika matumizi', 'gharama ya siku ya zamani'],
    must: [C.BACKDATE, C.EXPENSE],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Kuandika Matumizi ya Siku Iliyopita
1. Nenda kwenye **Historia ya Mauzo**.
2. Bofya **"Andika Matumizi Nyuma"**.
3. Chagua **tarehe** matumizi yalipotokea.
4. Jaza kiasi, kundi na maelezo, kisha bofya **"Hifadhi Matumizi"**.`,
    destination: { route: '/historia', spotlight: 'backdated-expense-btn', label: 'Nionyeshe kitufe hicho' },
    related: ['expense.add', 'sale.backdated'],
  },
  {
    id: 'cart.quantity',
    kind: 'howto',
    domain: 'sales',
    title: 'Kubadilisha idadi kikapuni',
    phrases: ['nibadilishe idadi kikapuni', 'kuweka idadi kubwa', 'mteja amenunua vingi', 'change quantity'],
    must: [C.QUANTITY],
    any: [C.CART, C.SALE, C.EDIT],
    block: [C.STOCK, C.CREATE],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kubadilisha Idadi Kikapuni
Badala ya kugusa bidhaa mara nyingi:

1. Ingiza bidhaa kwenye **Kikapu** mara moja.
2. Gusa namba ya idadi (mfano **3x**) iliyo kushoto mwa jina la bidhaa.
3. Kibodi ndogo itafunguka — andika idadi unayotaka.
4. Thibitisha, na jumla itahesabika upya papo hapo.`,
    destination: { route: '/kikapu', spotlight: 'cart-list', label: 'Nipeleke kwenye Kikapu' },
    related: ['sale.cart', 'sale.discount'],
  },
  {
    id: 'sale.pdf_receipt',
    kind: 'howto',
    domain: 'sales',
    title: 'Kupakua risiti kama PDF',
    phrases: ['pakua risiti pdf', 'risiti ya pdf', 'nimtumie mteja risiti'],
    must: [C.PDF],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Risiti ya PDF
- Kwenye **Zaidi** kuna chaguo la **"Pakua Risiti (PDF)"**, pamoja na mpangilio wa **"Ipakue ukikamilisha mauzo"** — ukiiwasha, risiti itapakuliwa yenyewe kila unapomaliza mauzo.
- Risiti ya PDF unaweza kumtumia mteja kwa WhatsApp au email moja kwa moja kutoka kwenye simu yako.`,
    destination: { route: '/zaidi', spotlight: 'receipt-settings', label: 'Fungua mipangilio ya risiti' },
    related: ['sale.receipt', 'settings.profile'],
  },
  {
    id: 'product.stock_tracking',
    kind: 'howto',
    domain: 'inventory',
    title: 'Kufuatilia au kutofuatilia stoki',
    phrases: ['fuatilia stoki ya bidhaa', 'zima ufuatiliaji wa stoki', 'bidhaa isiyohesabiwa stock', 'stock tracking'],
    must: [C.TRACKING],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Kufuatilia Stoki ya Bidhaa
Baadhi ya bidhaa (kama huduma au vitu vinavyouzwa kwa kupima) haviitaji kuhesabiwa stoo.

1. Nenda **Bidhaa**, kisha fungua bidhaa husika kwa kuhariri.
2. Tafuta chaguo la **"Fuatilia Stoki ya Bidhaa"**.
3. Ukiizima (**"Kuzima Ufuatiliaji wa Stoki"**), bidhaa hiyo itauzwa bila kupunguza idadi ya stoo, na haitatokea kwenye tahadhari za kuisha.`,
    destination: { route: '/bidhaa', spotlight: 'product-search', label: 'Nipeleke kwenye Bidhaa' },
    related: ['product.min_stock', 'product.restock'],
  },
  {
    id: 'product.batches',
    kind: 'howto',
    domain: 'inventory',
    title: 'Kusimamia batches na expiry',
    phrases: ['simamia batches', 'mafungu ya bidhaa', 'batch ya bidhaa', 'mzigo wa tarehe tofauti'],
    must: [C.BATCH],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Batches na Expiry
Bidhaa moja inaweza kuwa na mizigo (batches) iliyoingia siku tofauti na tarehe tofauti za kuisha muda.

1. Nenda **Bidhaa** kisha fungua bidhaa husika.
2. Bofya **"Simamia Batches & Expiry"**.
3. Hapo unaweza kuona kila fungu na tarehe yake, na kuongeza fungu jipya ukipokea mzigo mwingine.

> 📌 Mfumo unauza kwanza fungu lenye tarehe ya karibu kuisha, ili usibakiwe na mzigo ulioisha muda.`,
    destination: { route: '/bidhaa', spotlight: 'product-search', label: 'Nipeleke kwenye Bidhaa' },
    related: ['product.expiry', 'product.restock'],
  },
  {
    id: 'product.min_stock',
    kind: 'howto',
    domain: 'inventory',
    title: 'Kiwango cha tahadhari ya stoo',
    phrases: ['kizuizi cha bidhaa', 'kiwango cha tahadhari', 'nionywe bidhaa ikiisha', 'min stock alert'],
    must: [C.MIN_STOCK],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Kiwango cha Tahadhari (Kizuizi)
1. Nenda **Bidhaa** kisha hariri bidhaa husika.
2. Jaza sehemu ya **"Kizuizi"** — hii ndiyo idadi ndogo kabisa unayotaka kubaki nayo.
3. Baki ikifika hapo, bidhaa itaonekana kwenye **"Bidhaa Zinazoisha"** kwenye Dashibodi ili uagize mapema.

Kwa expiry, sehemu ya **"Siku za Tahadhari"** hukuonya siku kadhaa kabla bidhaa haijaisha muda.`,
    destination: { route: '/bidhaa', spotlight: 'product-search', label: 'Nipeleke kwenye Bidhaa' },
    related: ['data.stock', 'product.expiry'],
  },
  {
    id: 'product.price_check',
    kind: 'howto',
    domain: 'inventory',
    title: 'Uhakiki wa bei (bidhaa zinazouzwa kwa hasara)',
    phrases: ['uhakiki wa bei', 'bidhaa zinazouzwa kwa hasara', 'bei tatanishi', 'hasara inayoweza kuepukika'],
    must: [C.PRICE],
    any: [C.PROBLEM, C.SECURITY],
    block: [C.EDIT, C.DISCOUNT, C.CART, C.DELETE],
    forms: ['PLAIN', 'WHY', 'DATA'],
    answer: `### Uhakiki wa Bei
Mfumo hukagua bei zako na kukuonya pale unapoweza kupoteza pesa:

- **Bidhaa Zinazouzwa kwa Hasara** — bei ya kuuza iko chini au sawa na bei ya kununua. Kila mauzo huleta hasara.
- **Uhakiki wa Bei (Uwiano usio wa kawaida)** — bei ya kuuza ni kubwa mno kuliko ya kununua, dalili ya kukosea kuandika bei.

Tahadhari hizi zinaonekana kwenye **Dashibodi** na **V Smart**. Ukihakikisha bei ni sahihi, bofya **"Bei ipo Sawa"** ili tahadhari iondoke.`,
    destination: { route: '/dashibodi', spotlight: 'price-check', label: 'Nionyeshe tahadhari za bei' },
    related: ['product.edit_price', 'explain.margin'],
  },
  {
    id: 'product.search',
    kind: 'howto',
    domain: 'inventory',
    title: 'Kutafuta bidhaa',
    phrases: ['nitafutaje bidhaa', 'sioni bidhaa kwenye orodha', 'tafuta bidhaa kwa jina'],
    must: [C.SEARCH],
    any: [C.PRODUCT, C.STOCK],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kutafuta Bidhaa
- Kwenye ukurasa wa **Bidhaa** au **Mauzo**, tumia sehemu ya kutafuta juu ya orodha.
- Andika herufi chache za jina la bidhaa — orodha itachujwa papo hapo.
- Ukiwa na barcode scanner, skani bidhaa badala ya kuandika.`,
    destination: { route: '/bidhaa', spotlight: 'product-search', label: 'Nipeleke kwenye Bidhaa' },
    related: ['product.barcode', 'sale.product_missing'],
  },
  {
    id: 'sale.product_missing',
    kind: 'howto',
    domain: 'troubleshooting',
    title: 'Bidhaa haionekani wakati wa kuuza',
    phrases: ['bidhaa haionekani kwenye mauzo', 'mbona siwezi kuuza bidhaa', 'bidhaa imezimwa haiuziki'],
    must: [C.PROBLEM],
    any: [C.PRODUCT],
    // REFUND means they already sold and want to undo it, not that the
    // product is missing from the list.
    block: [C.SYNC, C.PRINTER, C.LOGIN, C.PRICE, C.DEBT, C.REFUND, C.DELETE],
    forms: ['WHY', 'HOWTO'],
    answer: `### Bidhaa Haionekani Wakati wa Kuuza
Sababu za kawaida:

1. **Stoo imeisha** — baki ni sifuri. Nenda **Bidhaa** uongeze mzigo.
2. **Imeisha muda (Expired)** — mzigo wote umeisha muda. Bidhaa itaonekana kama kadi iliyozimwa yenye alama ya **"Imeisha muda"**, huwezi kuiuza.
3. **Jina tofauti** — jaribu kutafuta kwa herufi chache tofauti.
4. **Haijasawazishwa** — kama uliiongeza kwenye kifaa kingine, subiri usawazishaji ukamilike.`,
    destination: { route: '/bidhaa', spotlight: 'product-search', label: 'Kagua Bidhaa' },
    related: ['product.restock', 'product.expiry', 'system.sync'],
  },
  {
    id: 'debt.whatsapp',
    kind: 'howto',
    domain: 'customers',
    title: 'Kumkumbusha mdeni kwa WhatsApp',
    phrases: ['tuma whatsapp kwa mdeni', 'mkumbushe mteja deni', 'ujumbe wa kikumbusho'],
    must: [C.WHATSAPP],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Kumkumbusha Mdeni kwa WhatsApp
1. Nenda kwenye **Madeni**.
2. Fungua mteja unayetaka kumkumbusha.
3. Hakikisha **Namba ya Simu ya WhatsApp** yake imejazwa.
4. Bofya **"Tuma WhatsApp"** — mfumo utaandaa **ujumbe wa upole wa kukumbusha deni** wenye kiasi anachodaiwa.
5. Utapelekwa WhatsApp ili uthibitishe na kutuma.`,
    destination: { route: '/madeni', spotlight: 'debts-list', label: 'Nipeleke kwenye Madeni' },
    related: ['customer.pay_debt', 'data.debts'],
  },
  {
    id: 'debt.paid',
    kind: 'howto',
    domain: 'customers',
    title: 'Madeni yaliyolipwa',
    phrases: ['madeni yaliyolipwa', 'zilizolipwa', 'nani amelipa deni lake'],
    must: [C.DEBT],
    any: [C.HISTORY, C.PAYMENT],
    block: [C.CREATE, C.WHATSAPP],
    forms: ['PLAIN', 'WHERE', 'DATA'],
    answer: `### Madeni Yaliyolipwa
Kwenye ukurasa wa **Madeni** kuna sehemu mbili:

- **Orodha ya Wanaodaiwa** — wateja wenye deni linaloendelea, pamoja na **Baki** yao.
- **Zilizolipwa** — madeni yaliyokamilika kulipwa.

Juu kabisa utaona **Jumla ya Madeni Yote** ili ujue duka linadai kiasi gani kwa ujumla.`,
    destination: { route: '/madeni', spotlight: 'debts-list', label: 'Nipeleke kwenye Madeni' },
    related: ['customer.pay_debt', 'data.debts'],
  },
  {
    id: 'expense.categories',
    kind: 'howto',
    domain: 'money',
    title: 'Makundi ya matumizi',
    phrases: ['kundi la matumizi', 'aina za matumizi', 'category ya gharama'],
    must: [C.EXPENSE],
    any: [C.SETTINGS, C.DEFINE, C.HELP],
    block: [C.CREATE, C.BACKDATE],
    forms: ['PLAIN', 'HOWTO'],
    answer: `### Makundi ya Matumizi
Unapoongeza matumizi, unachagua **Kundi (Category)** ili ujue pesa zinaenda wapi. Mifano iliyopo:

- **Kodi ya Pango / Fremu**
- **Maji na Usafi**
- **Chakula na Vinywaji vya duka**
- **Kodi ya Serikali / TRA, Kibali**
- **Kurejesha Mikopo / Riba**
- **Matumizi Mengineyo (Nyingine)**

Kugawanya matumizi hivi kunakusaidia kuona kundi gani linakula faida yako zaidi.`,
    destination: { route: '/matumizi', spotlight: 'add-expense-btn', label: 'Nipeleke kwenye Matumizi' },
    related: ['expense.add', 'data.expenses'],
  },
  {
    id: 'report.history',
    kind: 'howto',
    domain: 'reports',
    title: 'Historia ya mauzo',
    phrases: ['historia ya mauzo', 'miamala ya zamani', 'risiti zilizopita', 'nione mauzo yote'],
    must: [C.HISTORY],
    block: [C.DELETE, C.DEBT],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Historia ya Mauzo
1. Nenda kwenye **Historia ya Mauzo**.
2. Bofya **"Chagua Kipindi cha Ripoti"** ili kuchuja kwa tarehe unayotaka.
3. Utaona **Jumla ya Mapato**, **Jumla ya Faida**, **Faida Halisi (Baada ya Matumizi)** na **Jumla ya Risiti Zilizokatwa**.
4. Kuna pia **Bidhaa 10 Zinazoongoza** kwa kipindi ulichochagua.
5. Gusa risiti yoyote kuona bidhaa zilizouzwa ndani yake.`,
    destination: { route: '/historia', spotlight: 'period-filter', label: 'Fungua Historia ya Mauzo' },
    related: ['report.daily_page', 'data.sales'],
  },
  {
    id: 'report.daily_email',
    kind: 'howto',
    domain: 'reports',
    title: 'Ripoti za kila siku',
    phrases: ['pokea ripoti kila siku', 'ripoti ya pulse na master', 'nitumiwe ripoti'],
    must: [C.REPORT],
    any: [C.APP, C.SETTINGS],
    block: [C.STAFF, C.EXPORT, C.HISTORY, C.SECURITY],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Ripoti za Kila Siku
Kwenye **Zaidi** kuna chaguo la **"Pokea ripoti za Pulse na Master kila siku"**.

Ukiiwasha, utakuwa unapokea muhtasari wa duka lako kila siku bila kuufungua mwenyewe — mauzo, faida na hali ya stoo.`,
    destination: { route: '/zaidi', spotlight: 'daily-reports-toggle', label: 'Fungua mipangilio ya ripoti' },
    related: ['report.daily_page', 'data.business'],
  },
  {
    id: 'staff.edit',
    kind: 'howto',
    domain: 'staff',
    title: 'Kuhariri au kuzuia mfanyakazi',
    phrases: ['hariri mfanyakazi', 'zuia mfanyakazi', 'mfanyakazi ameondoka kazini', 'futa mfanyakazi'],
    must: [C.STAFF],
    any: [C.EDIT, C.DELETE],
    block: [C.CREATE, C.PERMISSION],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Kuhariri au Kuzuia Mfanyakazi
1. Nenda **Zaidi**, sehemu ya **Wafanyakazi**.
2. Gusa mfanyakazi husika kisha bofya **"Hariri Mfanyakazi"**.
3. Unaweza kubadilisha **Jina la Mfanyakazi** au hali yake.
4. Mfanyakazi akiondoka kazini, mbadilishe kuwa **"Imezuiwa"** badala ya kumfuta — hivyo hataweza kuingia tena, lakini historia ya mauzo aliyofanya itabaki salama kwenye ripoti zako.`,
    destination: { route: '/zaidi', spotlight: 'staff-section', label: 'Nionyeshe sehemu ya Wafanyakazi' },
    related: ['staff.add', 'staff.permissions'],
  },
  {
    id: 'shop.add',
    kind: 'howto',
    domain: 'setup',
    title: 'Kuongeza duka jingine',
    phrases: ['ongeza duka', 'nina maduka mawili', 'duka la pili', 'nifungue tawi jingine'],
    must: [C.BRANCH],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Kuongeza na Kubadili Duka
Unaweza kuwa na zaidi ya duka moja kwenye akaunti hiyo hiyo.

1. Nenda **Zaidi**, sehemu ya **Menejimenti na kubadili duka lako**.
2. Bofya **"Ongeza Duka"** kusajili duka jipya.
3. Kubadili kutoka duka moja kwenda lingine, chagua duka husika kwenye orodha hiyo hiyo.

> 📌 Kila duka lina bidhaa, mauzo na wafanyakazi wake — takwimu hazichanganyiki.`,
    destination: { route: '/zaidi', spotlight: 'shops-section', label: 'Fungua menejimenti ya maduka' },
    related: ['settings.shop', 'staff.add'],
  },
  {
    id: 'shop.hours24',
    kind: 'howto',
    domain: 'setup',
    title: 'Duka la saa 24',
    phrases: ['duka la saa 24', 'nafunga usiku wa manane', 'mauzo ya usiku yanaingia siku gani'],
    must: [C.HOURS_24],
    forms: ['HOWTO', 'PLAIN', 'WHY'],
    answer: `### Duka la Saa 24
Kama duka lako linafanya kazi usiku kucha, washa chaguo la **"Duka la Saa 24"** kwenye **Zaidi**.

Hii inasaidia mauzo ya usiku wa manane yahesabiwe kwenye siku sahihi ya biashara badala ya kukatika saa sita usiku.`,
    destination: { route: '/zaidi', spotlight: 'hours24-toggle', label: 'Fungua mipangilio' },
    related: ['settings.shop', 'report.daily_page'],
  },
  {
    id: 'settings.profile',
    kind: 'howto',
    domain: 'setup',
    title: 'Kuhariri wasifu wako',
    phrases: ['hariri wasifu', 'badilisha jina langu', 'jina lako kamili'],
    must: [C.PROFILE],
    forms: ['HOWTO', 'WHERE'],
    answer: `### Kuhariri Wasifu Wako
1. Nenda kwenye **Zaidi**.
2. Bofya **"Hariri Wasifu"**.
3. Badilisha **Jina Lako Kamili** au taarifa nyingine za akaunti yako.
4. Hifadhi — jina hili ndilo linaloonekana kwenye ripoti kama muuzaji.`,
    destination: { route: '/zaidi', spotlight: 'profile-section', label: 'Fungua Wasifu' },
    related: ['settings.shop', 'error.login'],
  },
  {
    id: 'settings.clear_history',
    kind: 'howto',
    domain: 'setup',
    title: 'Kufuta historia',
    phrases: ['futa historia', 'nifute data zote', 'clear history'],
    must: [C.HISTORY, C.DELETE],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Kufuta Historia
Kwenye **Zaidi** kuna chaguo la **"Futa Historia"**.

> ⚠️ **Tahadhari kubwa:** hatua hii inaondoa kumbukumbu na haiwezi kurudishwa. Kabla ya kufanya hivyo, pakua ripoti zako (Excel/PDF) ili usipoteze takwimu za biashara yako.`,
    destination: { route: '/zaidi', spotlight: 'clear-history', label: 'Fungua Zaidi' },
    related: ['report.export', 'report.history'],
  },
  {
    id: 'support.contact',
    kind: 'howto',
    domain: 'system',
    title: 'Huduma kwa wateja',
    phrases: ['huduma kwa wateja', 'niwasiliane na nani', 'nataka msaada wa kiufundi', 'namba ya support'],
    must: [C.SUPPORT],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Huduma kwa Wateja
Ukikwama na jambo lolote ambalo mimi siwezi kukusaidia, nenda **Zaidi** kisha **"Huduma kwa Wateja"** upate njia za kuwasiliana na timu ya Venics Sales moja kwa moja.`,
    destination: { route: '/zaidi', spotlight: 'support-section', label: 'Fungua Huduma kwa Wateja' },
    related: ['system.help', 'license.renew'],
  },
  {
    id: 'audit.price_changes',
    kind: 'howto',
    domain: 'security',
    title: 'Kufuatilia mabadiliko ya bei na stoo',
    phrases: ['nani amebadilisha bei', 'bei ya asili na bei mpya', 'nani amepunguza stock', 'bidhaa tatanishi'],
    must: [C.SECURITY],
    any: [C.PRICE, C.STOCK, C.STAFF],
    forms: ['HOWTO', 'WHERE', 'WHY'],
    answer: `### Mabadiliko ya Bidhaa
Ukurasa wa **Mabadiliko ya Bidhaa** unakuonyesha kila mabadiliko yaliyofanywa duka:

- **Mhusika** — nani alifanya mabadiliko.
- **Bei ya Asili** na **Bei Mpya** — kama bei ilibadilishwa.
- **Stock Iliyopunguzwa** na **Kiasi Kilichorudishwa**.
- **Bidhaa Tatanishi** — mabadiliko yenye mashaka.

Pitia ukurasa huu angalau mara moja kwa wiki ili kuziba mianya ya upotevu.`,
    destination: { route: '/audit-logs', spotlight: 'audit-list', label: 'Fungua Mabadiliko ya Bidhaa' },
    related: ['data.security', 'staff.permissions'],
  },
  {
    id: 'dashboard.overview',
    kind: 'howto',
    domain: 'reports',
    title: 'Dashibodi inaonyesha nini',
    phrases: ['dashibodi inaonyesha nini', 'ukurasa wa mwanzo', 'dashboard'],
    must: [C.DASHBOARD],
    forms: ['HOWTO', 'WHERE', 'PLAIN'],
    answer: `### Dashibodi
Dashibodi ni muhtasari wa haraka wa duka lako:

- **Mapato (Leo)**, **Faida (Leo)** na **Faida Halisi**
- **Mauzo Mwezi Huu** na **Muhtasari wa Mwezi**
- **Mapato (Siku 7 Zilizopita)** — mwenendo wa wiki
- **Hali ya Stock** — **Bidhaa Zinazoisha**, **Zinakaribia Kuisha Muda**, **Zimekwisha Muda (Expired)**
- **Tahadhari ya Bidhaa** — pamoja na **Hasara Inayoweza Kuepukika** na **Uhakiki wa Bei**`,
    destination: { route: '/dashibodi', label: 'Fungua Dashibodi' },
    related: ['data.business', 'product.price_check'],
  },

  // ---- Explainers (business literacy) ----------------------------------
  {
    id: 'explain.net_profit',
    kind: 'howto',
    domain: 'strategy',
    title: 'Faida halisi ni nini',
    phrases: ['faida halisi ni nini', 'tofauti ya faida na faida halisi', 'net profit maana yake'],
    must: [C.NET_PROFIT, C.DEFINE],
    forms: ['PLAIN', 'HOWTO', 'WHY'],
    answer: `### Faida Halisi ni Nini?
- **Faida ya Bidhaa (Faida Ghafi):** Bei ya kuuza − Bei ya kununua, kwa bidhaa zote ulizouza.
- **Faida Halisi (Net Profit):** Faida Ghafi − **Matumizi** yote ya duka (pango, umeme, usafiri, n.k.).

Faida halisi ndiyo pesa safi zinazobaki mfukoni mwako.

> 💡 Hii ndiyo sababu ni muhimu kurekodi **kila** matumizi. Usipoyaandika, ripoti itaonyesha faida kubwa kuliko uhalisia.`,
    related: ['expense.add', 'explain.margin', 'data.sales'],
  },
  {
    id: 'explain.margin',
    kind: 'howto',
    domain: 'strategy',
    title: 'Faida ya bidhaa inahesabiwaje',
    phrases: ['faida ya bidhaa inahesabiwaje', 'margin ni nini', 'nipangeje bei ya kuuza'],
    must: [C.PROFIT, C.DEFINE],
    block: [C.NET_PROFIT],
    forms: ['PLAIN', 'HOWTO', 'WHY'],
    answer: `### Faida ya Bidhaa Inahesabiwaje
Faida ya bidhaa moja = **Bei ya Kuuza − Bei ya Kununua**.

Ndiyo maana ni muhimu kujaza **bei ya kununua** kwa usahihi unaposajili bidhaa — bila hiyo, mfumo hauwezi kujua unapata faida kiasi gani.

**Vidokezo vya kupanga bei:**
- Bidhaa zinazouzwa haraka zinaweza kuwa na faida ndogo kwa kila kipande, lakini mzunguko mkubwa.
- Bidhaa zinazokaa muda mrefu zinahitaji faida kubwa zaidi kwa kipande.`,
    related: ['product.edit_price', 'explain.net_profit', 'product.price_check'],
  },
  {
    id: 'explain.capital',
    kind: 'howto',
    domain: 'strategy',
    title: 'Thamani ya mzigo (mtaji)',
    phrases: ['mtaji wangu ni kiasi gani', 'thamani ya mzigo maana yake', 'capital ya duka'],
    must: [C.CAPITAL, C.DEFINE],
    forms: ['PLAIN', 'HOWTO', 'WHY'],
    answer: `### Thamani ya Mzigo (Mtaji)
Mfumo huhesabu thamani ya bidhaa zilizopo stoo kwa njia mbili:

- **Kwa bei ya kununua** — kiasi cha pesa ulichozamisha kwenye mzigo (mtaji wako halisi).
- **Kwa bei ya kuuza** — kiasi utakachopata ukiuza mzigo wote.

Tofauti kati ya hizi mbili ndiyo faida inayokusubiri kwenye stoo yako.`,
    related: ['data.stock', 'explain.margin'],
  },
  {
    id: 'explain.offline',
    kind: 'howto',
    domain: 'system',
    title: 'Kutumia app bila mtandao',
    phrases: ['naweza kutumia bila internet', 'app inafanya kazi offline', 'mtandao umekatika nifanyeje'],
    must: [C.OFFLINE],
    forms: ['PLAIN', 'HOWTO', 'WHY'],
    answer: `### Kutumia Duka Bila Mtandao
**Ndiyo — unaweza kuuza bila internet kabisa.**

- Mauzo, bidhaa na matumizi vyote huhifadhiwa kwenye kifaa chako kwanza.
- Mtandao ukirudi, kila kitu husawazishwa chenyewe kwenda kwenye wingu na kwenye vifaa vingine vya duka.
- Kile kinachohitaji mtandao ni: kusawazisha na vifaa vingine, na kuwaona wafanyakazi wanaouza kwenye kifaa kingine.`,
    related: ['system.sync', 'system.help'],
  },
];

/** id → skill, for related-lookup and handler dispatch. */
export const SKILL_INDEX = new Map(SKILLS.map((s) => [s.id, s]));

/**
 * Dev-time integrity check. The old FollowUpEngine referenced 9 knowledge-base
 * ids that did not exist, so its follow-ups silently never fired. This makes
 * that class of mistake loud instead of invisible.
 */
export function validateRegistry(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const skill of SKILLS) {
    if (seen.has(skill.id)) problems.push(`Duplicate skill id: ${skill.id}`);
    seen.add(skill.id);

    for (const rel of skill.related ?? []) {
      if (!SKILL_INDEX.has(rel)) {
        problems.push(`${skill.id}: related id "${rel}" does not exist`);
      }
    }
    if (skill.kind === 'howto' && !skill.answer) {
      problems.push(`${skill.id}: howto skill has no answer`);
    }
    if ((skill.kind === 'data' || skill.kind === 'action') && !skill.handler) {
      problems.push(`${skill.id}: ${skill.kind} skill has no handler`);
    }
  }

  return problems;
}
