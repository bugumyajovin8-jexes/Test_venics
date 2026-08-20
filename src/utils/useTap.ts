import { useRef } from 'react';

/**
 * Returns a `tap(fn)` wrapper for iOS-safe button handling.
 *
 * iOS Safari sometimes fails to synthesize a click event after touchend,
 * causing onClick handlers to silently not fire. Using onPointerUp bypasses
 * this — it fires directly from the native touch layer. Both onPointerUp and
 * onClick should call tap(fn) so that whichever fires first runs the action
 * and the second (arriving ~10-50ms later) is debounced out.
 *
 * Usage:
 *   const tap = useTap();
 *   <button onPointerUp={tap(handler)} onClick={tap(handler)}>
 */
export function useTap() {
  const last = useRef(0);
  return (fn: () => void) => () => {
    const now = Date.now();
    if (now - last.current > 300) {
      last.current = now;
      fn();
    }
  };
}
