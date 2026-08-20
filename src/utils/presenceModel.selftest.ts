/**
 * Presence fixture — the two scenarios that exposed the old model as fiction.
 *
 *   npx tsx src/services/presence.selftest.ts
 */

import { buildPresenceDay, formatDuration } from './presenceModel';

const DAY = '2026-08-05';
const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;
const session = (from: string, to: string) => ({ started_at: at(from), ended_at: at(to) });

const problems: string[] = [];
const check = (label: string, cond: boolean, got: string) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label} — got ${got}`); problems.push(label); }
};

console.log('\n── Scenario 1: 08:00–10:00, away, 14:00–22:00 ──');
{
  const day = buildPresenceDay([], { sessions: [session('08:00', '10:00'), session('14:00', '22:00')],
    now: new Date(at('23:00')),
  });

  check('two presence blocks, not one', day.blocks.length === 2, `${day.blocks.length}`);
  check('one gap detected', day.gaps.length === 1, `${day.gaps.length}`);
  check(
    'gap is the real 4h absence',
    day.longestGap?.seconds === 4 * 3600,
    formatDuration(day.longestGap?.seconds ?? 0),
  );
  check(
    'worked time is 10h, NOT the 14h span',
    day.activeSeconds === 10 * 3600,
    formatDuration(day.activeSeconds),
  );
}

console.log('\n── Scenario 2: 50 short visits, ~5 min apart ──');
{
  // Opens every ~10 minutes from 08:00 — well inside the 30-minute gap window.
  const logs = Array.from({ length: 50 }, (_, i) => {
    const startMin = i * 10;
    const h = String(8 + Math.floor(startMin / 60)).padStart(2, '0');
    const m = String(startMin % 60).padStart(2, '0');
    const endMin = startMin + 5;
    const eh = String(8 + Math.floor(endMin / 60)).padStart(2, '0');
    const em = String(endMin % 60).padStart(2, '0');
    return session(`${h}:${m}`, `${eh}:${em}`);
  });

  const day = buildPresenceDay([], { sessions: logs, now: new Date(at('20:00')) });
  check('collapses into a single block', day.blocks.length === 1, `${day.blocks.length}`);
  check('no phantom gaps', day.gaps.length === 0, `${day.gaps.length}`);
}

console.log('\n── A recorded sale can never fall inside a gap ──');
{
  const day = buildPresenceDay([], { sessions: [session('08:00', '09:00'), session('15:00', '16:00')],
    activityAt: [at('12:00')], // a sale while heartbeats were missed
    now: new Date(at('17:00')),
  });

  const saleTime = new Date(at('12:00')).getTime();
  const insideGap = day.gaps.some((g) => saleTime > g.start.getTime() && saleTime < g.end.getTime());
  check('sale time is not inside any gap', !insideGap, `${day.gaps.length} gaps`);
  check('sale creates its own block', day.blocks.length === 3, `${day.blocks.length}`);
}

console.log('\n── Legacy day: unclosed session must NOT run to "now" ──');
{
  // Yesterday's data, viewed today — the old code stretched this to the present.
  const day = buildPresenceDay(
    [{ action: 'app_opened', created_at: at('08:00') }],
    { now: new Date('2026-08-06T15:00:00.000Z') },
  );
  const end = day.lastSeen?.toISOString() ?? '';
  check('block ends on its own day', end.startsWith(DAY), end);
}

console.log(`\n${problems.length ? `❌ ${problems.length} failing` : '✅ all presence checks passed'}\n`);
process.exitCode = problems.length ? 1 : 0;
