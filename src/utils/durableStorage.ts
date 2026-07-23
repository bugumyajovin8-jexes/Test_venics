import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

// -----------------------------------------------------------------------------
// Durable auth storage.
//
// Browsers/WebViews evict localStorage after ~7 days of no interaction (Safari
// ITP) or under storage pressure (Chrome/Android), which wipes the Supabase
// session and logs the user out. Native apps (Bolt etc.) keep tokens in OS
// storage that is never evicted.
//
// We keep localStorage as the fast, synchronous working store, but MIRROR the
// auth keys into native Preferences (durable) and REHYDRATE localStorage from
// Preferences on startup — so the session survives eviction like a native app.
// On web (no native Preferences), this is a no-op; durability there comes from
// navigator.storage.persist() + being an installed PWA.
// -----------------------------------------------------------------------------

const isNative = Capacitor.isNativePlatform();

// Write to localStorage (sync, for immediate use) and mirror to native Preferences.
export function setDurable(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  if (isNative) {
    void Preferences.set({ key, value }).catch(() => {});
  }
}

export function removeDurable(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  if (isNative) {
    void Preferences.remove({ key }).catch(() => {});
  }
}

// Storage adapter handed to the Supabase client: synchronous localStorage reads/
// writes plus a durable native mirror on every write.
export const supabaseAuthStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => setDurable(key, value),
  removeItem: (key: string): void => removeDurable(key),
};

// Startup: if the browser evicted localStorage but native Preferences still holds
// the auth keys, copy them back so Supabase and the store find the session again.
// MUST run before the Supabase client / store read storage (see main.tsx).
export async function hydrateDurableAuth(): Promise<void> {
  if (!isNative) return;
  try {
    const { keys } = await Preferences.keys();
    const authKeys = keys.filter(
      (k) => k === 'pos_token' || k === 'pos_refresh_token' || k === 'pos_user' || k.startsWith('sb-')
    );
    for (const key of authKeys) {
      if (localStorage.getItem(key) == null) {
        const { value } = await Preferences.get({ key });
        if (value != null) {
          try {
            localStorage.setItem(key, value);
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch (e) {
    console.warn('[durableStorage] hydrate failed', e);
  }
}

// Ask the browser/WebView not to evict our storage under pressure. Installed PWAs
// are usually granted this automatically.
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!already) await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
}
