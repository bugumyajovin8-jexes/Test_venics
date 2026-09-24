// Web/PWA durable session via a server-set HttpOnly cookie (see api/session/*).
// The Desktop app ships as an installable web PWA (Chrome on Windows, Safari on
// macOS/iOS). Safari's ITP wipes localStorage/IndexedDB after ~7 days of no use,
// which is why sessions expire; an HttpOnly cookie is exempt from that sweep and
// keeps the user logged in.

// Store/refresh the HttpOnly refresh cookie (called after login and on token refresh).
export async function saveWebSession(refreshToken: string | null | undefined): Promise<void> {
  if (!refreshToken) return;
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

// Remove the cookie (called on logout). Awaited by the caller so the cookie is
// gone before the post-logout page reload, preventing a silent auto-restore.
// Returns true only if the server confirmed the clear, so callers can decide
// whether it's safe to drop the durable "pending logout" marker.
export async function clearWebSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/session/clear', { method: 'POST', credentials: 'same-origin' });
    return res.ok;
  } catch {
    return false;
  }
}

// Synchronously wipe every local auth artifact — our own keys plus Supabase's persisted
// session (sb-<ref>-auth-token). Used on logout and on boot recovery so a stale or
// half-written token can never wedge the SDK or resurrect a previous user. No network.
export function purgeLocalAuth(): void {
  try {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_refresh_token');
    localStorage.removeItem('pos_user');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

// On startup, if local storage was evicted, exchange the cookie for a fresh session.
export async function restoreWebSession(): Promise<{ access_token: string; refresh_token: string } | null> {
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
