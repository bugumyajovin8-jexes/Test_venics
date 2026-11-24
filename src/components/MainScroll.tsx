import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { fadeIn } from '../utils/motion';

/**
 * The app's main scrolling area: a new page fades in (160 ms) when the page
 * changes. Transparency only, so the sidebar and fixed bars never move.
 */
export default function MainScroll({ className, children }: { className?: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    fadeIn(scroller.current?.firstElementChild);
  }, [pathname]);

  return (
    <div ref={scroller} className={className} data-main-scroll>
      {children}
    </div>
  );
}
