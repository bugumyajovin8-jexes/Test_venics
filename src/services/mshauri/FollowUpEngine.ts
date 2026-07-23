import { Intent } from './IntentEngine';

export class FollowUpEngine {
  static getFollowUps(intent: Intent, kbMatchId?: string, isAiMode?: boolean): string[] {
    if (kbMatchId) {
      switch (kbMatchId) {
        case 'sale_add_cart':
          return ["Jinsi ya kutoa punguzo?", "Jinsi ya kugawanya malipo?", "Jinsi ya kulipia kwa M-Pesa?"];
        case 'sale_discount':
          return ["Jinsi ya kufanya mauzo?", "Jinsi ya kugawanya malipo?"];
        case 'sale_split_payment':
          return ["Jinsi ya kufanya mauzo?", "Jinsi ya kulipia kwa M-Pesa?"];
        case 'sale_mobile_money':
          return ["Jinsi ya kuchapa risiti?", "Jinsi ya kufuta mauzo makosa?"];
        case 'sale_receipt':
          return ["Jinsi ya kufuta mauzo makosa?", "Mbona printa haichapi?"];
        case 'sale_refund_cancel':
          return ["Ripoti ya mabadiliko duka", "Mauzo ya leo yapoje?"];
        case 'sale_tax_vat':
          return ["Jinsi ya kutoa punguzo?"];
        case 'product_add':
          return ["Jinsi ya kuongeza stoo mpya?", "Jinsi ya kubadili bei?"];
        case 'product_edit_price':
          return ["Jinsi ya kutoa punguzo?"];
        case 'product_update_stock':
          return ["Bidhaa gani zinazoisha?", "Jinsi ya kufanya stock take?"];
        case 'product_delete':
          return ["Kuongeza bidhaa mpya"];
        case 'product_low_stock':
          return ["Bidhaa gani zimedoda?", "Ripoti ya mzigo wote"];
        case 'product_stock_take':
          return ["Bidhaa gani zimekaa sana?"];
        case 'product_barcode':
          return ["Jinsi ya kufanya mauzo?"];
        case 'customer_add_debt':
          return ["Jinsi ya kupokea malipo ya deni?", "Nani anadaiwa hela nyingi?"];
        case 'customer_pay_debt':
          return ["Nani anadaiwa hela nyingi?"];
        case 'report_daily_sales':
          return ["Vipi kuhusu faida?", "Matumizi ya leo", "Bidhaa gani zinauzwa sana?"];
        case 'report_bestselling':
          return ["Bidhaa gani zimedoda?", "Mauzo ya leo", "Bidhaa zinazoisha stoo"];
        case 'report_export':
          return ["Mauzo ya leo yapoje?"];
        case 'staff_add_permission':
          return ["Ripoti ya mabadiliko duka", "Ripoti ya mauzo ya mfanyakazi"];
        case 'expense_add':
          return ["Matumizi ya leo", "Faida ya leo"];
        case 'error_sync':
          return ["Mbona mtandao unasumbua?"];
        case 'error_printer':
          return ["Jinsi ya kuchapa risiti?"];
        case 'error_login':
          return ["Jinsi ya kuongeza mfanyakazi?"];
        case 'shop_settings':
          return ["Malipo ya mfumo"];
        case 'multi_branch':
          return ["Malipo ya mfumo"];
        case 'biz_logic_profit_net':
          return ["Matumizi ya leo", "Mauzo ya leo"];
        case 'subscription':
          return ["Jinsi ya kulipa app?"];
        case 'general_contact':
          return ["Malipo ya mfumo"];
        default:
          break;
      }
    }

    switch (intent) {
      case 'REPORT_SALES':
        return ["Faida ya leo kiasi gani?", "Bidhaa gani zinauzwa sana?", "Vipi kuhusu matumizi?"];
      case 'REPORT_EXPENSES':
        return ["Nipe mauzo ya leo", "Nani anadaiwa duka?", "Faida ya leo kiasi gani?"];
      case 'REPORT_STOCK':
        return ["Bidhaa gani zinazoisha?", "Bidhaa gani zimedoda stoo?", "Onesha thamani ya mtaji"];
      case 'REPORT_DEBTS':
        return ["Jinsi ya kurekodi malipo ya deni?", "Nani anadaiwa hela nyingi?"];
      case 'REPORT_BEST_SELLING':
        return ["Bidhaa gani zimedoda stoo?", "Nipe faida ya leo", "Bidhaa zinazoisha stoo"];
      case 'REPORT_DEAD_STOCK':
        return ["Bidhaa gani zinauzwa sana?", "Onesha thamani ya mtaji", "Bidhaa zinazoisha"];
      case 'ACTION_ADD_STAFF':
        return ["Jinsi ya kuangalia ripoti za wafanyakazi?", "Jinsi ya kuweka ulinzi?"];
      case 'REPORT_EMPLOYEE':
        return ["Jinsi ya kuongeza mfanyakazi?", "Ripoti ya mabadiliko duka"];
      case 'REPORT_SECURITY':
        return ["Jinsi ya kufuta mauzo makosa?", "Jinsi ya kurekebisha hesabu za stock?"];
      default:
        return ["Nipe mauzo ya leo", "Bidhaa zinazoisha", "Bidhaa zinazouzwa sana"];
    }
  }
}
