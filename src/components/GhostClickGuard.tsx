import { useState, useEffect } from 'react';
import type { SyntheticEvent } from 'react';

/**
 * iOS ghost-click absorber for tap-opened overlays.
 *
 * On the iOS WKWebview a single tap runs the action on `onPointerUp` and then the
 * browser fires a *synthesized* `click` ~300ms later at whatever element now sits
 * under the finger. When a tap opens a modal/form, that late click lands on a
 * button inside the freshly-opened overlay (e.g. tap "Edit" -> the ghost hits
 * "Hifadhi" and closes the form again).
 *
 * Drop <GhostClickGuard /> as a child of an overlay that opens from a tap. It
 * mounts a full-screen transparent shield that swallows pointer/click events for
 * ~350ms (long enough to absorb the opening tap's ghost) and then removes itself,
 * so normal interaction with the overlay resumes. This is the same trick used on
 * the Kikapu page, packaged so each overlay only needs one line.
 */
export default function GhostClickGuard({ ms = 350 }: { ms?: number }) {
  const [active, setActive] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setActive(false), ms);
    return () => clearTimeout(t);
  }, [ms]);

  if (!active) return null;

  const swallow = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="fixed inset-0 z-[99999] bg-transparent pointer-events-auto cursor-default"
      onClick={swallow}
      onPointerDown={swallow}
      onPointerUp={swallow}
    />
  );
}
