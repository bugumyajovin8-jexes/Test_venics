import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Spotlight navigation.
 *
 * Venics Smart answers a "how do I…" question with a button that navigates to
 * the right page AND names the exact control to look at. Telling someone to
 * "go to Zaidi" is not much help on a long settings page — this scrolls the
 * real control into view and pulses a ring around it.
 *
 * Pages opt in by tagging a control:  <button data-tour="add-staff-btn">
 * Callers request it via router state: navigate('/zaidi', { state: { spotlight: 'add-staff-btn' } })
 */

const HIGHLIGHT_CLASS = 'venics-spotlight';
const HIGHLIGHT_MS = 2600;
/** Dexie live queries populate after mount, so the target may not exist yet. */
const MAX_WAIT_MS = 5000;
const POLL_MS = 120;

/** Navigation keys already handled, so a re-render never re-fires the pulse. */
const consumed = new Set<string>();

export function useSpotlight() {
  const location = useLocation();

  useEffect(() => {
    const target = (location.state as { spotlight?: string } | null)?.spotlight;
    if (!target || consumed.has(location.key)) return;
    consumed.add(location.key);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const startedAt = Date.now();

    let cancelled = false;
    let pollTimer: number | undefined;
    let clearTimer: number | undefined;
    let highlighted: HTMLElement | null = null;

    const poll = () => {
      if (cancelled) return;

      const node = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`);
      if (node) {
        highlighted = node;
        node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        node.classList.add(HIGHLIGHT_CLASS);
        clearTimer = window.setTimeout(() => node.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
        return;
      }

      // Give up quietly — a missing target must never break the page.
      if (Date.now() - startedAt > MAX_WAIT_MS) return;
      pollTimer = window.setTimeout(poll, POLL_MS);
    };

    poll();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (clearTimer) clearTimeout(clearTimer);
      highlighted?.classList.remove(HIGHLIGHT_CLASS);
    };
  }, [location.key, location.state]);
}
