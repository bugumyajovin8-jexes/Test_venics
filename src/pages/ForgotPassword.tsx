import { useEffect, useRef, useState } from 'react';
import { supabase, signOutSafely } from '../supabase';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { normalizeTzPhone, toE164, formatTzPhone } from '../utils/phone';
import { authErrorMessage, beginAuthFlow, finishSignIn } from '../services/authFlow';
import {
  AuthShell, FormError, OtpInput, OTP_LENGTH, PasswordInput, PhoneInput, ResendCode, SubmitButton, useResendTimer,
} from '../components/auth/AuthFields';

import { t } from '../i18n';
/**
 * Reset a password by SMS code: number → code → new password → signed in.
 *
 * `?njia=email` keeps the old email-link reset, only for accounts created
 * before phone numbers that have not added one yet.
 */
export default function ForgotPassword() {
  const [params] = useSearchParams();
  return params.get('njia') === 'email' ? <EmailReset /> : <PhoneReset />;
}

function PhoneReset() {
  const setAuth = useStore(state => state.setAuth);
  const navigate = useNavigate();
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const resend = useResendTimer();
  const normalized = normalizeTzPhone(phone);

  // From the moment the code is verified there is a live session, but the new
  // password is not set yet. Keep the app from opening over this screen, and
  // drop that session if the person walks away before finishing.
  const releaseFlow = useRef<(() => void) | null>(null);
  const finished = useRef(false);
  useEffect(() => () => {
    if (releaseFlow.current && !finished.current) void signOutSafely();
    releaseFlow.current?.();
  }, []);

  const sendCode = async () => {
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: toE164(normalized!),
      options: { shouldCreateUser: false },
    });
    if (otpError) throw otpError;
    resend.start();
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!normalized) { setError(t('Namba ya simu si sahihi. Andika namba ya Tanzania, mfano 0712 345 678.')); return; }
    setLoading(true);
    try {
      await sendCode();
      setCode('');
      setStep('code');
    } catch (err) {
      console.error('Reset code error:', err);
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setLoading(true);
    try { await sendCode(); } catch (err) { setError(authErrorMessage(err)); } finally { setLoading(false); }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (!releaseFlow.current) releaseFlow.current = beginAuthFlow();
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ phone: toE164(normalized!), token: code, type: 'sms' });
      if (verifyError) throw verifyError;
      if (!data.session) throw new Error(t('Uthibitisho umeshindikana. Tafadhali jaribu tena.'));
      setStep('password');
    } catch (err) {
      console.error('Reset verify error:', err);
      setError(authErrorMessage(err));
      releaseFlow.current?.();
      releaseFlow.current = null;
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError(t('Nenosiri lazima liwe na angalau herufi 6.')); return; }
    if (password !== confirmPassword) { setError(t('Nenosiri ulizoingiza hazifanani.')); return; }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      // The password they typed is the one the account already has: nothing
      // to change, the SMS code already proved the number, so just sign in.
      if (updateError && updateError.code !== 'same_password') throw updateError;

      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error(t('Muda umeisha. Anza upya.'));
      const signedIn = await finishSignIn(data.session);

      finished.current = true;
      // Navigate BEFORE setting auth State so that component is mounted
      navigate(signedIn.target, { replace: true });
      setAuth(signedIn.token, signedIn.localUser, signedIn.refreshToken);
    } catch (err) {
      console.error('Set new password error:', err);
      setError(authErrorMessage(err, t('Kuna tatizo limetokea wakati wa kubadili nenosiri.')));
    } finally {
      setLoading(false);
    }
  };

  const back = (
    <Link to="/login" className="flex items-center justify-center text-sm text-gray-500 font-bold mt-6">
      <ArrowLeft className="w-4 h-4 mr-2" /> {t('Rudi Kwenye Login')}
    </Link>
  );

  if (step === 'password') {
    return (
      <AuthShell title={t('Nenosiri Jipya')} subtitle={t('Namba imethibitishwa. Weka nenosiri lako jipya.')} busy={loading}>
        <form onSubmit={handleSetPassword} className="space-y-4">
          <PasswordInput value={password} onChange={v => { setPassword(v); setError(''); }} placeholder={t('Nenosiri Jipya')} autoComplete="new-password" autoFocus />
          <PasswordInput value={confirmPassword} onChange={v => { setConfirmPassword(v); setError(''); }} placeholder={t('Thibitisha Nenosiri')} autoComplete="new-password" />
          <FormError text={error} />
          <SubmitButton busy={loading} disabled={!password || !confirmPassword}>{t('Hifadhi na Ingia')}</SubmitButton>
        </form>
      </AuthShell>
    );
  }

  if (step === 'code') {
    return (
      <AuthShell
        title={t('Nimesahau Nenosiri')}
        subtitle={<>{t('Tumetuma SMS yenye namba ya uthibitisho kwenda')} <b className="text-gray-800">{formatTzPhone(normalized)}</b>.</>}
        busy={loading}
      >
        <form onSubmit={handleVerify} className="space-y-4">
          <OtpInput value={code} onChange={v => { setCode(v); setError(''); }} />
          <FormError text={error} />
          <SubmitButton busy={loading} disabled={code.length !== OTP_LENGTH}>{t('Endelea')}</SubmitButton>
          <ResendCode left={resend.left} busy={loading} onResend={handleResend} />
          <button type="button" onClick={() => { setStep('phone'); setError(''); }} className="block w-full text-sm text-gray-500 font-bold mt-2">
            {t('Badilisha namba')}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('Nimesahau Nenosiri')}
      subtitle={t('Andika namba ya simu ya akaunti yako. Tutakutumia SMS yenye namba ya uthibitisho.')}
      busy={loading}
      footer={
        <>
          {back}
          <Link to="/forgot-password?njia=email" className="block mt-4 text-xs text-gray-500 underline">
            {t('Akaunti ya zamani isiyo na namba ya simu? Tumia barua pepe')}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSendCode} className="space-y-4">
        <PhoneInput value={phone} onChange={v => { setPhone(v); setError(''); }} autoFocus />
        <FormError text={error} />
        <SubmitButton busy={loading} disabled={!phone}>{t('Tuma Namba ya Uthibitisho')}</SubmitButton>
      </form>
    </AuthShell>
  );
}

/** The original email-link reset, for email accounts that have no number yet. */
function EmailReset() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: t('Tumekutumia barua pepe yenye maelekezo ya kubadili nenosiri lako. Tafadhali angalia email yako.')
      });
    } catch (err: any) {
      console.error('Reset password error:', err);
      setMessage({ type: 'error', text: authErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={t('Nimesahau Nenosiri')} subtitle={t('Ingiza barua pepe ya akaunti yako ya zamani ili kupokea link ya kubadili nenosiri.')} busy={loading}>
      {message?.type === 'success' ? (
        <div className="space-y-6">
          <div className="p-4 bg-green-50 border border-green-100 rounded-2xl text-green-700 text-sm flex items-start text-left">
            <CheckCircle className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
            <p>{message.text}</p>
          </div>
          <Link to="/login" className="block w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-md">
            {t('Rudi Kwenye Login')}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleResetRequest} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder={t('mfano@email.com')}
              required
            />
          </div>
          <FormError text={message?.type === 'error' ? message.text : null} />
          <SubmitButton busy={loading} disabled={!email}>{t('Tuma Link')}</SubmitButton>
          <Link to="/forgot-password" className="block text-xs text-gray-500 underline mt-4">
            {t('Tumia namba ya simu badala yake')}
          </Link>
          <Link to="/login" className="flex items-center justify-center text-sm text-gray-500 font-bold mt-6">
            <ArrowLeft className="w-4 h-4 mr-2" /> {t('Rudi Kwenye Login')}
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
