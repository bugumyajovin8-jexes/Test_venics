// Diagnostic endpoint: ZERO imports, ZERO logic.
// If GET /api/session/ping also returns 500 FUNCTION_INVOCATION_FAILED, the problem
// is the Vercel Node-function runtime/build for this project (not our session code).
// If it returns {"ok":true} but /api/session/restore 500s, the problem is specific to
// that function (its imports/logic).
export default function handler(_req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, ts: Date.now() }));
}
