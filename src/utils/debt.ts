/**
 * One definition of an open debt.
 *
 * Dashibodi and Madeni each carried their own, and they disagreed:
 *
 *   Dashibodi   status !== 'completed'      balance > 0
 *   Madeni      status === 'pending'        balance > 0.1
 *
 * For a sale written today the two agree, because Kikapu only ever writes
 * 'pending' or 'completed'. They part company on a row whose `status` is absent
 * — a legacy row, or one synced from an older client — which is `!== 'completed'`
 * (counted on the dashboard) but not `=== 'pending'` (missing from the list). The
 * boss then reads one figure on Dashibodi, taps through, and the list adds up to
 * something smaller. The 0.1 epsilon on one side and not the other does the same
 * thing to rounding residue.
 *
 * Both screens now import from here, so they cannot drift again.
 */

/** Balances at or below this are settled; it absorbs floating-point residue. */
export const DEBT_EPSILON = 0.1;

type SaleLike = {
  isDeleted?: number;
  payment_method?: string;
  status?: string | null;
  total_amount?: number;
};

/**
 * Is this sale a credit sale that has not been closed?
 *
 * Deliberately excludes 'cancelled' and 'refunded' by name rather than trusting
 * `!== 'completed'`: a refund sets `isDeleted: 1` as well, so it is filtered out
 * today, but naming them means a future status cannot quietly become a debt.
 * A missing status stays open — an unpaid legacy row is still money owed.
 */
export function isOpenCreditSale(sale: SaleLike): boolean {
  if (sale.isDeleted === 1) return false;
  if (sale.payment_method !== 'credit') return false;
  return sale.status !== 'completed' && sale.status !== 'cancelled' && sale.status !== 'refunded';
}

/** What is still owed on a sale, given everything paid against it so far. */
export function outstanding(totalAmount: number, paid: number): number {
  return Math.max(0, (Number(totalAmount) || 0) - (Number(paid) || 0));
}

/** Does this sale still owe enough to be worth showing / counting? */
export function hasOutstanding(totalAmount: number, paid: number): boolean {
  return (Number(totalAmount) || 0) - (Number(paid) || 0) > DEBT_EPSILON;
}

/** Sums only the payments that belong to a sale and have not been voided. */
export function paidOn(
  saleId: string,
  payments: Array<{ sale_id?: string; amount?: number; isDeleted?: number }>
): number {
  return payments.reduce(
    (sum, p) => (p.sale_id === saleId && p.isDeleted !== 1 ? sum + (Number(p.amount) || 0) : sum),
    0
  );
}
