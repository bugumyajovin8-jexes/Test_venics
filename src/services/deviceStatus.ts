/**
 * What this computer says about itself, for support.
 *
 * When a boss calls ("kompyuta haitumi mauzo"), the superadmin opens the
 * shop's health page (Superadmin app) and sees each device: when it last
 * synced, whether the last sync failed and why, what it still has not sent
 * and since when, its build, its licence verdict and its clock. None of that
 * was visible before — the 9 November problem was found by guessing.
 *
 * One small row per device and person (public.device_status, Mobile app:
 * supabase/migrations/20261111_device_status.sql), OVERWRITTEN each time —
 * it never grows. Kept cheap on purpose (disk I/O, egress, storage):
 *   * at most once an hour while nothing important changes;
 *   * sooner only when something does — the sync starts failing or
 *     recovers, another shop, a new build — and never twice within 2 minutes;
 *   * the check that runs after every sync costs nothing: the device's
 *     unsent rows are counted only when a report is actually due;
 *   * only when online, after the sync, never in its way;
 *   * about 0.6 KB up, an empty reply down; no sales, names or numbers —
 *     counts, times and a short error;
 *   * if the server does not have the table yet, it stops trying until the
 *     app restarts.
 */

import { supabase } from '../supabase';
import { useStore } from '../store';
import { SyncService } from './sync';
import { LicenseService } from './license';
import { getDeviceId, getDeviceLabel } from './deviceId';
import { clockStatus } from './clock';
import { getHubConfig } from './hub';

const APP = 'desktop';
/** "Still here" when nothing important has changed. */
const HEARTBEAT_MS = 60 * 60 * 1000;
/** Never two reports closer than this, whatever changes. */
const MIN_GAP_MS = 2 * 60 * 1000;

let lastSentAt = 0;
let lastKey = '';
let busy = false;
let disabled = false;

/** Long digit runs (phone numbers) out of an error before it leaves the device. */
const scrub = (text: string) => text.replace(/\+?\d{9,}/g, '<number>');

/** The kind of machine the web app runs on. */
function platform(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/windows/i.test(ua)) return 'windows';
  if (/android/i.test(ua)) return 'android-browser';
  if (/iphone|ipad/i.test(ua)) return 'ios-browser';
  if (/mac os/i.test(ua)) return 'mac';
  if (/linux/i.test(ua)) return 'linux';
  return 'web';
}

/** Sends the report if something changed or it is due. True when one was sent. */
export async function reportDeviceStatus(opts: { force?: boolean; now?: number } = {}): Promise<boolean> {
  if (busy || disabled) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const state: any = useStore.getState();
  const user = state.user;
  if (!state.isAuthenticated || !user?.id) return false;
  const shopId: string | null = user.shopId || user.shop_id || null;

  // Due? Decided from what is already in memory, before anything is read.
  const now = opts.now ?? Date.now();
  const syncOk = state.syncHealth !== 'error';
  const build = typeof __APP_BUILD__ === 'string' && __APP_BUILD__ ? __APP_BUILD__ : null;
  const key = [shopId, syncOk, build].join('|');
  const since = now - lastSentAt;
  const due = opts.force || (key !== lastKey ? since >= MIN_GAP_MS : since >= HEARTBEAT_MS);
  if (!due) return false;

  busy = true;
  try {
    const pending = await SyncService.getPendingCounts();
    const error = SyncService.lastSyncError;

    const clock = clockStatus();
    const lastSync = SyncService.getLastSyncAt();
    const row = {
      device_id: getDeviceId(),
      user_id: user.id,
      shop_id: shopId,
      app: APP,
      platform: platform(),
      device_label: getDeviceLabel(),
      app_build: build,
      native_version: null,
      // On the server's clock, as far as this device knows it.
      last_sync_at: lastSync ? new Date(lastSync + (clock.offsetMs || 0)).toISOString() : null,
      sync_ok: syncOk,
      last_error: error ? scrub(error) : null,
      unsent_total: pending.total,
      unsent_on_hub: pending.onHub,
      unsent: pending.byTable,
      oldest_unsent_at: pending.oldestAt ? new Date(pending.oldestAt).toISOString() : null,
      licence_state: LicenseService.lastKnownStatus(),
      clock_offset_ms: Math.round(clock.offsetMs || 0),
      hub: !!getHubConfig(),
    };

    const { error: failed } = await supabase.from('device_status').upsert(row, { onConflict: 'device_id,user_id' });
    if (failed) {
      // The server has not been given the table yet, or will not take this row: not again this session.
      if (['PGRST205', '42P01', '42501'].includes((failed as any).code) || /device_status/i.test(failed.message ?? '')) disabled = true;
      return false;
    }
    lastSentAt = now;
    lastKey = key;
    return true;
  } catch {
    return false;
  } finally {
    busy = false;
  }
}
