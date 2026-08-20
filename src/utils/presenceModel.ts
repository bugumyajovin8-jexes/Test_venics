/**
 * Presence model (pure).
 *
 * Turns raw evidence that someone was present into blocks and gaps. Kept free
 * of Dexie/store/sync imports so it can be reasoned about — and tested — on its
 * own, and so the report can use it without pulling in the runtime service.
 */

/** Silence longer than this ends a block — the person had left. */
export const GAP_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Reading presence back out
// ---------------------------------------------------------------------------

export interface PresenceBlock {
  start: Date;
  end: Date;
  activeSeconds: number;
}

export interface PresenceDay {
  blocks: PresenceBlock[];
  firstSeen: Date | null;
  lastSeen: Date | null;
  /** Seconds actually spent working, summed across blocks. */
  activeSeconds: number;
  /** Absences between blocks — the hours the shop had nobody on the app. */
  gaps: Array<{ start: Date; end: Date; seconds: number }>;
  longestGap: { start: Date; end: Date; seconds: number } | null;
}

/**
 * Builds a day's presence by merging every piece of evidence that someone was
 * there — rows from the work_sessions table, legacy login/app_opened events,
 * and real work (sales, expenses, debt payments) passed in as `activityAt`.
 *
 * Including work events matters: a sale is proof of presence even if a
 * heartbeat was missed, so a recorded sale can never fall inside a "gap".
 *
 * Overlapping or near-touching intervals are merged, and only a silence longer
 * than the gap window separates two blocks.
 */
export function buildPresenceDay(
  logs: Array<{ action: string; created_at: string; details?: any }>,
  opts: {
    now?: Date;
    activityAt?: Array<string | Date>;
    /** Presence blocks from the work_sessions table (the authoritative source). */
    sessions?: Array<{ started_at: string; ended_at?: string; last_seen_at?: string }>;
  } = {},
): PresenceDay {
  const now = opts.now ?? new Date();
  const intervals: Array<{ start: number; end: number }> = [];

  const push = (start: Date, end: Date) => {
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
    intervals.push({ start: start.getTime(), end: Math.max(start.getTime(), end.getTime()) });
  };

  const sessionRows = opts.sessions ?? [];
  for (const row of sessionRows) {
    push(new Date(row.started_at), new Date(row.ended_at || row.last_seen_at || row.started_at));
  }

  // Legacy events, only where the newer session rows are absent for the day.
  if (sessionRows.length === 0) {
    const ordered = logs
      .filter((l) => ['login', 'app_opened', 'logout'].includes(l.action))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    let openAt: Date | null = null;
    let lastEvent: Date | null = null;

    for (const l of ordered) {
      const t = new Date(l.created_at);
      if (l.action === 'logout') {
        if (openAt) push(openAt, t);
        openAt = null;
      } else if (!openAt) {
        openAt = t;
      }
      lastEvent = t;
    }

    // An unclosed legacy block must never be stretched to "now" on a past day —
    // that is precisely the fiction this rewrite removes.
    if (openAt && lastEvent) {
      const sameDay = lastEvent.toDateString() === now.toDateString();
      push(openAt, sameDay ? now : lastEvent);
    }
  }

  // Work is presence.
  for (const at of opts.activityAt ?? []) {
    const t = at instanceof Date ? at : new Date(at);
    push(t, t);
  }

  intervals.sort((a, b) => a.start - b.start);

  const blocks: PresenceBlock[] = [];
  for (const iv of intervals) {
    const last = blocks[blocks.length - 1];
    if (last && iv.start - last.end.getTime() < GAP_MS) {
      if (iv.end > last.end.getTime()) last.end = new Date(iv.end);
    } else {
      blocks.push({ start: new Date(iv.start), end: new Date(iv.end), activeSeconds: 0 });
    }
  }
  for (const b of blocks) {
    b.activeSeconds = Math.round((b.end.getTime() - b.start.getTime()) / 1000);
  }

  const gaps: PresenceDay['gaps'] = [];
  for (let i = 1; i < blocks.length; i++) {
    const start = blocks[i - 1].end;
    const end = blocks[i].start;
    const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
    if (seconds > 0) gaps.push({ start, end, seconds });
  }

  const longestGap = gaps.length ? gaps.reduce((a, g) => (g.seconds > a.seconds ? g : a)) : null;

  return {
    blocks,
    firstSeen: blocks.length ? blocks[0].start : null,
    lastSeen: blocks.length ? blocks[blocks.length - 1].end : null,
    activeSeconds: blocks.reduce((a, b) => a + b.activeSeconds, 0),
    gaps,
    longestGap,
  };
}

/** "3h 20min" / "45min" */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}
