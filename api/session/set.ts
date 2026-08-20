// Fully self-contained (NO imports) so nothing needs to be bundled/traced by Vercel.
// POST /api/session/set { refresh_token } — stores the refresh token in a long-lived
// HttpOnly cookie.

const REFRESH_COOKIE = 'pos_rt';
const MAX_AGE = 400 * 24 * 60 * 60; // 400 days

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

async function readJsonBody(req: any): Promise<any> {
  if (req && req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve) => {
    try {
      let raw = '';
      req.on('data', (c: any) => { raw += c; });
      req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    } catch {
      resolve({});
    }
  });
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
    if (req.method !== 'POST') {
      send(res, 405, { error: 'Method not allowed' });
      return;
    }
    const body = await readJsonBody(req);
    const refreshToken = body && body.refresh_token;
    if (!refreshToken || typeof refreshToken !== 'string') {
      send(res, 400, { error: 'Missing refresh_token' });
      return;
    }
    send(res, 200, { ok: true }, cookieStr(refreshToken, isSecure((req && req.headers) || {}), MAX_AGE));
  } catch (e: any) {
    send(res, 500, { error: 'set_failed', message: String((e && e.message) || e) });
  }
}
