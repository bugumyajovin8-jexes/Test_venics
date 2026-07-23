import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, X } from 'lucide-react';

const MONTHS_SW = [
  'Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni',
  'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba',
];

interface Props {
  value: string;                  // 'yyyy-MM-dd' or ''
  onChange: (v: string) => void;  // '' when cleared
  allowClear?: boolean;
  className?: string;
  minYear?: number;
  maxYear?: number;
}

/**
 * Expiry date picker replacing the native <input type="date">. Shows dd/mm/yyyy regardless of OS
 * locale, has a large calendar button, and opens on a stepped flow: YEAR grid → (tap) MONTH grid →
 * (tap) DAY grid, each tap auto-advancing so there are no extra "open the dropdown" taps. A
 * breadcrumb (year › month › day) lets you jump back to any step. Portaled to <body> and fits the
 * viewport (flips above the trigger when short, scrolls internally). Picking a month already commits
 * a date (keeps the chosen day, or day 1) so year + month alone is enough.
 * Touch-safe: outside-close uses pointerdown; the trigger toggle is debounced vs the ghost click.
 */
export default function ExpiryDatePicker({ value, onChange, allowClear = true, className = '', minYear, maxYear }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; width: number; maxHeight: number; top?: number; bottom?: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const lastToggle = useRef(0);

  const today = new Date();
  const parts = value ? value.split('-').map(Number) : null; // [y, m, d]
  const [viewYear, setViewYear] = useState(parts ? parts[0] : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parts ? parts[1] - 1 : today.getMonth());
  const [step, setStep] = useState<'year' | 'month' | 'day'>('year');

  useEffect(() => {
    if (value) {
      const [y, m] = value.split('-').map(Number);
      setViewYear(y);
      setViewMonth(m - 1);
    }
  }, [value]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceBelow = vh - r.bottom;
    const spaceAbove = r.top;
    const below = spaceBelow >= 300 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(220, (below ? spaceBelow : spaceAbove) - 12);
    setCoords({
      left: r.left,
      width: r.width,
      maxHeight,
      ...(below ? { top: r.bottom + 4 } : { bottom: vh - r.top + 4 }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Debounced toggle: absorbs the iOS ghost click that would otherwise immediately re-close it.
  // Opens on the year grid for a fresh value, or the day grid when refining an existing date.
  const toggle = () => {
    const now = Date.now();
    if (now - lastToggle.current < 350) return;
    lastToggle.current = now;
    const next = !open;
    if (next) setStep(value ? 'day' : 'year');
    setOpen(next);
  };

  const curYear = today.getFullYear();
  const valueYear = parts ? parts[0] : curYear;
  const yLo = Math.min(minYear ?? curYear, valueYear);
  const yHi = Math.max(maxYear ?? curYear + 15, valueYear);
  const years: number[] = [];
  for (let y = yLo; y <= yHi; y++) years.push(y);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const selectedDay = parts && parts[0] === viewYear && parts[1] - 1 === viewMonth ? parts[2] : null;

  const commit = (y: number, m: number, dayOverride?: number) => {
    const base = dayOverride ?? (parts && parts[2] ? parts[2] : 1);
    const day = Math.min(base, new Date(y, m + 1, 0).getDate());
    onChange(`${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  };

  const display = value ? value.split('-').reverse().join('/') : '';

  return (
    <div className={className}>
      <button
        type="button"
        ref={triggerRef}
        onClick={toggle}
        className="w-full flex items-center justify-between gap-2 p-3 border border-gray-300 rounded-xl bg-white text-left outline-none focus:ring-2 focus:ring-blue-500"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <span className={display ? 'text-gray-900 font-semibold' : 'text-gray-400'}>{display || 'Chagua tarehe'}</span>
        <Calendar className="w-6 h-6 text-blue-600 shrink-0" />
      </button>

      {open && coords && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            left: coords.left,
            width: Math.max(coords.width, 260),
            maxHeight: coords.maxHeight,
            overflowY: 'auto',
            zIndex: 100000,
            ...(coords.top !== undefined ? { top: coords.top } : { bottom: coords.bottom }),
          }}
          className="bg-white border border-gray-200 rounded-xl shadow-2xl p-3"
        >
          {/* Breadcrumb — the current selection; tap any part to jump back to that step. */}
          <div className="flex gap-1.5 mb-3 sticky top-0 bg-white pb-2 z-10">
            <button
              type="button"
              onClick={() => setStep('year')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold ${step === 'year' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {viewYear}
            </button>
            <button
              type="button"
              onClick={() => setStep('month')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold ${step === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {MONTHS_SW[viewMonth]}
            </button>
            <button
              type="button"
              onClick={() => setStep('day')}
              className={`w-14 py-2 rounded-lg text-sm font-bold ${step === 'day' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {selectedDay ?? '—'}
            </button>
          </div>

          {step === 'year' && (
            <div className="grid grid-cols-4 gap-1.5">
              {years.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => { setViewYear(y); setStep('month'); }}
                  className={`h-11 rounded-lg text-sm font-bold ${y === viewYear ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-700'}`}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  {y}
                </button>
              ))}
            </div>
          )}

          {step === 'month' && (
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS_SW.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setViewMonth(i); commit(viewYear, i); setStep('day'); }}
                  className={`h-12 rounded-lg text-xs font-bold ${i === viewMonth ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-700'}`}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {step === 'day' && (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => { commit(viewYear, viewMonth, day); setOpen(false); }}
                  className={`h-9 rounded-lg text-sm font-semibold ${selectedDay === day ? 'bg-blue-600 text-white' : 'text-gray-700'}`}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  {day}
                </button>
              ))}
            </div>
          )}
          {allowClear && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="mt-3 w-full py-2 text-xs font-bold text-red-500 rounded-lg flex items-center justify-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Hakuna tarehe (haiishi muda)
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
