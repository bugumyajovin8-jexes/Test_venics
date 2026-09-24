/**
 * How this app reaches the shop hub. This app always runs in a browser; the
 * phone app's copy of this file adds a native route for its Android build.
 *
 * The hub is plain http on the shop's own wifi: a certificate for a private
 * address is either self-signed, which nothing accepts, or bought for a name
 * the shop does not own. Whether an app may talk plain http depends entirely
 * on where it runs:
 *
 *   Android app  The page lives at https://localhost inside the system
 *                WebView, and the WebView refuses any http request from an
 *                https page. So hub requests go through Capacitor's native HTTP
 *                instead, which those rules do not cover. Android's own rule
 *                against plain http is lifted for this app by the network
 *                security config that native/android/apply.mjs installs on
 *                every `cap sync`.
 *
 *   browser      Chrome lets an https page reach a device on the local network
 *                once the shop allows it — a one-time prompt. Nothing to do in
 *                code but make the request, and explain it when it was refused.
 *
 * Tested against a real Chrome (153): from an https origin the hub answers once
 * the local-network permission is granted, and not before.
 */
export interface HubRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Already JSON. */
  body?: string;
  timeoutMs: number;
}

export interface HubResponse {
  status: number;
  body: any;
}

export function hubTransportKind(): 'native' | 'web' {
  return 'web';
}

export function hubRequest(url: string, req: HubRequest): Promise<HubResponse> {
  return webRequest(url, req);
}

async function webRequest(url: string, req: HubRequest): Promise<HubResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    const res = await fetch(url, {
      method: req.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(req.headers ?? {}) },
      body: req.body,
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Has the shop let this page reach its network? Only a browser asks; the
 * Android app does not need to.
 *
 * Chrome keeps two permissions — one for this device (`localhost`) and one for
 * the rest of the local network — and older versions one for both. The first
 * name this Chrome recognises is the one that decides.
 */
export async function localNetworkPermission(url: string): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  const perms: any = typeof navigator !== 'undefined' ? (navigator as any).permissions : null;
  if (!perms?.query) return 'unknown';
  const onThisDevice = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
  const names = onThisDevice ? ['loopback-network', 'local-network-access'] : ['local-network', 'local-network-access'];
  for (const name of names) {
    try {
      return (await perms.query({ name })).state;
    } catch {
      /* not a permission this Chrome knows */
    }
  }
  return 'unknown';
}
