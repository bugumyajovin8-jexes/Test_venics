import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Mail } from 'lucide-react';
import { SyncService } from '../services/sync';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { clearWebSession, purgeLocalAuth } from '../utils/webSession';
import { normalizeTzPhone, toE164, formatTzPhone } from '../utils/phone';
import { authErrorMessage, beginAuthFlow, finishSignIn, type SignedIn } from '../services/authFlow';
import {
  AuthShell, FormError, OtpInput, OTP_LENGTH, PasswordInput, PhoneInput, ResendCode, SubmitButton, useResendTimer,
} from '../components/auth/AuthFields';

import { t } from '../i18n';
/**
 * Sign in with phone number + password.
 *
 * Email sign-in remains only for accounts created before phone numbers: once
 * in, they are made to add a number (PhoneRequiredGate) and use it from then on.
 */
/**
 * If signing in never resolves, the Supabase auth client is wedged — a hung
 * request is holding its internal navigator.locks lock, so the call waits
 * forever (the "Inaingia..." freeze). Recover the way clearing site data
 * would: leave a message for after the reload, purge local auth + the cookie,
 * and hard-reload to a clean login. 20s is far past a normal login, so it
 * only fires on a real wedge.
 */
function startLoginWatchdog(): () => void {
  const timer = setTimeout(() => {
    try {
      localStorage.setItem('pos_auth_error', t('Kuna tatizo lililotokea wakati wa ku-Login. Tafadhali Login tena.'));
    } catch { /* ignore */ }
    purgeLocalAuth();
    void clearWebSession();
    window.location.reload();
  }, 20000);
  return () => clearTimeout(timer);
}

export default function Login() {
  const setAuth = useStore(state => state.setAuth);
  const authError = useStore(state => state.authError);
  const navigate = useNavigate();
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [step, setStep] = useState<'credentials' | 'verify'>('credentials');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const resend = useResendTimer();

  const displayError = error || authError;
  const normalized = normalizeTzPhone(phone);

  // Dynamic cookie lifecycle: the durable HttpOnly session cookie exists only while a user is
  // logged IN. Whenever the login screen is shown, wipe it — so no stale or previous-user session
  // can linger or be auto-restored. A legitimate returning user never reaches this screen (the
  // boot restore logs them in first, keeping their cookie); logout, an interrupted/cancelled
  // logout recovered at boot, a second user, and a fresh login all pass through here, so every one
  // of those ends with the cookie gone. Clearing an HttpOnly cookie is server-side only, so this
  // hits /api/session/clear (no auth events → no logout-screen loop). Signing in below
  // re-creates the cookie for the new user on success.
  useEffect(() => {
    void clearWebSession();
  }, []);

  const enter = (signedIn: SignedIn, method: 'phone' | 'email') => {
    // Navigate BEFORE setting auth State so that component is mounted
    navigate(signedIn.target, { replace: true });
    setAuth(signedIn.token, signedIn.localUser, signedIn.refreshToken);
    if (signedIn.localUser.shop_id) {
      setTimeout(() => { SyncService.logAction('login', { method, platform: 'web' }); }, 500);
    }
    SyncService.sync().catch(err => console.error('Login sync failed:', err));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'phone' && !normalized) {
      setError(t('Namba ya simu si sahihi. Andika namba ya Tanzania, mfano 0712 345 678.'));
      return;
    }
    setLoading(true);
    const release = beginAuthFlow();
    const stopWatchdog = startLoginWatchdog();
    try {
      const { data, error: signInError } = mode === 'phone'
        ? await supabase.auth.signInWithPassword({ phone: toE164(normalized!), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });

      if (signInError) {
        // Signed up but never entered the SMS code: send a fresh one and finish here.
        if (mode === 'phone' && (signInError.code === 'phone_not_confirmed' || /Phone not confirmed/i.test(signInError.message))) {
          const { error: resendError } = await supabase.auth.resend({ type: 'sms', phone: toE164(normalized!) });
          if (resendError) throw resendError;
          resend.start();
          setCode('');
          setStep('verify');
          return;
        }
        throw signInError;
      }
      if (!data.session) throw new Error(t('Kushindwa kuingia: Mtumiaji hakupatikana.'));

      enter(await finishSignIn(data.session), mode);
    } catch (err: any) {
      console.error('Login error details:', err);
      setError(authErrorMessage(err, t('Kuna tatizo limetokea wakati wa kuingia')));
      setPassword('');
    } finally {
      stopWatchdog();
      release();
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const release = beginAuthFlow();
    const stopWatchdog = startLoginWatchdog();
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ phone: toE164(normalized!), token: code, type: 'sms' });
      if (verifyError) throw verifyError;
      if (!data.session) throw new Error(t('Kushindwa kuingia. Tafadhali jaribu tena.'));
      enter(await finishSignIn(data.session), 'phone');
    } catch (err: any) {
      console.error('Verify error:', err);
      setError(authErrorMessage(err));
    } finally {
      stopWatchdog();
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
        subtitle={<>{t('Tumetuma SMS yenye namba ya uthibitisho kwenda')} <b className="text-gray-800">{formatTzPhone(normalized)}</b>.</>}
        busy={loading}
      >
        <form onSubmit={handleVerify} className="space-y-4">
          <OtpInput value={code} onChange={v => { setCode(v); setError(''); }} />
          <FormError text={error} />
          <SubmitButton busy={loading} disabled={code.length !== OTP_LENGTH}>{t('Thibitisha na Ingia')}</SubmitButton>
          <ResendCode left={resend.left} busy={loading} onResend={handleResend} />
          <button type="button" onClick={() => { setStep('credentials'); setError(''); }} className="block w-full text-sm text-gray-500 font-bold mt-2">
            {t('Rudi nyuma')}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('Venics Sales')}
      subtitle={t('Karibu kwenye mfumo wako wa uuzaji bora na salama.')}
      busy={loading}
      footer={
        <>
          <div className="mt-6 text-sm text-gray-600">
            {t('Huna akaunti?')}{' '}
            <Link to="/register" className="text-blue-600 font-bold">{t('Jisajili hapa')}</Link>
          </div>
          <button
            type="button"
            onClick={() => { setMode(mode === 'phone' ? 'email' : 'phone'); setError(''); setPassword(''); }}
            className="mt-4 text-xs text-gray-500 underline"
          >
            {mode === 'phone'
              ? t('Akaunti yako ya zamani ni ya barua pepe? Ingia kwa barua pepe')
              : t('Ingia kwa namba ya simu')}
          </button>
        </>
      }
    >
      <form onSubmit={handleLogin} className="space-y-4">
        {mode === 'phone' ? (
          <PhoneInput value={phone} onChange={v => { setPhone(v); setError(''); }} />
        ) : (
          <>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3 text-left">
              {t('Baada ya kuingia, utaombwa kuongeza namba yako ya simu. Kuanzia hapo utaingia kwa namba hiyo.')}
            </p>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900 placeholder:text-gray-400"
                placeholder={t('Barua pepe (Email)')}
                autoComplete="email"
                required
              />
            </div>
          </>
        )}

        <PasswordInput value={password} onChange={v => { setPassword(v); setError(''); }} />

        <div className="flex justify-end">
          <Link
            to={mode === 'email' ? '/forgot-password?njia=email' : '/forgot-password'}
            className="text-xs font-bold text-blue-600"
          >
            {t('Nimesahau nenosiri?')}
          </Link>
        </div>

        <FormError text={displayError} />

        <SubmitButton busy={loading} disabled={!(mode === 'phone' ? phone : email) || !password}>{t('Ingia')}</SubmitButton>
      </form>
    </AuthShell>
  );
}
