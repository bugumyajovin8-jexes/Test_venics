/**
 * An owner's other shops: moving between them ("Hamia Hapa") and opening a new
 * one ("Ongeza Duka"), as the Mobile app does (Mobile app/src/services/shopSwitch.ts).
 *
 * One difference, and it is Desktop's own rule: this computer holds ONE shop at
 * a time — store.ts clears the local copy whenever the shop changes. So before
 * the shop being left is cleared from here, everything recorded in it must have
 * reached the cloud or the shop hub. A switch that cannot promise that does not
 * happen.
 */

import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase';
import { db, clearAllLocalData } from '../db';
import { useStore } from '../store';
import { SyncService } from './sync';
import { LicenseService } from './license';
import { nowIso } from './clock';
import { t } from '../i18n';

/** Support line, as on every locked surface. */
export const SUPPORT_PHONE = '0787979273';

/** Moving shops happens on the server, so it needs the internet. */
export const SWITCH_NEEDS_INTERNET =
  t('Kuhamia duka jingine kunahitaji intaneti. Washa data au unganisha kwenye wifi yenye intaneti, kisha ujaribu tena.');

export interface OwnShop {
  id: string;
  name: string;
  created_at?: string;
}

/** The shops this account created, from the server, oldest first. */
export async function fetchOwnShops(userId: string): Promise<OwnShop[]> {
  const { data, error } = await supabase
    .from('shops')
    .select('id, name, created_at')
    .eq('created_by', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OwnShop[];
}

/**
 * Moves this account to another of its own shops, on the server.
 *
 * Through `switch_shop()` (supabase/migrations/20261014_switch_shop.sql), which
 * moves the owner even out of a shop whose licence has lapsed. Updating
 * `users.shop_id` directly is refused for a lapsed shop, and refused QUIETLY —
 * no rows change and no error comes back.
 *
 * Resolves only once the server has really moved the account; otherwise
 * throws with a message for the shop owner.
 */
export async function moveAccountToShop(userId: string, shopId: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error(SWITCH_NEEDS_INTERNET);

  const ask = async <T,>(request: PromiseLike<T>): Promise<T> => {
    try {
      return await request;
    } catch (err) {
      throw new Error(describe(err));
    }
  };

  const { data, error } = await ask(supabase.rpc('switch_shop', { p_shop_id: shopId }));
  if (!error) {
    if ((data as any)?.shop_id !== shopId) throw new Error(failedMessage());
    return;
  }
  if (!isMissingFunction(error)) throw new Error(describe(error));

  // A server that has not had 20261014_switch_shop.sql yet. The old way still
  // works while the shop being left is licensed. The row is asked back,
  // because "no error" alone does not mean it moved.
  const { data: rows, error: updateError } = await ask(supabase
    .from('users')
    .update({ shop_id: shopId, updated_at: nowIso() })
    .eq('id', userId)
    .select('shop_id'));
  if (updateError) throw new Error(describe(updateError));
  if (!rows?.length || rows[0].shop_id !== shopId) throw new Error(failedMessage());
}

/**
 * "Hamia Hapa" on this computer: makes sure the shop being left has nothing
 * unsent, moves the account on the server, then replaces this computer's copy
 * of the old shop with the new one (recent sales and the daily totals, as a
 * new computer gets — services/dailyTotals.ts).
 */
export async function switchToShop(targetShopId: string): Promise<void> {
  const { user, token } = useStore.getState();
  if (!user || !token) throw new Error(failedMessage());
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error(SWITCH_NEEDS_INTERNET);

  // 1. Hand this shop's work to the cloud or the hub, and let the sync finish,
  //    so nothing is written into the old shop's copy while it is cleared.
  await SyncService.syncBeforeLogout();
  if (!(await SyncService.whenIdle(15_000))) {
    throw new Error(t('Kompyuta bado inasawazisha duka hili. Subiri kidogo, kisha ujaribu tena.'));
  }
  const unsent = await SyncService.countUnsentAnywhere();
  if (unsent > 0) {
    throw new Error(t('Rekodi {unsent} za duka hili bado hazijafika mtandaoni wala kwenye Kituo. Unganisha intaneti na subiri zisawazishwe, kisha ujaribu tena — vinginevyo zingepotea.', { unsent }));
  }

  // 2. The move itself. Throws unless the server really moved the account.
  await moveAccountToShop(user.id, targetShopId);

  // 3. The old shop leaves this computer — waited for, before anything of the
  //    new shop arrives. store.ts would clear it too on the shop change, but
  //    without waiting; marking the shop as seen keeps it from doing it twice.
  useStore.getState().clearCart();
  await clearAllLocalData({ forceAll: true });
  const updatedUser = { ...user, shop_id: targetShopId, shopId: targetShopId };
  await db.users.put({ ...updatedUser, synced: 1 } as any);
  try { localStorage.setItem('pos_last_shop_id', targetShopId); } catch { /* storage blocked: the store clears again, harmlessly */ }
  useStore.getState().setAuth(token, updatedUser as any);

  // 4. The new shop's licence now (the cached one is the old shop's), then its data.
  LicenseService.clearStatusCache();
  await LicenseService.syncLicense(true).catch(err => console.warn('[shopSwitch] licence sync after the switch failed:', err));
  void SyncService.sync(true, 'full').catch(err => console.error('[shopSwitch] first sync of the new shop failed:', err));
}

/**
 * "Ongeza Duka": creates another shop owned by this account, on the server.
 *
 * Its licence is settled when the owner first enters it: the licence check
 * there asks the server for the trial a genuinely first shop gets (one per
 * owner, see the init-license function), and otherwise shows the support
 * number. The Mobile app asks at creation by moving the account into the new
 * shop for a moment; here that moment would have the server refuse this
 * computer's uploads for the shop it is still in, and a refused upload is
 * dropped (sync.ts), so it is not done.
 */
export async function createShop(name: string): Promise<OwnShop> {
  const user = useStore.getState().user;
  if (!user) throw new Error(t('Imeshindwa kuongeza duka.'));
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error(t('Kuongeza duka kunahitaji intaneti. Washa data au unganisha kwenye wifi yenye intaneti, kisha ujaribu tena.'));
  const shop = {
    id: uuidv4(),
    name: name.trim(),
    status: 'active',
    owner_name: user.name || user.email?.split('@')[0] || 'Bosi',
    created_by: user.id,
    enable_expiry: false,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { error } = await supabase.from('shops').insert(shop);
  if (error) throw new Error(describe(error, t('Imeshindwa kuongeza duka.')));
  return { id: shop.id, name: shop.name, created_at: shop.created_at };
}

function isMissingFunction(error: any): boolean {
  return error?.code === 'PGRST202' || /could not find the function/i.test(String(error?.message ?? ''));
}

function failedMessage(): string {
  return t('Imeshindikana kuhamia duka hili kwa sasa. Piga simu {SUPPORT_PHONE} kwa msaada.', { SUPPORT_PHONE });
}

function describe(error: any, fallback = failedMessage()): string {
  const message = String(error?.message ?? '');
  if (/not your shop/i.test(message)) return t('Duka hili si mojawapo ya maduka yako.');
  if (/account blocked/i.test(message)) return t('Akaunti yako imezuiwa. Piga simu {SUPPORT_PHONE} kwa msaada.', { SUPPORT_PHONE });
  // Connected to a wifi that does not actually reach the internet: the
  // computer believes it is online, and only the request finds out.
  if (/failed to fetch|network|timeout|timed out|unable to resolve host|offline|connection/i.test(message) || error?.status === 0) {
    return SWITCH_NEEDS_INTERNET;
  }
  return fallback;
}
