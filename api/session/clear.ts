// Fully self-contained (NO imports) so nothing needs to be bundled/traced by Vercel.
// POST /api/session/clear — removes the refresh cookie (called on logout).

const REFRESH_COOKIE = 'pos_rt';

function isSecure(headers: any): boolean {
  const host = String((headers && headers.host) || '');
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return false;
  const proto = headers && headers['x-forwarded-proto'];
  return proto === undefined || proto === 'https';
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

export default function handler(req: any, res: any) {
  try {
    const secure = isSecure((req && req.headers) || {});
    const a = [`${REFRESH_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
    if (secure) a.push('Secure');
    send(res, 200, { ok: true }, a.join('; '));
  } catch (e: any) {
    send(res, 500, { error: 'clear_failed', message: String((e && e.message) || e) });
  }
}
