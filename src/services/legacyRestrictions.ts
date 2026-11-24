/**
 * Promote the two device-local staff restrictions into the shop's `features`
 * table, once.
 *
 * THE PROBLEM THIS SOLVES
 *
 * "Ficha Idadi ya Bidhaa kwa Wafanyakazi" and "Zuia Wafanyakazi Kuona Historia"
 * used to live in the local Dexie `settings` row on one computer. Shops that
 * already switched them on have that intent recorded nowhere else — not in
 * Supabase, not on their phones. Shipping the synced version without this would
 * silently unlock Historia for every employee in those shops on the next
 * update, and nobody would know until an employee mentioned it.
 *
 * THE FOUR RULES
 *
 * 1. BOSS ONLY. `features` is a boss-writable table (the sync push drops it for
 *    everyone else and RLS would refuse it anyway), so an employee's machine
 *    cannot promote anything. It just waits for the boss's row to arrive.
 *
 * 2. ONLY PROMOTE `true`. A local `false` is indistinguishable from "never
 *    touched" — both are the default — so promoting it would write rows that
 *    say nothing, and on a second machine could overwrite a real `true`.
 *
 * 3. NEVER OVERWRITE AN EXISTING ROW. If the shop already has a row for the key
 *    — set from another machine, or from the new settings panel — that is the
 *    current decision and this stale local copy must not undo it.
 *
 * 4. RUN AFTER A PULL. Rule 3 is only safe once the local `features` table
 *    reflects the server, so the caller must have synced features first.
 *
 * Marked done per device, and only after a successful write, so a failure
 * retries on the next launch rather than being lost.
 */

import { db } from '../db';
import { useStore } from '../store';
import { SyncService } from './sync';
import { HIDE_STOCK_KEY, BLOCK_HISTORIA_KEY } from '../hooks/useStaffRestrictions';

const DONE_KEY = 'staff_restrictions_promoted_v1';

const PAIRS: { legacy: 'hideStockFromStaff' | 'blockHistoriaForStaff'; feature: string }[] = [
  { legacy: 'hideStockFromStaff', feature: HIDE_STOCK_KEY },
  { legacy: 'blockHistoriaForStaff', feature: BLOCK_HISTORIA_KEY },
];

function alreadyDone(shopId: string): boolean {
  try {
    return localStorage.getItem(`${DONE_KEY}_${shopId}`) === 'true';
  } catch {
    // No localStorage: treat as not done. Re-running is harmless — rule 3 makes
    // the whole thing a no-op once the rows exist.
    return false;
  }
}

function markDone(shopId: string): void {
  try {
    localStorage.setItem(`${DONE_KEY}_${shopId}`, 'true');
  } catch {
    /* best effort */
  }
}

export async function promoteLegacyStaffRestrictions(): Promise<void> {
  const user = useStore.getState().user;
  const shopId = user?.shopId;
  if (!shopId) return;

  const isBoss = user?.role === 'boss' || user?.role === 'admin' || user?.role === 'superadmin';
  if (!isBoss) return;                       // rule 1
  if (alreadyDone(shopId)) return;

  try {
    const settings: any = await db.settings.get(1);
    if (!settings) { markDone(shopId); return; }

    let wrote = 0;

    for (const { legacy, feature } of PAIRS) {
      if (settings[legacy] !== true) continue;   // rule 2

      const existing = await db.features
        .where('featureKey').equals(feature)
        .filter(f => f.shop_id === shopId)
        .toArray();
      if (existing.length > 0) continue;         // rule 3

      // toggleFeature writes the local row, updates the store map and pushes
      // the single row immediately — the same path the settings panel uses.
      await SyncService.toggleFeature(feature, true);
      wrote++;
      console.log(`[legacyRestrictions] Promoted "${legacy}" to feature "${feature}".`);
    }

    markDone(shopId);
    if (wrote === 0) {
      console.log('[legacyRestrictions] Nothing to promote for this shop.');
    }
  } catch (err) {
    // Deliberately NOT marked done: a failure here means the boss's setting is
    // still only on this machine, and the next launch should try again.
    console.error('[legacyRestrictions] Promotion failed; will retry next launch.', err);
  }
}
