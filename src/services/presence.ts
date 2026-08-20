/**
 * Presence tracking.
 *
 * Replaces the old `app_opened` event, which was both noisy and misleading:
 * it fired once per killed process (≈50 rows/day for a shop with few
 * customers), and the report then discarded all but the first — producing a
 * single fictional shift that ran from the first open until "now", hiding
 * every absence in between.
 *
 * Here presence is a set of BLOCKS, derived by gap-splitting heartbeats:
 *
 *   • A heartbeat bumps `last_seen_at` every HEARTBEAT_MS while the app is
 *     in the foreground. Local Dexie write only — nothing hits the network.
 *   • Reopening within GAP_MS continues the SAME block, so brief repeated
 *     visits collapse into one.
 *   • A longer gap closes the previous block and starts a new one, which is
 *     exactly how a real absence should read.
 *   • Only a CLOSED block is pushed, as one row in its own table —
 *     never into audit_logs, which is the boss's suspicious-activity record.
 *
 * Result: fewer rows than before, and a report that finally tells the truth
 * about when someone was actually there.
 */

import { v4 as uuidv4 } from 'uuid';
import { db, type WorkSession } from '../db';
import { GAP_MS } from '../utils/presenceModel';

/** How often presence is confirmed while the app is visible. */
const HEARTBEAT_MS = 2 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let currentShopId: string | null = null;
let currentUserId: string | null = null;

const iso = (d = new Date()) => d.toISOString();

/**
 * Closes a block and hands it to the sync queue.
 *
 * Marking `synced: 0` is what makes it eligible for push — an in-progress
 * block stays at `synced: 1` so heartbeats never touch the network.
 */
async function flush(session: WorkSession): Promise<void> {
  const started = new Date(session.started_at);
  const ended = new Date(session.ended_at || session.last_seen_at);
  const spanSeconds = Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000));

  // Blocks too short to mean anything are dropped rather than recorded.
  if (spanSeconds < 60 && session.active_seconds < 60) {
    await db.workSessions.delete(session.id);
    return;
  }

  try {
    await db.workSessions.update(session.id, {
      ended_at: ended.toISOString(),
      updated_at: new Date().toISOString(),
      synced: 0,
    });
  } catch (err) {
    console.error('[presence] failed to close session:', err);
  }
}

/**
 * Closes any block whose last heartbeat is older than the gap window.
 * Runs on start-up too, so a session left open by an app kill is repaired.
 */
export async function sweepStaleSessions(shopId: string, userId: string): Promise<void> {
  const open = (await db.workSessions
    .where('[shop_id+user_id]')
    .equals([shopId, userId])
    .toArray())
    .filter((s) => !s.ended_at);

  const cutoff = Date.now() - GAP_MS;
  for (const session of open) {
    if (new Date(session.last_seen_at).getTime() < cutoff) {
      await flush({ ...session, ended_at: session.last_seen_at });
    }
  }
}

/** Current open block for this user, if one is still within the gap window. */
async function activeSession(shopId: string, userId: string): Promise<WorkSession | null> {
  const open = (await db.workSessions
    .where('[shop_id+user_id]')
    .equals([shopId, userId])
    .toArray())
    .filter((s) => !s.ended_at);

  const cutoff = Date.now() - GAP_MS;
  const live = open
    .filter((s) => new Date(s.last_seen_at).getTime() >= cutoff)
    .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));

  return live[0] ?? null;
}

async function beat(): Promise<void> {
  if (!currentShopId || !currentUserId) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

  try {
    await sweepStaleSessions(currentShopId, currentUserId);
    const existing = await activeSession(currentShopId, currentUserId);
    const now = iso();

    if (existing) {
      // Only count time the app was genuinely in the foreground.
      const sinceLast = Date.now() - new Date(existing.last_seen_at).getTime();
      const credited = Math.min(sinceLast, HEARTBEAT_MS * 1.5) / 1000;
      await db.workSessions.update(existing.id, {
        last_seen_at: now,
        active_seconds: Math.round(existing.active_seconds + credited),
      });
    } else {
      await db.workSessions.add({
        id: uuidv4(),
        shop_id: currentShopId,
        user_id: currentUserId,
        started_at: now,
        last_seen_at: now,
        active_seconds: 0,
        isDeleted: 0,
        updated_at: now,
        // synced:1 keeps an in-progress block off the network entirely;
        // closing it flips this to 0 and the push picks it up.
        synced: 1,
      });
    }
  } catch (err) {
    console.error('[presence] heartbeat failed:', err);
  }
}

/** Begins tracking for the signed-in user. Safe to call repeatedly. */
export function startPresence(shopId: string, userId: string, role?: string): void {
  // The boss is not clocking in — only staff presence is meaningful here, and
  // this mirrors SyncService.logAction, which already skips the boss.
  if (role === 'boss') return;
  if (!shopId || !userId) return;

  if (timer && currentShopId === shopId && currentUserId === userId) return;
  stopPresence();

  currentShopId = shopId;
  currentUserId = userId;

  void beat();
  timer = setInterval(() => void beat(), HEARTBEAT_MS);

  // Coming back to the foreground confirms presence immediately rather than
  // waiting out the interval, which keeps short visits from being lost.
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') void beat();
  };
  document.addEventListener('visibilitychange', visibilityHandler);
}

export function stopPresence(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
  currentShopId = null;
  currentUserId = null;
}

/** Closes and flushes the open block — called on explicit logout. */
export async function endPresence(): Promise<void> {
  const shopId = currentShopId;
  const userId = currentUserId;
  stopPresence();
  if (!shopId || !userId) return;

  const existing = await activeSession(shopId, userId);
  if (existing) await flush({ ...existing, ended_at: iso() });
}
