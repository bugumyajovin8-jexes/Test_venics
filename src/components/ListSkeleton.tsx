import { t } from '../i18n';
/**
 * Placeholder rows shown while a list is still being read from the database.
 *
 * Exists because of a genuinely alarming bug: `useLiveQuery` returns `undefined`
 * until its query resolves, and every call site flattened that to `[]` with
 * `|| []`. On a shop with a lot of data the query takes long enough that the
 * page rendered "Hakuna madeni yoyote" or "Hakuna bidhaa iliyopatikana" first,
 * and the owner saw their records apparently wiped for a second before
 * everything reappeared.
 *
 * Skeleton rows say "loading" without ever making that claim. The rule this
 * encodes: an empty-state message is a STATEMENT OF FACT about the data, so it
 * must never be shown until the data has actually been read.
 */

interface Props {
  /** How many placeholder rows to draw. Match the real list's density. */
  rows?: number;
  /** 'card' for chunky list items (debts, products); 'line' for compact rows. */
  variant?: 'card' | 'line';
  className?: string;
}

export default function ListSkeleton({ rows = 5, variant = 'card', className = '' }: Props) {
  return (
    // aria-busy + a label so a screen reader announces loading rather than
    // silently reading out a pile of empty boxes.
    <div className={`space-y-3 ${className}`} aria-busy="true" aria-label={t('Inapakia taarifa')}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`bg-white border border-gray-100 rounded-2xl animate-pulse ${
            variant === 'card' ? 'p-4' : 'p-3'
          }`}
          // Each row fades slightly more than the last, so the list reads as
          // "still arriving" rather than as a solid block of grey.
          style={{ opacity: Math.max(0.35, 1 - i * 0.15) }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-2">
              <div className={`h-3 bg-gray-200 rounded-full ${i % 2 ? 'w-1/2' : 'w-2/3'}`} />
              <div className="h-2.5 bg-gray-100 rounded-full w-1/3" />
            </div>
            {variant === 'card' && <div className="h-8 w-16 bg-gray-100 rounded-xl shrink-0" />}
          </div>
        </div>
      ))}
    </div>
  );
}
