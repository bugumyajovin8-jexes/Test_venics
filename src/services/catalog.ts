import { supabase } from '../supabase';
import { db } from '../db';

// Shop categories shown in the catalog picker. Only pharmacy is live for now; the rest are
// displayed as "coming soon" so the UI is ready to scale without a redesign.
export interface CatalogCategory {
  key: string;
  label: string;   // Swahili label
  emoji: string;
  active: boolean;
}

export const CATALOG_CATEGORIES: CatalogCategory[] = [
  { key: 'pharmacy', label: 'Duka la Dawa', emoji: '💊', active: true },
  { key: 'cosmetics', label: 'Vipodozi', emoji: '💄', active: false },
  { key: 'electronics', label: 'Elektroniki', emoji: '📱', active: false },
  { key: 'groceries', label: 'Mahitaji ya Nyumbani', emoji: '🛒', active: false },
  { key: 'hardware', label: 'Vifaa vya Ujenzi', emoji: '🔧', active: false },
  { key: 'stationery', label: 'Vifaa vya Ofisi', emoji: '✏️', active: false },
];

// A reference product from the Supabase `catalog_products` table (global, read-only).
export interface CatalogItem {
  id: string;
  category: string;
  name: string;
  sub_category: string | null;
  default_buy_price: number;
  default_sell_price: number;
  unit: string;
  sort_order: number | null;
}

// The editable working copy for a selected product, before it's saved into the shop.
export interface CatalogDraft {
  catalogId: string;
  name: string;
  unit: string;
  buy_price: number | '';
  sell_price: number | '';
  stock: number | '';
  track_stock: boolean;
  expiry_date: string;          // 'YYYY-MM-DD' or ''
  notify_expiry_days: number | '';
}

const CATALOG_CACHE_PREFIX = 'venics_catalog_cache_';
const CATALOG_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function readCatalogCache(category: string): { fetchedAt: number; items: CatalogItem[] } | null {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_PREFIX + category);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) return parsed;
  } catch { /* ignore corrupt cache */ }
  return null;
}

function writeCatalogCache(category: string, items: CatalogItem[]) {
  try {
    localStorage.setItem(CATALOG_CACHE_PREFIX + category, JSON.stringify({ fetchedAt: Date.now(), items }));
  } catch { /* quota / private mode — just skip caching */ }
}

async function fetchCatalogFromServer(category: string): Promise<CatalogItem[]> {
  const all: CatalogItem[] = [];
  const PAGE = 1000;
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('catalog_products')
      .select('id, category, name, sub_category, default_buy_price, default_sell_price, unit, sort_order')
      .eq('category', category)
      .eq('is_active', true)
      .order('sub_category', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as CatalogItem[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Fetch a category, caching it in localStorage after the first successful download so we
// don't hit Supabase on every open. Uses the cache when it's fresh, when the device is
// offline, or when a network error occurs; only re-downloads once the cache is older than
// CATALOG_CACHE_TTL (or forceRefresh is passed). Throws 'OFFLINE' if offline with no cache.
export async function fetchCatalog(category: string, opts?: { forceRefresh?: boolean }): Promise<CatalogItem[]> {
  const cached = readCatalogCache(category);
  const isFresh = !!cached && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL;

  if (isFresh && !opts?.forceRefresh) return cached!.items;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (cached) return cached.items;
    throw new Error('OFFLINE');
  }

  try {
    const items = await fetchCatalogFromServer(category);
    writeCatalogCache(category, items);
    return items;
  } catch (e) {
    if (cached) return cached.items; // fall back to a previously downloaded copy
    throw e;
  }
}

// Catalog-ids this shop currently OWNS (has a non-deleted product for). Used to mark items
// the boss already imported so they aren't offered again. A soft-deleted product
// (isDeleted === 1) does NOT count — the boss no longer has it, so it can be re-imported.
export async function getOwnedCatalogIds(shopId: string): Promise<Set<string>> {
  const owned = new Set<string>();
  await db.products.where('shop_id').equals(shopId).each((p) => {
    if (p.catalog_id && p.isDeleted !== 1) owned.add(p.catalog_id);
  });
  return owned;
}

export function draftFromItem(item: CatalogItem, defaultNotifyDays: number): CatalogDraft {
  return {
    catalogId: item.id,
    name: item.name,
    unit: item.unit || 'pcs',
    buy_price: item.default_buy_price || '',
    sell_price: item.default_sell_price || '',
    stock: '',
    track_stock: true,
    expiry_date: '',
    notify_expiry_days: defaultNotifyDays,
  };
}

export const numToInput = (v: number | ''): string => (v === '' ? '' : String(v));
export const inputToNum = (s: string): number | '' => {
  if (s.trim() === '') return '';
  const n = Number(s);
  return isNaN(n) ? '' : n;
};
