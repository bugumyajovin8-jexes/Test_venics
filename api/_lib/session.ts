// Shared logic for the HttpOnly cookie session endpoints.
// Used by both the Vercel serverless functions (prod) and the Express dev server.
//
// The cookie holds the Supabase refresh token as an HttpOnly, Secure, SameSite=Lax
// first-party cookie. Server-set first-party cookies are NOT subject to Safari/iOS
// ITP's 7-day script-storage cap, so the session survives long inactivity on an
// installed iOS PWA (which localStorage/IndexedDB do not).

export const REFRESH_COOKIE = 'pos_rt';
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60; // 400 days (Chrome's cookie cap)

// Public values (same as the client bundle). Overridable via server env vars.
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rdprkqfxznajegttfsbg.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkcHJrcWZ4em5hamVndHRmc2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjkzOTYsImV4cCI6MjA5MDQ0NTM5Nn0.yX-vvx3WDNYCNDTx1GGecxYAs2IVZ_5_aLEMdfjLpYE';

// Cookies can only be Secure over HTTPS. Local dev (http://localhost) must omit it,
// or the browser silently drops the cookie.
export function isSecureRequest(headers: Record<string, unknown>): boolean {
  const host = String(headers['host'] || '');
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return false;
  const proto = headers['x-forwarded-proto'];
  return proto === undefined || proto === 'https';
}

export function buildSetCookie(refreshToken: string, secure: boolean): string {
  const attrs = [
    `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function buildClearCookie(secure: boolean): string {
  const attrs = [`${REFRESH_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

// Exchange a refresh token for a fresh session via Supabase's token endpoint.
// Returns the session (with a rotated refresh_token) or null if the token is invalid.
export async function refreshSupabaseSession(
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number; expires_at?: number } | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    if (!data?.access_token || !data?.refresh_token) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: data.expires_at,
    };
  } catch {
    return null;
  }
}
