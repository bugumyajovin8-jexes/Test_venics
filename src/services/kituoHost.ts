/**
 * The shop hub on THIS computer: Venics Kituo cha Duka, a small program with
 * no window that the boss downloads from the Kituo cha Duka card ("Windows
 * app" folder: src/kituo-main.mjs). A web page cannot run a server, so the hub
 * needs a program; everything about it is shown on the card, and this file
 * talks to it on 127.0.0.1:8789. It answers this website only.
 */

export const KITUO_CONTROL = 'http://127.0.0.1:8789';
/** Opens the installed program: registered by its installer. */
export const KITUO_OPEN_LINK = 'venics-kituo://start';

export type KituoState = 'off' | 'starting' | 'running' | 'error';
export type KituoErrorCode = 'old_hub_running' | 'port_busy' | 'data_denied' | 'failed';

export interface KituoEvent {
  /** The computer's own clock. */
  at: string;
  kind: 'started' | 'stopped' | 'paired' | 'error';
  /** A device's name as it joined, e.g. "Simu (3c95)". */
  label?: string;
  /** Who was signed in on it. */
  userName?: string | null;
  /** The VenicsHub.exe folder whose data the hub took over when it started. */
  adoptedFrom?: string | null;
  error?: KituoErrorCode;
}

/** What the hub's console window used to print, and a little more. */
export interface KituoStatus {
  state: KituoState;
  error: KituoErrorCode | null;
  errorDetail: string | null;
  /** What holds the port, when something does. */
  blocker: { exePath: string | null; isVenicsHub: boolean } | null;
  hubVersion: string;
  port: number;
  /** What each phone types: one per network this computer is on. */
  urls: string[];
  /** What this computer itself uses. */
  localUrl: string;
  /** Valid as long as the hub runs; a new one each time it starts. */
  pairingCode: string | null;
  hubId: string | null;
  /** Fixed by the first device to pair. */
  shopId: string | null;
  devices: number;
  dataDir: string | null;
  adoptedFrom: string | null;
  /** Switched on: it starts whenever the program does. */
  enabled: boolean;
  /** The program starts with Windows. */
  autostart: boolean;
  /** Oldest first. */
  events: KituoEvent[];
  /** Goes up with every change. */
  rev?: number;
  /** The program's own version (the hub's is `hubVersion`). */
  appVersion?: string;
}

/** Whether this browser is on Windows: the program is for Windows only. */
export function onWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as any).userAgentData?.platform;
  return platform ? platform === 'Windows' : /Windows/i.test(navigator.userAgent);
}

export class KituoError extends Error {
  constructor(public code: 'unreachable' | 'timeout' | 'other_site' | 'failed', public status = 0) {
    super(code);
  }
}

async function control(path: string, { method = 'GET', body, timeoutMs = 15_000, signal }: {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
} = {}): Promise<any> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop);
  let res: Response;
  try {
    res = await fetch(`${KITUO_CONTROL}${path}`, {
      method,
      // JSON on every POST: the program insists, so Chrome always checks with
      // it first that this website is allowed.
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    throw new KituoError(timedOut ? 'timeout' : 'unreachable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
  // A program built for another website answers, but only to say so.
  if (res.status === 403) throw new KituoError('other_site', 403);
  if (!res.ok) throw new KituoError('failed', res.status);
  return res.json();
}

/** The card's buttons. */
export const kituo = {
  start: (): Promise<KituoStatus> => control('/kituo/start', { method: 'POST', timeoutMs: 60_000 }),
  stop: (): Promise<KituoStatus> => control('/kituo/stop', { method: 'POST', timeoutMs: 30_000 }),
  // Closing the old VenicsHub.exe and taking over its data takes a few seconds.
  replaceOld: (): Promise<KituoStatus> => control('/kituo/replace-old', { method: 'POST', timeoutMs: 90_000 }),
  setAutostart: (on: boolean) => control('/kituo/autostart', { method: 'POST', body: { on } }),
  openDataFolder: async () => { await control('/kituo/open-folder', { method: 'POST' }); },
};

/**
 * The program's status now, or as soon as it changes after `rev`: a phone
 * pairing shows on this computer within a second, with no polling.
 *
 * Asked with rev 0 the program answers at once. Such a request that takes
 * longer is Chrome holding it while its permission question is on screen, so
 * it is given all the time the shop needs to answer.
 */
export function waitForKituo(rev: number, signal: AbortSignal): Promise<KituoStatus> {
  return control(`/kituo/wait?rev=${rev}&timeout=25000`, { timeoutMs: rev ? 35_000 : 10 * 60_000, signal });
}

/**
 * The program on offer, from the website itself (public/downloads, put there
 * by `npm run dist` in the "Windows app" folder): same address as the app, no
 * other service to trust or pay for. Without this list there is no installer
 * to offer — a missing file would come back as the app's own page.
 */
export async function latestKituo(): Promise<{ version: string; bytes: number; url: string } | null> {
  try {
    const res = await fetch(new URL('downloads/kituo.json', document.baseURI).href, { cache: 'no-store' });
    if (!res.ok) return null;
    const info = await res.json();
    if (typeof info?.version !== 'string') return null;
    return { version: info.version, bytes: Number(info.bytes) || 0, url: new URL(`downloads/${info.file}`, document.baseURI).href };
  } catch {
    return null;
  }
}

/** "1.2.0" is newer than "1.10.0"? No. */
export function newerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

// Remembered on this computer once the program has been seen here, so the
// card can offer to open it rather than to download it again.
const SEEN_KEY = 'venics.kituo.seen';
export function kituoSeenHere(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
export function markKituoSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* only a convenience */
  }
}
