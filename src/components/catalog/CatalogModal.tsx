import { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { X, ArrowLeft, Loader2, CheckCircle2, Package, AlertTriangle } from 'lucide-react';
import { db, Product } from '../../db';
import { SyncService } from '../../services/sync';
import {
  CATALOG_CATEGORIES,
  CatalogItem,
  CatalogDraft,
  fetchCatalog,
  draftFromItem,
  getOwnedCatalogIds,
} from '../../services/catalog';
import CatalogSelectStep from './CatalogSelectStep';
import CatalogDetailsStep from './CatalogDetailsStep';
import GhostClickGuard from '../GhostClickGuard';
import { useTap } from '../../utils/useTap';

type Step = 'category' | 'loading' | 'select' | 'details' | 'saving' | 'done' | 'error';

export default function CatalogModal({
  show,
  onClose,
  shopId,
  enableExpiry,
  currency,
  stockEnabled,
  onSaved,
}: {
  show: boolean;
  onClose: () => void;
  shopId: string;
  enableExpiry: boolean;
  currency: string;
  stockEnabled: boolean;
  onSaved?: (count: number) => void;
}) {
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<CatalogDraft[]>([]);
  const [error, setError] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [owned, setOwned] = useState<Set<string>>(new Set()); // catalog-ids this shop already has

  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(420);
  const detailsEnteredAt = useRef(0); // when we landed on the details step (for the ghost-click guard below)

  useEffect(() => {
    if (!show) return;
    const measure = () => { if (listRef.current) setListHeight(listRef.current.clientHeight); };
    const id = setTimeout(measure, 0);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(id); window.removeEventListener('resize', measure); };
  }, [show, step]);

  useEffect(() => {
    if (!show) {
      setStep('category'); setCategory(null); setItems([]); setSelected(new Set());
      setDrafts([]); setError(''); setSavedCount(0); setProgress(0); setOwned(new Set());
    }
  }, [show]);

  // NOTE: every hook must run before the early return below — never after it.
  const totalValue = useMemo(
    () => drafts.reduce((sum, d) => sum + (Number(d.sell_price) || 0) * (Number(d.stock) || 0), 0),
    [drafts]
  );
  const tap = useTap();

  if (!show) return null;

  const pickCategory = async (key: string) => {
    setCategory(key);
    setStep('loading');
    setError('');
    try {
      const data = await fetchCatalog(key);
      setItems(data);
      setSelected(new Set());
      try { setOwned(await getOwnedCatalogIds(shopId)); } catch { setOwned(new Set()); }
      setStep('select');
    } catch (e: any) {
      const offline = (typeof navigator !== 'undefined' && !navigator.onLine) || e?.message === 'OFFLINE';
      setError(
        offline
          ? 'Hauko mtandaoni (offline). Bidhaa hizi bado hazijapakuliwa kwenye kifaa hiki — washa mtandao (data au WiFi) kisha jaribu tena.'
          : 'Imeshindwa kupakua orodha ya bidhaa. Angalia mtandao wako kisha jaribu tena.'
      );
      setStep('error');
    }
  };

  const goToDetails = () => {
    const chosen = items.filter((i) => selected.has(i.id));
    setDrafts(chosen.map((i) => ({ ...draftFromItem(i, 30), track_stock: stockEnabled })));
    detailsEnteredAt.current = Date.now();
    setStep('details');
  };

  const updateDraft = (id: string, patch: Partial<CatalogDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.catalogId === id ? { ...d, ...patch } : d)));
  const removeDraft = (id: string) => setDrafts((ds) => ds.filter((d) => d.catalogId !== id));
  const applyBulk = (patch: Partial<CatalogDraft>) => setDrafts((ds) => ds.map((d) => ({ ...d, ...patch })));

  const save = async () => {
    // Ignore a save fired within 500ms of landing on the details step — that's the iOS ghost
    // click from tapping "Endelea", which sits directly above this "Hifadhi" button.
    if (Date.now() - detailsEnteredAt.current < 500) return;
    setStep('saving');
    setProgress(0);
    try {
      const valid = drafts.filter((d) => d.name.trim());

      // Load this shop's existing catalog-linked products (incl. soft-deleted) so a re-import
      // REVIVES the same row (isDeleted → 0, id reused) instead of creating a duplicate.
      const existingByCatalogId = new Map<string, Product>();
      await db.products.where('shop_id').equals(shopId).each((p) => {
        if (p.catalog_id) existingByCatalogId.set(p.catalog_id, p);
      });

      const CHUNK = 500;
      let saved = 0;
      for (let i = 0; i < valid.length; i += CHUNK) {
        const chunk = valid.slice(i, i + CHUNK);
        const products: Product[] = chunk.map((d) => {
          const track = !!d.track_stock;
          const stock = track ? Number(d.stock) || 0 : 0;
          const existing = existingByCatalogId.get(d.catalogId);
          const priorStock = existing?.stock || 0;
          const now = new Date().toISOString();
          const batches =
            enableExpiry && d.expiry_date
              ? [
                  {
                    id: uuidv4(),
                    batch_number:
                      'CAT-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5),
                    expiry_date: new Date(d.expiry_date).toISOString(),
                    stock,
                  },
                ]
              : [];
          return {
            id: existing?.id || uuidv4(), // reuse the id → revive rather than duplicate
            shop_id: shopId,
            name: d.name.trim(),
            buy_price: Number(d.buy_price) || 0,
            sell_price: Number(d.sell_price) || 0,
            stock,
            // Delta the server toward the entered stock. existing.stock is our known server value
            // (0 for a brand-new product → delta === stock, matching a fresh import).
            stock_delta: track ? stock - priorStock : 0,
            min_stock: existing?.min_stock ?? 0,
            notify_expiry_days:
              enableExpiry && d.notify_expiry_days !== '' ? Number(d.notify_expiry_days) : undefined,
            unit: d.unit || 'pcs',
            batches,
            track_stock: track,
            catalog_id: d.catalogId,
            created_at: existing?.created_at || now,
            updated_at: now,
            synced: 0,
            isDeleted: 0,
          } as Product;
        });
        await db.transaction('rw', db.products, async () => {
          await db.products.bulkPut(products);
        });
        saved += products.length;
        setProgress(Math.round((saved / Math.max(1, valid.length)) * 100));
      }
      setSavedCount(saved);
      if (saved > 0) SyncService.logAction('import_products', { count: saved, source: 'catalog', category });
      SyncService.sync();
      try { setOwned(await getOwnedCatalogIds(shopId)); } catch { /* ignore */ }
      setStep('done');
      onSaved?.(saved);
    } catch (e: any) {
      setError(e?.message || 'Imeshindwa kuhifadhi bidhaa. Jaribu tena.');
      setStep('error');
    }
  };

  const titles: Record<Step, string> = {
    category: 'Pakua Orodha ya Bidhaa',
    loading: 'Inapakua...',
    select: 'Chagua Bidhaa',
    details: 'Kamilisha Bidhaa',
    saving: 'Inahifadhi...',
    done: 'Imekamilika',
    error: 'Tatizo',
  };

  const canBack = step === 'select' || step === 'details';
  const goBack = () => {
    if (step === 'details') setStep('select');
    else if (step === 'select') setStep('category');
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-[100dvh] bg-gray-50 flex flex-col pt-[env(safe-area-inset-top)]">
      {/* Absorb the iOS ghost click from the opening tap AND from every step transition
          (keyed by step → re-arms on each change, e.g. Endelea → details delete buttons). */}
      <GhostClickGuard key={step} />
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white">
        {canBack ? (
          <button type="button" onClick={goBack} className="p-1 text-gray-600"><ArrowLeft className="w-5 h-5" /></button>
        ) : (
          <Package className="w-5 h-5 text-blue-600" />
        )}
        <h2 className="flex-1 font-bold text-gray-900">{titles[step]}</h2>
        <button type="button" onClick={onClose} className="p-1 text-gray-500"><X className="w-5 h-5" /></button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col p-4">
        {step === 'category' && (
          <div className="grid grid-cols-2 gap-3">
            {CATALOG_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={!c.active}
                onClick={tap(() => { if (c.active) pickCategory(c.key); })}
                onPointerUp={tap(() => { if (c.active) pickCategory(c.key); })}
                className={`flex flex-col items-center gap-2 p-5 rounded-2xl border text-center transition-colors ${
                  c.active ? 'bg-white border-gray-200 active:bg-blue-50' : 'bg-gray-100 border-gray-100 opacity-60'
                }`}
              >
                <span className="text-3xl">{c.emoji}</span>
                <span className="font-semibold text-sm text-gray-900">{c.label}</span>
                {!c.active && <span className="text-[10px] text-gray-400">Inakuja hivi karibuni</span>}
              </button>
            ))}
          </div>
        )}

        {step === 'loading' && (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
            <p className="text-sm">Inapakua orodha ya bidhaa...</p>
          </div>
        )}

        {step === 'select' && (
          <div ref={listRef} className="flex-1 min-h-0">
            <CatalogSelectStep
              items={items}
              selected={selected}
              setSelected={setSelected}
              currency={currency}
              owned={owned}
              listHeight={listHeight}
            />
          </div>
        )}

        {step === 'details' && (
          <div ref={listRef} className="flex-1 min-h-0">
            <CatalogDetailsStep
              drafts={drafts}
              update={updateDraft}
              remove={removeDraft}
              applyBulk={applyBulk}
              expiryEnabled={enableExpiry}
              stockEnabled={stockEnabled}
              listHeight={listHeight}
            />
          </div>
        )}

        {step === 'saving' && (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
            <p className="text-sm">Inahifadhi bidhaa... {progress}%</p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <CheckCircle2 className="w-16 h-16 text-green-500 mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-1">Bidhaa {savedCount} zimeongezwa!</h3>
            <p className="text-sm text-gray-500 max-w-xs">Bidhaa zako zimeingia kwenye mfumo.</p>
          </div>
        )}

        {step === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <AlertTriangle className="w-14 h-14 text-red-500 mb-4" />
            <p className="text-sm text-gray-600 max-w-xs mb-4">{error}</p>
            <button type="button" onClick={() => setStep('category')} className="text-blue-600 font-semibold">Anza upya</button>
          </div>
        )}
      </div>

      {/* Footer */}
      {step === 'select' && (
        <div className="px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-gray-200 bg-white shrink-0">
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={tap(goToDetails)}
            onPointerUp={tap(goToDetails)}
            className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-bold disabled:bg-gray-300"
          >
            Endelea ({selected.size})
          </button>
        </div>
      )}

      {step === 'details' && (
        <div className="px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-gray-200 bg-white shrink-0">
          <div className="flex items-center justify-between mb-2 text-xs">
            <span className="text-gray-500">Bidhaa {drafts.length}</span>
            <span className="text-gray-500">Thamani ya hisa/Mtaji: <span className="font-semibold text-gray-900">{currency} {totalValue.toLocaleString()}</span></span>
          </div>
          <button
            type="button"
            disabled={drafts.length === 0}
            onClick={tap(save)}
            onPointerUp={tap(save)}
            className="w-full py-3.5 rounded-xl bg-green-600 text-white font-bold disabled:bg-gray-300"
          >
            Hifadhi Bidhaa {drafts.length}
          </button>
        </div>
      )}

      {step === 'done' && (
        <div className="px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-gray-200 bg-white shrink-0">
          <button type="button" onClick={tap(onClose)} onPointerUp={tap(onClose)} className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-bold">Funga</button>
        </div>
      )}
    </div>
  );
}
