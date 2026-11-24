/**
 * The two staff restrictions a boss can set: hide stock figures, and shut
 * employees out of Historia.
 *
 * These used to be DEVICE settings, held in the local Dexie `settings` row and
 * never uploaded — a boss set them on one till and the phones knew nothing
 * about it. They are now shop-wide features synced through Supabase.
 *
 * WHY THIS READS `db.features` AND NOT `isFeatureEnabled()`
 *
 * The store's feature map is in memory. It is empty on a cold start until a
 * sync populates it, and `isFeatureEnabled` answers `false` for anything it has
 * not heard of yet. For a cosmetic feature that is fine; for an access
 * restriction it is a hole — an employee opening the app offline would get a
 * few unrestricted seconds. `db.features` is on disk and needs no network.
 *
 * THE LEGACY FALLBACK
 *
 * Shops that already ticked these boxes have the answer only in their local
 * `settings` row. Until the promotion in `promoteLegacyStaffRestrictions()` has
 * run and synced, that local value is still the only record of the boss's
 * intent, so it is honoured as a fallback. It can only ever turn a restriction
 * ON: once a feature row exists it is authoritative, including when it says
 * off, otherwise a boss could never switch these back off on this machine.
 *
 * Neither restriction ever applies to a boss.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';

export const HIDE_STOCK_KEY = 'hide_stock_from_staff';
export const BLOCK_HISTORIA_KEY = 'block_historia_for_staff';

type LegacySettingKey = 'hideStockFromStaff' | 'blockHistoriaForStaff';

function useRestriction(key: string, legacy: LegacySettingKey): boolean {
  const shopId = useStore(s => s.user?.shopId);
  // Selecting the role rather than the isBoss function: the function's identity
  // is stable, so subscribing to it would not re-render when the user changes.
  const role = useStore(s => s.user?.role);
  const isBoss = role === 'boss' || role === 'admin' || role === 'superadmin';

  const on = useLiveQuery(async () => {
    if (!shopId) return false;

    const rows = await db.features
      .where('featureKey').equals(key)
      .filter(f => f.shop_id === shopId)
      .toArray();

    // A feature row is the answer, whichever way it points.
    if (rows.length > 0) return rows.some(r => r.isEnabled === true);

    // No row yet — fall back to what this machine was told before the setting
    // became shop-wide.
    const settings = await db.settings.get(1);
    return (settings as any)?.[legacy] === true;
  }, [shopId, key, legacy]);

  return on === true && !isBoss;
}

/** Withhold remaining-stock figures from this person. */
export function useHideStock(): boolean {
  return useRestriction(HIDE_STOCK_KEY, 'hideStockFromStaff');
}

/**
 * Shut this person out of Historia.
 *
 * Read it in two places, and both are needed: the navigation, so the way in
 * disappears; and the ROUTE, so typing the address or arriving from a chat
 * suggestion is turned away. Hiding a button only hides a button.
 */
export function useBlockHistoria(): boolean {
  return useRestriction(BLOCK_HISTORIA_KEY, 'blockHistoriaForStaff');
}
