/**
 * "Chagua lugha · Choose your language" — asked once on each computer.
 *
 * English is new, and its switch sits in Usimamizi na Zaidi (and, before
 * signing in, at the top of the sign-in screens), where few will look for it.
 * So the first time the app opens on a computer where nobody has picked a
 * language — a new one, or a till signed in long before English came — it
 * asks. In both languages at once, because the reader may read only one of
 * them. One tap, and never again on this computer; Kiswahili stays the
 * default.
 */

import { useState } from 'react';
import { Globe } from 'lucide-react';
import { langChosen, setLang, type Lang } from '../i18n';

export default function LanguageChooser({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(() => !langChosen());
  if (!open) return null;

  const choose = (lang: Lang) => {
    setLang(lang);
    setOpen(false);
  };

  // i18n-ignore-start — shown in both languages at once, whichever the app is in.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="language-chooser-title"
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-slate-900/60 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <Globe className="h-6 w-6" aria-hidden="true" />
        </div>
        {signedIn && (
          <span className="mb-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            Mpya · New
          </span>
        )}
        <h2 id="language-chooser-title" className="text-xl font-extrabold leading-tight text-gray-900">Chagua lugha</h2>
        <p className="text-sm font-semibold text-gray-500">Choose your language</p>
        <p className="mt-3 text-xs leading-snug text-gray-600">
          {signedIn ? 'Venics Sales sasa inapatikana kwa Kiingereza pia.' : 'Venics Sales inapatikana kwa Kiswahili na Kiingereza.'}
          <br />
          <span className="text-gray-500">
            {signedIn ? 'Venics Sales is now available in English too.' : 'Venics Sales is available in Swahili and English.'}
          </span>
        </p>
        <div className="mt-5 grid gap-2">
          <button
            type="button"
            onClick={() => choose('sw')}
            data-testid="choose-sw"
            className="w-full cursor-pointer rounded-2xl bg-blue-600 py-3.5 text-base font-bold text-white transition-all active:scale-95"
          >
            Kiswahili
          </button>
          <button
            type="button"
            onClick={() => choose('en')}
            data-testid="choose-en"
            className="w-full cursor-pointer rounded-2xl border-2 border-gray-200 bg-white py-3.5 text-base font-bold text-gray-800 transition-all active:scale-95"
          >
            English
          </button>
        </div>
        <p className="mt-4 text-[11px] leading-snug text-gray-500">
          Unaweza kubadilisha wakati wowote: Usimamizi na Zaidi → Lugha.
          <br />
          You can change it any time: Management and More → Language.
        </p>
      </div>
    </div>
  );
  // i18n-ignore-end
}
