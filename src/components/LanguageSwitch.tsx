/**
 * Kiswahili | English — the app's language on this device.
 *
 * Each option is written in its own language, so someone who reads only one
 * of them can still find it. Choosing reloads the app in that language (see
 * i18n/index.ts).
 */

import { Globe } from 'lucide-react';
import { getLang, setLang, type Lang } from '../i18n';

const OPTIONS: { lang: Lang; label: string }[] = [
  { lang: 'sw', label: 'Kiswahili' },
  { lang: 'en', label: 'English' },
];

export default function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const current = getLang();
  return (
    <div
      role="radiogroup"
      aria-label="Lugha / Language"
      className={`inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 ${compact ? 'text-xs' : 'text-sm'}`}
    >
      <Globe className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-gray-400 ml-1.5 mr-0.5 shrink-0`} aria-hidden="true" />
      {OPTIONS.map(o => {
        const on = o.lang === current;
        return (
          <button
            key={o.lang}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setLang(o.lang)}
            className={`rounded-lg font-bold transition-colors cursor-pointer ${compact ? 'px-2.5 py-1' : 'px-3 py-1.5'} ${
              on ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
