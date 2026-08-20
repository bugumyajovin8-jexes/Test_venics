/**
 * React view of read-only mode.
 *
 * The Dexie middleware is what actually stops writes; this hook exists so a
 * screen can look locked *before* the user commits an action, rather than
 * letting them fill in a form and fail at save. Use `guard` on the entry point
 * to a write flow — opening a modal, tapping checkout — not as a substitute for
 * the database guard.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { getReadOnlyState, showLockedSheet, subscribeReadOnly } from '../services/readOnly';

export function useReadOnly() {
  const locked = useSyncExternalStore(
    subscribeReadOnly,
    () => getReadOnlyState().locked,
  );

  /** Wraps a handler so a lapsed shop gets the explanation instead of the action. */
  const guard = useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (getReadOnlyState().locked) {
          showLockedSheet();
          return;
        }
        fn(...args);
      },
    [],
  );

  return {
    locked,
    guard,
    showLockedSheet,
    /**
     * Append to any write button's className to fade it out.
     *
     * Deliberately `grayscale` + `opacity` rather than swapping in a grey
     * background: it reads as disabled on every button in the app — orange,
     * emerald, red, blue — without each call site having to know its own
     * palette, and without a locked page looking like a different design.
     */
    lockedClass: locked ? 'opacity-50 grayscale' : '',
  };
}
