import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rdprkqfxznajegttfsbg.supabase.co';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkcHJrcWZ4em5hamVndHRmc2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjkzOTYsImV4cCI6MjA5MDQ0NTM5Nn0.yX-vvx3WDNYCNDTx1GGecxYAs2IVZ_5_aLEMdfjLpYE';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('Supabase credentials missing from environment. Using hardcoded fallbacks.');
}

// supabase-js uses the global fetch with NO timeout, and serializes every auth operation behind a
// single navigator.locks lock. So one stalled request (cold serverless, dropped wifi, a half-open
// socket) hangs forever while holding that lock, and the next signInWithPassword waits behind it —
// the "Inaingia..." freeze that previously only clearing site data could fix. Give the client a
// fetch that aborts after a generous timeout so a stuck request FAILS (releasing the lock) instead
// of hanging. 25s is far beyond any normal request (including large syncs), so it only ever catches
// true hangs, never legitimate traffic.
const REQUEST_TIMEOUT_MS = 25000;
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Supabase request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  );
  // Forward any signal supabase-js already passed so its own aborts keep working.
  const upstream = init?.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort((upstream as any).reason);
    else upstream.addEventListener('abort', () => controller.abort((upstream as any).reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
});

/**
 * Sign out, and make it stick with or without internet.
 *
 * supabase-js tells the server first and only then forgets the session on
 * this device — and when the server cannot be reached it gives up WITHOUT
 * forgetting it, so the next start would sign the same person straight back
 * in. Before any of that it waits for its own lock, which a token refresh
 * stuck on a dead connection holds for as long as that request lasts. So: ask
 * politely, briefly, and forget the session here whatever the answer.
 */
export async function signOutSafely(timeoutMs = 5_000): Promise<void> {
  let signedOut = false;
  try {
    const result: any = await Promise.race([
      supabase.auth.signOut(),
      new Promise(resolve => setTimeout(() => resolve({ error: 'timeout' }), timeoutMs)),
    ]);
    signedOut = !result?.error;
  } catch {
    signedOut = false;
  }
  if (signedOut) return;
  // The server could not be told. Its copy of the session expires on its own;
  // this device simply stops holding the keys to it.
  const key: string | undefined = (supabase.auth as any).storageKey;
  if (!key) return;
  for (const k of [key, `${key}-code-verifier`, `${key}-user`]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* already gone */
    }
  }
}
