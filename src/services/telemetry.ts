import { db } from '../db';

export interface TelemetryEvent {
  feature_key: string;
  interaction_type?: string;
  metadata?: Record<string, any>;
}

export class TelemetryService {
  /**
   * Tracks a SaaS feature interaction and logs it into standard, synced audit logs.
   * @param featureKey The unique identifier of the SaaS feature.
   * @param details Additional metadata about how the feature was used.
   */
  static async track(_featureKey: string, _details: Record<string, any> = {}) {
    // Telemetry to the Supabase `saas_telemetry` table is disabled — it consumed database storage
    // for little value. Every trackXxx() helper funnels through here, so this single no-op turns the
    // whole feature off; the (now inert) call sites are left in place so nothing else needs changing.
    return;
  }

  /**
   * Tracks recording a new Sale (POS Transactions).
   */
  static trackSale(paymentMethod: string, amount: number, itemCount: number) {
    this.track('pos_checkout', {
      payment_method: paymentMethod,
      is_credit: paymentMethod === 'credit',
      amount_total: amount,
      items_sold_count: itemCount,
    });
  }

  /**
   * Tracks querying the Business Advisor (Venics Assistant / Mshauri AI)
   */
  static trackAssistantQuery(queryType: 'custom_ai' | 'pre_calculated_intent', intent?: string) {
    this.track('mshauri_ai_advisor', {
      query_type: queryType,
      intent_captured: intent || 'general',
      is_gen_ai: queryType === 'custom_ai',
    });
  }

  /**
   * Tracks debt payments (Dawa ya Madeni / Credit clearance).
   */
  static trackDebtRepayment(amountCleared: number) {
    this.track('debt_payments_clearance', {
      amount_paid: amountCleared,
    });
  }

  /**
   * Tracks adding/editing expenses.
   */
  static trackExpense(category: string, amount: number) {
    this.track('expenses_tracker', {
      expense_category: category,
      amount: amount,
    });
  }

  /**
   * Tracks importing products in bulk via excel/csv templates or bar scanner.
   */
  static trackBulkImport(productCount: number) {
    this.track('bulk_product_import', {
      items_imported_count: productCount,
    });
  }

  /**
   * Tracks toggling a SaaS feature flag settings (e.g. enabling staff product edit).
   */
  static trackFeatureFlagToggle(flagKey: string, isNowEnabled: boolean) {
    this.track('saas_feature_flag_toggle', {
      flag_key: flagKey,
      is_enabled: isNowEnabled,
    });
  }

  /**
   * Tracks checking product expirations and batch schedules.
   */
  static trackExpiryChecked() {
    this.track('product_expiry_tracker', {
      view_mode: 'modal_alert_or_reports',
    });
  }

  /**
   * Tracks the use of camera or image input to scan product listings.
   */
  static trackCameraProductScan(source: 'camera' | 'upload', successCount: number) {
    this.track('camera_product_scan', {
      input_source: source,
      products_recognized_count: successCount,
    });
  }

  /**
   * Tracks copying or sharing product information as an instant message/context.
   */
  static trackInstantProductMessageShare() {
    this.track('instant_product_message_share', {
      action: 'copy_or_share_products',
    });
  }

  /**
   * Tracks registering backdated sales.
   */
  static trackBackdatedSale(amount: number, itemCount: number) {
    this.track('backdated_sale', {
      amount_total: amount,
      item_count: itemCount,
    });
  }

  /**
   * Tracks registering backdated expenses.
   */
  static trackBackdatedExpense(amount: number, category: string) {
    this.track('backdated_expense', {
      expense_amount: amount,
      expense_category: category,
    });
  }

  /**
   * Tracks viewing product changes/audit logs page ("Mabadiliko ya Bidhaa").
   */
  static trackMabadilikoYaBidhaaView() {
    this.track('mabadiliko_ya_bidhaa', {
      view_event: 'audit_logs_opened',
    });
  }

  /**
   * Tracks viewing employee performance and behavior reports.
   */
  static trackEmployeeReportsView() {
    this.track('employee_reports_view', {
      view_event: 'performance_reports_opened',
    });
  }

  /**
   * Tracks adding/inviting new staff members or employees.
   */
  static trackAddStaff(email: string, role: string) {
    this.track('add_staff', {
      invited_role: role,
      mask_email: email.substring(0, 3) + '***@' + email.split('@')[1],
    });
  }

  /**
   * Tracks checking stock valuation details ("Thamani ya Stock").
   */
  static trackStockValuationChecked() {
    this.track('stock_valuation_checked', {
      action: 'view_invested_capital_metrics',
    });
  }

  /**
   * Tracks executing product refund transactions.
   */
  static trackRefundSale(saleId: string, amount: number) {
    this.track('refund_sale', {
      refunded_sale_id: saleId,
      refunded_amount: amount,
    });
  }

  /**
   * Tracks sending a debt reminder or billing via WhatsApp.
   */
  static trackWhatsAppDebtReminder(phone: string, amount: number) {
    this.track('whatsapp_debt_reminder', {
      reminded_debt_amount: amount,
      mask_phone: phone.substring(0, 4) + '****' + phone.substring(phone.length - 2),
    });
  }

  /**
   * Tracks network egress/ingress data usage per table as requested by the SaaS owner.
   * Disabled to minimize Supabase Disk IO, CPU utilization, and network traffic overhead.
   */
  static async trackNetworkUsage(direction: 'push' | 'pull', tableName: string, payload: any, rowsCount: number) {
    // Network logging is disabled to improve local storage and DB write performance.
    return;
  }
}

// Telemetry is disabled: clear any local telemetry rows left over from older versions so they
// reclaim device storage and can never be pushed to Supabase.
setTimeout(async () => {
  try {
    await db.saasTelemetry.clear();
  } catch (err) {
    console.error('[Telemetry Cleanup] Failed to clear local telemetry records:', err);
  }
}, 3000);

