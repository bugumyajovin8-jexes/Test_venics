import type { Session, User as AuthUser } from '@supabase/supabase-js';
import { supabase, signOutSafely } from '../supabase';
import type { User } from '../db';
import { nowIso } from './clock';
import { normalizeTzPhone } from '../utils/phone';

import { t } from '../i18n';
/**
 * Sign-in plumbing shared by Login, Register, ForgotPassword and the
 * "add your phone number" screen.
 *
 * Accounts are phone numbers now. Supabase Auth sends and checks the SMS codes
 * (through the `send-sms` hook → Beem); this file turns a Supabase session into
 * the app's signed-in user.
 */

// ---------------------------------------------------------------- flow guard
//
// App.tsx signs the user in by itself whenever Supabase reports SIGNED_IN.
// During password reset that is wrong: verifying the SMS code creates a
// session BEFORE the new password is set, and the app would open over the
// reset screen. Pages hold this while they finish their own steps.
let activeFlows = 0;

export function beginAuthFlow(): () => void {
  activeFlows++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeFlows = Math.max(0, activeFlows - 1);
  };
}

export function authFlowActive(): boolean {
  return activeFlows > 0;
}

// ---------------------------------------------------------------- errors

/** Swahili for the auth errors people actually meet. */
export function authErrorMessage(err: unknown, fallback = t('Kuna tatizo limetokea. Tafadhali jaribu tena.')): string {
  const e = (err ?? {}) as { message?: string; code?: string; status?: number; name?: string; reasons?: string[] };
  const code = String(e.code ?? '');
  const msg = String(e.message ?? '');

  if (/Failed to fetch|NetworkError|Load failed|timed out|TimeoutError|AuthRetryableFetchError/i.test(msg + ' ' + (e.name ?? ''))) {
    return t('Hakuna mtandao. Unganisha intaneti kisha ujaribu tena.');
  }
  if (code === 'invalid_credentials' || /Invalid login credentials/i.test(msg)) {
    return t('Namba ya simu (au barua pepe) au nenosiri si sahihi.');
  }
  if (code === 'phone_not_confirmed' || /Phone not confirmed/i.test(msg)) {
    return t('Namba hii bado haijathibitishwa.');
  }
  if (code === 'email_not_confirmed' || /Email not confirmed/i.test(msg)) {
    return t('Barua pepe yako bado haijathibitishwa. Angalia email yako na ubonyeze link ya kuthibitisha.');
  }
  if (code === 'user_already_exists' || code === 'phone_exists' || /already (been )?registered|already exists/i.test(msg)) {
    return t('Namba hii tayari imesajiliwa. Ingia (Login), au tumia "Nimesahau nenosiri".');
  }
  if (code === 'otp_expired' || /Token has expired or is invalid/i.test(msg)) {
    return t('Namba ya uthibitisho si sahihi au imeisha muda. Angalia SMS tena, au omba nyingine.');
  }
  const wait = msg.match(/after (\d+) seconds?/i);
  if (code === 'over_sms_send_rate_limit' || wait) {
    return wait
      ? t('Subiri sekunde {v} kisha uombe namba nyingine.', { v: wait[1] })
      : t('SMS nyingi mno kwa sasa. Subiri kidogo kisha ujaribu tena.');
  }
  if (code === 'over_request_rate_limit' || e.status === 429) {
    return t('Maombi mengi mno. Subiri kidogo kisha ujaribu tena.');
  }
  if (code === 'otp_disabled' || /Signups not allowed for otp/i.test(msg)) {
    return t('Namba hii haijasajiliwa. Jisajili kwanza.');
  }
  if (code === 'phone_provider_disabled' || /Unsupported phone provider|phone.*(disabled|not enabled)/i.test(msg)) {
    return t('Kuingia kwa namba ya simu bado hakujawashwa. Wasiliana nasi 0787979273.');
  }
  // Before the weak-password check: "New password should be different…" also
  // contains "password should be".
  if (code === 'same_password' || /should be different from the old/i.test(msg)) {
    return t('Nenosiri jipya lisifanane na la zamani.');
  }
  if (code === 'weak_password' || /^Password should|known to be weak/i.test(msg)) {
    const reasons = e.reasons ?? [];
    const min = msg.match(/at least (\d+) characters/i);
    if (reasons.includes('length') || min) return t('Nenosiri ni fupi mno. Tumia angalau herufi {v}.', { v: min?.[1] ?? 6 });
    if (reasons.includes('characters') || /should contain/i.test(msg)) return t('Nenosiri ni jepesi mno. Changanya herufi kubwa, herufi ndogo na namba.');
    return t('Nenosiri hili ni rahisi mno kubahatisha. Chagua jingine.');
  }
  if (code === 'hook_timeout' || code === 'hook_timeout_after_retry' || code === 'sms_send_failed') {
    return t('Imeshindikana kutuma SMS kwa sasa. Jaribu tena baada ya dakika moja.');
  }
  if (code === 'validation_failed' && /phone/i.test(msg)) {
    return t('Namba ya simu si sahihi. Andika namba ya Tanzania, mfano 0712 345 678.');
  }
  // Messages from our own SMS hook are already Swahili.
  return msg || fallback;
}

// ---------------------------------------------------------------- profile

/**
 * The caller's `users` row, created if missing; also joins the shop that
 * invited their confirmed number, if they have no shop yet.
 *
 * Falls back to reading (and self-healing) the row directly when the server
 * migration (20261011_phone_auth.sql) has not been run.
 */
async function loadProfile(authUser: AuthUser, nameHint?: string): Promise<any | null> {
  const { data, error } = await supabase.rpc('claim_shop_invitation', { p_name: nameHint?.trim() || null });
  if (!error && data?.user) return data.user;
  if (error) console.warn('[auth] claim_shop_invitation unavailable, reading profile directly:', error.message);

  const { data: row, error: readError } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();
  if (readError) {
    console.error('User fetch error:', readError);
    if (readError.message.includes('recursion') || readError.code === '42P17') {
      throw new Error(t('Kuna tatizo la kiufundi kwenye database (Recursion). Tafadhali wasiliana na msaada wa kiufundi.'));
    }
    throw new Error(t('Kuna tatizo la kiufundi wakati wa kutafuta akaunti yako. Tafadhali jaribu tena.'));
  }
  if (row) return row;

  // SELF-HEALING: in Auth but not in `users`.
  const { data: created, error: createError } = await supabase
    .from('users')
    .upsert({
      id: authUser.id,
      email: authUser.email || null,
      name: nameHint?.trim() || 'Mtumiaji',
      role: null,
      status: 'active',
      updated_at: nowIso(),
    }, { onConflict: 'id' })
    .select()
    .maybeSingle();
  if (createError && !createError.message.includes('duplicate key')) {
    console.error('Failed to self-heal profile:', createError);
    throw new Error(t('Akaunti yako haijakamilika na imeshindikana kuitengeneza. Tafadhali wasiliana na msimamizi wako.'));
  }
  if (created) return created;
  const { data: retry } = await supabase.from('users').select('*').eq('id', authUser.id).maybeSingle();
  return retry ?? null;
}

export interface SignedIn {
  localUser: User;
  token: string;
  refreshToken: string;
  /** Where to go: the shop's home, or shop setup when there is no shop yet. */
  target: string;
}

/**
 * Turns a fresh Supabase session into the app's user. Refuses blocked and
 * inactive accounts — and signs the session out again when it does, so a
 * refused account is not left half signed in.
 */
export async function finishSignIn(session: Session, opts: { nameHint?: string } = {}): Promise<SignedIn> {
  try {
    const authUser = session.user;
    const profile = await loadProfile(authUser, opts.nameHint);

    if (!profile) throw new Error(t('Akaunti yako haijakamilika. Tafadhali wasiliana na msimamizi wako.'));
    if (profile.status === 'blocked') {
      throw new Error(t('Akaunti yako imezuiwa (Blocked). Tafadhali wasiliana na msimamizi wako ili kufunguliwa.'));
    }
    if (profile.status && profile.status !== 'active') {
      throw new Error(t('Akaunti yako haijaruhusiwa kutumika. Tafadhali wasiliana na msimamizi wako.'));
    }

    const phone = normalizeTzPhone(authUser.phone) ?? undefined;
    const localUser = {
      id: profile.id,
      email: authUser.email || profile.email || '',
      phone,
      name: profile.name,
      role: profile.role,
      shop_id: profile.shop_id,
      shopId: profile.shop_id,
      status: profile.status ?? 'active',
      isActive: true,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      isDeleted: 0,
      synced: 1,
    } as User;

    const isUserBoss = localUser.role === 'admin' || localUser.role === 'superadmin' || localUser.role === 'boss';
    const target = localUser.shop_id ? (isUserBoss ? '/executive' : '/') : '/setup-shop';
    return { localUser, token: session.access_token, refreshToken: session.refresh_token, target };
  } catch (err) {
    await signOutSafely().catch(() => {});
    throw err;
  }
}

/**
 * Joins the shop that invited this account, if it has no shop. Null when the
 * server cannot be asked (offline, or the migration is not run yet).
 */
export async function claimShopInvitation(): Promise<{ claimed: boolean; user?: any } | null> {
  const { data, error } = await supabase.rpc('claim_shop_invitation', { p_name: null });
  if (error) {
    console.warn('[auth] claim_shop_invitation failed:', error.message);
    return null;
  }
  return data ?? null;
}

// ---------------------------------------------------------------- login number

/**
 * The account's confirmed login number: a string, `null` when it has none,
 * or `undefined` when that cannot be known right now (offline, no session).
 * Callers must not block anyone on `undefined`.
 */
export async function fetchLoginPhone(timeoutMs = 10_000): Promise<string | null | undefined> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return undefined;
    const cached = data.session.user?.phone;
    if (cached) return normalizeTzPhone(cached) ?? cached;
  } catch {
    return undefined;
  }

  // The cached session may predate a number added on another device.
  try {
    const res: any = await Promise.race([
      supabase.auth.getUser(),
      new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), timeoutMs)),
    ]);
    if (res?.timedOut || res?.error || !res?.data?.user) return undefined;
    const phone = res.data.user.phone;
    return phone ? normalizeTzPhone(phone) ?? phone : null;
  } catch {
    return undefined;
  }
}
