import { supabase } from '../supabase';
import { db, clearAllLocalData } from '../db';
import { useStore } from '../store';
import { SyncService } from './sync';
import { LicenseService } from './license';
import { SUPPORT_PHONE } from './shopSwitch';
import { formatTzPhone } from '../utils/phone';
import { t } from '../i18n';

/**
 * Staff who open a shop by mistake (supabase/migrations/20261117_staff_signup.sql).
 *
 *  - Sign-up asks "Mmiliki au Mfanyakazi?" first; the answer is kept with the
 *    account (signup_role) and a staff account cannot open a shop.
 *  - A boss whose shop looks unused is asked, when another shop has invited
 *    their number, whether they opened it by mistake. "Ndiyo" removes the
 *    empty shop and joins the inviting one as staff. Never automatic.
 */

export type SignupRole = 'boss' | 'employee';

const ROLE_KEY = 'venics_signup_role';
const DISMISSED_KEY = 'venics_invite_dismissed';

/** What the person said at sign-up; null for accounts made before the question. */
export async function getSignupRole(): Promise<SignupRole | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const role = data.session?.user?.user_metadata?.signup_role;
    if (role === 'boss' || role === 'employee') return role;
  } catch { /* no session to read */ }
  try {
    const stored = localStorage.getItem(ROLE_KEY);
    if (stored === 'boss' || stored === 'employee') return stored;
  } catch { /* storage blocked */ }
  return null;
}

export function rememberSignupRole(role: SignupRole): void {
  try { localStorage.setItem(ROLE_KEY, role); } catch { /* storage blocked: the account has it too */ }
}

export function forgetSignupRole(): void {
  try { localStorage.removeItem(ROLE_KEY); } catch { /* ignore */ }
}

/** "Nimekosea, mimi ni bosi": changes the answer on the server, where the shop guard reads it. */
export async function changeSignupRole(role: SignupRole): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(t('Unahitaji mtandao ili kubadilisha hili. Washa data au wifi, kisha ujaribu tena.'));
  }
  const { error } = await supabase.auth.updateUser({ data: { signup_role: role } });
  if (error) throw new Error(t('Imeshindikana kubadilisha. Hakikisha una mtandao kisha ujaribu tena.'));
  rememberSignupRole(role);
}

// ---------------------------------------------------------------- the boss's message

/** What the person waiting sends their boss. In Swahili, whatever the app's language: it goes to another person. */
export function bossMessage(phone: string | null | undefined): string {
  const shown = phone ? formatTzPhone(phone) : '';
  return `Habari bosi, nimejisajili kwenye Venics Sales${shown ? ` kwa namba ${shown}` : ''}. `
    + 'Tafadhali niongeze kama mfanyakazi: Zaidi → Wafanyakazi → Ongeza, kisha andika namba hii.';
}

/** The computer's share sheet where there is one; otherwise WhatsApp. Costs Venics no SMS. */
export async function shareWithBoss(text: string): Promise<void> {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  if (nav?.share) {
    try { await nav.share({ text }); return; } catch (err: any) { if (err?.name === 'AbortError') return; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

// ---------------------------------------------------------------- another shop's invitation

export interface MistakeCheck {
  can_switch: boolean;
  /** not_creator | sales | people | paid | other_shops */
  reasons: string[];
  products: number;
  records: number;
}

export interface InvitationOffer {
  invitation_id: string;
  shop_id: string;
  shop_name: string;
  invited_at: string;
  own_shop: { id: string; name: string };
  check: MistakeCheck;
}

function isMissingFunction(error: any): boolean {
  return error?.code === 'PGRST202' || /could not find the function/i.test(String(error?.message ?? ''));
}

/**
 * Another shop has invited this number while this account is the boss of its
 * own shop. Null when there is nothing to ask, or it cannot be asked now
 * (offline, or the server has not had 20261117_staff_signup.sql yet).
 */
export async function findInvitationForMe(): Promise<InvitationOffer | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  const { data, error } = await supabase.rpc('shop_invitation_for_me');
  if (error) {
    if (!isMissingFunction(error)) console.warn('[staffJoin] shop_invitation_for_me failed:', error.message);
    return null;
  }
  return (data as InvitationOffer) ?? null;
}

/** Asked only for a shop with no sales on this computer: a shop in use is not a mistake. */
export async function looksUnused(): Promise<boolean> {
  try {
    return (await db.sales.count()) === 0;
  } catch {
    return false;
  }
}

export function isDismissed(invitationId: string): boolean {
  try { return (JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]') as string[]).includes(invitationId); } catch { return false; }
}

export function dismiss(invitationId: string): void {
  try {
    const list = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]') as string[];
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...list.filter(x => x !== invitationId), invitationId].slice(-20)));
  } catch { /* storage blocked: asked again next time */ }
}

/** Why a shop is kept, in words. */
export function keptBecause(reasons: string[]): string {
  const words: Record<string, string> = {
    sales: t('lina mauzo'),
    people: t('lina wafanyakazi wengine'),
    paid: t('leseni yake imelipiwa'),
    other_shops: t('una maduka mengine'),
    not_creator: t('si duka ulilofungua wewe'),
  };
  return reasons.map(r => words[r]).filter(Boolean).join(', ') || t('linatumika');
}

function joinError(error: any): string {
  const message = String(error?.message ?? '');
  const hint = String(error?.hint ?? '');
  if (/failed to fetch|network|timeout|offline|connection/i.test(message)) {
    return t('Unahitaji mtandao ili kujiunga. Washa data au wifi, kisha ujaribu tena.');
  }
  if (hint.startsWith('in_use') || /in use/i.test(message)) {
    return t('Duka lako linatumika, kwa hiyo haliwezi kufutwa kutoka hapa. Piga simu {SUPPORT_PHONE} kwa msaada.', { SUPPORT_PHONE });
  }
  if (hint === 'no_invitation' || /invitation not found|inviting shop is gone/i.test(message)) {
    return t('Mwaliko huu haupo tena. Muombe bosi wako akualike tena.');
  }
  if (isMissingFunction(error)) {
    return t('Huduma hii bado haijawashwa kwenye seva. Piga simu {SUPPORT_PHONE} kwa msaada.', { SUPPORT_PHONE });
  }
  return t('Imeshindikana kujiunga kwa sasa. Piga simu {SUPPORT_PHONE} kwa msaada.', { SUPPORT_PHONE });
}

/**
 * This computer now belongs to `shopId` as staff. It holds one shop at a time
 * (services/shopSwitch.ts), so the old shop's copy goes first — waited for,
 * before anything of the new shop arrives — then the licence, then the data.
 */
async function becomeStaffOn(shopId: string): Promise<void> {
  const { user, token } = useStore.getState();
  if (!user || !token) return;
  useStore.getState().clearCart();
  await clearAllLocalData({ forceAll: true });
  const updatedUser = { ...user, shop_id: shopId, shopId, role: 'employee' as const };
  await db.users.put({ ...updatedUser, synced: 1 } as any);
  // Marked as seen, so store.ts does not clear the new shop again.
  try { localStorage.setItem('pos_last_shop_id', shopId); } catch { /* storage blocked: cleared again, harmlessly */ }
  useStore.getState().setAuth(token, updatedUser as any);
  forgetSignupRole();
  LicenseService.clearStatusCache();
  await LicenseService.syncLicense(true).catch(err => console.warn('[staffJoin] licence sync failed:', err));
  void SyncService.sync(true, 'full').catch(err => console.error('[staffJoin] first sync of the new shop failed:', err));
}

/**
 * "Ndiyo, jiunge": sends anything still on this phone first (so the server
 * judges the shop with everything in it), then the server removes the empty
 * shop and moves the account. Throws a message for the person if not.
 */
export async function joinInvitingShop(offer: InvitationOffer): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(t('Unahitaji mtandao ili kujiunga. Washa data au wifi, kisha ujaribu tena.'));
  }
  await SyncService.syncBeforeLogout();
  if (!(await SyncService.whenIdle(15_000))) {
    throw new Error(t('Kompyuta bado inasawazisha duka hili. Subiri kidogo, kisha ujaribu tena.'));
  }
  const unsent = await SyncService.countUnsentAnywhere();
  if (unsent > 0) {
    throw new Error(t('Rekodi {unsent} za duka lako bado hazijafika mtandaoni. Unganisha intaneti na subiri zisawazishwe, kisha ujaribu tena.', { unsent }));
  }

  let result: any;
  try {
    const { data, error } = await supabase.rpc('join_inviting_shop', { p_invitation: offer.invitation_id });
    if (error) throw error;
    result = data;
  } catch (err) {
    throw new Error(joinError(err));
  }
  if (!result?.shop_id) throw new Error(joinError(null));

  await becomeStaffOn(result.shop_id);
}

/**
 * The Superadmin moved this account out of its mistaken shop (boss there,
 * staff in another shop now). The old shop is gone from the server: take it
 * off this computer too and open the new one.
 */
export async function adoptMoveFromServer(newShopId: string, _oldShopId: string | null): Promise<void> {
  await becomeStaffOn(newShopId);
}
