/**
 * The time this app writes on records — the server's clock, not the device's.
 *
 * WHY: every row carries `updated_at`, and when two devices have edited the
 * same product the later timestamp wins. Offline, those timestamps come from
 * phones whose clocks are routinely wrong — a phone set two days fast wins
 * every conflict forever, and a phone set slow loses even the edits it made
 * last. In a shop that goes days without internet, that is silent, permanent
 * data loss: the boss's corrected price quietly replaced by a stale one.
 *
 * So the device learns its offset from the server whenever it is online, keeps
 * it on disk, and stamps every record with the corrected time. A device that
 * has never been online has no offset and behaves exactly as before.
 *
 * This is NOT a clock for display niceties — it is the ordering key for merges.
 * Use `nowIso()` wherever a record is written; `new Date()` is still fine for
 * rendering "5 min iliyopita".
 */

const OFFSET_KEY = 'venics_clock_offset_ms';
const MEASURED_KEY = 'venics_clock_measured_at';

/** Beyond a year apart, the measurement is the thing that is broken. */
const MAX_OFFSET_MS = 365 * 24 * 60 * 60 * 1000;
/** Re-measure at most this often while online. Clock drift is slow. */
const REMEASURE_MS = 6 * 60 * 60 * 1000;
/** Ignore a round trip this slow: half of it is a poor estimate of one way. */
const MAX_RTT_MS = 10_000;

/**
 * Read lazily and defensively: Vite replaces `import.meta.env` at build time,
 * but this module is also loaded by tooling that runs the source directly (the
 * routing self-test), where it does not exist at all.
 */
function serverEnv(): { url: string; key: string } {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
  return {
    url: env.VITE_SUPABASE_URL || 'https://rdprkqfxznajegttfsbg.supabase.co',
    key: env.VITE_SUPABASE_ANON_KEY || '',
  };
}

function readNumber(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

let offsetMs = readNumber(OFFSET_KEY);
let measuredAt = readNumber(MEASURED_KEY);

// A monotonic anchor, so a clock CHANGED while the app is open (a user fixing
// the date, or the network handing one over) can be spotted: wall time and
// monotonic time would then disagree about how long the app has been running.
const bootWall = Date.now();
const bootMono = typeof performance !== 'undefined' ? performance.now() : 0;

function driftSinceBoot(): number {
  if (typeof performance === 'undefined') return 0;
  return Math.abs((Date.now() - bootWall) - (performance.now() - bootMono));
}

/** The device's clock has been changed since the app started. */
export function clockChangedSinceBoot(): boolean {
  return driftSinceBoot() > 60_000;
}

/** Corrected epoch milliseconds — the server's idea of now. */
export function nowMs(): number {
  return Date.now() + offsetMs;
}

export function nowDate(): Date {
  return new Date(nowMs());
}

/** What every record's `created_at` / `updated_at` should be stamped with. */
export function nowIso(): string {
  return nowDate().toISOString();
}

export interface ClockStatus {
  /** How far the device's own clock is from the server's, in milliseconds. */
  offsetMs: number;
  /** When the offset was last measured (device time), or null if never. */
  measuredAt: number | null;
  /** The offset is old, or the device clock moved since it was measured. */
  stale: boolean;
  /** Out by more than five minutes — worth telling the user about. */
  wrong: boolean;
}

export function clockStatus(): ClockStatus {
  return {
    offsetMs,
    measuredAt: measuredAt || null,
    stale: !measuredAt || Date.now() - measuredAt > 7 * 24 * 60 * 60 * 1000 || clockChangedSinceBoot(),
    wrong: Math.abs(offsetMs) > 5 * 60 * 1000,
  };
}

/** Used by the tests and by `syncClockWithServer`. `rttMs` is the round trip. */
export function applyServerTime(serverMs: number, rttMs = 0): boolean {
  if (!Number.isFinite(serverMs) || serverMs <= 0) return false;
  // The reply was written about half a round trip ago.
  const next = serverMs + Math.min(rttMs, MAX_RTT_MS) / 2 - Date.now();
  if (!Number.isFinite(next) || Math.abs(next) > MAX_OFFSET_MS) return false;
  offsetMs = Math.round(next);
  measuredAt = Date.now();
  try {
    localStorage.setItem(OFFSET_KEY, String(offsetMs));
    localStorage.setItem(MEASURED_KEY, String(measuredAt));
  } catch {
    // Private mode or a full quota: the offset still holds for this session.
  }
  return true;
}

let inFlight: Promise<boolean> | null = null;

/**
 * Ask the server what time it is. Any reply will do — the `Date` header is on
 * all of them — so this is a HEAD request that transfers nothing.
 */
export async function syncClockWithServer(force = false): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  if (!force && measuredAt && Date.now() - measuredAt < REMEASURE_MS && !clockChangedSinceBoot()) return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const started = Date.now();
      const { url, key } = serverEnv();
      const res = await fetch(`${url}/rest/v1/`, {
        method: 'HEAD',
        headers: key ? { apikey: key } : undefined,
        cache: 'no-store',
      });
      const header = res.headers.get('date');
      if (!header) return false;
      const serverMs = new Date(header).getTime();
      return applyServerTime(serverMs, Date.now() - started);
    } catch {
      // Offline, or the request was blocked. The stored offset stands.
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test seam: forget the learned offset. */
export function resetClockForTests(): void {
  offsetMs = 0;
  measuredAt = 0;
  try {
    localStorage.removeItem(OFFSET_KEY);
    localStorage.removeItem(MEASURED_KEY);
  } catch {
    /* ignore */
  }
}
