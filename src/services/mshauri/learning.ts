/**
 * Learning store.
 *
 * Two local-only signals let the assistant improve from real shop usage
 * without any model or network call:
 *
 *   1. Unresolved questions are counted, so the gaps that actually matter
 *      (asked often) surface ahead of one-off typos.
 *   2. When a question that failed is immediately followed by one that works,
 *      the failed phrasing is remembered as an alias for the skill that
 *      answered — so the same wording resolves directly next time.
 *
 * Kept in localStorage on purpose: these are device-local learning signals,
 * they must survive logout, and they must never consume Supabase storage.
 */

import { normalize } from './normalize';

const UNRESOLVED_KEY = 'mshauri_unresolved_v1';
const ALIAS_KEY = 'mshauri_aliases_v1';

/** Caps so a busy shop can never bloat localStorage. */
const MAX_UNRESOLVED = 120;
const MAX_ALIASES = 300;
const MAX_SAMPLES = 3;

export interface UnresolvedEntry {
  key: string;
  samples: string[];
  count: number;
  lastSeen: string;
  /** Skill ids that came closest, for triage. */
  nearest: string[];
}

interface AliasEntry {
  key: string;
  skillId: string;
  hits: number;
}

/**
 * Order-insensitive key: "faida ya leo" and "leo faida" are the same gap.
 * Built from normalized tokens so spelling variants collapse together.
 */
export function queryKey(text: string): string {
  const { tokens } = normalize(text);
  return [...new Set(tokens)].sort().join(' ');
}

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Quota or private mode — learning is best-effort, never fatal. */
  }
}

/** Records a question the matcher could not answer. */
export function recordUnresolved(text: string, nearest: string[] = []): void {
  const key = queryKey(text);
  if (!key) return;

  const entries = read<UnresolvedEntry>(UNRESOLVED_KEY);
  const existing = entries.find((e) => e.key === key);

  if (existing) {
    existing.count += 1;
    existing.lastSeen = new Date().toISOString();
    if (!existing.samples.includes(text) && existing.samples.length < MAX_SAMPLES) {
      existing.samples.push(text);
    }
    if (nearest.length) existing.nearest = nearest;
  } else {
    entries.push({
      key,
      samples: [text],
      count: 1,
      lastSeen: new Date().toISOString(),
      nearest,
    });
  }

  // Keep the most-asked, then the most-recent.
  entries.sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));
  write(UNRESOLVED_KEY, entries.slice(0, MAX_UNRESOLVED));
}

/** Unresolved questions, most-asked first. */
export function getUnresolved(): UnresolvedEntry[] {
  return read<UnresolvedEntry>(UNRESOLVED_KEY);
}

export function clearUnresolved(): void {
  write(UNRESOLVED_KEY, []);
}

/**
 * Teaches the matcher that `text` meant `skillId`.
 *
 * Single-token phrasings are ignored: they are too ambiguous to bind safely,
 * and a bad alias would be worse than an honest "sijaelewa".
 */
export function recordAlias(text: string, skillId: string): void {
  const key = queryKey(text);
  if (!key || key.split(' ').length < 2) return;

  const aliases = read<AliasEntry>(ALIAS_KEY);
  const existing = aliases.find((a) => a.key === key);

  if (existing) {
    // A different resolution replaces the old one rather than fighting it.
    if (existing.skillId === skillId) existing.hits += 1;
    else {
      existing.skillId = skillId;
      existing.hits = 1;
    }
  } else {
    aliases.push({ key, skillId, hits: 1 });
  }

  aliases.sort((a, b) => b.hits - a.hits);
  write(ALIAS_KEY, aliases.slice(0, MAX_ALIASES));

  // The gap is closed — stop reporting it.
  const remaining = read<UnresolvedEntry>(UNRESOLVED_KEY).filter((e) => e.key !== key);
  write(UNRESOLVED_KEY, remaining);
}

/** Skill previously learned for this phrasing, if any. */
export function lookupAlias(text: string): string | null {
  const key = queryKey(text);
  if (!key) return null;
  return read<AliasEntry>(ALIAS_KEY).find((a) => a.key === key)?.skillId ?? null;
}

export function getAliasCount(): number {
  return read<AliasEntry>(ALIAS_KEY).length;
}

export function clearAliases(): void {
  write(ALIAS_KEY, []);
}
