/**
 * The explanation for people who never hit a locked button.
 *
 * A boss mostly reads: reports, history, employee performance. They can go a
 * whole session without attempting a single write, so the locked buttons and the
 * sheet never appear and the app just quietly stops being useful. This states
 * plainly what happened and what still works, on the page they land on.
 *
 * Renders nothing while the licence is healthy.
 */

import { useSyncExternalStore } from 'react';
import { Lock, Phone } from 'lucide-react';
import {
  SUPPORT_PHONE,
  getReadOnlyState,
  subscribeReadOnly,
} from '../services/readOnly';

export default function ReadOnlyNotice() {
  const state = useSyncExternalStore(subscribeReadOnly, getReadOnlyState);
  if (!state.locked) return null;

  const selfFixable = state.reason === 'SYNC_REQUIRED' || state.reason === 'DATE_MANIPULATED';
  if (selfFixable) return null; // the banner already tells them what to do

  const noLicence = state.reason === 'NO_LICENSE';

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-[2rem] p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0">
          <Lock className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-black text-blue-900 leading-tight">
            {noLicence ? 'Duka hili linahitaji kifurushi' : 'Kifurushi chako kimeisha muda'}
          </h3>
          <p className="text-xs text-blue-800/80 leading-relaxed mt-1.5">
            Unaweza kuendelea kuona ripoti, historia na taarifa zote za duka lako. Hata hivyo,
            kwa sasa huwezi kuuza, kuongeza bidhaa, wala kubadilisha chochote mpaka ulipie.
          </p>
          <p className="text-xs font-bold text-blue-900 mt-2">
            Taarifa zako zote zipo salama.
          </p>
        </div>
      </div>

      <a
        href={`tel:${SUPPORT_PHONE}`}
        className="bg-green-500 shadow-lg shadow-green-500/25 text-white px-5 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-all w-full"
      >
        <Phone className="w-4 h-4" />
        Piga Simu
      </a>
    </div>
  );
}
