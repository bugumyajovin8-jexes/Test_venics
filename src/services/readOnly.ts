/**
 * Read-only mode.
 *
 * When a shop's licence lapses the app no longer blocks the door — it keeps
 * every screen readable and refuses only the act of *recording*. A shop owner
 * locked out of last month's numbers becomes an ex-customer; one who can still
 * read them, and can see the register is closed, renews.
 *
 * Enforcement lives here, in ONE place, rather than as an `if` at each of the
 * ~80 write call sites. A Dexie DBCore middleware intercepts `mutate` for the
 * business tables, so every write path — including bulk operations, and
 * including code written next year — fails closed without needing to know this
 * module exists.
 *
 * This layer is honesty, not security: the APK sits on the user's phone and can
 * be patched. The un-bypassable check is the licence clause in Postgres RLS.
 * What a patched client loses is sync, backup and multi-device — a broken shop,
 * not a free one.
 */

import { db } from '../db';
import type { DBCore, DBCoreTable } from 'dexie';
import type { LicenseStatus } from './license';

/** Support line shown on every locked surface. */
export const SUPPORT_PHONE = '0787979273';

/**
 * Business data. Writes here are refused while the licence is lapsed.
 *
 * Deliberately absent, because blocking them would break the app rather than
 * the business:
 *   license                          — the renewal itself has to be able to land
 *   settings                         — device preferences (dark mode, layout)
 *   salesDaily / salesEmployeeDaily  — local rollups that reports are built from
 *   auditLogs / workSessions         — login and attendance records
 *   saasTelemetry                    — usage counters
 */
export const LOCKED_TABLES = new Set([
  'products',
  'sales',
  'saleItems',
  'expenses',
  'debtPayments',
  'shops',
  'users',
  'features',
  'assistantChats',
]);

export class ReadOnlyError extends Error {
  readonly table: string;
  constructor(table: string) {
    super(`Read-only mode: refused write to "${table}".`);
    this.name = 'ReadOnlyError';
    this.table = table;
  }
}

export function isReadOnlyError(e: unknown): boolean {
  return e instanceof ReadOnlyError || (e as { name?: string })?.name === 'ReadOnlyError';
}

// --- State -------------------------------------------------------------------

/**
 * The single published verdict on the licence.
 *
 * Everything that cares — the write guard, the banner, the sheet, the notice —
 * reads from here, so they cannot disagree. This exists because they once did:
 * the licence-sync button on Dashibodi refreshed the day count from its own
 * Dexie query while the write gate stayed locked until a background tick
 * happened to run, leaving a renewed shop staring at dead buttons.
 */
interface ReadOnlyState {
  /** Latest verdict. Anything other than VALID stops writes. */
  status: LicenseStatus;
  locked: boolean;
  /** Why the shop is locked — drives which explanation the sheet shows. */
  reason: LicenseStatus | null;
  daysRemaining: number;
  /** Set during the end-of-day tail: writes still allowed until this moment. */
  graceEndsAt: number | null;
  /** Effective expiry, so the UI can lock at exactly 23:59 rather than on a poll. */
  expiresAt: number | null;
  sheetOpen: boolean;
}

let state: ReadOnlyState = {
  status: 'VALID',
  locked: false,
  reason: null,
  daysRemaining: 14,
  graceEndsAt: null,
  expiresAt: null,
  sheetOpen: false,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<ReadOnlyState>) {
  const next = { ...state, ...patch };
  // Identity must be stable when nothing changed: useSyncExternalStore compares
  // by reference, and checkStatus republishes on every call.
  const unchanged = (Object.keys(next) as (keyof ReadOnlyState)[])
    .every((k) => next[k] === state[k]);
  if (unchanged) return;
  state = next;
  emit();
}

export function getReadOnlyState(): ReadOnlyState {
  return state;
}

export function subscribeReadOnly(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Synchronous so the Dexie middleware can consult it inside `mutate`, which has
 * no room for an await.
 */
export function isReadOnly(): boolean {
  return state.locked;
}

/**
 * Publishes a licence verdict app-wide.
 *
 * Called from `LicenseService.checkStatus`, which means EVERY path that
 * re-evaluates the licence — the guard's poll, the Dashibodi sync button, a
 * manual re-check — updates the write gate in the same tick. Nothing has to
 * remember to do it.
 */
export function publishLicenseCheck(check: {
  status: LicenseStatus;
  daysRemaining: number;
  graceEndsAt?: number | null;
  expiresAt?: number | null;
}) {
  const locked = check.status !== 'VALID';
  setState({
    status: check.status,
    locked,
    reason: locked ? check.status : null,
    daysRemaining: check.daysRemaining,
    graceEndsAt: check.graceEndsAt ?? null,
    expiresAt: check.expiresAt ?? null,
    // Leaving read-only (a renewal landed) must also dismiss the sheet.
    sheetOpen: locked ? state.sheetOpen : false,
  });
}

export function showLockedSheet() {
  if (!state.locked) return;
  setState({ sheetOpen: true });
}

export function hideLockedSheet() {
  setState({ sheetOpen: false });
}

// --- System writes -----------------------------------------------------------

let systemWriteDepth = 0;

/**
 * Escape hatch for writes the app performs *on the user's behalf* rather than at
 * their instruction — specifically the one-time restore pull that repopulates a
 * fresh install. Without it, a boss who reinstalls the app on a lapsed licence
 * would open an empty database, which is a worse outcome than the blocking
 * screen this whole feature exists to remove.
 *
 * Best-effort by design: it is a depth counter, so a user write that interleaves
 * during an await inside `fn` would also pass. That is acceptable — the binding
 * check is server-side, and this path runs for seconds, once per device.
 */
export async function runAsSystemWrite<T>(fn: () => Promise<T>): Promise<T> {
  systemWriteDepth++;
  try {
    return await fn();
  } finally {
    systemWriteDepth--;
  }
}

// --- Enforcement -------------------------------------------------------------

let installed = false;

/**
 * Installs the Dexie middleware. Must run before the first write, and is
 * idempotent so a hot reload cannot stack duplicate guards.
 */
export function installReadOnlyGuard() {
  if (installed) return;
  installed = true;

  db.use({
    stack: 'dbcore',
    name: 'venicsReadOnlyGuard',
    create: (downlevel: DBCore): DBCore => ({
      ...downlevel,
      table: (tableName: string): DBCoreTable => {
        const table = downlevel.table(tableName);
        if (!LOCKED_TABLES.has(tableName)) return table;

        return {
          ...table,
          mutate: (req) => {
            if (state.locked && systemWriteDepth === 0) {
              // Surfacing the sheet from here is what keeps the explanation
              // consistent: any blocked write anywhere in the app produces the
              // same message, with no per-page wiring to forget.
              showLockedSheet();
              return Promise.reject(new ReadOnlyError(tableName));
            }
            return table.mutate(req);
          },
        };
      },
    }),
  });
}
