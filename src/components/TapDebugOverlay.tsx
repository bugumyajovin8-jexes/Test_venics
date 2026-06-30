import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * On-screen diagnostic for iOS PWA tap-vs-navigate issues.
 *
 * Enable: visit any URL with `?tapdbg=1` once (e.g. `http://.../#/?tapdbg=1`).
 *         Persists in localStorage. Tap the X on the overlay to disable.
 *
 * What it shows:
 *   TS = touchstart count, TE = touchend count, PC = pointercancel count,
 *   CL = click count, NAV = navigation count.
 *   If TS > CL → iOS dropped a synthesized click (often paired with PC).
 *   If CL > NAV → click fired but no route change happened.
 *   Recent event list shows what fired and on which target, with timing.
 *
 * Listens at document-level with capture=true so it sees events before any
 * React handler can preventDefault or stopPropagation them.
 */

interface RecentEvent {
  type: string;
  target: string;
  t: number;
}

export default function TapDebugOverlay() {
  const [enabled, setEnabled] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('tapdbg')) {
        localStorage.setItem('tapdbg', '1');
        return true;
      }
      return localStorage.getItem('tapdbg') === '1';
    } catch {
      return false;
    }
  });

  const location = useLocation();
  const [, force] = useState(0);
  const counts = useRef({
    touchstart: 0,
    touchend: 0,
    pointercancel: 0,
    click: 0,
    navigations: 0,
  });
  const recent = useRef<RecentEvent[]>([]);

  // Bump navigation counter on every route change.
  useEffect(() => {
    counts.current.navigations++;
    recent.current.unshift({
      type: 'NAV',
      target: location.pathname,
      t: Date.now(),
    });
    recent.current = recent.current.slice(0, 8);
    force((n) => n + 1);
  }, [location.pathname]);

  useEffect(() => {
    if (!enabled) return;

    const describe = (el: EventTarget | null): string => {
      if (!(el instanceof Element)) return '?';
      let cur: Element | null = el;
      while (cur && cur !== document.body) {
        if (cur.tagName === 'BUTTON' || cur.tagName === 'A') {
          const txt = (cur.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18);
          return `${cur.tagName.toLowerCase()}:${txt || '(no-text)'}`;
        }
        cur = cur.parentElement;
      }
      return el.nodeName.toLowerCase();
    };

    const handler = (label: keyof typeof counts.current) => (e: Event) => {
      counts.current[label]++;
      recent.current.unshift({
        type: label === 'touchstart' ? 'TS'
            : label === 'touchend' ? 'TE'
            : label === 'pointercancel' ? 'PC'
            : 'CL',
        target: describe(e.target),
        t: Date.now(),
      });
      recent.current = recent.current.slice(0, 8);
      force((n) => n + 1);
    };

    const onTS = handler('touchstart');
    const onTE = handler('touchend');
    const onPC = handler('pointercancel');
    const onCL = handler('click');

    document.addEventListener('touchstart', onTS, { capture: true, passive: true });
    document.addEventListener('touchend', onTE, { capture: true, passive: true });
    document.addEventListener('pointercancel', onPC, { capture: true, passive: true });
    document.addEventListener('click', onCL, { capture: true, passive: true });

    return () => {
      document.removeEventListener('touchstart', onTS, { capture: true });
      document.removeEventListener('touchend', onTE, { capture: true });
      document.removeEventListener('pointercancel', onPC, { capture: true });
      document.removeEventListener('click', onCL, { capture: true });
    };
  }, [enabled]);

  if (!enabled) return null;

  const c = counts.current;
  const drops = Math.max(0, c.touchstart - c.click);
  const navMissing = Math.max(0, c.click - c.navigations);
  const now = Date.now();

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.88)',
        color: '#0f0',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: '10px',
        lineHeight: 1.35,
        padding: '4px 6px',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>TS:{c.touchstart}</span>
        <span>TE:{c.touchend}</span>
        <span style={{ color: c.pointercancel > 0 ? '#f80' : '#0f0' }}>PC:{c.pointercancel}</span>
        <span>CL:{c.click}</span>
        <span>NAV:{c.navigations}</span>
        {drops > 0 && <span style={{ color: '#f44' }}>⚠ drop:{drops}</span>}
        {navMissing > 0 && <span style={{ color: '#f44' }}>⚠ no-nav:{navMissing}</span>}
        <button
          onClick={() => {
            try { localStorage.removeItem('tapdbg'); } catch {}
            setEnabled(false);
          }}
          style={{
            marginLeft: 'auto',
            pointerEvents: 'auto',
            color: '#0f0',
            background: 'transparent',
            border: '1px solid #0f0',
            padding: '0 5px',
            fontSize: '10px',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          X
        </button>
      </div>
      {recent.current.slice(0, 6).map((e, i) => (
        <div key={i} style={{ opacity: 1 - i * 0.12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          -{((now - e.t) / 1000).toFixed(1)}s {e.type} → {e.target}
        </div>
      ))}
    </div>
  );
}
