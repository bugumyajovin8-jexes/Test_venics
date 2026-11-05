import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Lock, Phone, ShieldCheck } from 'lucide-react';
import VenicsLogo from '../VenicsLogo';
import LanguageSwitch from '../LanguageSwitch';

import { t } from '../../i18n';
/** The card every sign-in screen sits in. */
export function AuthShell({ title, subtitle, busy, children, footer }: {
  title: string;
  subtitle?: ReactNode;
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      {/* Before signing in, so the whole sign-in can be read in English. */}
      <div className="w-full max-w-sm flex justify-end mb-3">
        <LanguageSwitch compact />
      </div>
      <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-sm text-center">
        <div className="mb-6 flex justify-center">
          <VenicsLogo size={80} animate={busy ? 'loading' : 'idle'} outerGradient={['#1e3a8a', '#06b6d4']} innerGradient={['#0891b2', '#1e40af']} />
        </div>
        <h1 className="text-2xl font-extrabold text-blue-700 tracking-tight mb-2 font-sans">{title}</h1>
        {subtitle && <p className="text-gray-500 mb-8 text-sm font-medium">{subtitle}</p>}
        {children}
        {footer}
      </div>
      <p className="mt-6 text-xs text-gray-500 text-center">{t('Made by Venics Software Company')}</p>
    </div>
  );
}

const fieldClass =
  'w-full pl-12 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900 placeholder:text-gray-400';

export function PhoneInput({ value, onChange, autoFocus, disabled }: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^\d+\s-]/g, ''))}
        className={`${fieldClass} pr-4`}
        placeholder={t('Namba ya simu (mf. 0712 345 678)')}
        autoFocus={autoFocus}
        disabled={disabled}
        required
      />
    </div>
  );
}

export function PasswordInput({ value, onChange, placeholder = t('Nenosiri (Password)'), autoComplete = 'current-password', autoFocus }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${fieldClass} pr-12`}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
        aria-label={show ? t('Ficha nenosiri') : t('Onyesha nenosiri')}
      >
        {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
      </button>
    </div>
  );
}

export const OTP_LENGTH = 6;

export function OtpInput({ value, onChange, autoFocus = true }: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={OTP_LENGTH}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
        className={`${fieldClass} pr-4 text-center text-2xl font-bold tracking-[0.5em]`}
        placeholder="••••••"
        aria-label={t('Namba ya uthibitisho')}
        autoFocus={autoFocus}
        required
      />
    </div>
  );
}

/** Seconds until another code may be requested (Supabase allows one a minute). */
export function useResendTimer(seconds = 60) {
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = () => {
    setLeft(seconds);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setLeft(s => {
        if (s <= 1 && timer.current) { clearInterval(timer.current); timer.current = null; }
        return Math.max(0, s - 1);
      });
    }, 1000);
  };

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  return { left, start };
}

export function ResendCode({ left, busy, onResend }: { left: number; busy?: boolean; onResend: () => void }) {
  return (
    <div className="space-y-1">
      {/* Each new code replaces the last one, and SMS can arrive late. */}
      <p className="text-xs text-gray-400">{t('SMS inaweza kuchelewa kidogo. Ukiomba namba nyingine, tumia ile ya mwisho.')}</p>
      {left > 0 ? (
        <p className="text-xs text-gray-500">{t('Hujapata SMS? Unaweza kuomba tena baada ya sekunde {left}.', { left })}</p>
      ) : (
        <button type="button" disabled={busy} onClick={onResend} className="text-xs font-bold text-blue-600 disabled:text-gray-400">
          {t('Hujapata SMS? Tuma tena')}
        </button>
      )}
    </div>
  );
}

export function FormError({ text }: { text?: string | null }) {
  return text ? <p className="text-red-500 text-sm mt-2">{text}</p> : null;
}

export function SubmitButton({ busy, disabled, children }: { busy?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled || busy}
      className="w-full bg-blue-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-md transition-colors mt-4 flex items-center justify-center gap-2"
    >
      {busy && <VenicsLogo size={20} animate="loading" outerGradient={['#ffffff', '#06b6d4']} innerGradient={['#22d3ee', '#ffffff']} />}
      {busy ? t('Inapakia...') : children}
    </button>
  );
}
