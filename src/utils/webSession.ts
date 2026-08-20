import { Capacitor } from '@capacitor/core';

// Web/PWA-only durable session via a server-set HttpOnly cookie (see api/session/*).
// On native the app uses Capacitor Preferences instead, and there is no first-party
// /api origin, so these are no-ops there.

const isNative = Capacitor.isNativePlatform();

// Store/refresh the HttpOnly refresh cookie (called after login and on token refresh).
export async function saveWebSession(refreshToken: string | null | undefined): Promise<void> {
  if (isNative || !refreshToken) return;
  try {
    await fetch('/api/session/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    /* offline / no endpoint — ignore */
  }
}

// Remove the cookie (called on logout).
export async function clearWebSession(): Promise<void> {
  if (isNative) return;
  try {
    await fetch('/api/session/clear', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* ignore */
  }
}

// On startup, if local storage was evicted, exchange the cookie for a fresh session.
export async function restoreWebSession(): Promise<{ access_token: string; refresh_token: string } | null> {
  if (isNative) return null;
  try {
    const res = await fetch('/api/session/restore', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.access_token && data?.refresh_token) {
      return { access_token: data.access_token, refresh_token: data.refresh_token };
    }
    return null;
  } catch {
    return null;
  }
}
