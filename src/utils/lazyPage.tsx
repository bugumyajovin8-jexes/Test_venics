/**
 * Pages that load when they are first opened, so the app's first screen does
 * not wait for every page's code (a low-end phone spends seconds reading it).
 *
 *   const Bidhaa = lazyPage(() => import('../pages/Bidhaa'));
 *   <Suspense fallback={<PageLoading />}> … <Bidhaa /> … </Suspense>
 *
 * warmPages() then loads the rest in the background a little after start-up,
 * one at a time, so moving between pages is instant afterwards and keeps
 * working offline (the service worker has every file; this puts them in
 * memory too). A page whose code is already loaded is drawn directly, with no
 * loading flash.
 *
 * If a page's code cannot be fetched (an update replaced the files while the
 * app was open), the app reloads once to pick up the new ones; a second
 * failure within a minute goes to the error screen instead of looping.
 */
import { lazy, useEffect, useState, type ComponentType } from 'react';
import { Loader2 } from 'lucide-react';

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

export type LazyPage<P> = ComponentType<P> & { preload: () => Promise<unknown> };

const RELOAD_KEY = 'venics_chunk_reload';

function reloadOnce(err: unknown): Promise<never> {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last > 60_000) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      console.warn('[lazyPage] page code missing; reloading once', err);
      window.location.reload();
      return new Promise<never>(() => { /* the page is going away */ });
    }
  } catch { /* storage blocked: fall through to the error screen */ }
  return Promise.reject(err);
}

export function lazyPage<P extends object>(load: Loader<P>): LazyPage<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;

  const preload = () => {
    pending ??= load().then(
      m => (loaded = m.default),
      err => { pending = null; throw err; },
    );
    return pending;
  };

  const Lazy = lazy(() => preload().then(C => ({ default: C }), reloadOnce));

  function Page(props: P) {
    // Chosen once per mount: switching between the two later would remount
    // the page and lose what is on it.
    const [Direct] = useState(() => loaded);
    return Direct ? <Direct {...props} /> : <Lazy {...props} />;
  }
  return Object.assign(Page, { preload });
}

/** Load these pages in the background, one at a time, once the app is idle. */
export function warmPages(pages: Array<{ preload: () => Promise<unknown> }>, delayMs = 2500): () => void {
  let stopped = false;
  const idle = (fn: () => void) => {
    const ric = (window as any).requestIdleCallback as undefined | ((f: () => void, o?: { timeout: number }) => number);
    if (ric) ric(fn, { timeout: 2000 }); else setTimeout(fn, 50);
  };
  const timer = setTimeout(async () => {
    for (const p of pages) {
      if (stopped) return;
      await new Promise<void>(r => idle(r));
      if (stopped) return;
      try { await p.preload(); } catch { /* fetched again when the page is opened */ }
    }
  }, delayMs);
  return () => { stopped = true; clearTimeout(timer); };
}

/** Shown while a page's code loads; appears only after a moment, so a quick load shows nothing. */
export function PageLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 250);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="flex h-[60vh] items-center justify-center" data-testid="page-loading">
      {show && <Loader2 className="h-7 w-7 animate-spin text-blue-500" />}
    </div>
  );
}
