import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useStore } from '../store';
import { db } from '../db';
import { supabase } from '../supabase';
import { SyncService } from '../services/sync';
import { normalizeTzPhone, toE164, formatTzPhone } from '../utils/phone';
import { authErrorMessage, fetchLoginPhone } from '../services/authFlow';
import {
  AuthShell, FormError, OtpInput, OTP_LENGTH, PhoneInput, ResendCode, SubmitButton, useResendTimer,
} from './auth/AuthFields';

import { t } from '../i18n';
const RECHECK_MS = 5 * 60_000;

/**
 * Accounts sign in with a phone number now. An account created with an email
 * must add one before it can carry on — same account, same shop, same data;
 * from then on it signs in with the number.
 *
 * Never shown offline: the number cannot be confirmed without a network, and
 * a shop that has no internet for days must keep selling. It appears the next
 * time the device is online.
 */
export default function PhoneRequiredGate() {
  const user = useStore(s => s.user);
  const updateUser = useStore(s => s.updateUser);
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (!user?.id || user.phone) { setRequired(false); return; }
    let cancelled = false;

    const check = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const phone = await fetchLoginPhone();
      if (cancelled) return;
      if (phone) {
        updateUser({ phone });
        void db.users.update(user.id, { phone }).catch(() => {});
        setRequired(false);
      } else if (phone === null) {
        setRequired(true);
      }
      // undefined: could not tell (offline, server unreachable) — leave as is.
    };

    void check();
    const interval = setInterval(check, RECHECK_MS);
    window.addEventListener('online', check);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('online', check);
    };
  }, [user?.id, user?.phone, updateUser]);

  if (!required || !user) return null;
  return <AddPhoneScreen onDone={phone => {
    updateUser({ phone });
    void db.users.update(user.id, { phone }).catch(() => {});
    setRequired(false);
  }} />;
}

function AddPhoneScreen({ onDone }: { onDone: (phone: string) => void }) {
  const user = useStore(s => s.user);
  const logout = useStore(s => s.logout);
  const showConfirm = useStore(s => s.showConfirm);
  const setIsLoggingOut = useStore(s => s.setIsLoggingOut);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const resend = useResendTimer();
  const normalized = normalizeTzPhone(phone);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!normalized) { setError(t('Namba ya simu si sahihi. Andika namba ya Tanzania, mfano 0712 345 678.')); return; }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ phone: toE164(normalized) });
      if (updateError) {
        if (updateError.code === 'phone_exists' || /already been registered/i.test(updateError.message)) {
          throw new Error(t('Namba hii tayari inatumiwa na akaunti nyingine. Tumia namba nyingine, au wasiliana nasi 0787979273.'));
        }
        throw updateError;
      }
      resend.start();
      setCode('');
      setStep('code');
    } catch (err) {
      console.error('Add phone error:', err);
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setLoading(true);
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'phone_change', phone: toE164(normalized!) });
      if (resendError) throw resendError;
      resend.start();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ phone: toE164(normalized!), token: code, type: 'phone_change' });
      if (verifyError) throw verifyError;
      // The next token carries the number; nothing waits on it.
      void supabase.auth.refreshSession().catch(() => {});
      onDone(normalized!);
      useStore.getState().showToast(t('Namba imeongezwa. Kuanzia sasa ingia kwa namba hii.'), 'success');
    } catch (err) {
      console.error('Verify phone error:', err);
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Same rules as Zaidi's logout: logout clears this till's records, so
  // anything not yet sent anywhere is named before it is lost.
  const handleLogout = () => {
    showConfirm(t('Toka'), t('Unataka kutoka kwenye akaunti hii? Utahitaji kuingia tena.'), async () => {
      setLeaving(true);
      setIsLoggingOut(true);
      try {
        await SyncService.logAction('logout', { platform: 'web' });
        await SyncService.flushAuditLogs();
      } catch (e) {
        console.error('Failed to log logout', e);
      }
      await SyncService.syncBeforeLogout();
      const unsent = await SyncService.countUnsentAnywhere();
      if (unsent > 0) {
        setIsLoggingOut(false);
        setLeaving(false);
        showConfirm(
          t('Kuna rekodi ambazo hazijatumwa'),
          t('Rekodi {unsent} (mauzo, matumizi au madeni) ziko kwenye kompyuta hii tu — hazijafika kwenye mtandao wala kwenye kituo cha duka. Ukitoka sasa zitafutwa na hazitapatikana tena. Ni bora uunganishe intaneti au kituo cha duka, usubiri zitumwe, kisha utoke. Toka sasa hata hivyo?', { unsent }),
          () => {
            setLeaving(true);
            setIsLoggingOut(true);
            void logout();
          },
        );
        return;
      }
      void logout();
    });
  };

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-gray-50">
      <AuthShell
        title={t('Ongeza namba ya simu')}
        subtitle={step === 'phone'
          ? <>{t('Kuanzia sasa, Venics Sales inatumia')} <b className="text-gray-800">{t('namba ya simu')}</b> {t('badala ya barua pepe kuingia na kurejesha nenosiri. Ongeza namba yako mara moja tu — akaunti, biashara na taarifa zako zote zinabaki vilevile.')}</>
          : <>{t('Tumetuma SMS yenye namba ya uthibitisho kwenda')} <b className="text-gray-800">{formatTzPhone(normalized)}</b>.</>}
        busy={loading || leaving}
        footer={
          <button
            type="button"
            onClick={handleLogout}
            disabled={leaving}
            className="mt-6 inline-flex items-center gap-1.5 text-xs text-gray-500 font-bold disabled:opacity-50"
          >
            <LogOut className="w-3.5 h-3.5" /> {leaving ? t('Inatoka...') : t('Toka ({v})', { v: user?.name || 'akaunti hii' })}
          </button>
        }
      >
        {step === 'phone' ? (
          <form onSubmit={handleSend} className="space-y-4">
            <PhoneInput value={phone} onChange={v => { setPhone(v); setError(''); }} autoFocus />
            <FormError text={error} />
            <SubmitButton busy={loading} disabled={!phone}>{t('Tuma Namba ya Uthibitisho')}</SubmitButton>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <OtpInput value={code} onChange={v => { setCode(v); setError(''); }} />
            <FormError text={error} />
            <SubmitButton busy={loading} disabled={code.length !== OTP_LENGTH}>{t('Thibitisha')}</SubmitButton>
            <ResendCode left={resend.left} busy={loading} onResend={handleResend} />
            <button type="button" onClick={() => { setStep('phone'); setError(''); }} className="block w-full text-sm text-gray-500 font-bold mt-2">
              {t('Badilisha namba')}
            </button>
          </form>
        )}
      </AuthShell>
    </div>
  );
}
