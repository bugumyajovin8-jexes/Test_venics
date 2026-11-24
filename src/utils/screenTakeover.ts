/**
 * "A full-screen child has taken the screen over."
 *
 * The notification bell is `position: fixed` in the top-right corner and is
 * mounted once, in App.tsx, for the whole app. It already limits itself to the
 * Executive Dashboard — but Ripoti za Wafanyakazi is not a route: it is rendered
 * *inside* ExecutiveDashboard, replacing its content while the URL stays on
 * /executive. So the bell stayed up and floated over that screen's own
 * top-right control, the permissions gear, and sat on top of it.
 *
 * The bell and the screen are siblings, not parent and child (App.tsx mounts
 * the bell; ExecutiveDashboard mounts the screen), so this is the signal
 * between them.
 *
 * Ref-counted rather than a boolean: two takeovers could overlap during a
 * transition, and StrictMode deliberately mounts, unmounts and remounts effects
 * in development. A boolean would be left stuck off by whichever one unmounted
 * first; a count cannot be.
 */

import { useEffect, useSyncExternalStore } from 'react';

let takeovers = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(l => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return takeovers > 0;
}

/**
 * Call from a screen that covers the viewport and owns its own header
 * controls. The claim is released automatically when the screen unmounts.
 */
export function useScreenTakeover(): void {
  useEffect(() => {
    takeovers++;
    emit();
    return () => {
      takeovers--;
      emit();
    };
  }, []);
}

/** True while any such screen is up. */
export function useIsScreenTakeover(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
