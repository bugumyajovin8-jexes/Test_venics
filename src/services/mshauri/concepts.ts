/**
 * Concept layer.
 *
 * The old QueryParser stemmed every surface word down to ONE bucket, which
 * destroyed meaning before matching could happen — `futa` (delete) collapsed
 * into `ulinzi` (security), so "nifutaje bidhaa?" returned a theft report.
 *
 * Here a word maps to one or MORE weighted concepts and nothing is thrown
 * away. Disambiguation is the matcher's job, not the tokenizer's.
 */

export const C = {
  // ---- Domains -------------------------------------------------------
  SALE: 'SALE',
  CART: 'CART',
  PRODUCT: 'PRODUCT',
  STOCK: 'STOCK',
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER',
  DEBT: 'DEBT',
  EXPENSE: 'EXPENSE',
  PROFIT: 'PROFIT',
  REVENUE: 'REVENUE',
  RECEIPT: 'RECEIPT',
  PRICE: 'PRICE',
  DISCOUNT: 'DISCOUNT',
  PAYMENT: 'PAYMENT',
  MOBILE_MONEY: 'MOBILE_MONEY',
  SECURITY: 'SECURITY',
  PERMISSION: 'PERMISSION',
  SETTINGS: 'SETTINGS',
  PRINTER: 'PRINTER',
  BARCODE: 'BARCODE',
  LICENSE: 'LICENSE',
  BRANCH: 'BRANCH',
  LOGIN: 'LOGIN',
  TAX: 'TAX',
  SYNC: 'SYNC',
  REPORT: 'REPORT',
  EXPORT: 'EXPORT',
  DEAD_STOCK: 'DEAD_STOCK',
  BEST_SELLING: 'BEST_SELLING',
  LOW_STOCK: 'LOW_STOCK',
  EXPIRY: 'EXPIRY',
  BUSINESS: 'BUSINESS',
  CAPITAL: 'CAPITAL',
  APP: 'APP',
  BATCH: 'BATCH',
  TRACKING: 'TRACKING',
  MIN_STOCK: 'MIN_STOCK',
  WHATSAPP: 'WHATSAPP',
  PDF: 'PDF',
  PROFILE: 'PROFILE',
  HOURS_24: 'HOURS_24',
  SUPPORT: 'SUPPORT',
  DASHBOARD: 'DASHBOARD',
  HISTORY: 'HISTORY',
  BACKDATE: 'BACKDATE',
  QUANTITY: 'QUANTITY',
  NET_PROFIT: 'NET_PROFIT',
  OFFLINE: 'OFFLINE',
  SEARCH: 'SEARCH',
  DEFINE: 'DEFINE',

  // ---- Verbs / intents ------------------------------------------------
  CREATE: 'CREATE',
  DELETE: 'DELETE',
  EDIT: 'EDIT',
  VIEW: 'VIEW',
  REFUND: 'REFUND',
  GROW: 'GROW',
  COMPARE: 'COMPARE',
  HELP: 'HELP',
  GREETING: 'GREETING',
  PROBLEM: 'PROBLEM',
  LOCATE: 'LOCATE',

  // ---- Time -----------------------------------------------------------
  TODAY: 'TODAY',
  YESTERDAY: 'YESTERDAY',
  WEEK: 'WEEK',
  MONTH: 'MONTH',
  LAST_MONTH: 'LAST_MONTH',
  SIX_MONTHS: 'SIX_MONTHS',
} as const;

export type Concept = (typeof C)[keyof typeof C];

interface VocabEntry {
  words: string[];
  concepts: Concept[];
  /** Weight of this mapping, default 1. Use <1 for weak/secondary senses. */
  weight?: number;
}

/**
 * Surface forms → concepts. Multi-word entries are matched as bigrams by the
 * normalizer, so "dead stock" and "mobile money" resolve as single units.
 */
export const VOCABULARY: VocabEntry[] = [
  // ---- Sales / revenue ------------------------------------------------
  { words: ['mauzo', 'sales', 'sale', 'kuuza', 'uza', 'uuzaji', 'niuze', 'nauza'], concepts: [C.SALE] },
  { words: ['mapato', 'pato', 'revenue', 'ingizo', 'turnover'], concepts: [C.REVENUE] },
  { words: ['faida', 'profit', 'profits', 'gain', 'gains', 'manufaa'], concepts: [C.PROFIT] },
  { words: ['hasara', 'loss', 'losses', 'kupoteza'], concepts: [C.PROFIT, C.PROBLEM] },
  { words: ['kikapu', 'cart', 'basket'], concepts: [C.CART] },
  { words: ['risiti', 'receipt', 'receipts', 'stakabadhi', 'invoice'], concepts: [C.RECEIPT] },
  { words: ['bei', 'price', 'prices', 'gharama ya bidhaa', 'pricing'], concepts: [C.PRICE] },
  { words: ['punguzo', 'discount', 'discounts', 'punguza bei', 'ofa', 'offer'], concepts: [C.DISCOUNT] },
  { words: ['malipo', 'payment', 'payments', 'lipa', 'kulipa', 'lipia', 'kulipia'], concepts: [C.PAYMENT] },
  { words: ['mpesa', 'm-pesa', 'tigopesa', 'tigo pesa', 'airtel', 'airtel money', 'halopesa', 'mobile money', 'lipa namba'], concepts: [C.MOBILE_MONEY, C.PAYMENT] },
  { words: ['taslimu', 'cash', 'fedha taslimu'], concepts: [C.PAYMENT] },
  { words: ['kodi', 'vat', 'tax', 'tra'], concepts: [C.TAX] },

  // ---- Products / stock ------------------------------------------------
  // NOTE: PRODUCT and STOCK are deliberately distinct concepts. The old
  // stemmer merged them, making "ongeza bidhaa" (add product) and
  // "ongeza stock" (restock) indistinguishable.
  { words: ['bidhaa', 'product', 'products', 'item', 'items', 'kitu', 'vitu'], concepts: [C.PRODUCT] },
  { words: ['stoo', 'stock', 'stoki', 'mzigo', 'mizigo', 'ghala', 'inventory'], concepts: [C.STOCK] },
  { words: ['zinazoisha', 'zimeisha', 'imeisha', 'low stock', 'baki kidogo', 'kuisha', 'pungufu'], concepts: [C.LOW_STOCK, C.STOCK] },
  { words: ['zimedoda', 'dead stock', 'haitembei', 'zisizouza', 'zilizolala', 'lala', 'slow stock'], concepts: [C.DEAD_STOCK, C.STOCK] },
  { words: ['zinauzwa sana', 'zinazouzwa sana', 'inayouzwa sana', 'inauzwa sana', 'zinauza sana', 'best selling', 'bestselling', 'best sellers', 'maarufu', 'mashuhuri', 'trending', 'zinakimbizwa'], concepts: [C.BEST_SELLING] },
  { words: ['barcode', 'skani', 'scanner', 'msimbo', 'kisimbuzi'], concepts: [C.BARCODE] },
  { words: ['expiry', 'expire', 'muda wa matumizi', 'kuisha muda', 'tarehe ya mwisho', 'ekspaya'], concepts: [C.EXPIRY] },
  { words: ['mtaji', 'capital', 'thamani ya mzigo'], concepts: [C.CAPITAL] },

  // ---- People ----------------------------------------------------------
  { words: ['mfanyakazi', 'wafanyakazi', 'mfanyikazi', 'wafanyikazi', 'mhudumu', 'wahudumu', 'mtumishi', 'watumishi', 'msaidizi', 'wasaidizi', 'staff', 'employee', 'employees', 'worker', 'workers', 'cashier', 'cashiers', 'muuzaji'], concepts: [C.STAFF] },
  { words: ['mteja', 'wateja', 'customer', 'customers', 'client', 'clients'], concepts: [C.CUSTOMER] },
  { words: ['deni', 'madeni', 'mkopo', 'mikopo', 'debt', 'debts', 'credit', 'kopa', 'kopesha', 'kukopesha', 'wadaiwa', 'mdaiwa', 'anadaiwa', 'adai'], concepts: [C.DEBT] },

  // ---- Money out --------------------------------------------------------
  { words: ['matumizi', 'expense', 'expenses', 'gharama', 'cost', 'costs', 'expenditure', 'matumise'], concepts: [C.EXPENSE] },

  // ---- Security ---------------------------------------------------------
  // `futa` is NOT here — deleting is a normal action, not a security event.
  { words: ['ulinzi', 'usalama', 'salama', 'wizi', 'upotevu', 'mianya', 'audit', 'anomaly', 'anomalies', 'udanganyifu', 'mabadiliko ya bidhaa', 'audit logs'], concepts: [C.SECURITY] },
  { words: ['ruhusa', 'ruksa', 'permission', 'permissions', 'vipengele', 'features', 'feature', 'rights', 'privileges', 'mamlaka', 'toggles'], concepts: [C.PERMISSION] },

  // ---- System -----------------------------------------------------------
  { words: ['sync', 'usawazishaji', 'kusawazisha', 'isink', 'sink', 'haisync', 'haisawazishi'], concepts: [C.SYNC] },
  { words: ['printa', 'printer', 'chapa', 'kuchapa', 'print', 'kuchapisha'], concepts: [C.PRINTER] },
  { words: ['mipangilio', 'settings', 'setting', 'usanidi', 'sanidi'], concepts: [C.SETTINGS] },
  { words: ['leseni', 'license', 'subscription', 'bando', 'malipo ya mfumo', 'kifurushi'], concepts: [C.LICENSE] },
  { words: ['tawi', 'matawi', 'branch', 'branches', 'duka lingine'], concepts: [C.BRANCH] },
  { words: ['login', 'kuingia', 'nywila', 'password', 'akaunti', 'account', 'sign in'], concepts: [C.LOGIN] },
  { words: ['app', 'mfumo', 'programu', 'system', 'venics'], concepts: [C.APP] },
  { words: ['duka', 'biashara', 'business', 'shop', 'store', 'mwenendo'], concepts: [C.BUSINESS] },
  { words: ['ripoti', 'ripote', 'lipoti', 'report', 'reports', 'muhtasari', 'mchanganuo', 'summary', 'takwimu'], concepts: [C.REPORT] },
  { words: ['pakua', 'export', 'excel', 'pdf', 'download', 'shusha'], concepts: [C.EXPORT] },

  // ---- Verbs ------------------------------------------------------------
  { words: ['ongeza', 'kuongeza', 'ongeze', 'sajili', 'kusajili', 'alika', 'kualika', 'mwaliko', 'ingiza', 'kuingiza', 'andika', 'kuandika', 'rekodi', 'kurekodi', 'weka', 'kuweka', 'tengeneza', 'add', 'invite', 'register', 'create', 'new', 'mpya', 'ajiri', 'kuajiri'], concepts: [C.CREATE] },
  { words: ['futa', 'kufuta', 'ondoa', 'kuondoa', 'delete', 'remove', 'diliti', 'ondosha'], concepts: [C.DELETE] },
  { words: ['badilisha', 'kubadilisha', 'badili', 'rekebisha', 'kurekebisha', 'hariri', 'edit', 'change', 'update', 'sasisha'], concepts: [C.EDIT] },
  { words: ['ona', 'kuona', 'angalia', 'kuangalia', 'onyesha', 'nionyeshe', 'kagua', 'tazama', 'view', 'show', 'see', 'check', 'orodha', 'list'], concepts: [C.VIEW] },
  { words: ['refund', 'rejesha', 'kurejesha', 'rudisha', 'kurudisha', 'marejesho', 'cancel'], concepts: [C.REFUND] },
  { words: ['kukuza', 'grow', 'boost', 'mwelekeo', 'utabiri', 'forecast', 'ushauri', 'nishauri', 'nipendekezee', 'mapendekezo', 'strategy', 'mkakati', 'ongeza mauzo', 'kuongeza mauzo', 'kukuza mauzo', 'ongeza faida', 'kuongeza faida', 'kukuza biashara', 'kuongeza wateja',
    // Forward-looking and decision language — these are judgement calls, not
    // lookups, so they must reach the model rather than a canned answer.
    'baadaye', 'ijayo', 'mwezi ujao', 'mwaka ujao', 'wiki ijayo', 'miezi 6 ijayo', 'kesho',
    'nitegemee', 'itakuaje', 'nitawezaje', 'nianze', 'niwekeze', 'nichague', 'nifanyeje',
    'mshindani', 'washindani', 'promosheni', 'wekeza', 'uwekezaji',
    // Planning and budgeting: deciding what to buy, how much to spend and when
    // is judgement, not a lookup. Note these are SUBJUNCTIVE forms ('niagize' =
    // should I order) — the plain imperative 'agiza' stays a how-to.
    'bajeti', 'makadirio', 'kadirio', 'nikadirie', 'kukadiria', 'ununuzi',
    'niagize', 'nitumie', 'nitanunua', 'nihitaji', 'nipange', 'nipangeje',
    'ujao', 'unaofuata', 'inayofuata', 'zijazo', 'lini'], concepts: [C.GROW] },
  // Admitting a mistake is, in practice, a request to undo it.
  { words: ['kosea', 'nimekosea', 'makosa', 'kimakosa', 'nimefanya makosa'], concepts: [C.PROBLEM, C.REFUND], weight: 0.6 },
  { words: ['linganisha', 'tofauti', 'compare', 'versus', 'vs', 'tofautisha', 'ukilinganisha'], concepts: [C.COMPARE] },
  { words: ['msaada', 'help', 'saidia', 'nisaidie', 'unafanya nini', 'unajua nini', 'maswali', 'swali', 'question', 'questions', 'mapungufu'], concepts: [C.HELP] },
  { words: ['habari', 'mambo', 'shikamoo', 'hujambo', 'salama', 'hello', 'hi', 'asubuhi', 'mchana', 'jioni', 'usiku', 'morning', 'evening'], concepts: [C.GREETING], weight: 0.9 },
  { words: ['mbona', 'kwanini', 'kwa nini', 'shida', 'tatizo', 'haifanyi', 'imeshindwa', 'imekwama', 'stuck', 'error', 'hitilafu', 'problem', 'sumbua', 'inasumbua', 'usiyoelewa', 'huelewi', 'hujui', 'sielewi', 'mapungufu', 'umeshindwa',
    'liko sawa', 'iko sawa', 'niko sawa', 'ni sawa', 'kuna shida', 'ina shida'], concepts: [C.PROBLEM] },
  { words: ['wapi', 'iko wapi', 'napata wapi', 'where', 'nipate wapi'], concepts: [C.LOCATE] },

  // ---- Phase 2: features confirmed present in the mobile UI -------------
  { words: ['batch', 'batches', 'mafungu', 'fungu', 'simamia batches'], concepts: [C.BATCH] },
  { words: ['fuatilia', 'ufuatiliaji', 'kufuatilia', 'tracking', 'fuatilia stoki'], concepts: [C.TRACKING] },
  { words: ['kizuizi', 'kiwango cha tahadhari', 'min stock', 'tahadhari ya kuisha', 'siku za tahadhari'], concepts: [C.MIN_STOCK] },
  { words: ['whatsapp', 'ujumbe', 'kikumbusho', 'kukumbusha', 'sms', 'meseji'], concepts: [C.WHATSAPP] },
  { words: ['pdf', 'pakua risiti'], concepts: [C.PDF, C.RECEIPT] },
  { words: ['wasifu', 'profile', 'jina langu', 'hariri wasifu'], concepts: [C.PROFILE] },
  { words: ['saa 24', 'duka la saa 24', '24 hour', 'usiku wa manane'], concepts: [C.HOURS_24] },
  { words: ['huduma kwa wateja', 'customer service', 'wasiliana', 'support', 'msaada wa kiufundi'], concepts: [C.SUPPORT] },
  { words: ['dashibodi', 'dashboard', 'jopo', 'ukurasa wa mwanzo'], concepts: [C.DASHBOARD] },
  { words: ['historia', 'history', 'kumbukumbu', 'miamala ya zamani'], concepts: [C.HISTORY] },
  { words: ['nyuma', 'backdate', 'backdated', 'siku ya zamani', 'tarehe ya nyuma', 'mauzo ya nyuma', 'sahau kuandika'], concepts: [C.BACKDATE] },
  { words: ['idadi', 'kiasi cha bidhaa', 'quantity', 'qty'], concepts: [C.QUANTITY] },
  { words: ['faida halisi', 'net profit', 'faida safi'], concepts: [C.NET_PROFIT, C.PROFIT] },
  { words: ['offline', 'bila mtandao', 'bila internet', 'hakuna mtandao', 'hakuna internet'], concepts: [C.OFFLINE] },
  { words: ['tafuta', 'kutafuta', 'search', 'nitapataje'], concepts: [C.SEARCH] },
  // Definitional cue — separates "faida halisi ni nini?" (explain) from
  // "faida halisi ya leo" (compute).
  { words: ['ni nini', 'maana', 'maana yake', 'inamaanisha', 'nini maana', 'inahesabiwaje', 'inapatikanaje'], concepts: [C.DEFINE] },

  { words: ['sahau', 'nilisahau', 'nimesahau', 'kusahau', 'umesahau'], concepts: [C.BACKDATE] },
  { words: ['kwa hasara', 'inauzwa hasara', 'hasara inayoweza kuepukika', 'uzwa kwa hasara'], concepts: [C.PRICE, C.PROBLEM, C.PROFIT] },
  { words: ['haionekani', 'sioni', 'haipatikani', 'haitokei', 'hazionekani'], concepts: [C.PROBLEM] },
  { words: ['zilizolipwa', 'yaliyolipwa', 'amelipa', 'walipa', 'lipwa'], concepts: [C.PAYMENT, C.HISTORY] },
  { words: ['kundi', 'makundi', 'category', 'categories'], concepts: [C.SETTINGS] },
  { words: ['pokea', 'kupokea', 'nitumiwe', 'pulse', 'kila siku'], concepts: [C.APP] },
  { words: ['zuia', 'kuzuia', 'imezuiwa', 'block', 'funga akaunti'], concepts: [C.EDIT] },
  { words: ['duka jingine', 'duka la pili', 'maduka', 'maduka mengi', 'ongeza duka'], concepts: [C.BRANCH] },
  // "Nani ...?" about a past change is an audit question.
  { words: ['nani'], concepts: [C.SECURITY], weight: 0.5 },

  // ---- Time -------------------------------------------------------------
  { words: ['leo', 'today'], concepts: [C.TODAY] },
  { words: ['jana', 'yesterday'], concepts: [C.YESTERDAY] },
  { words: ['wiki', 'week', 'juma'], concepts: [C.WEEK] },
  { words: ['mwezi', 'month'], concepts: [C.MONTH] },
  { words: ['mwezi uliopita', 'last month'], concepts: [C.LAST_MONTH] },
  { words: ['miezi 6', 'miezi sita', '6 months', 'six months'], concepts: [C.SIX_MONTHS] },
];

/** Fast lookup: surface form → weighted concepts. Built once at module load. */
export const VOCAB_INDEX = new Map<string, { concepts: Concept[]; weight: number }>();
for (const entry of VOCABULARY) {
  for (const word of entry.words) {
    const existing = VOCAB_INDEX.get(word);
    if (existing) {
      // A surface form legitimately carrying two senses keeps both.
      existing.concepts = [...new Set([...existing.concepts, ...entry.concepts])];
    } else {
      VOCAB_INDEX.set(word, { concepts: [...entry.concepts], weight: entry.weight ?? 1 });
    }
  }
}

/** Every multi-word surface form, longest first, for bigram/trigram matching. */
export const MULTIWORD_FORMS = [...VOCAB_INDEX.keys()]
  .filter((k) => k.includes(' '))
  .sort((a, b) => b.split(' ').length - a.split(' ').length);
