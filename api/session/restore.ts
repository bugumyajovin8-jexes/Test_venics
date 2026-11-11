// Fully self-contained (NO imports) so nothing needs to be bundled/traced by Vercel.
// POST/GET /api/session/restore — exchanges the HttpOnly refresh cookie for a fresh
// Supabase session, rotates the cookie, and returns the session.

const REFRESH_COOKIE = 'pos_rt';
const MAX_AGE = 400 * 24 * 60 * 60; // 400 days

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rdprkqfxznajegttfsbg.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkcHJrcWZ4em5hamVndHRmc2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjkzOTYsImV4cCI6MjA5MDQ0NTM5Nn0.yX-vvx3WDNYCNDTx1GGecxYAs2IVZ_5_aLEMdfjLpYE';

function isSecure(headers: any): boolean {
  const host = String((headers && headers.host) || '');
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return false;
  const proto = headers && headers['x-forwarded-proto'];
  return proto === undefined || proto === 'https';
}

function cookieStr(value: string, secure: boolean, maxAge: number): string {
  const a = [`${REFRESH_COOKIE}=${encodeURIComponent(value)}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) a.push('Secure');
  return a.join('; ');
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function send(res: any, status: number, body: unknown, setCookie?: string): void {
  try {
    if (setCookie) res.setHeader('Set-Cookie', setCookie);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(JSON.stringify(body));
  } catch {
    /* ignore */
  }
}

export default async function handler(req: any, res: any) {
  try {
    const headers = (req && req.headers) || {};
    const secure = isSecure(headers);
    const token = readCookie(headers.cookie, REFRESH_COOKIE);
    if (!token) {
      send(res, 401, { error: 'No session' });
      return;
    }

    const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ refresh_token: token }),
    });

    if (!resp.ok) {
      send(res, 401, { error: 'Invalid session' }, cookieStr('', secure, 0));
      return;
    }
    const data: any = await resp.json();
    if (!data || !data.access_token || !data.refresh_token) {
      send(res, 401, { error: 'Invalid session' }, cookieStr('', secure, 0));
      return;
    }

    send(
      res,
      200,
      {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: data.expires_at,
      },
      cookieStr(data.refresh_token, secure, MAX_AGE),
    );
  } catch (e: any) {
    send(res, 500, { error: 'restore_failed', message: String((e && e.message) || e) });
  }
}
