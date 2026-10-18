/**
 * Kituo cha Duka — the shop hub.
 *
 * A shop with no internet still has electricity and a wifi router, and the
 * phones behind the counter can see each other even when nothing can see
 * Supabase. The hub is a small program on the till that holds the shop's rows
 * and hands them between devices over that wifi. This file is the app's side
 * of it: pair once, then push and pull the same way the cloud sync does.
 *
 * WHAT THE HUB IS NOT: it is not an account, and it holds no credentials. It
 * cannot reach Supabase on the shop's behalf. The cloud is still reached by
 * whichever device has internet, and the hub simply means the other devices no
 * longer have to wait for one.
 *
 * WHY A SECOND "sent?" FLAG: a row must reach both destinations, and reaching
 * one says nothing about the other. So every row carries `hub_synced` beside
 * `synced`, and every product carries `hub_delta` beside `stock_delta` — see
 * the hooks in db.ts. Two accumulators, one per path, so neither can swallow
 * what the other has not seen.
 */

import { db } from '../db';
import { useStore } from '../store';
import { nowMs } from './clock';
import { getDeviceId, getDeviceLabel } from './deviceId';
import { hubRequest, hubTransportKind, localNetworkPermission } from './hubTransport';

import { t, tData } from '../i18n';
const CONFIG_KEY = 'venics_hub_config';

/**
 * A device's name as people read it. It is stored as it was made
 * ("Kompyuta (bf65)") and shared through the hub; only the kind of device is
 * shown in the screen's language.
 */
export const shownLabel = (label: string) => label.replace(/^(Simu|Kompyuta)(?= \()/, kind => tData(kind));
/** A hub on the shop's wifi answers in milliseconds; anything slower is not there. */
const PROBE_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 15_000;

export interface HubConfig {
  /** e.g. http://192.168.1.20:8787 */
  url: string;
  token: string;
  hubId: string;
  shopId: string;
  name: string;
  pairedAt: number;
}

export interface HubHello {
  hub: string;
  version: number;
  hubId: string;
  name: string;
  shopId: string | null;
  paired: number;
  time: string;
  licence: { verifiedAt: number; shopId: string } | null;
}

export function getHubConfig(): HubConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    return cfg && cfg.url && cfg.token ? cfg : null;
  } catch {
    return null;
  }
}

export function setHubConfig(cfg: HubConfig | null): void {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* storage blocked: the pairing lasts this session only */
  }
}

/** "192.168.1.20", "192.168.1.20:9000" or a full URL — all mean the same hub. */
export function normalizeHubUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return /:\d+$/.test(withScheme) ? withScheme : `${withScheme}:8787`;
}

interface HubCallInit {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * Who is using this device, for the list on the shop's main computer. Display
 * only — the hub authorises nothing by it. A name and a role, never an email.
 */
function whoHeader(): Record<string, string> {
  const user = useStore.getState().user;
  if (!user) return {};
  const who = { name: String(user.name ?? '').slice(0, 40), role: String(user.role ?? '').slice(0, 20) };
  // Encoded: a header may only carry plain ASCII, and names need not be.
  return { 'X-Venics-Who': encodeURIComponent(JSON.stringify(who)) };
}

/** Every call to the hub goes through here, and on through hubTransport. */
async function request(url: string, path: string, init: HubCallInit = {}): Promise<any> {
  const res = await hubRequest(url + path, {
    method: init.method,
    headers: { ...whoHeader(), ...(init.headers ?? {}) },
    body: init.body,
    timeoutMs: init.timeoutMs ?? REQUEST_TIMEOUT_MS,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(res.body?.error || `hub ${res.status}`);
  return res.body;
}

/** The hub's refusals, in words a shopkeeper can act on. */
const HUB_ERRORS: Record<string, string> = {
  code_wrong: t('Namba ya kuunganisha si sahihi. Angalia namba iliyo kwenye skrini ya kituo.'),
  other_shop: t('Kituo hiki ni cha duka lingine.'),
  shop_required: t('Hakuna duka kwenye kifaa hiki.'),
  not_paired: t('Kifaa hiki hakijaunganishwa na kituo. Kiunganishe upya.'),
};

/**
 * Why the hub could not be reached, in words a shopkeeper can act on.
 *
 * A browser reports every refusal as the same bare "Failed to fetch" — hub
 * switched off, wrong address, and Chrome's own block all look alike — so the
 * permission is asked about separately rather than read off the error.
 */
export async function describeHubFailure(url: string, err: unknown): Promise<string> {
  const message = String((err as any)?.message ?? err ?? '');
  if (HUB_ERRORS[message]) return HUB_ERRORS[message];
  if (/cleartext/i.test(message)) {
    // An Android build that skipped native/android/apply.mjs.
    return t('Toleo hili la programu haliwezi kuwasiliana na kituo. Sasisha programu ya Venics Sales.');
  }
  if (hubTransportKind() === 'web' && (await localNetworkPermission(url)) === 'denied') {
    return t('Chrome imezuia ukurasa huu kuwasiliana na kituo. Bonyeza alama iliyo kushoto ya anwani ya tovuti (juu kabisa), fungua "Site settings", weka "Local network access" kuwa "Allow", kisha jaribu tena.');
  }
  return t('Kituo hakipatikani. Hakikisha kompyuta ya kituo imewashwa na kituo kinaendelea, na kifaa hiki kiko kwenye wifi ya duka.');
}

/** Ask an address whether a hub is there and whose shop it serves. */
export function hubHello(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<HubHello> {
  return request(url, '/hub/hello', { method: 'GET', timeoutMs });
}

/**
 * Join a hub with the six-digit code shown on its screen. The code proves the
 * person is standing in the shop, which is the only thing a local network can
 * reasonably prove.
 */
export async function pairWithHub(rawUrl: string, code: string): Promise<HubConfig> {
  const url = normalizeHubUrl(rawUrl);
  if (!url) throw new Error(t('Weka anwani ya kituo.'));
  const shopId = useStore.getState().user?.shopId;
  if (!shopId) throw new Error(t('Hakuna duka kwenye kifaa hiki.'));

  let hello: HubHello;
  try {
    hello = await hubHello(url);
  } catch (err) {
    throw new Error(await describeHubFailure(url, err));
  }
  if (hello.hub !== 'venics') throw new Error(t('Anwani hii si ya kituo cha Venics.'));
  if (hello.shopId && hello.shopId !== shopId) throw new Error(t('Kituo hiki ni cha duka lingine.'));

  let res: any;
  try {
    res = await request(url, '/hub/pair', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim(), shopId, deviceId: getDeviceId(), label: getDeviceLabel() }),
    });
  } catch (err) {
    throw new Error(await describeHubFailure(url, err));
  }

  const cfg: HubConfig = {
    url,
    token: res.token,
    hubId: res.hubId,
    shopId: res.shopId,
    name: res.name ?? hello.name ?? 'Kituo cha Duka',
    pairedAt: Date.now(),
  };
  setHubConfig(cfg);
  return cfg;
}

/**
 * Leave the hub. It is told first, so this device drops off the list on the
 * main computer and its token stops working; if the hub cannot be reached, the
 * device leaves anyway and simply stays on that list as last seen.
 */
export async function unpairHub(): Promise<void> {
  const cfg = getHubConfig();
  if (cfg) {
    try {
      await request(cfg.url, '/hub/unpair', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}` },
        timeoutMs: PROBE_TIMEOUT_MS,
      });
    } catch {
      /* switched off, or out of range — leave regardless */
    }
  }
  setHubConfig(null);
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('hubCursor_')) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Tables the hub carries, in the order a device should send them: a sale's
 * items and payments mean nothing before the sale itself.
 */
export const HUB_TABLES: { table: string; dexie: string }[] = [
  { table: 'products', dexie: 'products' },
  { table: 'sales', dexie: 'sales' },
  { table: 'sale_items', dexie: 'saleItems' },
  { table: 'debt_payments', dexie: 'debtPayments' },
  { table: 'expenses', dexie: 'expenses' },
  { table: 'audit_logs', dexie: 'auditLogs' },
  { table: 'work_sessions', dexie: 'workSessions' },
];

/**
 * Whether this role is handed the shop's activity log (audit_logs). It is the
 * boss's record of what everyone did — the anomalies, the refunds, who opened
 * the app at midnight — so the cloud pull gives it to these roles alone (see
 * pullTable in sync.ts), and the hub exchange does the same. The same roles as
 * the store's isBoss().
 */
export function seesShopActivity(role: string | null | undefined): boolean {
  return role === 'boss' || role === 'admin' || role === 'superadmin';
}

function cursorKey(shopId: string, table: string): string {
  return `hubCursor_${shopId}_${table}`;
}

/** Take this table from the hub's first row again, on the next exchange. */
export function resetHubCursor(shopId: string, table: string): void {
  try {
    localStorage.removeItem(cursorKey(shopId, table));
  } catch {
    /* ignore */
  }
}

function readCursor(shopId: string, table: string): number {
  try {
    return Number(localStorage.getItem(cursorKey(shopId, table))) || 0;
  } catch {
    return 0;
  }
}

function writeCursor(shopId: string, table: string, value: number): void {
  try {
    localStorage.setItem(cursorKey(shopId, table), String(value));
  } catch {
    /* ignore */
  }
}

/** Rows per push. */
const SEND_BATCH = 300;
/**
 * How long one exchange keeps sending before it moves on. Every table gets at
 * least one batch; whatever is left goes in the next exchange.
 */
const SEND_BUDGET_MS = 3_000;

/**
 * The next rows of a table to send to the hub: this device's own new changes
 * first — the ones not in the cloud either (`synced` not 1), like a sale just
 * rung up — and only then what it passes on, such as history it pulled from
 * the cloud. In key order alone, a new sale waited behind that history for as
 * many exchanges as it took to get through it.
 */
async function nextToSend(local: any, shopId: string): Promise<any[]> {
  const ours = (r: any) => !r.shop_id || r.shop_id === shopId;
  let rows: any[];
  try {
    rows = await local.where('hub_synced').equals(0).filter((r: any) => r.synced !== 1 && ours(r)).limit(SEND_BATCH).toArray();
    if (rows.length < SEND_BATCH) {
      rows = rows.concat(await local.where('hub_synced').equals(0).filter((r: any) => r.synced === 1 && ours(r)).limit(SEND_BATCH - rows.length).toArray());
    }
  } catch {
    // The index is missing (an older database that has not upgraded yet).
    rows = (await local.toArray()).filter((r: any) => r.hub_synced !== 1 && ours(r)).slice(0, SEND_BATCH);
  }
  // A row with no hub_synced at all predates the hub: it still needs sending.
  if (rows.length === 0) {
    rows = await local.filter((r: any) => r.hub_synced === undefined && r.shop_id === shopId).limit(SEND_BATCH).toArray();
  }
  return rows;
}

export interface HubSyncResult {
  ok: boolean;
  reason?: 'no_hub' | 'unreachable' | 'not_paired' | 'other_shop';
  pushed: number;
  pulled: number;
  conflicts: any[];
  licence: { verifiedAt: number; licence: any } | null;
}

export interface HubDevice {
  deviceId: string;
  /** e.g. "Simu (3f2a)" — the kind of device, from when it joined. */
  label: string;
  /** Who was signed in on it at its last sync. */
  userName: string | null;
  role: string | null;
  pairedAt: string;
  /** Any request at all — the device can see the hub. */
  lastSeen: string;
  /** Its last pull or push — the device is actually syncing. */
  lastSyncAt: string | null;
  /** The device asking. */
  you: boolean;
}

export interface HubDeviceList {
  devices: HubDevice[];
  /** Is the device asking the hub's own computer — the shop's main device? */
  local: boolean;
  /** The hub's clock, which stamped every `lastSeen`. */
  now: string;
}

/** Every device joined to this shop's hub, as the hub sees them. */
export async function listHubDevices(): Promise<HubDeviceList | null> {
  const cfg = getHubConfig();
  if (!cfg) return null;
  const res = await request(cfg.url, '/hub/devices', {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.token}` },
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  return {
    devices: Array.isArray(res?.devices) ? res.devices : [],
    local: res?.local === true,
    now: String(res?.now ?? new Date().toISOString()),
  };
}

/** Is the paired hub reachable right now? Cheap enough to ask every cycle. */
export async function hubReachable(): Promise<boolean> {
  const cfg = getHubConfig();
  if (!cfg) return false;
  try {
    const hello = await hubHello(cfg.url);
    return hello.hubId === cfg.hubId;
  } catch {
    return false;
  }
}

/** How long one wait for news stays open at the hub before it is asked again. */
export const HUB_WAIT_MS = 25_000;

/**
 * Waits at the hub for another device's change.
 *
 * The hub answers the moment a push lands there (or after HUB_WAIT_MS with no
 * news), so a sale on one phone reaches the others within a second instead of
 * at their next round. `since` is the hub's change number this device has
 * caught up to; null asks where things stand. Null back means a hub from
 * before waits existed, which only knows the regular round.
 */
export async function waitForHubChange(since: number | null): Promise<{ seq: number; changed: boolean } | null> {
  const cfg = getHubConfig();
  if (!cfg) throw new Error('no_hub');
  const res = await hubRequest(`${cfg.url}/hub/wait?since=${since ?? ''}&timeout=${HUB_WAIT_MS}`, {
    method: 'GET',
    headers: { ...whoHeader(), Authorization: `Bearer ${cfg.token}` },
    // Longer than the hub holds it, so the hub is the one that ends it.
    timeoutMs: HUB_WAIT_MS + 10_000,
  });
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) throw new Error(res.body?.error || `hub ${res.status}`);
  return { seq: Number(res.body?.seq) || 0, changed: res.body?.changed === true };
}

/** Has this device written anything the hub has not had yet? Asks the local database only. */
export async function hubHasPending(): Promise<boolean> {
  for (const { dexie } of HUB_TABLES) {
    const local: any = (db as any)[dexie];
    if (!local) continue;
    try {
      if (await local.where('hub_synced').equals(0).count()) return true;
    } catch {
      return true; // no index yet (an older database): a full exchange sorts it out
    }
  }
  return false;
}

/**
 * One exchange with the hub: send what it has not seen, take what this device
 * has not seen.
 *
 * Rows that arrive are marked `hub_synced: 1, synced: 0` — the hub has them,
 * the cloud has not — so whichever device next reaches the internet carries
 * them up. Rows that arrive from the CLOUD are marked the other way round, in
 * the cloud sync. That is the whole relay: two flags, and every row travels
 * until both are set.
 */
export async function syncWithHub(applyRows: (dexieTable: string, rows: any[]) => Promise<number>): Promise<HubSyncResult> {
  const cfg = getHubConfig();
  const out: HubSyncResult = { ok: false, pushed: 0, pulled: 0, conflicts: [], licence: null };
  if (!cfg) return { ...out, reason: 'no_hub' };

  const shopId = useStore.getState().user?.shopId;
  if (!shopId || shopId !== cfg.shopId) return { ...out, reason: 'other_shop' };

  const auth = { Authorization: `Bearer ${cfg.token}` };
  const sendStarted = Date.now();

  for (const { table, dexie } of HUB_TABLES) {
    const local: any = (db as any)[dexie];
    if (!local) continue;

    // ---- send ------------------------------------------------------------
    // Batch after batch until the table is sent or the budget is spent — not
    // one batch per exchange, which took a shop's history a round at a time.
    for (let batch = 0; batch === 0 || Date.now() - sendStarted < SEND_BUDGET_MS; batch++) {
      const pending = await nextToSend(local, shopId);
      if (!pending.length) break;

      // Claim each product's delta on disk BEFORE sending it, and re-send an
      // existing claim unchanged. Without this, a run interrupted between the
      // request and the bookkeeping either loses the delta or sends a second,
      // different one — and with two sync paths there are twice the chances.
      if (table === 'products') {
        // One transaction for the batch: still on disk before the request, in
        // one trip to the database rather than one per row.
        await db.transaction('rw', local, async () => {
          for (const row of pending) {
            if (row.hub_pending_id) {
              row.hub_pending_delta = Number(row.hub_pending_delta) || 0;
            } else {
              const claim = {
                hub_pending_id: `${row.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                hub_pending_delta: Number(row.hub_delta) || 0,
              };
              await local.update(row.id, { ...claim, sync_ack: Date.now() });
              row.hub_pending_id = claim.hub_pending_id;
              row.hub_pending_delta = claim.hub_pending_delta;
            }
          }
        });
      }

      const rows = pending.map((row: any) => {
        const payload: any = { ...row };
        delete payload.synced;
        delete payload.hub_synced;
        delete payload.sync_ack;
        delete payload.hub_pending_id;
        delete payload.hub_pending_delta;
        delete payload.hub_counted_delta;
        delete payload.hub_count_id;
        delete payload.hub_counted_stock;
        delete payload.hub_counted_base;
        delete payload.hub_counted_claim_id;
        // The CLOUD's bookkeeping. It travels to the cloud and nowhere else:
        // its count was worked out from what this device owes THE CLOUD, and
        // handing it to the hub would move the shop's stock by the difference
        // between the two.
        delete payload.pending_delta;
        delete payload.pending_delta_id;
        delete payload.counted_claim_id;
        delete payload.count_id;
        delete payload.counted_stock;
        delete payload.counted_base;
        delete payload.counted_delta;
        if (table === 'products') {
          // The hub's own accumulator, claimed the way the cloud push claims
          // its own: what is sent now is what is cleared when it lands.
          payload.stock_delta = Number(row.hub_pending_delta) || 0;
          // The claim IS the id the hub de-duplicates on, so a resend of the
          // same claim moves the stock once.
          payload.delta_id = row.hub_pending_id;
          if (row.hub_count_id && row.hub_counted_stock != null) {
            // The hub's own copy of the count: the same shelf, measured
            // against what this device owed THE HUB when it was counted.
            payload.count_id = `${row.hub_count_id}`;
            payload.counted_stock = row.hub_counted_stock;
            payload.counted_base = row.hub_counted_base;
            payload.counted_delta = row.hub_counted_delta ?? 0;
          }
        }
        delete payload.hub_delta;
        return payload;
      });

      let res: any;
      try {
        res = await request(cfg.url, '/hub/push', { method: 'POST', headers: auth, body: JSON.stringify({ table, rows }) });
      } catch (err: any) {
        if (String(err?.message).includes('not_paired')) return { ...out, reason: 'not_paired' };
        return { ...out, reason: 'unreachable' };
      }

      if (Array.isArray(res.conflicts) && res.conflicts.length) {
        // The count travelled net of the delta that was in flight when the
        // shelf was counted (see db.ts), which is right for the arithmetic and
        // meaningless to a shopkeeper. Put it back, so the warning carries the
        // number that was actually typed.
        out.conflicts.push(...res.conflicts.map((clash: any) => {
          const row = pending.find((r: any) => r.id === clash.product_id);
          const inFlight = Number(row?.hub_pending_delta) || 0;
          if (!inFlight) return clash;
          return {
            ...clash,
            counted_stock: Number(clash.counted_stock) + inFlight,
            counted_base: Number(clash.counted_base) + inFlight,
            server_stock: Number(clash.server_stock) + inFlight,
          };
        }));
      }

      // Products the hub had never seen: it stores the absolute figure the
      // device sent rather than building the stock up from differences, so
      // everything that travelled with the row was consumed by that one write.
      const created = new Set<string>(
        Array.isArray(res?.inserted) ? res.inserted.map((x: any) => String(x)) : [],
      );

      // One transaction for the batch rather than one write per row.
      await db.transaction('rw', local, async () => {
        for (const row of pending) {
          const current = await local.get(row.id);
          if (!current) continue;
          const patch: any = { hub_synced: 1, sync_ack: Date.now() };
          if (table === 'products') {
            // Ordinarily: subtract only what was actually sent, so anything
            // added while the request was in flight stays owed and goes out
            // under a fresh claim. The same two exceptions as the cloud path —
            // a row the hub has just created from an absolute figure, and a
            // count that was recorded net of this very claim.
            const sent = Number(row.hub_pending_delta) || 0;
            const absorbed = current.hub_counted_claim_id != null
              && current.hub_counted_claim_id === row.hub_pending_id;
            patch.hub_delta = created.has(String(row.id))
              ? (Number(current.stock) || 0) - (Number(row.stock) || 0)
              : absorbed
                ? (Number(current.hub_delta) || 0)
                : (Number(current.hub_delta) || 0) - sent;
            patch.hub_pending_id = null;
            patch.hub_pending_delta = null;

            // Clear the count only if it is still the one that was sent: a shelf
            // counted while the request was in flight has not been anywhere yet.
            const sentCount = row.hub_count_id != null && row.hub_count_id === (current.hub_count_id ?? null);
            if (sentCount) {
              patch.hub_count_id = null;
              patch.hub_counted_stock = null;
              patch.hub_counted_base = null;
              patch.hub_counted_delta = null;
              patch.hub_counted_claim_id = null;
            }
            if (patch.hub_delta !== 0 || (current.hub_count_id && !sentCount)) patch.hub_synced = 0;
          }
          await local.update(row.id, patch);
        }
      });
      out.pushed += pending.length;
      if (pending.length < SEND_BATCH) break;
    }

    // ---- receive ---------------------------------------------------------
    // A staff device sends its own activity log to the hub, for the boss, and
    // takes none back. Its place in the log stays put, so a boss who signs in
    // on this device later still gets the whole of it.
    if (table === 'audit_logs' && !seesShopActivity(useStore.getState().user?.role)) continue;

    let since = readCursor(shopId, table);
    for (let page = 0; page < 20; page++) {
      let res: any;
      try {
        res = await request(cfg.url, `/hub/pull?table=${table}&since=${since}&limit=300`, { method: 'GET', headers: auth });
      } catch (err: any) {
        if (String(err?.message).includes('not_paired')) return { ...out, reason: 'not_paired' };
        return { ...out, reason: 'unreachable' };
      }
      const rows: any[] = Array.isArray(res.rows) ? res.rows : [];
      if (!rows.length) break;
      out.pulled += await applyRows(dexie, rows);
      since = Number(res.next) || since;
      writeCursor(shopId, table, since);
      if (!res.more) break;
    }
  }

  // ---- the licence a device with internet left behind ---------------------
  try {
    const res = await request(cfg.url, '/hub/licence', { method: 'GET', headers: auth });
    if (res?.licence?.licence && res.licence.shopId === shopId) {
      out.licence = { verifiedAt: Number(res.licence.verifiedAt) || 0, licence: res.licence.licence };
    }
  } catch {
    /* the hub is old or the licence is not there yet */
  }

  out.ok = true;
  return out;
}

/**
 * The licence alone, for a device that is locked out.
 *
 * A device past its offline grace period syncs nothing — which would include
 * the very licence that unlocks it, so it could never recover inside a shop
 * with no internet. This asks for that one thing and nothing else.
 */
export async function fetchHubLicence(): Promise<{ verifiedAt: number; licence: any } | null> {
  const cfg = getHubConfig();
  const shopId = useStore.getState().user?.shopId;
  if (!cfg || !shopId || shopId !== cfg.shopId) return null;
  try {
    const res = await request(cfg.url, '/hub/licence', { method: 'GET', headers: { Authorization: `Bearer ${cfg.token}` } });
    if (res?.licence?.licence && res.licence.shopId === shopId) {
      return { verifiedAt: Number(res.licence.verifiedAt) || 0, licence: res.licence.licence };
    }
  } catch {
    /* the hub is off */
  }
  return null;
}

/**
 * Leave this device's own verification behind for the phones that never reach
 * the internet. Called after a successful licence check against Supabase.
 */
export async function publishLicenceToHub(licence: any, verifiedAt?: number): Promise<boolean> {
  const cfg = getHubConfig();
  const shopId = useStore.getState().user?.shopId;
  if (!cfg || !shopId || shopId !== cfg.shopId || !licence) return false;
  try {
    await request(cfg.url, '/hub/licence', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}` },
      // When the licence was actually read from the server — passed in by the
      // caller, which is the only place that knows whether the server was
      // reached at all. Falling back to `nowMs` (and not Date.now) for a
      // direct caller: the grace period this buys other devices is measured
      // from it, and a till with a wrong clock must not hand out a
      // verification dated next month.
      body: JSON.stringify({ shopId, licence, verifiedAt: Number(verifiedAt) || nowMs() }),
    });
    return true;
  } catch {
    return false;
  }
}
