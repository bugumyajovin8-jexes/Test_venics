/**
 * Type-the-sentence confirmation for actions that cannot be undone.
 *
 * A yes/no dialog is the wrong shape for wiping a catalogue or a year of
 * history: "Ndiyo" sits exactly where the pointer already is, and one mistaken
 * click is indistinguishable from a decision. Making the shopkeeper copy out a
 * sentence costs a few seconds and makes the action impossible to perform by
 * accident.
 *
 * Paste is blocked and the sentence is not selectable, on purpose. The typing
 * IS the safeguard — if it can be copied off the screen above the field, this
 * becomes a two-click dialog with extra steps.
 *
 * Matching is case- and spacing-insensitive. Failing someone over "Nataka" vs
 * "nataka" would teach them the gate is broken rather than serious.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';

/** Exported so the rule can be tested directly rather than through a copy. */
export function normalizeConfirmText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function confirmTextMatches(typed: string, phrase: string): boolean {
  return normalizeConfirmText(typed) === normalizeConfirmText(phrase);
}

interface TypeToConfirmProps {
  open: boolean;
  title: string;
  /** The exact sentence the user must reproduce. */
  phrase: string;
  /** What is about to happen. Be specific and count things where possible. */
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export default function TypeToConfirm({
  open,
  title,
  phrase,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: TypeToConfirmProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A reopened dialog must start empty. Without this, cancelling with the
  // sentence already typed and reopening would present an armed button.
  useEffect(() => {
    if (open) {
      setValue('');
      setBusy(false);
      busyRef.current = false;
      // Focus is safe here (and expected on a desktop dialog) — the field is
      // the only thing to do in it.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const matches = confirmTextMatches(value, phrase);

  // Escape cancels. Deliberately not bound while busy: interrupting midway
  // would leave half the rows deleted with the dialog gone.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    if (!matches || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-start gap-3 p-6 pb-3">
          <div className="bg-red-100 p-3 rounded-full shrink-0">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div className="flex-1 min-w-0 pt-1.5">
            <h3 className="text-lg font-bold text-gray-900 leading-tight">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-full shrink-0 transition-colors"
            aria-label="Funga"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <div className="text-sm text-gray-600 leading-relaxed">{description}</div>

          <div>
            <p className="text-xs font-bold text-gray-700 mb-1.5">
              Ili kuendelea, andika sentensi hii:
            </p>
            <div className="bg-gray-100 border border-gray-200 rounded-lg px-3.5 py-2.5 select-none">
              <p className="text-[15px] font-bold text-gray-900 leading-snug">{phrase}</p>
            </div>
          </div>

          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            onPaste={e => e.preventDefault()}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="Andika hapa…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            className={`w-full px-3.5 py-2.5 rounded-lg border-2 text-[15px] font-semibold outline-none transition-colors ${
              value.length === 0
                ? 'border-gray-200 bg-white focus:border-gray-400'
                : matches
                  ? 'border-emerald-400 bg-emerald-50/50 text-emerald-900'
                  : 'border-amber-300 bg-amber-50/40 text-gray-900'
            }`}
          />

          {value.length > 0 && !matches && (
            <p className="text-[11.5px] text-amber-700 font-semibold -mt-2">
              Sentensi bado hailingani. Iandike kama ilivyo hapo juu.
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm transition-colors"
            >
              Ghairi
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!matches || busy}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-sm transition-colors ${
                matches && !busy
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? 'Inafuta…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
