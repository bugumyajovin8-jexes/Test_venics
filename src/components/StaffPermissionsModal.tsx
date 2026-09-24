/**
 * Every staff permission in one place, opened from the gear on Ripoti za
 * Wafanyakazi.
 *
 * The three "ruhusu" toggles already existed in Zaidi and are unchanged — this
 * is a second door to the same switches, next to the reports where a boss is
 * actually thinking about what their staff can do. The two "zuia/ficha"
 * restrictions are new here: they used to be Desktop-only device settings and
 * are now shop-wide, synced, and enforced on phones too.
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
import { X, Package, Wallet, TrendingUp, EyeOff, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { useStore } from '../store';
import { SyncService } from '../services/sync';
import { HIDE_STOCK_KEY, BLOCK_HISTORIA_KEY } from '../hooks/useStaffRestrictions';

type Row = {
  key: string;
  title: string;
  detail: string;
  icon: typeof Package;
  /** Green reads "staff may"; amber reads "staff may not". */
  tone: 'allow' | 'restrict';
};

const ROWS: Row[] = [
  {
    key: 'staff_product_management',
    title: 'Ruhusu Wafanyakazi Kuongeza Bidhaa',
    detail: 'Wataweza kuongeza, kuhariri na kuingiza bidhaa kwa Excel.',
    icon: Package,
    tone: 'allow',
  },
  {
    key: 'staff_expense_management',
    title: 'Ruhusu Wafanyakazi Kuona/Kuongeza Matumizi',
    detail: 'Wataweza kuona na kuongeza matumizi ya biashara.',
    icon: Wallet,
    tone: 'allow',
  },
  {
    key: 'show_mapato_to_staff',
    title: 'Ruhusu Wafanyakazi Kuona Mapato',
    detail: 'Wataona mapato na mauzo yote kwenye Dashibodi na Historia.',
    icon: TrendingUp,
    tone: 'allow',
  },
  {
    key: HIDE_STOCK_KEY,
    title: 'Ficha Idadi ya Bidhaa kwa Wafanyakazi',
    detail: 'Hawataona idadi iliyobaki stoo popote — Bidhaa, Kikapu, Dashibodi wala Historia.',
    icon: EyeOff,
    tone: 'restrict',
  },
  {
    key: BLOCK_HISTORIA_KEY,
    title: 'Zuia Wafanyakazi Kuona Historia',
    detail: 'Ukurasa wa Historia hautaonekana, na hawataweza kuufikia hata kwa njia nyingine.',
    icon: Clock,
    tone: 'restrict',
  },
];

export default function StaffPermissionsModal({ onClose }: { onClose: () => void }) {
  const { isFeatureEnabled } = useStore();
  const [busy, setBusy] = useState<string | null>(null);

  // Escape closes, as a desktop dialog should. Not bound while a write is in
  // flight: closing mid-toggle would hide the spinner, not cancel the write.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const close = onClose;

  const toggle = async (key: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await SyncService.toggleFeature(key, !isFeatureEnabled(key));
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
              <h2 className="text-base font-bold text-gray-900 leading-tight">Ruhusa za Wafanyakazi</h2>
              <p className="text-[11px] text-gray-500 leading-tight mt-0.5">Zinatumika kwenye kompyuta na simu zote za biashara</p>
            </div>
          </div>
          <button
            onClick={close}
            className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Funga"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {ROWS.map(row => {
            const on = isFeatureEnabled(row.key);
            const Icon = row.icon;
            const working = busy === row.key;
            const accent = row.tone === 'allow'
              ? { wrap: 'bg-blue-50 border-blue-100', icon: 'text-blue-600', title: 'text-blue-900', detail: 'text-blue-700', knob: 'bg-blue-600' }
              : { wrap: 'bg-amber-50 border-amber-100', icon: 'text-amber-600', title: 'text-amber-900', detail: 'text-amber-700', knob: 'bg-amber-600' };

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
                  onClick={() => { void toggle(row.key); }}
                  disabled={working}
                  className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${on ? accent.knob : 'bg-gray-300'}`}
                  aria-pressed={on}
                >
                  {working
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white absolute top-1.25 left-4" />
                    : <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${on ? 'left-7' : 'left-1'}`} />}
                </button>
              </div>
            );
          })}

          <p className="text-[11px] text-gray-400 leading-snug px-1 pt-1">
            Mabadiliko haya yanahifadhiwa mtandaoni na yatafika kwenye simu na kompyuta
            nyingine za biashara yako zitakaposawazisha.
          </p>
        </div>
      </div>
    </div>
  );
}
