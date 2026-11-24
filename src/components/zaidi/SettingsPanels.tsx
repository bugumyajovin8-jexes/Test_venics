/**
 * The building blocks of the Desktop Zaidi page (rebuilt 2026-11-24 from the
 * layout the owner saw on 9 November): sections with a title, white panels
 * whose rows are split by thin lines, and a plain switch.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function Toggle({ on, onClick, color = 'bg-blue-600', label, disabled, testId }: { on: boolean; onClick: () => void; color?: string; label: string; disabled?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer disabled:opacity-60 ${on ? color : 'bg-gray-300'}`}
    >
      <span className={`absolute top-1 w-4 h-4 bg-white knob rounded-full shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

/** A white panel with an optional title bar; its rows are separated by thin lines. */
export function Panel({ title, sub, icon: Icon, tone = 'text-blue-600 bg-blue-50', action, children, className = '', testId }: {
  title?: string; sub?: string; icon?: LucideIcon; tone?: string; action?: ReactNode; children: ReactNode; className?: string; testId?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm ${className}`} data-testid={testId}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && <div className={`p-2 rounded-xl shrink-0 ${tone}`}><Icon className="w-5 h-5" /></div>}
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-gray-900">{title}</h3>
              {sub && <p className="text-xs text-gray-500">{sub}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/** One setting: what it is on the left, its control on the right. */
export function Row({ icon: Icon, tone, title, desc, children, testId }: { icon: LucideIcon; tone: string; title: string; desc?: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5" data-testid={testId}>
      <div className="flex items-center gap-3 min-w-0 flex-1 basis-48">
        <div className={`p-2 rounded-xl shrink-0 ${tone}`}><Icon className="w-4 h-4" /></div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {desc && <p className="text-xs text-gray-500">{desc}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** One part of the page; the tabs at the top jump to it. */
export function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section id={id} data-section className="scroll-mt-44">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500">{sub}</p>
      </div>
      {children}
    </section>
  );
}
