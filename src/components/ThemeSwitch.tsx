/**
 * Mwonekano in Zaidi: light, dark, or as the computer is (utils/theme.ts).
 * Per device, like the language; the change shows at once, no reload.
 */
import { Monitor, Moon, Sun, SunMoon } from 'lucide-react';
import { setThemeChoice, useThemeChoice, type ThemeChoice } from '../utils/theme';
import { t } from '../i18n';

/** `compact`: the three choices only, side by side, for a settings row on Zaidi. */
export default function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const choice = useThemeChoice();
  const options: { id: ThemeChoice; label: string; Icon: typeof Sun }[] = [
    { id: 'light', label: t('Mwanga'), Icon: Sun },
    { id: 'dark', label: t('Giza'), Icon: Moon },
    { id: 'system', label: t('Kama kompyuta'), Icon: Monitor },
  ];
  if (compact) {
    return (
      <div role="radiogroup" aria-label={t('Mwonekano')} data-testid="theme-switch" className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 text-xs">
        {options.map(({ id, label, Icon }) => {
          const on = choice === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              data-theme-choice={id}
              onClick={() => setThemeChoice(id)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold transition-colors cursor-pointer select-none ${on ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <section data-tour="theme-section" className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3" data-testid="theme-switch">
      <div className="flex items-center min-w-0">
        <div className="bg-indigo-100 p-2 rounded-xl mr-3 shrink-0">
          <SunMoon className="w-6 h-6 text-indigo-600" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-800">{t('Mwonekano')}</h2>
          <p className="text-xs text-gray-500">{t('Mwanga, giza, au kama kompyuta yako ilivyo')}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('Mwonekano')}>
        {options.map(({ id, label, Icon }) => {
          const on = choice === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              data-theme-choice={id}
              onClick={() => setThemeChoice(id)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border-2 py-2.5 text-[13px] font-bold transition-colors cursor-pointer select-none ${
                on ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-100 bg-gray-50 text-gray-600'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
