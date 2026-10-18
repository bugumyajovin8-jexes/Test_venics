import { useState } from 'react';
import { useStore } from '../store';
import { User } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { normalizeTzPhone, toE164, formatTzPhone } from '../utils/phone';
import { authErrorMessage, beginAuthFlow, finishSignIn, type SignedIn } from '../services/authFlow';
import {
  AuthShell, FormError, OtpInput, OTP_LENGTH, PasswordInput, PhoneInput, ResendCode, SubmitButton, useResendTimer,
} from '../components/auth/AuthFields';

import { t } from '../i18n';
const ALREADY_REGISTERED = t('Namba hii tayari imesajiliwa. Ingia (Login), au tumia "Nimesahau nenosiri".');

/**
 * Create an account with a phone number. The number is confirmed with an SMS
 * code before the account can be used. If a boss invited this number, the new
 * account joins that shop as soon as the code is confirmed.
 */
export default function Register() {
  const setAuth = useStore(state => state.setAuth);
  const navigate = useNavigate();
  const [step, setStep] = useState<'details' | 'verify'>('details');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const resend = useResendTimer();

  const normalized = normalizeTzPhone(phone);

  const enter = (signedIn: SignedIn) => {
    // Navigate BEFORE setting auth State so that component is mounted
    navigate(signedIn.target, { replace: true });
    setAuth(signedIn.token, signedIn.localUser, signedIn.refreshToken);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError(t('Andika jina lako.')); return; }
    if (!normalized) { setError(t('Namba ya simu si sahihi. Andika namba ya Tanzania, mfano 0712 345 678.')); return; }
    if (password.length < 6) { setError(t('Nenosiri lazima liwe na angalau herufi 6.')); return; }
    if (password !== confirmPassword) { setError(t('Nenosiri halilingani. Tafadhali hakiki tena.')); return; }

    setLoading(true);
    const release = beginAuthFlow();
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        phone: toE164(normalized),
        password,
        options: { data: { name: name.trim() } },
      });
      if (signUpError) throw signUpError;

      // Phone confirmation switched off in Supabase: signed in already.
      if (data.session) {
        enter(await finishSignIn(data.session, { nameHint: name }));
        return;
      }
      // Supabase answers a repeat sign-up of a confirmed number with a decoy
      // user (so numbers cannot be probed); the empty identity list gives it away.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error(ALREADY_REGISTERED);
      }
      resend.start();
      setCode('');
      setStep('verify');
    } catch (err: any) {
      console.error('Registration error details:', err);
      setError(authErrorMessage(err, t('Kuna tatizo limetokea wakati wa usajili')));
    } finally {
      release();
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const release = beginAuthFlow();
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ phone: toE164(normalized!), token: code, type: 'sms' });
      if (verifyError) throw verifyError;
      if (!data.session) throw new Error(t('Uthibitisho umeshindikana. Tafadhali jaribu tena.'));

      // Someone who started signing up before and came back keeps the
      // password from the first attempt — Supabase does not change it on a
      // repeat sign-up. Make it the one they just typed.
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError && pwError.code !== 'same_password') console.warn('Password update after sign-up failed:', pwError.message);

      enter(await finishSignIn(data.session, { nameHint: name }));
    } catch (err: any) {
      console.error('Verify error:', err);
      setError(authErrorMessage(err));
    } finally {
      release();
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setLoading(true);
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'sms', phone: toE164(normalized!) });
      if (resendError) throw resendError;
      resend.start();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (step === 'verify') {
    return (
      <AuthShell
        title={t('Thibitisha namba')}
        subtitle={<>{t('Tumetuma SMS yenye namba ya uthibitisho kwenda')} <b className="text-gray-800">{formatTzPhone(normalized)}</b>{t('. Iandike hapa.')}</>}
        busy={loading}
      >
        <form onSubmit={handleVerify} className="space-y-4">
          <OtpInput value={code} onChange={v => { setCode(v); setError(''); }} />
          <FormError text={error} />
          <SubmitButton busy={loading} disabled={code.length !== OTP_LENGTH}>{t('Thibitisha')}</SubmitButton>
          <ResendCode left={resend.left} busy={loading} onResend={handleResend} />
          <button type="button" onClick={() => { setStep('details'); setError(''); }} className="block w-full text-sm text-gray-500 font-bold mt-2">
            {t('Badilisha namba')}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('Venics Sales')}
      subtitle={t('Anza sasa! Fungua akaunti yako ya biashara.')}
      busy={loading}
      footer={
        <div className="mt-6 text-sm text-gray-600">
          {t('Tayari una akaunti?')}{' '}
          <Link to="/" className="text-blue-600 font-bold">{t('Ingia hapa')}</Link>
        </div>
      }
    >
      <form onSubmit={handleRegister} className="space-y-4">
        <div className="relative">
          <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900 placeholder:text-gray-400"
            placeholder={t('Jina Kamili')}
            autoComplete="name"
            required
          />
        </div>
        <PhoneInput value={phone} onChange={v => { setPhone(v); setError(''); }} />
        <PasswordInput value={password} onChange={v => { setPassword(v); setError(''); }} autoComplete="new-password" />
        <PasswordInput value={confirmPassword} onChange={v => { setConfirmPassword(v); setError(''); }} placeholder={t('Thibitisha Nenosiri')} autoComplete="new-password" />

        <p className="text-xs text-gray-500 text-left">
          {t('Tutatuma SMS yenye namba ya uthibitisho kwenye namba hii. Kama bosi wako amekualika, tumia namba aliyoitumia.')}
        </p>

        <FormError text={error} />

        <SubmitButton busy={loading} disabled={!name || !phone || !password || !confirmPassword}>{t('Jisajili')}</SubmitButton>

        <p className="mt-4 text-xs text-gray-500">
          {t('By signing up you agree to our')}{' '}
          <a href="https://legal-peach-five.vercel.app" target="_blank" rel="noopener noreferrer" className="text-blue-600">
            {t('Terms of Service')}
          </a>{' '}
          {t('and')}{' '}
          <a href="https://legal-peach-five.vercel.app" target="_blank" rel="noopener noreferrer" className="text-blue-600">
            {t('Privacy Policy')}
          </a>
        </p>
      </form>
    </AuthShell>
  );
}
