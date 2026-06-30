import { QueryParser } from './QueryParser';

export type Intent = 
  | 'REPORT_SALES'
  | 'REPORT_EXPENSES'
  | 'REPORT_STOCK'
  | 'REPORT_DEBTS'
  | 'REPORT_SECURITY'
  | 'REPORT_EMPLOYEE'
  | 'REPORT_DEAD_STOCK'
  | 'REPORT_BEST_SELLING'
  | 'REPORT_COMPARISON'
  | 'REPORT_FORECAST'
  | 'REPORT_BUSINESS'
  | 'ACTION_SYNC'
  | 'ACTION_ADD_STAFF'
  | 'ACTION_TOGGLE_FEATURES'
  | 'GENERAL_HELP'
  | 'UNKNOWN';

export interface IntentResult {
  intent: Intent;
  params: Record<string, any>;
}

export class IntentEngine {
  static classify(text: string, previousIntent?: Intent): IntentResult {
    const cleanText = text.toLowerCase().trim();
    const parsed = QueryParser.parse(cleanText);

    // Contextual Continuation Detection (Stateful Context Tracking)
    if (previousIntent && previousIntent !== 'UNKNOWN') {
      const getCategory = (it: Intent): string => {
        if (['REPORT_EMPLOYEE', 'ACTION_ADD_STAFF', 'ACTION_TOGGLE_FEATURES'].includes(it)) return 'staff';
        if (['REPORT_SALES', 'REPORT_BEST_SELLING', 'REPORT_COMPARISON', 'REPORT_FORECAST', 'REPORT_BUSINESS'].includes(it)) return 'sales';
        if (['REPORT_STOCK', 'REPORT_DEAD_STOCK'].includes(it)) return 'stock';
        if (['REPORT_EXPENSES'].includes(it)) return 'expenses';
        if (['REPORT_DEBTS'].includes(it)) return 'debts';
        if (['REPORT_SECURITY'].includes(it)) return 'security';
        return 'general';
      };

      const prevCat = getCategory(previousIntent);

      // Check if this query is a connective follow-up
      const isConnective = 
        cleanText.startsWith('na ') ||
        cleanText.startsWith('then ') ||
        cleanText.startsWith('kisha ') ||
        cleanText.startsWith('tena ') ||
        cleanText.startsWith('vipi ') ||
        cleanText.startsWith('je ') ||
        cleanText.startsWith('how about ') ||
        cleanText.startsWith('what about ') ||
        cleanText.startsWith('kuhusu ') ||
        cleanText.startsWith('kwa ') ||
        cleanText.startsWith('ya ') ||
        cleanText.startsWith('za ') ||
        parsed.tokens.length <= 3; // short follow ups like "mwezi huu?", "leo?", "kumuongeza?", "mzunguko wao?"

      // Check if there are other explicit category nouns that would override context.
      // E.g., if previous was 'staff', but they say 'nionyeshe mauzo', we don't treat it as staff context!
      const hasOtherCategoryKeywords = 
        (prevCat !== 'staff' && (parsed.hasToken(['fanyakazi']) || cleanText.includes('mhudumu') || cleanText.includes('msaidizi') || cleanText.includes('staff'))) ||
        (prevCat !== 'stock' && (parsed.hasToken(['stoo']) || cleanText.includes('stock') || cleanText.includes('lala') || cleanText.includes('dead stock') || cleanText.includes('product') || cleanText.includes('mzigo'))) ||
        (prevCat !== 'sales' && (parsed.hasToken(['mauzo', 'faida']) || cleanText.includes('sales') || cleanText.includes('profit') || cleanText.includes('mapato') || cleanText.includes('selling'))) ||
        (prevCat !== 'expenses' && (parsed.hasToken(['matumizi']) || cleanText.includes('expense') || cleanText.includes('gharama'))) ||
        (prevCat !== 'debts' && (parsed.hasToken(['deni']) || cleanText.includes('madeni') || cleanText.includes('mikopo') || cleanText.includes('debt'))) ||
        (prevCat !== 'security' && (parsed.hasToken(['ulinzi']) || cleanText.includes('salama') || cleanText.includes('wizi') || cleanText.includes('anomaly') || cleanText.includes('logs')));

      if (isConnective && !hasOtherCategoryKeywords) {
        if (prevCat === 'staff') {
          // Rule 1: Adding/inviting staff
          if (parsed.hasToken(['ongeza']) || cleanText.match(/ongeza|kuongeza|sajili|kunsajili|kumsajili|alika|mwaliko|invite|register|add/i)) {
            return { intent: 'ACTION_ADD_STAFF', params: {} };
          }
          // Rule 2: Permissions / Toggles / Features
          if (parsed.hasToken(['ruhusa']) || cleanText.match(/ruhusa|ruksa|vipengele|rights|permissions|mamlaka|toggles|feature|flags/i)) {
            return { intent: 'ACTION_TOGGLE_FEATURES', params: {} };
          }
          // Rule 3: View / List of employees
          if (cleanText.match(/ripoti|orodha|list|wote|yake|wao|huduma|ona/i)) {
            return { intent: 'REPORT_EMPLOYEE', params: { query: cleanText } };
          }
        } else if (prevCat === 'sales') {
          // Rule 1: Period updates
          if (cleanText.match(/leo|today|jana|yesterday|wiki|week|mwezi|month|mwaka|year/i)) {
            return { intent: 'REPORT_SALES', params: this.extractPeriod(cleanText) };
          }
          // Rule 2: Growth / forecast
          if (parsed.hasToken(['kukuza']) || cleanText.match(/mwelekeo|forecast|projection|strategy|kesho|tomorrow|grow|kuongeza|boost|ushauri|nipendekezee/i)) {
            return { intent: 'REPORT_FORECAST', params: {} };
          }
          // Rule 3: Best selling
          if (cleanText.match(/bestsell|best sell|inayouzwa sana|zinazouza sana|maarufu/i)) {
            return { intent: 'REPORT_BEST_SELLING', params: {} };
          }
        } else if (prevCat === 'expenses') {
          if (cleanText.match(/leo|today|jana|yesterday|wiki|week|mwezi|month|mwaka|year/i)) {
            return { intent: 'REPORT_EXPENSES', params: this.extractPeriod(cleanText) };
          }
        } else if (prevCat === 'debts') {
          if (cleanText.match(/leo|today|jana|yesterday|wiki|week|mwezi|month|mwaka|year/i)) {
            return { intent: 'REPORT_DEBTS', params: this.extractPeriod(cleanText) };
          }
        } else if (prevCat === 'stock') {
          if (cleanText.match(/lala|haitembei|zisizouza|dead\s*stock|slow\s*stock/i)) {
            return { intent: 'REPORT_DEAD_STOCK', params: {} };
          }
          if (cleanText.match(/bestsell|best sell|inayouzwa sana|zinazouza sana/i)) {
            return { intent: 'REPORT_BEST_SELLING', params: {} };
          }
          if (cleanText.match(/ripoti|orodha|list|baki|shika|zilizopo|stock|mzigo/i)) {
            return { intent: 'REPORT_STOCK', params: {} };
          }
        }
      }
    }

    // Standard Classification Rules
    // 1. Sync Actions (Most Specific)
    if (parsed.hasToken(['sync']) || cleanText.match(/sync|isink|sink|stuck|feli|haionekani|hazifiki|sizioni/i)) {
      return { intent: 'ACTION_SYNC', params: {} };
    }

    // 1b. Actions: Add Staff / Invitation (Highly Specific)
    if (parsed.hasToken(['ongeza']) && parsed.hasToken(['fanyakazi'])) {
      return { intent: 'ACTION_ADD_STAFF', params: {} };
    }
    if (cleanText.match(/ongeza\s+(mfanyakazi|wafanyakazi|mhudumu|wahudumu|staff|employee|employees|msaidizi|wasaidizi)/i) ||
        cleanText.match(/kuongeza\s+(mfanyakazi|wafanyakazi|mhudumu|wahudumu|staff|employee|employees|msaidizi|wasaidizi)/i) ||
        cleanText.includes('mwaliko wa') ||
        cleanText.includes('invite staff') ||
        cleanText.includes('invite employee')
    ) {
      return { intent: 'ACTION_ADD_STAFF', params: {} };
    }

    // 1c. Actions: Toggle Features / Permissions (Highly Specific)
    if (parsed.hasToken(['ruhusa']) && parsed.hasToken(['fanyakazi'])) {
      return { intent: 'ACTION_TOGGLE_FEATURES', params: {} };
    }
    if (cleanText.match(/wezesha\s+feature|zima\s+feature|wezesha\s+ruhusa|zima\s+ruhusa|wezesha\s+ruksa|zima\s+ruksa|badili\s+ruhusa|badili\s+ruksa|rights|permissions|toggles|feature\s+flags|toggle\s+feature/i) || 
        cleanText.match(/ruksa.*(wafanyakazi|wahudumu|mfanyakazi|mhudumu)/i) || 
        cleanText.match(/ruhusa.*(wafanyakazi|wahudumu|mfanyakazi|mhudumu)/i) || 
        cleanText.includes('kusanidi ruhusa') || 
        cleanText.includes('ruhusa zake')
    ) {
      return { intent: 'ACTION_TOGGLE_FEATURES', params: {} };
    }

    // 2. Dead Stock (Highly Specific)
    if (parsed.hasToken(['lala']) || cleanText.match(/lala|haitembei|zisizouza|dead\s*stock|slow\s*stock/i)) {
      return { intent: 'REPORT_DEAD_STOCK', params: {} };
    }

    // 3. Security / Audit
    if (parsed.hasToken(['ulinzi']) || cleanText.match(/ulinzi|salama|wizi|anomal|upotevu|mianya|kufuta|void/i)) {
      return { intent: 'REPORT_SECURITY', params: {} };
    }

    // 4. Employee Reports
    if (parsed.hasToken(['fanyakazi'])) {
      if (!parsed.hasToken(['ongeza', 'ruhusa'])) {
        return { intent: 'REPORT_EMPLOYEE', params: { query: cleanText } };
      }
    }

    // 5. Debts
    if (parsed.hasToken(['deni']) || cleanText.match(/deni|madeni|mikopo|debt|credit|adai|kopa/i)) {
      return { intent: 'REPORT_DEBTS', params: this.extractPeriod(cleanText) };
    }

    // 6. Expenses
    if (parsed.hasToken(['matumizi']) || cleanText.match(/matumizi|expense|gharama|cost|pesa imetoka/i)) {
      if (!parsed.hasToken(['linganisha']) && !cleanText.match(/linganisha|tofauti|mabadiliko|compare|vs|versus/i)) {
        return { intent: 'REPORT_EXPENSES', params: this.extractPeriod(cleanText) };
      }
    }

    // 7. Best Selling
    if (cleanText.match(/bestsell|best sell|inayouzwa sana|zinazouza sana|maarufu/i) || 
        cleanText.match(/bidhaa.*sana/i) || 
        cleanText.match(/popular/i) || 
        cleanText.match(/top/i)
    ) {
      return { intent: 'REPORT_BEST_SELLING', params: {} };
    }

    // 8. Stock
    if (parsed.hasToken(['stoo']) || cleanText.match(/stock|product|mzigo|zimeisha/i)) {
      if (!parsed.hasToken(['fanyakazi', 'deni', 'matumizi'])) {
        return { intent: 'REPORT_STOCK', params: {} };
      }
    }

    // 9. Comparison Reports
    if (parsed.hasToken(['linganisha']) || cleanText.match(/linganisha|tofauti|mabadiliko|maendeleo|tofautisha|compare|versus|vs/i)) {
      let compPeriod = 'week';
      if (cleanText.match(/mwezi|month/i)) compPeriod = 'month';
      else if (cleanText.match(/siku|day|jana|leo|yesterday|today/i)) compPeriod = 'day';
      return { intent: 'REPORT_COMPARISON', params: { comparePeriod: compPeriod } };
    }

    // 10. Forecast / Strategy
    if (parsed.hasToken(['kukuza']) || cleanText.match(/mwelekeo|forecast|projection|kesho|tomorrow|ijayo|nifanye nini|kukuza|grow|kuongeza|boost|ushauri|nipendekezee/i)) {
      if (!parsed.hasToken(['fanyakazi', 'stoo'])) {
        return { intent: 'REPORT_FORECAST', params: {} };
      }
    }

    // 10b. Business Report (General Business summary / metrics breakdown)
    if (parsed.hasToken(['biashara']) || cleanText.includes('biashara') || cleanText.match(/mchanganuo\s+(wa\s+)?duka|ripoti\s+ya\s+duka|hali\s+ya\s+duka|ripoti\s+ya\s+biashara/i)) {
      return { intent: 'REPORT_BUSINESS', params: this.extractPeriod(cleanText) };
    }

    // 11. Sales & Revenue
    if (parsed.hasToken(['mauzo', 'faida']) || cleanText.match(/mauzo|sales|revenue|faida|profit|mapato/i)) {
      if (!parsed.hasToken(['matumizi'])) {
        return { intent: 'REPORT_SALES', params: this.extractPeriod(cleanText) };
      }
    }

    // 12. Help
    if (parsed.hasToken(['msaada']) || cleanText.match(/msaada|help|unajua kufanya nini|karibu/i)) {
      return { intent: 'GENERAL_HELP', params: {} };
    }

    return { intent: 'UNKNOWN', params: {} };
  }

  private static extractPeriod(text: string) {
    if (text.match(/leo|today/i)) return { period: 'today' };
    if (text.match(/jana|yesterday/i)) return { period: 'yesterday' };
    if (text.match(/wiki|week/i)) return { period: 'week' };
    if (text.match(/mwezi uliopita|last month/i)) return { period: 'lastMonth' };
    if (text.match(/mwezi|month/i)) return { period: 'month' };
    if (text.match(/miezi 6|6 months/i)) return { period: '6months' };
    return { period: 'today' };
  }
}
