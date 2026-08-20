/**
 * The single explanation shown whenever a lapsed shop touches a write.
 *
 * It is raised by the Dexie guard itself rather than by each page, so every
 * blocked action anywhere in the app produces exactly this sheet — no per-screen
 * wording to drift, and nothing to forget to wire up on a new feature.
 *
 * Dismissible on purpose. The point of read-only mode is that the shop can still
 * read its own books, so the sheet explains and steps aside.
 */

import { useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clock, Lock, Phone, Wifi, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  SUPPORT_PHONE,
  getReadOnlyState,
  hideLockedSheet,
  subscribeReadOnly,
} from '../services/readOnly';
import type { LicenseStatus } from '../services/license';
import GhostClickGuard from './GhostClickGuard';

interface Copy {
  icon: LucideIcon;
  tone: string;
  title: string;
  /** Only the self-fixable states need a body — the rest is the call button. */
  body?: string;
  showCall: boolean;
}

/**
 * Two states are the shop's own to fix in seconds. Telling those users their
 * package expired sends them to the support line for a problem a sentence would
 * have solved, so they get an instruction instead — same sheet, same design.
 */
function copyFor(reason: LicenseStatus | null): Copy {
  switch (reason) {
    case 'SYNC_REQUIRED':
      return {
        icon: Wifi,
        tone: 'text-orange-500 bg-orange-50',
        title: 'Unganisha kwenye mtandao',
        body: 'Washa data au WiFi kwa sekunde chache ili mfumo uhakiki kifurushi chako, kisha utaendelea kama kawaida.',
        showCall: false,
      };
    case 'DATE_MANIPULATED':
      return {
        icon: Clock,
        tone: 'text-orange-500 bg-orange-50',
        title: 'Rekebisha tarehe ya simu',
        body: 'Tarehe na saa ya simu yako si sahihi. Irekebishe iwe ya sasa, kisha utaendelea kama kawaida.',
        showCall: false,
      };
    // A shop that has never held a licence — a second branch, or one still
    // awaiting provisioning. Telling them their package "expired" would be
    // simply untrue, and they would argue it on the phone.
    case 'NO_LICENSE':
      return {
        icon: Lock,
        tone: 'text-blue-600 bg-blue-50',
        title: 'Duka hili linahitaji kifurushi',
        showCall: true,
      };
    default:
      return {
        icon: Lock,
        tone: 'text-blue-600 bg-blue-50',
        title: 'Kifurushi chako kimeisha muda',
        showCall: true,
      };
  }
}

export default function LockedSheet() {
  const state = useSyncExternalStore(subscribeReadOnly, getReadOnlyState);

  const copy = copyFor(state.reason);
  const Icon = copy.icon;

  return (
    <AnimatePresence>
      {state.sheetOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={hideLockedSheet}
          className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-4"
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-sm rounded-[2rem] p-6 pb-8 shadow-2xl relative mb-safe"
          >
            {/* This sheet always opens FROM a tap, so the synthesized click that
                follows ~300ms later lands on the backdrop and closes it again —
                the sheet appeared to never open at all on the Uza buttons. */}
            <GhostClickGuard />
            <button
              onClick={hideLockedSheet}
              onPointerUp={hideLockedSheet}
              aria-label="Funga"
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 ${copy.tone}`}>
              <Icon className="w-7 h-7" />
            </div>

            <h2 className="text-xl font-black text-gray-900 leading-tight pr-8">{copy.title}</h2>

            {copy.body && (
              <p className="text-sm text-gray-500 leading-relaxed mt-2">{copy.body}</p>
            )}

            {copy.showCall && (
              <a
                href={`tel:${SUPPORT_PHONE}`}
                className="mt-6 bg-green-500 shadow-xl shadow-green-500/30 text-white px-6 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-all w-full cursor-pointer"
              >
                <Phone className="w-5 h-5" />
                Piga Simu
              </a>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
