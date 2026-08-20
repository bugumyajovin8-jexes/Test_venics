/**
 * Licence date maths.
 *
 * Kept free of any service dependency so it can be reasoned about — and tested —
 * on its own, without dragging in Supabase, Dexie or the store.
 */

/**
 * The moment a licence actually stops working: 23:59:59.999 local on the day it
 * expires.
 *
 * `init-license` issues a trial as `now + 14 days`, so a shop created at 14:30
 * expires at 14:30 — mid-trading-day, potentially with items already in the
 * cart. Rounding up to the end of the local day costs no free days (the ≤5-day
 * banner has been warning for a working week) and moves the cut-off to a moment
 * when nobody is serving a customer.
 *
 * Idempotent: an expiry already stamped at end-of-day stays exactly where it is
 * rather than rolling into the following day.
 */
export function effectiveExpiry(expiryDate: number): number {
  const d = new Date(expiryDate);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
