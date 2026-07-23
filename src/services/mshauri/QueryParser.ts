export interface ParsedQuery {
  raw: string;
  tokens: string[];
  tokenSet: Set<string>;
  hasToken: (stems: string[]) => boolean;
  hasAllTokens: (stems: string[]) => boolean;
}

const SWAHILI_STEMS: Record<string, string> = {
  // Wafanyakazi / Staff / Employees
  'mfanyakazi': 'fanyakazi',
  'wafanyakazi': 'fanyakazi',
  'mfanyikazi': 'fanyakazi',
  'wafanyikazi': 'fanyakazi',
  'mhudumu': 'fanyakazi',
  'wahudumu': 'fanyakazi',
  'mtumishi': 'fanyakazi',
  'watumishi': 'fanyakazi',
  'msaidizi': 'fanyakazi',
  'wasaidizi': 'fanyakazi',
  'staff': 'fanyakazi',
  'employee': 'fanyakazi',
  'employees': 'fanyakazi',
  'worker': 'fanyakazi',
  'workers': 'fanyakazi',
  'cashier': 'fanyakazi',
  'cashiers': 'fanyakazi',
  'wahazini': 'fanyakazi',
  'mhazini': 'fanyakazi',
  'wahasibu': 'fanyakazi',
  'mhasibu': 'fanyakazi',

  // Bidhaa / Products / Stock
  'bidhaa': 'stoo',
  'mzigo': 'stoo',
  'mizigo': 'stoo',
  'stock': 'stoo',
  'stoo': 'stoo',
  'stoki': 'stoo',
  'product': 'stoo',
  'products': 'stoo',
  'item': 'stoo',
  'items': 'stoo',

  // Ripoti / Reports
  'ripoti': 'ripoti',
  'ripote': 'ripoti',
  'lipoti': 'ripoti',
  'maripoti': 'ripoti',
  'report': 'ripoti',
  'reports': 'ripoti',
  'summary': 'ripoti',
  'muhtasari': 'ripoti',
  'mchanganuo': 'ripoti',

  // Mauzo / Sales / Receipts
  'mauzo': 'mauzo',
  'sales': 'mauzo',
  'sale': 'mauzo',
  'kuuza': 'mauzo',
  'uza': 'mauzo',
  'mapato': 'mauzo',
  'pato': 'mauzo',
  'risiti': 'mauzo',
  'receipt': 'mauzo',
  'receipts': 'mauzo',

  // Faida / Gain
  'faida': 'faida',
  'profit': 'faida',
  'profits': 'faida',
  'gain': 'faida',
  'gains': 'faida',

  // Matumizi / Expenses
  'matumizi': 'matumizi',
  'expense': 'matumizi',
  'expenses': 'matumizi',
  'gharama': 'matumizi',
  'cost': 'matumizi',
  'costs': 'matumizi',
  'matumise': 'matumizi',
  'expenditures': 'matumizi',

  // Deni / Debts
  'deni': 'deni',
  'madeni': 'deni',
  'mikopo': 'deni',
  'mkopo': 'deni',
  'debt': 'deni',
  'debts': 'deni',
  'dai': 'deni',
  'wadaiwa': 'deni',
  'kopa': 'deni',
  'kopesha': 'deni',
  'kukopesha': 'deni',

  // Wateja / Customers
  'mteja': 'teja',
  'wateja': 'teja',
  'customer': 'teja',
  'customers': 'teja',
  'client': 'teja',
  'clients': 'teja',

  // Ongeza / Invite / Register / Create
  'ongeza': 'ongeza',
  'kuongeza': 'ongeza',
  'ongeze': 'ongeza',
  'sajili': 'ongeza',
  'kusajili': 'ongeza',
  'alika': 'ongeza',
  'kualika': 'ongeza',
  'mwaliko': 'ongeza',
  'ingiza': 'ongeza',
  'kuingiza': 'ongeza',
  'andika': 'ongeza',
  'kuandika': 'ongeza',
  'rekodi': 'ongeza',
  'kurekodi': 'ongeza',
  'tengeneza': 'ongeza',
  'kutengeneza': 'ongeza',
  'add': 'ongeza',
  'invite': 'ongeza',
  'register': 'ongeza',
  'new': 'ongeza',
  'mpya': 'ongeza',

  // Ruhusa / Permissions / Control / Feature Flags
  'ruhusa': 'ruhusa',
  'ruksa': 'ruhusa',
  'ruusa': 'ruhusa',
  'permission': 'ruhusa',
  'permissions': 'ruhusa',
  'vigezo': 'ruhusa',
  'vipengele': 'ruhusa',
  'toggles': 'ruhusa',
  'features': 'ruhusa',
  'feature': 'ruhusa',
  'rights': 'ruhusa',
  'privilege': 'ruhusa',
  'privileges': 'ruhusa',
  'control': 'ruhusa',
  'controls': 'ruhusa',

  // Ulinzi / Security / Audit
  'ulinzi': 'ulinzi',
  'usalama': 'ulinzi',
  'salama': 'ulinzi',
  'wizi': 'ulinzi',
  'upotevu': 'ulinzi',
  'mianya': 'ulinzi',
  'audit': 'ulinzi',
  'logs': 'ulinzi',
  'void': 'ulinzi',
  'futa': 'ulinzi',
  'kufuta': 'ulinzi',

  // Sync
  'sync': 'sync',
  'usawazishaji': 'sync',
  'isink': 'sync',
  'sink': 'sync',
  'usawazisha': 'sync',
  'stuck': 'sync',

  // Jinsi / How-to / Methods / Guidance
  'jinsi': 'jinsi',
  'namna': 'jinsi',
  'mbinu': 'jinsi',
  'njia': 'jinsi',
  'nawezaje': 'jinsi',
  'how': 'jinsi',
  'guide': 'jinsi',

  // Kukuza / Grow / Forecast / Strategy
  'kukuza': 'kukuza',
  'grow': 'kukuza',
  'boost': 'kukuza',
  'mwelekeo': 'kukuza',
  'utabiri': 'kukuza',
  'forecast': 'kukuza',
  'projection': 'kukuza',
  'ushauri': 'kukuza',
  'nipendekezee': 'kukuza',
  'mapendekezo': 'kukuza',
  'mbinu za kukuza': 'kukuza',

  // Period / Time
  'leo': 'leo',
  'today': 'leo',
  'jana': 'jana',
  'yesterday': 'jana',
  'wiki': 'wiki',
  'week': 'wiki',
  'mwezi': 'mwezi',
  'month': 'mwezi',
  'mwaka': 'mwaka',
  'year': 'mwaka',

  // Comparison
  'linganisha': 'linganisha',
  'tofauti': 'linganisha',
  'mabadiliko': 'linganisha',
  'compare': 'linganisha',
  'versus': 'linganisha',
  'vs': 'linganisha',

  // Dead stock
  'lala': 'lala',
  'haitembei': 'lala',
  'zisizouza': 'lala',
  'dead': 'lala',
  'slow': 'lala',

  // Business
  'biashara': 'biashara',
  'business': 'biashara',
  'mwenendo': 'biashara',

  // Help
  'msaada': 'msaada',
  'help': 'msaada',
  'karibu': 'msaada'
};

const STOP_WORDS = new Set([
  'ya', 'za', 'la', 'wa', 'kwa', 'na', 'ni', 'ili', 'hili', 'hadi', 'hivi', 'huu',
  'cha', 'vya', 'pa', 'mwenye', 'wenye', 'yake', 'zake', 'lake', 'wake', 'yao', 'wao',
  'vyake', 'chake', 'gani', 'yote', 'zote', 'lote', 'wote', 'hapa', 'juu', 'chini',
  'kila', 'kama', 'kutoka', 'kwenda', 'ambao', 'ambayo', 'ambazo', 'the', 'a', 'an', 'to',
  'of', 'for', 'in', 'on', 'with', 'by', 'at', 'about'
]);

export class QueryParser {
  private static getLevenshteinDistance(a: string, b: string): number {
    const tmp: number[][] = [];
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    for (let i = 0; i <= a.length; i++) {
      tmp[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      tmp[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        tmp[i][j] = Math.min(
          tmp[i - 1][j] + 1, // deletion
          tmp[i][j - 1] + 1, // insertion
          tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
        );
      }
    }
    return tmp[a.length][b.length];
  }

  private static findFuzzyMatch(word: string): string | null {
    if (word.length < 3) return null;

    let bestMatchKey: string | null = null;
    let maxSimilarity = 0;

    const stemKeys = Object.keys(SWAHILI_STEMS);

    for (const candidate of stemKeys) {
      if (Math.abs(word.length - candidate.length) > 2) continue;

      const len = Math.max(word.length, candidate.length);
      const distance = this.getLevenshteinDistance(word, candidate);
      const similarity = 1 - distance / len;

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        bestMatchKey = candidate;
      }
    }

    const threshold = word.length >= 5 ? 0.8 : 0.75;
    if (maxSimilarity >= threshold && bestMatchKey) {
      return SWAHILI_STEMS[bestMatchKey];
    }

    return null;
  }

  static parse(text: string): ParsedQuery {
    const raw = text.toLowerCase().trim();
    
    // Clean specialized characters and punctuation
    const cleaned = raw.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, ' ');
    const rawTokens = cleaned.split(/\s+/).filter(t => t.length > 0);
    
    const tokens: string[] = [];
    for (const t of rawTokens) {
      if (STOP_WORDS.has(t) || t.length <= 1) continue;
      
      let stemmed = t;
      if (SWAHILI_STEMS[t]) {
        stemmed = SWAHILI_STEMS[t];
      } else {
        // Try fuzzy matching first
        const fuzzy = this.findFuzzyMatch(t);
        if (fuzzy) {
          stemmed = fuzzy;
        } else {
          // Human plural/singular standard prefix light stemming
          if (t.startsWith('wa') && t.length > 4) {
            const possibleStem = t.substring(2);
            if (SWAHILI_STEMS[possibleStem]) {
              stemmed = SWAHILI_STEMS[possibleStem];
            } else {
              const possibleFuzzy = this.findFuzzyMatch(possibleStem);
              stemmed = possibleFuzzy || possibleStem;
            }
          } else if (t.startsWith('m') && t.length > 3 && !t.startsWith('ma') && !t.startsWith('mb')) {
            const possibleStem = t.substring(1);
            if (SWAHILI_STEMS[possibleStem]) {
              stemmed = SWAHILI_STEMS[possibleStem];
            } else {
              const possibleFuzzy = this.findFuzzyMatch(possibleStem);
              stemmed = possibleFuzzy || possibleStem;
            }
          }
        }
      }
      tokens.push(stemmed);
    }

    const tokenSet = new Set(tokens);

    return {
      raw,
      tokens,
      tokenSet,
      hasToken: (stems: string[]) => stems.some(s => tokenSet.has(s)),
      hasAllTokens: (stems: string[]) => stems.every(s => tokenSet.has(s))
    };
  }
}
