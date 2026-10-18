/**
 * A name for THIS device, stable across restarts.
 *
 * Two phones and a till all sync into one shop, and when something goes wrong
 * — a count that clashed, a queue that never drained — the first question is
 * "which device?". Nothing in the data could answer that: rows carry a user,
 * and one person may use two devices.
 *
 * Local only, and deliberately not a fingerprint: a random id made on first
 * run, plus the platform, so a support conversation can say "Simu (a3f1)".
 */

const KEY = 'venics_device_id';

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = makeId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Storage blocked: stable for this session at least.
    return 'unknown';
  }
}

/** What a person would recognise: the kind of device, and enough id to tell two apart. */
export function getDeviceLabel(): string {
  const id = getDeviceId();
  const short = id.replace(/-/g, '').slice(0, 4);
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const kind = /android/i.test(ua) ? 'Simu' : /iphone|ipad/i.test(ua) ? 'iPhone' : 'Kompyuta';
  return `${kind} (${short})`;
}
