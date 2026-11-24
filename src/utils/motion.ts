import { useEffect, useRef, useState } from 'react';

/**
 * Small movements that confirm what just happened: an item going into the
 * cart, a refusal, a finished sale, a new page. Each has a job and is short
 * (140–400 ms); none blocks the next tap, and the work (saving a sale, adding
 * to the cart) is always done first: an animation only follows it.
 *
 * No vibration, and no switch in Zaidi: the animations are always on, except
 * where the phone's or computer's own "remove animations" setting
 * (prefers-reduced-motion) asks for less. Only position and transparency are
 * animated: the cheapest for a phone to draw.
 */

/** Whether anything should move now: not when the device asks for less motion. */
export function motionOn(): boolean {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  } catch { /* old WebView: allowed */ }
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

/** `reduce-motion` on <html> switches off the CSS pop-ins too (index.css). */
export function applyMotionClass(): void {
  try { document.documentElement.classList.toggle('reduce-motion', !motionOn()); } catch { /* no document */ }
}

// ---------------------------------------------------------------- movements

function run(el: Element | null | undefined, frames: Keyframe[], duration: number, options: KeyframeAnimationOptions = {}): Animation | null {
  if (!el || !motionOn()) return null;
  try {
    return (el as HTMLElement).animate(frames, { duration, easing: 'ease-out', ...options });
  } catch {
    return null;
  }
}

/** A tap pressing the thing in, 140 ms. */
export const press = (el: Element | null | undefined) =>
  run(el, [{ transform: 'scale(1)' }, { transform: 'scale(0.95)' }, { transform: 'scale(1)' }], 140);

/** A number or badge that just changed, 220 ms. */
export const pop = (el: Element | null | undefined) =>
  run(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], 220);

/** "Not allowed": a short shake, 300 ms. */
export const shake = (el: Element | null | undefined) =>
  run(el, [
    { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' },
    { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' },
  ], 300);

/** A new page showing: a quick fade, 160 ms. Transparency only, so fixed bars inside it never move. */
export const fadeIn = (el: Element | null | undefined) =>
  run(el, [{ opacity: 0.35 }, { opacity: 1 }], 160);

/**
 * A dot that flies from the tapped product to the cart's total
 * (the element marked data-cart-target), 380 ms, which then pops.
 * Nothing flies when the total is off the screen.
 */
export function flyToCart(from: Element | null | undefined): void {
  if (!from || !motionOn()) return;
  const target = document.querySelector('[data-cart-target]');
  if (!target) return;
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (!b.width || b.bottom < 0 || b.top > window.innerHeight) { pop(target); return; }
  const dot = document.createElement('div');
  dot.setAttribute('aria-hidden', 'true');
  dot.dataset.flyDot = '1';
  dot.style.cssText = `position:fixed;left:${a.left + a.width / 2 - 7}px;top:${a.top + a.height / 2 - 7}px;`
    + 'width:14px;height:14px;border-radius:9999px;background:#2563eb;z-index:9999;pointer-events:none;';
  document.body.appendChild(dot);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    dot.remove();
    pop(target);
  };
  try {
    const flight = dot.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx / 2}px,${dy / 2 - 40}px) scale(0.9)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px,${dy}px) scale(0.4)`, opacity: 0.3 },
    ], { duration: 380, easing: 'ease-in' });
    flight.onfinish = done;
    flight.oncancel = done;
  } catch {
    done();
  }
  window.setTimeout(done, 900); // never left behind
}

/**
 * A finished sale: a green tick and the total in the middle of the screen,
 * about a second, then gone. It never takes a tap: the next customer can be
 * served straight away. The success message the app already shows stays.
 */
export function saleDone(label: string): void {
  if (!motionOn()) return;
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.dataset.saleDone = '1';
  box.style.cssText = 'position:fixed;left:50%;top:42%;z-index:9998;pointer-events:none;transform:translate(-50%,-50%);'
    + 'display:flex;align-items:center;gap:10px;background:#15803d;color:#fff;border-radius:18px;'
    + 'padding:14px 20px;font:600 16px system-ui,-apple-system,sans-serif;box-shadow:0 12px 28px rgba(21,128,61,.35);white-space:nowrap;';
  box.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-dasharray="24" stroke-dashoffset="24"/></svg><span></span>';
  (box.querySelector('span') as HTMLSpanElement).textContent = label;
  document.body.appendChild(box);
  const tick = box.querySelector('path');
  try {
    box.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(0.85)' },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' },
    ], { duration: 200, easing: 'ease-out', fill: 'forwards' });
    tick?.animate([{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], { duration: 320, delay: 120, fill: 'forwards', easing: 'ease-out' });
    const out = box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, delay: 1050, fill: 'forwards' });
    out.onfinish = () => box.remove();
  } catch { /* no animation: removed below */ }
  window.setTimeout(() => box.remove(), 1600);
}

/** A total that counts to its new value (320 ms) instead of jumping. `animate` false: shows it at once. */
export function useCountUp(value: number, animate = true, duration = 320): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (!animate || !motionOn() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); from.current = value; };
  }, [value, animate, duration]);
  return shown;
}
