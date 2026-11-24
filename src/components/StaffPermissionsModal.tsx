/**
 * Every staff permission in one place, opened from the gear on Ripoti za
 * Wafanyakazi.
 *
 * The same five switches as the Wafanyakazi section of Zaidi (the list is
 * staff/staffPermissions.ts): every one reads "Ruhusu…" and ON means allowed,
 * as on the phones. The two stored as restrictions (hide stock, block
 * Historia) are turned round there.
 *
 * Toggling writes through `SyncService.toggleFeature`, which updates the local
 * row, the in-memory map and pushes that single row immediately — so the other
 * devices in the shop pick it up on their next pull rather than in 5–15
 * minutes.
 *
 * Boss only. The gear is not rendered for anyone else, and `toggleFeature`
 * would be refused by RLS regardless.
 */

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Loader2, ShieldCheck } from 'lucide-react';
import { useStore } from '../store';
import { db } from '../db';
import { staffPermissions, storedFlag, isAllowed, setAllowed, TONE, type StaffPermission } from './staff/staffPermissions';

import { t } from '../i18n';

export default function StaffPermissionsModal({ onClose }: { onClose: () => void }) {
  const features = useStore(s => s.features);
  const settings = useLiveQuery(() => db.settings.get(1));
  const [busy, setBusy] = useState<string | null>(null);

  // Escape closes, as a desktop dialog should. Not bound while a write is in
  // flight: closing mid-toggle would hide the spinner, not cancel the write.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const close = onClose;

  const toggle = async (p: StaffPermission) => {
    if (busy) return;
    setBusy(p.key);
    try {
      await setAllowed(p, !isAllowed(p, storedFlag(p, features, settings)));
    } catch (err) {
      console.error('[StaffPermissions] toggle failed:', err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl max-h-[88vh] flex flex-col animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="bg-green-100 p-2 rounded-xl shrink-0">
              <ShieldCheck className="w-5 h-5 text-green-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900 leading-tight">{t('Ruhusa za Wafanyakazi')}</h2>
              <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{t('Zinatumika kwenye kompyuta na simu zote za biashara')}</p>
            </div>
          </div>
          <button
            onClick={close}
            className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
            aria-label={t('Funga')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {staffPermissions().map(row => {
            const on = isAllowed(row, storedFlag(row, features, settings));
            const Icon = row.icon;
            const working = busy === row.key;
            const [wrap, title, detail, knob] = TONE[row.tone];
            const accent = { wrap, icon: detail, title, detail, knob };

            return (
              <div key={row.key} className={`flex items-center justify-between gap-3 p-4 rounded-2xl border ${accent.wrap}`}>
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${accent.icon}`} />
                  <div className="min-w-0">
                    <h3 className={`text-sm font-bold leading-snug ${accent.title}`}>{row.title}</h3>
                    <p className={`text-[10px] leading-snug mt-0.5 ${accent.detail}`}>{row.detail}</p>
                  </div>
                </div>

                <button
                  onClick={() => { void toggle(row); }}
                  disabled={working}
                  className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${on ? accent.knob : 'bg-gray-300'}`}
                  aria-pressed={on}
                >
                  {working
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white absolute top-1.25 left-4" />
                    : <div className={`absolute top-1 w-4 h-4 bg-white knob rounded-full transition-all ${on ? 'left-7' : 'left-1'}`} />}
                </button>
              </div>
            );
          })}

          <p className="text-[11px] text-gray-400 leading-snug px-1 pt-1">
            {t('Mabadiliko haya yanahifadhiwa mtandaoni na yatafika kwenye simu na kompyuta nyingine za biashara yako zitakaposawazisha.')}
          </p>
        </div>
      </div>
    </div>
  );
}
