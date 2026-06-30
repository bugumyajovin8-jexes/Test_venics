import { QueryParser } from './QueryParser';

export interface KnowledgeEntry {
  id: string;
  category: 'sales' | 'inventory' | 'customers' | 'reports' | 'staff' | 'cash' | 'troubleshooting' | 'setup' | 'branches' | 'accounting' | 'subscription' | 'general';
  titleSw: string;
  titleEn: string;
  keywords: string[];
  answer: string;
  actionCode?: string;
  action?: { label: string; path: string };
}

export const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  // 1) Sales & Billing
  {
    id: "sale_how_to",
    category: "sales",
    titleSw: "Jinsi ya Kufanya Mauzo (Nafanyaje mauzo / Kuuza)",
    titleEn: "How to Make a Sale",
    keywords: ["fanya mauzo", "kuuza", "mauzo", "how to sell", "make a sale", "billing", "ingiza mauzo", "piga mauzo"],
    answer: `### Jinsi ya Kufanya Mauzo duka kwako (How to Sell):
1. Hakikisha upo kwenye ukurasa wa **Mauzo**.
2. Bofya bidhaa unayotaka kuuza ili iongezwe kwenye kikapu. Ikiwa bidhaa ina uzani ama bei tofauti, taja kiasi.
3. Bofya kitufe cha **"Uza"** au **"Kamilisha Mauzo"** chini ya Kikapu.
4. Chagua **Njia ya Malipo**:
   - **Cash (Pesa Taslimu)**
   - **M-Pesa / Tigo Pesa / Airtel Money** (Malipo ya simu)
   - **Credit (Deni)** - Ukichagua hii, utahitajika kuchagua au kuongeza jina la **Mteja**.
5. Bofya **"Kamilisha"** ili kuhifadhi mauzo na kuchapisha risiti (ikiwa umeunganisha printa).`,
    action: { label: "Nenda kwenye Mauzo", path: "/kikapu" }
  },
  {
    id: "sale_add_cart",
    category: "sales",
    titleSw: "Jinsi ya Kuongeza Bidhaa Kwenye Kikapu",
    titleEn: "How to Add Items to Cart",
    keywords: ["kikapu", "add to cart", "ongeza kwenye kikapu", "kurefusha kikapu", "bidhaa kwenye kikapu"],
    answer: `### Kuongeza Bidhaa Kwenye Kikapu (Adding to Cart):
- **Njia ya 1:** Gusa jina au picha ya bidhaa moja kwa moja kwenye orodha ya bidhaa. Kila ukigusa, kiasi (Quantity) kitaongezeka kwa moja (+1).
- **Njia ya 2:** Kutumia **Barcode Scanner** (Kifaa cha kusoma misimbo). Skani bidhaa na itajiongeza yenyewe moja kwa moja kwenye kikapu chenye bei yake husika.`,
    action: { label: "Nenda kwenye Mauzo", path: "/kikapu" }
  },
  {
    id: "sale_discount",
    category: "sales",
    titleSw: "Jinsi ya Kutoa Punguzo (Discount / Punguza)",
    titleEn: "How to Apply Discounts",
    keywords: ["discount", "punguza", "punguzo", "asilimia", "fixed discount", "punguza bei", "aslimia"],
    answer: `### Kutoa Punguzo Kwenye Mauzo (Applying Discounts):
1. Ukiwa kwenye ukurasa wa **Mauzo**, bofya chaguo la **"Punguzo / Discount"** juu ya kitufe cha kulipia.
2. Unaweza kutoa punguzo la aina mbili:
   - **Punguzo la Thamani ya Kudumu (Fixed Discount):** Mfano, kupunguza **TZS 1,000** kwenye jumla.
   - **Punguzo la Asilimia (% Discount):** Mfano, kutoa **5%** ya punguzo kwenye jumla ya bei.
3. Punguzo hili litakatwa moja kwa moja kwenye jumla na kuingia kwenye ripoti kama punguzo ili usipoteze hesabu ya faida yako.`,
    action: { label: "Nenda kwenye Mauzo", path: "/kikapu" }
  },
  {
    id: "sale_split_payment",
    category: "sales",
    titleSw: "Malipo ya Awamu / Kugawana Malipo (Split Payments)",
    titleEn: "How to Split Payments",
    keywords: ["split payment", "gawanya malipo", "awamu", "lipa nusu na nusu", "nusu taslimu", "malipo mchanganyiko"],
    answer: `### Kugawanya Malipo (Split Payments):
- Mfumo wetu unaruhusu kupokea malipo kupitia njia zaidi ya moja kwenye miamala mchanganyiko.
- Unapoenda **Kulipia**, bofya chaguo la **"Mchanganyiko (Split)"**, ingiza kiasi cha pesa kilicholipwa kwa **Taslimu (Cash)** na kilichobaki kilicholipwa kwa **Simu (M-Pesa/Tigo Pesa)** ili kuweka uwiano sahihi duka.`,
    action: { label: "Nenda kwenye Mauzo", path: "/kikapu" }
  },
  {
    id: "sale_mobile_money",
    category: "sales",
    titleSw: "Kurekodi Malipo ya Mitandao ya Simu (M-Pesa / Tigo Pesa / Airtel Money)",
    titleEn: "Recording Mobile Money Payments",
    keywords: ["mpesa", "tigopesa", "airtel", "halopesa", "lipa namba", "simu", "malipo ya mtandao", "mobile money"],
    answer: `### Kurekodi Malipo ya Simu (Mobile Money):
1. Baada ya kujaza bidhaa kwenye kikapu, bofya **"Lipia"**.
2. Katika skrini ya njia za malipo, chagua **"Mobile Money (Mtandao)"**.
3. Chagua mtandao ulipotokea muamala (k.m. M-Pesa, Tigo Pesa, Airtel Money).
4. (Hiari) Unaweza kuingiza **Msimbo wa Muamala (Transaction ID)** ili kurahisisha ukaguzi pindi unapolinganisha hesabu na mtandao husika.`,
    action: { label: "Nenda kwenye Mauzo", path: "/kikapu" }
  },
  {
    id: "sale_receipt",
    category: "sales",
    titleSw: "Kutoa / Kuchapisha na Kurudisha Risiti (Receipt Print / Reprint)",
    titleEn: "Issuing & Reprinting Receipts",
    keywords: ["risiti", "receipt", "print", "chapa risiti", "reprint", "rudisha risiti", "stakabadhi"],
    answer: `### Kutoa na Kuchapisha Risiti:
- **Kutoa Risiti Mpya:** Baada ya muamala kukamilika, bofya **"Chapa Risiti (Print Receipt)"**. Mfumo utatuma amri kwenye Printer yako ya Bluetooth au USB.
- **Kurudisha/Reprint Risiti ya Kale:**
  1. Nenda kwenye ukurasa wa **Historia ya Mauzo**.
  2. Bofya muamala husika uliopita.
  3. Bofya kitufe cha **"Print"** au **"Shiriki risiti (PDF/WhatsApp)"** kutuma kwa mteja mteule.`,
    action: { label: "Kagua Historia ya Mauzo", path: "/historia" }
  },
  {
    id: "sale_refund_cancel",
    category: "sales",
    titleSw: "Kufuta Mauzo / Kumrudishia Mteja (Marejesho duka)",
    titleEn: "Refunding & Cancelling Sales",
    keywords: ["refund", "cancel", "futa mauzo", "futa muamala", "rudisha hela", "rejesha bidhaa", "futa muamala kabla ya kuuza"],
    answer: `### Kufuta Mauzo au Kurejesha (Marejesho):
1. Nenda kwenye ukurasa wa **Historia (History)** wa mauzo yako.
2. Gusa muamala unaotaka kuufuta au kuufanyia marekebisho.
3. Bofya kitufe cha **"Refund"** (Kurejesha bidhaa stoo) au **"Futa"**.
4. Weka sababu ya kufanya marekebisho hayo (k.m., mzigo umebainika una kasoro, mteja amebadili mawazo).
5. Bidhaa zitarudi stoo moja kwa moja na mauzo hayo yataondolewa kwenye ripoti ya siku huku rekodi yake ikihifadhiwa kwenye **Ripoti ya Mabadiliko duka** chini ya sehemu ya ulinzi ili kuzuia wizi wa mhudumu.`,
    action: { label: "Kagua Historia ya Mauzo", path: "/historia" }
  },
  {
    id: "sale_tax_vat",
    category: "sales",
    titleSw: "Kuweka Kodi / VAT",
    titleEn: "Applying Tax & VAT",
    keywords: ["vat", "kodi", "tax", "tra", "risiti ya kodi"],
    answer: `### Kuongeza au Kuweka Kodi/VAT:
- Ili bidhaa zako zijumuishe kodi ya VAT, unaweza kuangalia usanidi wake katika sehemu ya **Mipangilio (Settings)** -> **Viwango vya Kodi**.
- Unaweza kuweka **18% VAT** iwe inakokotolewa yenyewe wakati wa kuuza, ama kuizima kabisa ili mauzo yako yasiwe na kodi ya nyongeza.`,
    action: { label: "Nenda kwenye Mipangilio", path: "/zaidi" }
  },

  // 2) Products & Inventory
  {
    id: "product_add_new",
    category: "inventory",
    titleSw: "Jinsi ya Kusajili / Kuongeza Bidhaa Mpya",
    titleEn: "How to Add a New Product",
    keywords: ["ongeza bidhaa", "sajili bidhaa", "weka bidhaa", "add product", "new product", "bidhaa mpya", "ingiza mzigo"],
    answer: `### Kusajili Bidhaa Mpya Stoo:
1. Nenda kwenye ukurasa wa **Bidhaa (Inventory / Products)** kwenye menyu yako.
2. Bofya kitufe kilichoandikwa **"Ingiza Bidhaa"** au alama ya **"+"** ya kijani kibichi.
3. Jaza taarifa zifuatazo:
   - **Jina la Bidhaa** (k.m. "Coke ya Kopo 350ml")
   - **Bei ya Kununulia (Cost Price)** - Hii inasaidia kukokotoa faida halisi.
   - **Bei ya Kuuzia (Selling Price)**
   - **Kiasi cha Sasa (Current Stock)** - Kiasi kilichopo stoo sasa hivi.
   - **Kiwango cha Tahadhari (Min Stock Alert)** - Mfumo utakuonya baki ikifikia hapa.
4. Bofya **"Hifadhi Bidhaa"**.`,
    action: { label: "Nenda kwenye Bidhaa", path: "/bidhaa" }
  },
  {
    id: "product_edit_price",
    category: "inventory",
    titleSw: "Jinsi ya Kubadilisha Bei ya Bidhaa",
    titleEn: "How to Change Product Price",
    keywords: ["badilisha bei", "edit price", "rekebisha bei", "bei ya bidhaa", "price update"],
    answer: `### Kurekebisha bei ya kuuzia au bei ya kununulia ya bidhaa:
1. Nenda kwenye ukurasa wa **Bidhaa (Inventory)**.
2. Tafuta bidhaa unayotaka kuibadilisha bei kwa kuandika jina lake kwenye sehemu ya kutafuta (Search).
3. Bofya ikoni ya **Kalamu (Edit)** karibu na bidhaa hiyo.
4. Badilisha bei kwenye sehemu ya **Bei ya Kuuza** au **Bei ya Kununua**.
5. Bofya **"Hifadhi"** (Save). Bei ya bidhaa itabadilika mara moja na kuanza kutumika kwenye kikapu kipya.`,
    action: { label: "Nenda kwenye Bidhaa", path: "/bidhaa" }
  },
  {
    id: "product_update_stock",
    category: "inventory",
    titleSw: "Jinsi ya Ongeza / Rejesha Mzigo (Restock / Stock Update)",
    titleEn: "How to Update Stock Quantity",
    keywords: ["ongeza stock", "restock", "ongeza mzigo", "update stock", "weka mzigo", "mzigo mwingine", "weka kiasi"],
    answer: `### Kuongeza au Kusasisha Mzigo (Restock):
1. Nenda kwenye kichupo cha **Bidhaa (Inventory)**.
2. Gusa bidhaa unayotaka kuongeza mzigo uliopokelewa kutoka kwa msambazaji.
3. Bofya chaguo la **"Update Stock (Ongeza Mzigo)"** au bofya edit ya haraka ya idadi ya stoo.
4. Unaweza kuongeza kiasi kilichowasili (k.m., ukijaza "+50" inaongeza juu ya baki ya zamani).
5. Bofya **"Hifadhi"**. Mfumo utarekodi muamala huu na kuweka histori ya uingizaji mzigo.`,
    action: { label: "Nenda kwenye Bidhaa", path: "/bidhaa" }
  },
  {
    id: "product_delete",
    category: "inventory",
    titleSw: "Jinsi ya Kufuta Bidhaa Kabisa duka kwako",
    titleEn: "How to Delete/Remove a Product",
    keywords: ["futa bidhaa", "remove product", "delete product", "diliti bidhaa", "ondoa mzigo", "ondoa bidhaa"],
    answer: `### Kufuta Bidhaa:
1. Nenda kwenye ukurasa wa **Bidhaa**.
2. Tafuta bidhaa inayohusika, bofya ikoni ya kalamu (Edit).
3. Chini ya skrini ya uhariri, kuna kitufe chenye rangi ya nyekundu kilichoandikwa **"Futa Bidhaa" (Delete)**.
4. Gusa hapo na uthibitishe uamuzi huo. Bidhaa itaondolewa kwenye orodha amilifu kuzuia uuzaji wa kimakosa.`,
    action: { label: "Nenda kwenye Bidhaa", path: "/bidhaa" }
  },
  {
    id: "product_low_stock",
    category: "inventory",
    titleSw: "Kuangalia Bidhaa Zinazoisha (Low Stock)",
    titleEn: "How to Check Low Stock Items",
    keywords: ["low stock", "bidhaa zinazoisha", "zimeisha", "mzigo umeisha", "baki kidogo", "alert stock"],
    answer: `### Kuangalia Bidhaa Zinazoisha:
- **Njia ya Haraka:** Kwenye ukurasa wa mwanzo wa **Dawati la Uchambuzi (Dashibodi)** au kupitia **Venics Smart**, utaona sanduku maalum lililoandikwa "Low Stock alert" au "Bidhaa zinazoisha".
- **Njia ya 2:** Kwenye orodha ya **Bidhaa**, bidhaa zenye baki iliyo chini ya Kiwango cha Tahadhari (Minimum Stock) zitatia alama nyekundu au njano kukukumbusha kuagiza haraka.`,
    action: { label: "Kagua Bidhaa Pungufu", path: "/bidhaa" }
  },
  {
    id: "product_stock_take",
    category: "inventory",
    titleSw: "Jinsi ya Kufanya Ukaguzi wa Mzigo (Stock Taking / Audit)",
    titleEn: "How to Perform Stock Taking/Audit",
    keywords: ["stock taking", "stock audit", "ukaguzi", "hesabu mzigo", "kuhakiki stoo", "stock loss"],
    answer: `### Kufanya Ukaguzi na Uhakiki wa Mzigo (Stock Taking):
1. Bofya menyu ya **"Stock Audit (Ukaguzi wa Stoo)"**.
2. Mfumo utakuhitaji kuhesabu kimwili bidhaa moja baada ya nyingine.
3. Ingiza idadi halisi uliyoikuta kwenye rafu.
4. Ikiwa kuna tofauti (Discrepancy) kati ya hesabu ya mfumo na hesabu ya mhudumu:
   - Mfumo utarekodi tofauti hiyo.
   - Utalazimika kuandika sababu (k.m., chupa ilivunjika, bidhaa imeharibika).
   - Hii inaziba mianya yote ya upotevu wa bidhaa bila taarifa.`,
    action: { label: "Nenda kwenye Mipangilio", path: "/zaidi" }
  },
  {
    id: "product_barcode",
    category: "inventory",
    titleSw: "Kusanidi Mashine ya Barcode (Barcode Scanning)",
    titleEn: "Setting up Barcode Scanning",
    keywords: ["barcode", "barcode scanner", "skani", "kisimbuzi", "scanner ya msimbo", "msimbo"],
    answer: `### Matumizi ya Barcode Scanner:
1. Duka letu linaunganisha mashine za Barcode za USB pamoja na za wireless.
2. Unaposajili au kurekebisha bidhaa, bofya uwanja wa **"Barcode / Msimbo"**.
3. Skani Barcode iliyo kwenye bidhaa kwa kutumia mashine yako au kamera ya simu; msimbo utajaza uwanja huo kiotomatiki.
4. Wakati wa kuuza, ukiwa kwenye kikapu, skani tu bidhaa husika na mfumo utaitafuta na kuiingiza kwenye kikapu bila kukosea.`,
    action: { label: "Nenda kwenye Bidhaa", path: "/bidhaa" }
  },

  // 3) Customers
  {
    id: "customer_add_debt",
    category: "customers",
    titleSw: "Kusajili Mteja na Kumkopesha (Add Customer & Record Debt)",
    titleEn: "Adding Customers & Giving Credit",
    keywords: ["mteja mgeni", "ongeza mteja", "kopesha", "mpe deni", "sajili mteja", "customer debt"],
    answer: `### Kusajili Mteja Mpya na Kurekodi Deni:
1. Wakati unauza na bidhaa ziko kwenye kikapu, bofya **"Lipia"**.
2. Chagua njia ya malipo ya **"Credit (Deni)"**.
3. Mfumo utakutaka uchague mteja. Kama mteja hayupo:
   - Bofya **"Sajili Mteja Mpya" (Add Customer)**.
   - Jaza jina, namba yake ya simu, na kikomo chake cha mkopo ikiwa ipo.
   - Bofya **"Hifadhi"**.
4. Baada ya kumchagua mteja huyo, bofya **"Kamilisha"**. Deni lake litarekodiwa na kiasi hicho kitaingia kwenye akaunti yake ya madeni sasa hivi.`,
    action: { label: "Kagua Madeni", path: "/madeni" }
  },
  {
    id: "customer_pay_debt",
    category: "customers",
    titleSw: "Kupokea Malipo ya Madeni ya Wateja",
    titleEn: "Recording Customer Debt Payments",
    keywords: ["lipa deni", "punguza deni", "payment debt", "mteja kalipa", "rejesha deni"],
    answer: `### Jinsi ya kurekodi malipo yanapotolewa na mteja mwenye deni:
1. Nenda kwenye orodha ya **Madeni (Debts / Credit Customers)**.
2. Tafuta jina la mteja aliyekuja kulipa na bofya wasifu wake.
3. Bofya kitufe cha **"Pokea Malipo (Receive Payment)"**.
4. Weka kiasi cha fedha alicholipa (taslimu au kwa simu) na tarehe ya leo.
5. Bofya **"Kamilisha"**. Kiasi hicho kitakatwa kutoka kwenye deni lake kubwa na baki yake mpya itasasishwa papo hapo.`,
    action: { label: "Kagua Madeni", path: "/madeni" }
  },

  // 4) Reports & Analytics
  {
    id: "report_daily",
    category: "reports",
    titleSw: "Kuangalia Ripoti ya Mauzo Siku (Daily Reports)",
    titleEn: "How to View Daily Sales Reports",
    keywords: ["mauzo ya leo", "ripoti ya siku", "mauzo leo", "daily report", "profit today", "faida ya leo"],
    answer: `### Kuangalia Mauzo na Faida ya Leo (Daily Reports):
- **Njia Rahisi:** Fungua chat na Venics Smart na uulize: *"Nimeuza kiasi gani leo?"* au *"Faida ya leo"*. Assistant atapiga hesabu na kukupatia mchanganuo.
- **Njia ya 2:** Nenda kwenye ukurasa wa **Dashibodi (Dashboard)** au ukurasa wa **Historia (History)**. Unaweza kuchuja taarifa za tarehe ya leo ili kuona kila muamala na faida yake husika.`,
    action: { label: "Kagua Dashibodi", path: "/dashibodi" }
  },
  {
    id: "report_bestselling",
    category: "reports",
    titleSw: "Bidhaa Zinazouza Sana (Best Selling Products)",
    titleEn: "How to View Best Selling Products",
    keywords: ["trending", "bestselling", "inayouzwa sana", "mashuhuri", "maarufu", "best sellers"],
    answer: `### Kuona ni bidhaa gani inayoongoza kwa kuleta wateja na faida zaidi:
1. Kwenye **Dashibodi (Dashboard)** yako, tembea hadi sehemu ya **"Uchambuzi wa Bidhaa"**.
2. Mfumo unaonyesha chati iliyojaa rangi inayokariri **"Bidhaa Zinazouzwa Sana (Top Selling Items)"**.
3. Utaona jina la bidhaa hiyo pamoja na idadi iliyokwisha kuuzwa tangu uanze kutumia mfumo huu.`,
    action: { label: "Kagua Dashibodi", path: "/dashibodi" }
  },
  {
    id: "report_export",
    category: "reports",
    titleSw: "Kupakua hesabu kama Excel au PDF (Export Reports)",
    titleEn: "Exporting Reports to Excel/PDF",
    keywords: ["pakua", "export", "excel", "pdf", "shushia ripoti", "tuma ripoti excel"],
    answer: `### Kupakua hesabu au ripoti kama faili la Excel/PDF:
- Nenda kwenye ukurasa wa **Historia ya Mauzo** au **Matumizi** au **Bidhaa**.
- Juu ya meza ya data, kuna kitufe chenye rangi ya kijani kilichoandikwa **"Download Excel"** au **"Export to Excel"**.
- Bofya hapo, na faili litatengenezwa na kupakuliwa moja kwa moja kwenye simu au kompyuta yako ambalo unaweza kumtumia mhasibu wako.`,
    action: { label: "Nenda kwenye Historia", path: "/historia" }
  },

  // 5) Cashier & Staff Management
  {
    id: "staff_add_permission",
    category: "staff",
    titleSw: "Ongeza Mfanyakazi na Kusanidi Ruhusa zake (Staff Permission)",
    titleEn: "Adding Cashiers & Setting Permissions",
    keywords: ["mhudumu", "cashier", "mhudumu mgeni", "ruksa", "ruhusa", "permission", "futa mfanyakazi", "mfanyakazi", "ongeza mfanyakazi", "sajili mfanyakazi", "mhudumu mpya", "mfanyakazi mpya", "ongeza mhudumu", "sajili mhudumu", "staff"],
    answer: `### Kuongeza Cashier au Mfanyakazi Mpya:
1. Nenda kwenye ukurasa wa **Zaidi**.
2. Angalia sehemu iliyoandikwa **Wafanyakazi**.
3. Bofya **"Ongeza"** (Add Staff).
4. Ingiza barua pepe(email) yake hakikisha ni sahihi kabisa. Usikosee hata kituo.
5. Sasa mpe na yeye app kwenye simu yake au ya ofisi alafu mwambie ajisajili kwa kutumia email hiyohiyo uliyoijaza.
5. Sanidi **Ruhusa zake (Permissions):**
   - **Mfanyakazi:** Anaweza kuuza bidhaa tu na kuona kikapu, HAWEZI kuona Mapato/faida ya duka, HAWEZI kubadilisha bei ya bidhaa, wala kufuta miamala ya zamani bila idhini yako.
   - **Manager (Meneja):** Ana ruhusa ya kusimamia stoo na matumizi.
6. Bofya **"Hifadhi"**.`,
    action: { label: "Fungua Mipangilio ya Wafanyakazi", path: "/zaidi" }
  },

  // 6) Payments & Cash Management
  {
    id: "cash_expenses",
    category: "cash",
    titleSw: "Jinsi ya Kurekodi Matumizi ya Duka (Record Expenses)",
    titleEn: "How to Record Store Expenses",
    keywords: ["rekodi matumizi", "matumizi", "expense", "gharama", "pesa ya chakula", "kulipia umeme", "pato la duka"],
    answer: `### Jinsi ya Kurekodi Matumizi ya duka (Expenses):
1. Nenda kwenye menyu ya **Matumizi (Expenses)**.
2. Bofya kitufe cha **"Ongeza Matumizi" (Add Expense)**.
3. Jaa taarifa zifuatazo:
   - **Kiasi cha Fedha** kilichotumika (k.m., TZS 5,000)
   - **Kundi (Category)** (k.m., Chakula, Umeme/Maji, Kodi ya fremu, Usafiri)
   - **Maelezo mafupi** (k.m., "Kununua umeme wa luku")
4. Bonyeza **"Hifadhi"**. Kiasi hiki kitakatwa moja kwa moja kwenye ripoti yako ya faida ili kupata faida halisi.`,
    action: { label: "Ingiza Matumizi", path: "/matumizi" }
  },

  // 7) Errors & Troubleshooting
  {
    id: "error_not_syncing",
    category: "troubleshooting",
    titleSw: "Nini cha kufanya data isiposawazisha (sync error)",
    titleEn: "Troubleshooting Sync Errors",
    keywords: ["stuck", "feli", "haisync", "sioni data", "haisawazishi", "syncing issue", "data iko wapi", "duka halisync"],
    answer: `### Msaada wa haraka data za duka zisiposawazisha (Sync Troubleshooting):
1. **Angalia Mtandao (Internet):** Hakikisha una mtandao wenye kasi wa kutosha. Ikiwa unatumia Wi-Fi ya duka, ijaze upya.
2. **Kuhakiki Akaunti:** Hakikisha duka lolote halijabadilika kuwa la majaribio, na uko kwenye wasifu wako halali wa "Venics Sales".
3. **Bofya "Sync Now":** Kwenye kona ya kushoto/chini ya skrini, bofya chaguo la **"Usawazishaji (Sync Now)"** ili kuburuta na kusukuma miamala yote iliyosubiri kwenye simu.`,
    action: { label: "Kagua Dashibodi", path: "/dashibodi" }
  },
  {
    id: "error_printer",
    category: "troubleshooting",
    titleSw: "Printa yangu ya Bluetooth haichapi risiti (Printer Issue)",
    titleEn: "Troubleshooting Bluetooth Printer Issues",
    keywords: ["printa haiprint", "haichapi", "bluetooth printer", "mashine ya risiti", "connect printer", "luku ya printa"],
    answer: `### Maelekezo ya Kuunganisha au Kurekebisha Printa haichapi:
1. **Washa Bluetooth:** Hakikisha Bluetooth ya simu au kompyuta iko "ON".
2. **Pairing:** Nenda kwenye mipangilio ya Bluetooth ya simu yako na utafute printa (mara nyingi jina lake ni *MTP-II* au *POS-58*). Weka nambari ya siri ya kuunganisha ambayo ni **0000** au **1234**.
3. **Chagua Kwenye App:** Fungua App yetu, nenda **Settings (Mipangilio)** -> **Printa**. Bofya **Connect** na uanze kuchapa risiti kwa furaha.`,
    action: { label: "Fungua Mipangilio ya Printa", path: "/zaidi" }
  },
  {
    id: "error_login",
    category: "troubleshooting",
    titleSw: "Nimeshindwa Kuingia Kwenye Akaunti (Login Failure / Locked Out)",
    titleEn: "Troubleshooting Login Failures",
    keywords: ["siwezi kuingia", "password imekataa", "login problem", "locked out", "akaunti imezuiwa", "block"],
    answer: `### Jinsi ya kutatua tatizo la kuingia kwenye akaunti yako:
- **Kosa la Nywila au Barua pepe:** Hakikisha unaingiza herufi sahihi za barua pepe na neno la siri bila kuacha nafasi (spaces) mwishoni.
- **Akaunti Kufungwa (Blocked):** Ikiwa unaambiwa *"Akaunti yako imezuiwa (Blocked)"*, wasiliana na msimamizi mkuu au mmiliki wa duka aliyesajili akaunti yako ili akufungulie kwenye mfumo.`
  },

  // 8) Setup & Configuration
  {
    id: "setup_shop_name",
    category: "setup",
    titleSw: "Kubadilisha Jina la Biashara au Sarafu ya Duka",
    titleEn: "How to Change Shop Name or Currency",
    keywords: ["jina la duka", "change name", "sarafu", "currency", "badili jina duka", "jina la duka letu"],
    answer: `### Kubadilisha Taarifa za Duka Lako:
1. Nenda kwenye sehemu ya **Mipangilio ya Duka (Shop Settings)**.
2. Badilisha **Business Name (Jina la Biashara)** linaloonekana kwenye risiti.
3. Kwenye chaguo la **Sarafu (Currency)**, chagua **TZS** kwa Shilingi ya Kitanzania, au sarafu yoyote unayotaka duka lifanye hesabu zake.
4. Bofya **"Hifadhi Mipangilio"** (Save).`,
    action: { label: "Fungua Mipangilio ya Duka", path: "/zaidi" }
  },

  // 9) Multi-Branch
  {
    id: "branch_manage",
    category: "branches",
    titleSw: "Kusimamia Maduka Mengi na Matawi (Multi-Branch Management)",
    titleEn: "Managing Multiple Branches",
    keywords: ["matawi", "branches", "duka lingine", "tawi lingine", "multi branch", "miliki maduka mawili", "tawi"],
    answer: `### Kusimamia Maduka Mengi (Multi-Store / Branches):
- Mfumo wetu unakuwezesha wewe kama **Mhasibu Mkuu (Boss)** kuongeza maduka mengi na kuyasimamia yote ukiwa sehemu moja.
- Unaweza kuhamisha bidhaa kutoka tawi moja hadi lingine bila kupoteza kumbukumbu.
- Ripoti ya kila tawi imejitenga ili ujue ni tawi gani linaleta faida kubwa zaidi kwa siku.`,
    action: { label: "Fungua Usimamizi wa Maduka", path: "/zaidi" }
  },

  // 10) Accounting / Business Intelligence (Advanced)
  {
    id: "accounting_margin",
    category: "accounting",
    titleSw: "Kuelewa Mtaji wako na Faida Halisi duka kwako (Profit & Loss)",
    titleEn: "Understanding Profit and Loss Accounts",
    keywords: ["mtaji mzunguko", "faida halisi", "loss", "hasara", "nitapataje faida", "kukuza biashara", "margin"],
    answer: `### Uchambuzi wa Mtaji na Hesabu za Faida na Hasara:
- **Faida Ghafi:** Huu ni mzunguko unaopatikana kwa kutoa Bei ya Kununua kwenye Bei ya Kuuza kwa bidhaa zote zilizouzwa leo.
- **Faida Halisi (Net Profit):** Inapatikana kwa kuchukua **Faida Ghafi** na kutoa **Matumizi (Expenses)** yote ya siku.
- Ili duka lako lipate afya ya kiuchumi ya kudumu, hakikisha matumizi ya uendeshaji ya kila siku yasizidi 30% ya faida yako ghafi inayopatikana duka.`,
    action: { label: "Kagua Dashibodi", path: "/dashibodi" }
  },

  // 11) Subscription / App Usage
  {
    id: "sub_renew",
    category: "subscription",
    titleSw: "Kuhusu Malipo ya Mfumo (App Subscription & Licensing)",
    titleEn: "App Subscriptions & Licensing Help",
    keywords: ["leseni", "lipa app", "subscription", "expire", "expire duka", "huduma ya kila mwezi", "bando la app"],
    answer: `### Huduma na Malipo ya App yetu (Subscription & Licensing Plan):
- Venics Sales ina mipango inayovutia kulingana na ukubwa wa duka lako:
  1. **Toleo la Kawaida (Standard Plan):** Line imara kwa duka la rejareja au la jumla lenye mhudumu mmoja.
  2. **Toleo la Juu (Premium Multi-Branch):** Bora kwa maduka yenye tawi zaidi ya moja na cashiers wengi.
- Ili kujua siku zilizosalia angalia kwenye **Dashibodi** au kulipia bando la leseni ya mwezi, nenda **Zaidi** -> **Malipo ya Mfumo**.`,
    action: { label: "Malipo ya Mfumo", path: "/zaidi" }
  },

  // 12) General how-to
  {
    id: "general_use",
    category: "general",
    titleSw: "Nafanyaje Kazi Mfumo huu kama Msaidizi?",
    titleEn: "What Can This System Do?",
    keywords: ["unafanya nini", "unajua nini", "msaada wako", "saidia duka", "learn app", "how it works"],
    answer: `### Unachoweza kufanya duka kwako na "Venics Sales":
- **Matumizi Rahisi:** Unaendesha mauzo nje ya mtandao na ndani ya mtandao kikamilifu na kwa uwazi.
- **Udhibiti wa Wizi:** Wafanyakazi wako wakifuta mauzo au kupunguza bei bila ruhusa, mfumo utakujulisha kupitia **Ripoti ya Mabadiliko duka** kuondoa mianya ya upotevu.
- **Kutabiri Bidhaa:** Najua ni bidhaa zipi zinakimbizwa sana duka mara nyingi na nazitaja stoo ziagizwe.
- **Tafuta Majibu Mara Moja:** Mimi nina uwezo wa kusoma takwimu halisi za duka na kukupa mchanganuo wa maendeleo yako.`
  }
];

export class KnowledgeBase {
  static findBestMatch(text: string): KnowledgeEntry | null {
    const cleanQuery = text.toLowerCase().trim();
    if (cleanQuery.length < 3) return null;

    const parsedQuery = QueryParser.parse(text);
    const queryTokens = parsedQuery.tokens;
    if (queryTokens.length === 0) return null;

    let bestEntry: KnowledgeEntry | null = null;
    let maxScore = 0;

    for (const entry of KNOWLEDGE_BASE) {
      let score = 0;

      // 1. Title phrase matches (High Weight)
      const titleSwLower = entry.titleSw.toLowerCase();
      const titleEnLower = entry.titleEn.toLowerCase();
      if (titleSwLower.includes(cleanQuery) || titleEnLower.includes(cleanQuery)) {
        score += 15;
      }

      // 2. Token overlap with exact titles
      const entryTitleTokens = new Set([
        ...QueryParser.parse(entry.titleSw).tokens,
        ...QueryParser.parse(entry.titleEn).tokens
      ]);

      const matchingTitleTokens = queryTokens.filter(t => entryTitleTokens.has(t));
      score += matchingTitleTokens.length * 4;

      // 3. Token overlap with keywords
      const entryKeywordTokens = new Set<string>();
      for (const keyword of entry.keywords) {
        const kwTokens = QueryParser.parse(keyword.toLowerCase()).tokens;
        for (const kt of kwTokens) {
          entryKeywordTokens.add(kt);
        }
      }

      const matchingKwTokens = queryTokens.filter(t => entryKeywordTokens.has(t));
      score += matchingKwTokens.length * 2;

      // Require a higher confidence threshold for long or multi-word queries to prevent false positives
      const isMultiWordQuery = queryTokens.length > 1;
      const minimumScoreNeeded = isMultiWordQuery ? 3 : 2;

      if (score > maxScore && score >= minimumScoreNeeded) {
        maxScore = score;
        bestEntry = entry;
      }
    }

    return bestEntry;
  }
}
