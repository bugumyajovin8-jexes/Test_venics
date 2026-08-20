// Diagnostic endpoint: ZERO imports, ZERO logic. Should return {"ok":true}.
// If this 500s, the problem is the Vercel Node-function runtime/build for this
// project, not the session code.
export default function handler(_req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, ts: Date.now() }));
}
