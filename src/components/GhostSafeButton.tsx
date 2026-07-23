import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTap } from '../utils/useTap';

/**
 * A button that ignores clicks for the first `guardMs` after it MOUNTS.
 *
 * A tap-opened overlay mounts this button at open time, so it absorbs the iOS
 * synthesized "ghost" click (~300ms after the opening tap) that would otherwise land
 * on it and fire its action — WITHOUT freezing the rest of the overlay the way a
 * full-screen <GhostClickGuard /> shield does. Use it for an overlay's Cancel / close /
 * dismiss control: the tap that opened the overlay can't instantly dismiss it again,
 * while inputs and other buttons stay live immediately.
 *
 * (Because the overlay is conditionally rendered, React remounts this button on every
 * open, so the guard window restarts automatically each time.)
 */
export default function GhostSafeButton({
  onPress,
  guardMs = 400,
  className,
  style,
  title,
  type = 'button',
  children,
}: {
  onPress: () => void;
  guardMs?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
  type?: 'button' | 'submit';
  children: ReactNode;
}) {
  const tap = useTap();
  const mountedAt = useRef(Date.now());

  const run = () => {
    // Swallow the opening tap's ghost click; a real press comes well after guardMs.
    if (Date.now() - mountedAt.current < guardMs) return;
    onPress();
  };

  return (
    <button type={type} onClick={tap(run)} onPointerUp={tap(run)} className={className} style={style} title={title}>
      {children}
    </button>
  );
}
