import { useState, useEffect } from 'react';

/**
 * Detects OS/browser text magnification (accessibility "font size" / "display size"
 * settings). Browsers render the root font at 16px by default; enlarging the phone's
 * text/display pushes the rendered root font higher. Pinch-zoom is disabled app-wide,
 * so this is the practical signal for "the user has magnified their screen".
 *
 * Lets a layout keep its normal single-row (horizontal scroll) presentation and
 * switch to a wrapped, fully-visible layout only when magnified — so nothing gets
 * cut off for users who enlarged their display.
 *
 * `thresholdPx` is tunable: 16px = default, ~18px ≈ a 1.12x enlargement.
 */
export function useMagnified(thresholdPx = 17.5, minViewportPx = 340): boolean {
  const [magnified, setMagnified] = useState(false);

  useEffect(() => {
    const check = () => {
      try {
        // 1) "Font size" magnification pushes the rendered root font above 16px.
        const root = parseFloat(getComputedStyle(document.documentElement).fontSize || '16') || 16;
        const fontMagnified = root >= thresholdPx;
        // 2) "Display size" magnification does NOT change font-size — it shrinks the
        //    CSS viewport instead. Normal phones are ≥ ~360px wide, so a viewport this
        //    narrow means the display is enlarged (or a very small screen) → reflow.
        const displayMagnified = typeof window !== 'undefined' && window.innerWidth <= minViewportPx;
        setMagnified(fontMagnified || displayMagnified);
      } catch {
        /* ignore */
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [thresholdPx, minViewportPx]);

  return magnified;
}
