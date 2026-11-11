/**
 * Hesabu ya Stoo — stock taking (services/stockTake.ts).
 *
 *   home    the count in progress (or the way to start one), past counts, and
 *           for the boss, losses count by count
 *   count   the products, one figure each; Enter moves to the next. Venics's
 *           own figures are hidden from whoever counts (always for staff)
 *   review  boss: every difference in shillings, a reason for each shortage,
 *           approve. Staff: what they counted, sent to the boss
 *   detail  a past count, with its PDF
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ClipboardList, ClipboardCheck, Search, Minus, Plus, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle,
  TrendingDown, Eye, EyeOff, Send, X, Info, Keyboard, Play, Package, Clock, User, FileDown, RefreshCw, Ban,
} from 'lucide-react';
import { db, type Product, type StockTake, type StockTakeItem } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { nowIso } from '../services/clock';
import { monthNames, t, tData } from '../i18n';
import {
  REASONS, UNKNOWN_REASON, approveTake, cancelTake, countable, inScope, recordCount, setReason,
  startTake, submitTake, summarize, syncStockTakesNow,
} from '../services/stockTake';
import { exportStockTakePdf } from '../services/stockTakePdf';

const PAGE = 100;

function day(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${monthNames()[d.getMonth()]} ${d.getFullYear()}`;
}
function time(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm ${className}`}>{children}</div>;
}
function Stat({ label, value, sub, tone = 'text-gray-900' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums whitespace-nowrap ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </Card>
  );
}
function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold text-gray-600 mb-1.5">
        <span>{t('Zimehesabiwa {done} kati ya {total}', { done, total })}</span><span>{pct}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
function Back({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-sm font-semibold text-gray-600 hover:text-gray-900 mb-3 cursor-pointer">
      <ChevronLeft className="w-4 h-4" /> {label}
    </button>
  );
}

export default function HesabuYaStoo() {
  const { user, isBoss, showConfirm, showAlert, showToast, isFeatureEnabled } = useStore();
  const boss = isBoss();
  // The boss, or staff allowed to add and edit products: they review in
  // shillings, approve and cancel. The same rule as canApproveStockTakes()
  // in services/stockTake.ts, read here from the store so the page follows it.
  const approver = boss || isFeatureEnabled('staff_product_management');
  const shopId: string | undefined = (user as any)?.shopId || (user as any)?.shop_id;
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  const shop = useLiveQuery(() => (shopId ? db.shops.get(shopId) : undefined), [shopId]);
  const tsh = (n: number) => formatCurrency(Math.abs(n), currency);
  const signed = (n: number) => (n < 0 ? `−${tsh(n)}` : n > 0 ? `+${tsh(n)}` : tsh(0));

  const productQuery = useLiveQuery(
    () => (shopId ? db.products.where('[shop_id+isDeleted]').equals([shopId, 0]).toArray() : Promise.resolve([] as Product[])),
    [shopId],
  );
  const productRows = productQuery ?? [];
  const products = useMemo(() => countable(productRows).sort((a, b) => a.name.localeCompare(b.name)), [productRows]);
  const takeQuery = useLiveQuery(
    () => (shopId ? db.stockTakes.where('[shop_id+isDeleted]').equals([shopId, 0]).toArray() : Promise.resolve([] as StockTake[])),
    [shopId],
  );
  const takeRows = takeQuery ?? [];
  const takes = useMemo(() => [...takeRows].sort((a, b) => b.started_at.localeCompare(a.started_at)), [takeRows]);
  const cur = takes.find(x => x.status === 'counting' || x.status === 'submitted') ?? null;
  const history = useMemo(
    () => takes.filter(x => x.status === 'approved').sort((a, b) => (b.approved_at || b.started_at).localeCompare(a.approved_at || a.started_at)),
    [takes],
  );

  const curItemRows = useLiveQuery(
    () => (cur ? db.stockTakeItems.where('[stock_take_id+isDeleted]').equals([cur.id, 0]).toArray() : Promise.resolve([] as StockTakeItem[])),
    [cur?.id],
  ) ?? [];
  const scope = useMemo(() => inScope(products, cur), [products, cur]);
  const itemByProduct = useMemo(() => new Map(curItemRows.map(i => [i.product_id, i])), [curItemRows]);
  const counted = scope.filter(p => itemByProduct.has(p.id!)).length;

  const [view, setView] = useState<'home' | 'count' | 'review' | 'detail' | 'done'>('home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Products to start with already chosen (from "Hesabu bidhaa hii").
  const [preselect, setPreselect] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const detail = takes.find(x => x.id === detailId) ?? null;
  const detailItems = useLiveQuery(
    () => (detailId ? db.stockTakeItems.where('[stock_take_id+isDeleted]').equals([detailId, 0]).toArray() : Promise.resolve([] as StockTakeItem[])),
    [detailId],
  ) ?? [];

  const go = (v: typeof view) => { setView(v); document.getElementById('main-scroll')?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }); };

  // Whatever other devices have counted or approved since: fetch it on opening.
  useEffect(() => { syncStockTakesNow(); }, []);
  // The count was finished, approved or cancelled elsewhere: back to the start.
  // (Not while this computer is approving it: that ends it too, and the page
  // moves on to the confirmation by itself.)
  useEffect(() => { if ((view === 'count' || view === 'review') && !cur && !busy) setView('home'); }, [view, cur, busy]);

  // Opened from a notice in Shughuli za Wafanyakazi ("Hesabu bidhaa hii"):
  // offer a count of just that product — once the page knows whether a count
  // is already going on, since only one runs at a time.
  const location = useLocation();
  const navigate = useNavigate();
  const asked = (location.state as { countProducts?: string[] } | null)?.countProducts;
  useEffect(() => {
    if (!asked?.length || takeQuery === undefined || productQuery === undefined) return;
    navigate(location.pathname, { replace: true, state: null });
    if (cur) { showToast(t('Maliza hesabu inayoendelea kwanza'), 'info'); return; }
    setPreselect(asked.filter(id => products.some(p => p.id === id)));
    setStarting(true);
  }, [asked, takeQuery, productQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  if (shop && shop.enable_stock === false) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
        <Card className="p-8 text-center">
          <Package className="w-10 h-10 text-gray-300 mx-auto" />
          <h1 className="mt-3 text-xl font-bold text-gray-900">{t('Hesabu ya Stoo')}</h1>
          <p className="mt-2 text-sm text-gray-600">{t('Duka lako halifuatilii stoo kwa sasa, hivyo hakuna cha kuhesabu. Washa ufuatiliaji wa stoo kwenye Bidhaa ili kuhesabu.')}</p>
        </Card>
      </div>
    );
  }

  // ================================================================ COUNT
  if (view === 'count' && cur) {
    return (
      <CountView
        take={cur} scope={scope} items={itemByProduct} counted={counted} boss={boss} approver={approver}
        onBack={() => go('home')} onReview={() => go('review')}
        onBlind={async b => { await db.stockTakes.update(cur.id, { blind: b, updated_at: nowIso(), synced: 0 }); syncStockTakesNow(); }}
      />
    );
  }

  // ================================================================ REVIEW
  if (view === 'review' && cur) {
    const items = curItemRows.filter(i => scope.some(p => p.id === i.product_id) || cur.scope === 'all');
    const s = summarize(items);
    const diffs = items.filter(i => i.counted_qty !== i.expected_qty)
      .sort((a, b) => (a.counted_qty - a.expected_qty) * a.buy_price - (b.counted_qty - b.expected_qty) * b.buy_price);
    const same = items.filter(i => i.counted_qty === i.expected_qty);
    const left = Math.max(0, scope.length - counted);
    // Sent from another computer, and not all of it has reached this one yet.
    const missing = cur.status === 'submitted' ? Math.max(0, (cur.counted_products ?? 0) - items.length) : 0;
    const stillCountingElsewhere = cur.status === 'counting' && cur.started_by && cur.started_by !== (user as any)?.id;

    const approve = () => {
      const doIt = async () => {
        setBusy(true);
        try {
          const r = await approveTake(cur, items, scope.length);
          setDetailId(cur.id);
          go('done');
          if (r.skipped.length) showAlert(t('Bidhaa hazikurekebishwa'), t('Bidhaa hizi hazipo tena au stoo yake haifuatiliwi, hivyo idadi yake haikubadilishwa: {list}', { list: r.skipped.join(', ') }));
        } catch (e: any) {
          showAlert(t('Kosa'), e?.message || t('Imeshindwa kuidhinisha hesabu.'));
        } finally {
          setBusy(false);
        }
      };
      showConfirm(
        t('Idhinisha hesabu?'),
        (stillCountingElsewhere ? t('{name} bado anahesabu: bidhaa ambazo hajazifikia hazitabadilishwa. ', { name: cur.started_by_name || '' }) : '') +
          t('Idadi ya bidhaa {n} itarekebishwa kulingana na hesabu hii, na hesabu itahifadhiwa.', { n: diffs.length }) +
          (boss ? '' : t(' Bosi ataona kwenye Shughuli za Wafanyakazi kwamba umeidhinisha hesabu hii.')),
        () => void doIt(),
      );
    };

    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8 pb-32">
        <Back onClick={() => go(cur.status === 'counting' ? 'count' : 'home')} label={cur.status === 'counting' ? t('Rudi kuhesabu') : t('Hesabu ya Stoo')} />
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{approver ? t('Kagua tofauti') : t('Tuma hesabu kwa bosi')}</h1>
            <p className="text-sm text-gray-500">
              {cur.scope === 'all' ? t('Duka zima') : t('Bidhaa {n} ulizochagua', { n: scope.length })} · {t('imehesabiwa na {name}', { name: cur.submitted_by_name || cur.started_by_name || '' })}
            </p>
          </div>
          {approver && (
            <button
              onClick={() => showConfirm(t('Ghairi hesabu?'), t('Hesabu hii itafutwa bila kubadilisha idadi ya bidhaa yoyote.'), () => { void cancelTake(cur, items.length).then(() => go('home')); })}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-bold hover:bg-red-100 cursor-pointer"
            >
              <Ban className="w-4 h-4" /> {t('Ghairi hesabu')}
            </button>
          )}
        </div>

        {approver ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <Stat label={t('Zimehesabiwa')} value={`${items.length} / ${scope.length}`} sub={left ? t('{n} bado', { n: left }) : t('Zote zimehesabiwa')} />
              <Stat label={t('Zilizopungua ({n})', { n: s.lostCount })} value={`−${tsh(s.lost)}`} tone="text-red-700" sub={t('Kwa bei ya kununua')} />
              <Stat label={t('Zilizozidi ({n})', { n: s.extraCount })} value={`+${tsh(s.extra)}`} tone="text-emerald-700" sub={t('Kwa bei ya kununua')} />
              <Stat label={t('Bila maelezo')} value={`−${tsh(s.unexplained)}`} tone="text-red-700" sub={t('Haijulikani zimeendaje')} />
            </div>
            {missing > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5 px-5 py-3 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-900">
                <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {t('Bidhaa {n} zilizohesabiwa bado hazijafika kwenye kompyuta hii. Sawazisha kabla ya kuidhinisha.', { n: missing })}</span>
                <button onClick={() => syncStockTakesNow()} className="flex items-center gap-1.5 font-bold underline cursor-pointer"><RefreshCw className="w-4 h-4" /> {t('Sawazisha')}</button>
              </div>
            )}
            {left > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5 px-5 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
                <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {t('Bidhaa {n} hazijahesabiwa. Idadi yake kwenye mfumo haitabadilishwa.', { n: left })}</span>
                {cur.status === 'counting' && <button onClick={() => go('count')} className="font-bold underline cursor-pointer">{t('Endelea kuhesabu')}</button>}
              </div>
            )}
            <Card className="mb-5">
              <div className="px-5 pt-4 pb-3 border-b border-gray-100">
                <h3 className="text-[15px] font-bold text-gray-900">{t('Bidhaa zenye tofauti ({n})', { n: diffs.length })}</h3>
                <p className="text-xs text-gray-500">{t('Chagua sababu inapojulikana. "Haijulikani" ndiyo upotevu wa kufuatilia.')}</p>
              </div>
              <DiffTable items={diffs} editable signed={signed} />
            </Card>
            <SameList items={same} />
          </>
        ) : (
          <Card className="mb-5">
            <div className="px-5 pt-4 pb-3 border-b border-gray-100">
              <h3 className="text-[15px] font-bold text-gray-900">{t('Ulichohesabu ({done} kati ya {total})', { done: items.length, total: scope.length })}</h3>
              <p className="text-xs text-gray-500">{t('Bosi ataona tofauti na kuidhinisha.')}</p>
            </div>
            <div className="divide-y divide-gray-100">
              {[...items].sort((a, b) => a.product_name.localeCompare(b.product_name)).map(i => (
                <div key={i.id} className="flex justify-between px-5 py-2.5 text-sm"><span className="text-gray-800">{i.product_name}</span><b className="tabular-nums">{i.counted_qty}</b></div>
              ))}
            </div>
          </Card>
        )}

        <div className="fixed bottom-0 right-0 left-0 md:left-64 z-30 bg-white/95 backdrop-blur border-t border-gray-200">
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              {approver
                ? t('Ukiidhinisha, idadi ya bidhaa {n} itarekebishwa na hesabu itahifadhiwa.', { n: diffs.length })
                : t('Ukituma, bosi ataikagua na kuidhinisha.')}
            </p>
            <div className="flex gap-2">
              {cur.status === 'counting' && (
                <button onClick={() => go('count')} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 cursor-pointer">{t('Rudi kuhesabu')}</button>
              )}
              {/* Staff allowed to approve may still leave it to the boss. */}
              {approver && !boss && cur.status === 'counting' && (
                <button
                  onClick={async () => { setBusy(true); try { await submitTake(cur, items.length); showToast(t('Hesabu imetumwa kwa bosi.'), 'success'); go('home'); } finally { setBusy(false); } }}
                  disabled={busy || !items.length}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:text-gray-300 cursor-pointer">
                  <Send className="w-4 h-4" /> {t('Mwachie bosi')}
                </button>
              )}
              {approver ? (
                <button onClick={approve} disabled={busy || !items.length || missing > 0}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:bg-gray-300 cursor-pointer">
                  <CheckCircle2 className="w-4 h-4" /> {t('Idhinisha na urekebishe stoo')}
                </button>
              ) : (
                <button
                  onClick={async () => { setBusy(true); try { await submitTake(cur, items.length); showToast(t('Hesabu imetumwa kwa bosi.'), 'success'); go('home'); } finally { setBusy(false); } }}
                  disabled={busy || !items.length || cur.status === 'submitted'}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:bg-gray-300 cursor-pointer">
                  <Send className="w-4 h-4" /> {t('Tuma kwa bosi')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ================================================================ DONE / DETAIL
  if ((view === 'done' || view === 'detail') && detail) {
    const s = summarize(detailItems);
    const diffs = detailItems.filter(i => i.counted_qty !== i.expected_qty)
      .sort((a, b) => (a.counted_qty - a.expected_qty) * a.buy_price - (b.counted_qty - b.expected_qty) * b.buy_price);
    const same = detailItems.filter(i => i.counted_qty === i.expected_qty);
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
        <Back onClick={() => go('home')} label={t('Hesabu ya Stoo')} />
        {view === 'done' && (
          <div className="flex items-center gap-3 mb-5 px-5 py-4 rounded-2xl bg-emerald-50 border border-emerald-200">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <p className="font-bold text-emerald-900">{t('Hesabu imeidhinishwa')}</p>
              <p className="text-sm text-emerald-800">{t('Idadi ya bidhaa zenye tofauti imerekebishwa kwenye mfumo.')}</p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('Hesabu ya {date}', { date: day(detail.approved_at || detail.started_at) })}</h1>
            <p className="text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-1 mt-1">
              <span className="flex items-center gap-1"><Package className="w-4 h-4" /> {detail.scope === 'all' ? t('Duka zima') : t('Bidhaa zilizochaguliwa')} ({detailItems.length})</span>
              <span className="flex items-center gap-1"><User className="w-4 h-4" /> {t('Imehesabiwa na {name}', { name: detail.submitted_by_name || detail.started_by_name || '' })}</span>
              {detail.approved_by_name && <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> {t('Imeidhinishwa na {name}', { name: detail.approved_by_name })}</span>}
              <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> {t('saa {time}', { time: time(detail.approved_at || detail.started_at) })}</span>
            </p>
          </div>
          {approver && (
            <button onClick={() => void exportStockTakePdf(detail, detailItems, shop?.name || settings?.shopName || '', currency)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 cursor-pointer">
              <FileDown className="w-4 h-4" /> {t('Pakua PDF')}
            </button>
          )}
        </div>
        {approver && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <Stat label={t('Zimehesabiwa')} value={String(detailItems.length)} sub={detail.scope === 'all' ? t('Duka zima') : t('Bidhaa zilizochaguliwa')} />
            <Stat label={t('Zilizopungua ({n})', { n: s.lostCount })} value={`−${tsh(s.lost)}`} tone="text-red-700" sub={t('Kwa bei ya kununua')} />
            <Stat label={t('Zilizozidi ({n})', { n: s.extraCount })} value={`+${tsh(s.extra)}`} tone="text-emerald-700" sub={t('Kwa bei ya kununua')} />
            <Stat label={t('Bila maelezo')} value={`−${tsh(s.unexplained)}`} tone="text-red-700" sub={t('Haijulikani zimeendaje')} />
          </div>
        )}
        {approver ? (
          <>
            <Card className="mb-5">
              <div className="px-5 pt-4 pb-3 border-b border-gray-100"><h3 className="text-[15px] font-bold text-gray-900">{t('Bidhaa zenye tofauti ({n})', { n: diffs.length })}</h3></div>
              <DiffTable items={diffs} signed={signed} />
            </Card>
            <SameList items={same} />
          </>
        ) : (
          <Card>
            <div className="divide-y divide-gray-100">
              {[...detailItems].sort((a, b) => a.product_name.localeCompare(b.product_name)).map(i => (
                <div key={i.id} className="flex justify-between px-5 py-2.5 text-sm"><span className="text-gray-800">{i.product_name}</span><b className="tabular-nums">{i.counted_qty}</b></div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  // ================================================================ HOME
  const series = history.slice(0, 6).reverse().map(h => ({ h, lost: Number(h.lost_value) || 0, unexplained: Number(h.unexplained_value) || 0 }));
  const max = Math.max(1, ...series.map(x => x.lost));
  const first = series[0]?.lost ?? 0;
  const latest = series[series.length - 1]?.lost ?? 0;
  const change = first ? Math.round(((latest - first) / first) * 100) : 0;
  const last = history[0];

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('Hesabu ya Stoo')}</h1>
          <p className="text-sm text-gray-500">{t('Hesabu bidhaa zilizopo rafuni, ulinganishe na zilizo kwenye mfumo, ujue kilichopotea.')}</p>
        </div>
        <button disabled={!!cur || products.length === 0} onClick={() => setStarting(true)} title={cur ? t('Maliza hesabu inayoendelea kwanza') : ''}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white font-bold shadow-sm hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer">
          <Play className="w-4 h-4" /> {t('Anza hesabu mpya')}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          {cur ? (
            <Card className={`p-5 ${cur.status === 'submitted' ? 'border-amber-300 bg-amber-50/40' : 'border-blue-200'}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-xl ${cur.status === 'submitted' ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                    {cur.status === 'submitted' ? <ClipboardCheck className="w-6 h-6" /> : <ClipboardList className="w-6 h-6" />}
                  </div>
                  <div>
                    <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-black uppercase tracking-wide ${cur.status === 'submitted' ? 'bg-amber-100 text-amber-800' : 'bg-blue-50 text-blue-700'}`}>
                      {cur.status === 'submitted' ? (boss ? t('Inasubiri idhini yako') : approver ? t('Inasubiri idhini') : t('Imetumwa kwa bosi')) : t('Inaendelea')}
                    </span>
                    <h2 className="text-lg font-bold text-gray-900 mt-1">{cur.scope === 'all' ? t('Duka zima') : t('Bidhaa {n} ulizochagua', { n: scope.length })}</h2>
                    <p className="text-sm text-gray-500">
                      {t('Ilianzishwa na {name} · {date} saa {time}', { name: cur.started_by_name || '', date: day(cur.started_at), time: time(cur.started_at) })}
                      {cur.status === 'submitted' && cur.submitted_by_name ? ` · ${t('ilitumwa na {name} saa {time}', { name: cur.submitted_by_name, time: time(cur.submitted_at) })}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {cur.status === 'counting' && (
                    <button onClick={() => go('count')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 cursor-pointer">
                      {t('Endelea kuhesabu')} <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                  {approver && (
                    <button onClick={() => go('review')} className={`px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer ${cur.status === 'submitted' ? 'bg-amber-500 text-white hover:bg-amber-600' : 'border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                      {cur.status === 'submitted' ? t('Kagua na uidhinishe') : t('Kagua tofauti')}
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-4"><Progress done={counted} total={scope.length} /></div>
            </Card>
          ) : (
            <Card className="p-6 text-center border-dashed">
              <ClipboardList className="w-10 h-10 text-gray-300 mx-auto" />
              <p className="mt-2 font-bold text-gray-800">{products.length ? t('Hakuna hesabu inayoendelea') : t('Hakuna bidhaa za kuhesabu')}</p>
              <p className="text-sm text-gray-500 max-w-md mx-auto">
                {products.length
                  ? t('Anza hesabu mpya. Mauzo yanaweza kuendelea wakati mnahesabu: Venics inazingatia yaliyouzwa.')
                  : t('Ongeza bidhaa zinazofuatiliwa stoo kwenye Bidhaa kwanza.')}
              </p>
            </Card>
          )}

          <Card>
            <div className="px-5 pt-4 pb-3 border-b border-gray-100">
              <h3 className="text-[15px] font-bold text-gray-900">{t('Hesabu zilizopita')}</h3>
              <p className="text-xs text-gray-500">{approver ? t('Bonyeza moja kuona kila bidhaa') : t('Hesabu zilizoidhinishwa na bosi')}</p>
            </div>
            {history.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">{t('Bado hakuna hesabu iliyoidhinishwa.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                      <th className="px-5 py-2.5 font-bold">{t('Tarehe')}</th>
                      <th className="px-3 py-2.5 font-bold">{t('Aliyehesabu')}</th>
                      <th className="px-3 py-2.5 font-bold hidden sm:table-cell">{t('Bidhaa')}</th>
                      <th className="px-3 py-2.5 font-bold">{t('Zilizopungua')}</th>
                      {approver && <th className="px-3 py-2.5 font-bold text-right">{t('Upotevu')}</th>}
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map(h => (
                      <tr key={h.id} onClick={() => { setDetailId(h.id); go('detail'); }} className="hover:bg-blue-50/50 cursor-pointer">
                        <td className="px-5 py-3 font-semibold text-gray-900 whitespace-nowrap">{day(h.approved_at || h.started_at)}</td>
                        <td className="px-3 py-3 text-gray-700">{h.submitted_by_name || h.started_by_name}</td>
                        <td className="px-3 py-3 text-gray-700 hidden sm:table-cell">{h.scope === 'all' ? t('Duka zima') : t('Zilizochaguliwa')} ({h.counted_products ?? 0})</td>
                        <td className="px-3 py-3">
                          {h.lost_count ? <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-red-50 text-red-700">{h.lost_count}</span> : <span className="text-xs font-bold text-emerald-700">0</span>}
                        </td>
                        {approver && <td className="px-3 py-3 text-right font-bold tabular-nums whitespace-nowrap text-red-700">{h.lost_value ? `−${tsh(h.lost_value)}` : '—'}</td>}
                        <td className="px-3 py-3 text-gray-400"><ChevronRight className="w-4 h-4" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {approver && series.length > 0 && (
            <Card className="p-5">
              <h3 className="text-[15px] font-bold text-gray-900">{t('Upotevu kwa kila hesabu')}</h3>
              <p className="text-xs text-gray-500 mb-4">{t('Kwa bei ya kununua')}</p>
              <div className="flex items-end gap-2 h-40">
                {series.map(({ h, lost, unexplained }) => (
                  <div key={h.id} className="flex-1 flex flex-col items-center justify-end h-full" title={`${day(h.approved_at)}: ${tsh(lost)}`}>
                    <span className="text-[10px] font-bold text-gray-600 mb-1 tabular-nums">{lost >= 1000 ? `${Math.round(lost / 1000)}k` : Math.round(lost)}</span>
                    <div className="w-full rounded-t-md overflow-hidden flex flex-col justify-end min-h-[2px]" style={{ height: `${(lost / max) * 100}%` }}>
                      <div className="bg-amber-300" style={{ height: `${lost ? ((lost - unexplained) / lost) * 100 : 0}%` }} />
                      <div className="bg-red-500 flex-1" />
                    </div>
                    <span className="text-[11px] text-gray-500 mt-1">{monthNames()[new Date(h.approved_at || h.started_at).getMonth()].slice(0, 3)}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-gray-600">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> {t('Bila maelezo')}</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-300" /> {t('Yenye maelezo')}</span>
              </div>
              {series.length > 1 && (
                <p className={`mt-4 text-sm font-semibold flex items-center gap-2 ${change <= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  <TrendingDown className={`w-4 h-4 ${change > 0 ? 'rotate-180' : ''}`} />
                  {change <= 0
                    ? t('Upotevu umepungua {pct}% tangu {month}', { pct: Math.abs(change), month: monthNames()[new Date(series[0].h.approved_at || series[0].h.started_at).getMonth()] })
                    : t('Upotevu umeongezeka {pct}% tangu {month}', { pct: change, month: monthNames()[new Date(series[0].h.approved_at || series[0].h.started_at).getMonth()] })}
                </p>
              )}
            </Card>
          )}
          {approver && last && (
            <Card className="p-5">
              <h3 className="text-[15px] font-bold text-gray-900">{t('Hesabu ya mwisho')}</h3>
              <p className="text-xs text-gray-500 mb-3">{day(last.approved_at)} · {last.submitted_by_name || last.started_by_name}</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-3"><span className="text-gray-600">{t('Zilizopungua ({n})', { n: last.lost_count ?? 0 })}</span><b className="text-red-700 tabular-nums whitespace-nowrap">−{tsh(last.lost_value ?? 0)}</b></div>
                <div className="flex justify-between gap-3"><span className="text-gray-600">{t('Bila maelezo')}</span><b className="text-red-700 tabular-nums whitespace-nowrap">−{tsh(last.unexplained_value ?? 0)}</b></div>
                <div className="flex justify-between gap-3"><span className="text-gray-600">{t('Zilizozidi ({n})', { n: last.extra_count ?? 0 })}</span><b className="text-emerald-700 tabular-nums whitespace-nowrap">+{tsh(last.extra_value ?? 0)}</b></div>
              </div>
            </Card>
          )}
          <Card className="p-5 bg-blue-50/50 border-blue-100">
            <p className="text-sm font-bold text-blue-900 flex items-center gap-2"><Info className="w-4 h-4" /> {t('Ushauri')}</p>
            <p className="text-sm text-blue-900/80 mt-1">{t('Hesabu angalau mara moja kwa mwezi, siku ileile. Bidhaa za bei kubwa zihesabu kila wiki.')}</p>
          </Card>
        </div>
      </div>

      {starting && (
        <StartDialog
          products={products} boss={boss} initial={preselect ?? undefined}
          onClose={() => { setStarting(false); setPreselect(null); }}
          onStart={async (ids, blind) => {
            await startTake({ productIds: ids, blind, total: ids ? ids.length : products.length });
            setStarting(false);
            setPreselect(null);
            go('count');
          }}
        />
      )}
    </div>
  );
}

// ================================================================ start
function StartDialog({ products, boss, initial, onClose, onStart }: {
  products: Product[]; boss: boolean;
  /** Already chosen, listed first: opens on "Bidhaa ninazochagua". */
  initial?: string[];
  onClose: () => void; onStart: (ids: string[] | null, blind: boolean) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<'all' | 'some'>(initial?.length ? 'some' : 'all');
  const [picked, setPicked] = useState<string[]>(initial ?? []);
  const [q, setQ] = useState('');
  const [blind, setBlind] = useState(true);
  const first = new Set(initial ?? []);
  const list = products
    .filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(first.has(b.id!)) - Number(first.has(a.id!)))
    .slice(0, 300);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-xl font-bold text-gray-900">{t('Anza hesabu mpya')}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 space-y-3 overflow-y-auto">
          <p className="text-sm font-semibold text-gray-700">{t('Unahesabu nini?')}</p>
          {([
            ['all', t('Duka zima'), t('Bidhaa zote {n}. Inafaa kila mwisho wa mwezi.', { n: products.length })],
            ['some', t('Bidhaa ninazochagua'), t('Rafu moja, au bidhaa za bei kubwa tu. Inafaa kila wiki.')],
          ] as const).map(([k, title, desc]) => (
            <button key={k} onClick={() => setMode(k)} className={`w-full text-left p-4 rounded-2xl border-2 cursor-pointer ${mode === k ? 'border-blue-600 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
              <p className="font-bold text-gray-900">{title}</p><p className="text-sm text-gray-500">{desc}</p>
            </button>
          ))}
          {mode === 'some' && (
            <div className="border border-gray-200 rounded-2xl">
              <div className="p-3 border-b border-gray-100 relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-6 top-1/2 -translate-y-1/2" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Tafuta bidhaa...')} className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
                {list.map(p => (
                  <label key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={picked.includes(p.id!)} onChange={() => setPicked(x => (x.includes(p.id!) ? x.filter(i => i !== p.id) : [...x, p.id!]))} className="w-4 h-4 accent-blue-600" />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {boss ? (
            <label className="flex items-start justify-between gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100 cursor-pointer">
              <span>
                <span className="block font-bold text-gray-900 text-sm">{t('Ficha idadi ya mfumo wakati wa kuhesabu')}</span>
                <span className="block text-xs text-gray-500">{t('Anayehesabu hataona idadi iliyopo kwenye mfumo, ili ahesabu kweli badala ya kunakili. Wafanyakazi huhesabu hivi kila mara.')}</span>
              </span>
              <input type="checkbox" checked={blind} onChange={e => setBlind(e.target.checked)} className="w-5 h-5 mt-0.5 accent-blue-600 shrink-0" />
            </label>
          ) : (
            <p className="text-xs text-gray-500 flex items-start gap-2 p-3 rounded-xl bg-gray-50"><EyeOff className="w-4 h-4 shrink-0" /> {t('Utaandika idadi unayoiona rafuni. Bosi ndiye atakayeona tofauti na kuidhinisha.')}</p>
          )}
        </div>
        <div className="px-6 py-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 cursor-pointer">{t('Ghairi')}</button>
          <button onClick={() => void onStart(mode === 'all' ? null : picked, boss ? blind : true)} disabled={mode === 'some' && !picked.length}
            className="flex-1 py-3 rounded-2xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:bg-gray-300 cursor-pointer">
            {mode === 'some' && picked.length ? t('Anza ({n})', { n: picked.length }) : t('Anza')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================ count
function CountView({ take, scope, items, counted, boss, approver, onBack, onReview, onBlind }: {
  take: StockTake; scope: Product[]; items: Map<string, StockTakeItem>; counted: number; boss: boolean; approver: boolean;
  onBack: () => void; onReview: () => void; onBlind: (b: boolean) => void;
}) {
  const hidden = !boss || take.blind;
  const [filter, setFilter] = useState<'todo' | 'done' | 'all' | 'diff'>('todo');
  const [q, setQ] = useState('');
  const [visible, setVisible] = useState(PAGE);
  // What is being typed, ahead of the database.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // A product counted from the "not yet counted" list stays in it until the list is changed.
  const [kept, setKept] = useState<string[]>([]);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { setKept([]); setVisible(PAGE); }, [filter, q]);

  const diffN = scope.filter(p => { const i = items.get(p.id!); return i && i.counted_qty !== i.expected_qty; }).length;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const m = needle ? scope.filter(p => p.name.toLowerCase().includes(needle)) : scope;
    if (filter === 'todo') return m.filter(p => !items.has(p.id!) || kept.includes(p.id!));
    if (filter === 'done') return m.filter(p => items.has(p.id!));
    if (filter === 'diff') return m.filter(p => { const i = items.get(p.id!); return i && i.counted_qty !== i.expected_qty; });
    return m;
  }, [scope, q, filter, items, kept]);
  const shown = list.slice(0, visible);

  const put = (p: Product, n: number | null) => {
    if (filter === 'todo' && !kept.includes(p.id!)) setKept(k => [...k, p.id!]);
    void recordCount(take, p, n);
  };
  const type = (p: Product, raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    setDrafts(d => ({ ...d, [p.id!]: digits }));
    put(p, digits === '' ? null : Number(digits));
  };
  const step = (p: Product, by: number) => {
    const now = drafts[p.id!] !== undefined && drafts[p.id!] !== '' ? Number(drafts[p.id!]) : (items.get(p.id!)?.counted_qty ?? 0);
    const next = Math.max(0, now + by);
    setDrafts(d => ({ ...d, [p.id!]: String(next) }));
    put(p, next);
  };
  const focus = (i: number) => {
    if (i >= visible && i < list.length) setVisible(v => v + PAGE);
    setTimeout(() => { const el = inputs.current[i]; if (el) { el.focus(); el.select(); } }, 0);
  };

  const chips: [typeof filter, string, number][] = [
    ['todo', t('Hazijahesabiwa'), scope.length - counted],
    ['done', t('Zimehesabiwa'), counted],
    ['all', t('Zote'), scope.length],
  ];
  if (!hidden) chips.push(['diff', t('Zenye tofauti'), diffN]);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
      <Back onClick={onBack} label={t('Hesabu ya Stoo')} />
      <div className="sticky top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 pt-2 pb-4 bg-gray-50/95 backdrop-blur">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{t('Hesabu inaendelea: {what}', { what: take.scope === 'all' ? t('Duka zima') : t('Bidhaa {n}', { n: scope.length }) })}</h1>
              <p className="text-sm text-gray-500">{t('Ilianzishwa na {name} · {date} saa {time}', { name: take.started_by_name || '', date: day(take.started_at), time: time(take.started_at) })}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={onBack} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 cursor-pointer">{t('Endelea baadaye')}</button>
              <button onClick={onReview} disabled={!counted} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:bg-gray-300 cursor-pointer">
                {approver ? t('Kagua tofauti') : t('Maliza na tuma')} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <Progress done={counted} total={scope.length} />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5 items-start">
        <Card>
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
            {chips.map(([k, label, n]) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${filter === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {label} <span className="opacity-70">{n}</span>
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-56">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Tafuta bidhaa...')} className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2.5 font-bold">{t('Bidhaa')}</th>
                <th className="px-3 py-2.5 font-bold text-right hidden sm:table-cell">{t('Kwenye mfumo')}</th>
                <th className="px-3 py-2.5 font-bold text-center">{t('Zilizopo rafuni')}</th>
                <th className="px-4 py-2.5 font-bold text-right hidden sm:table-cell">{t('Hali')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((p, i) => {
                const e = items.get(p.id!);
                const diff = e ? e.counted_qty - e.expected_qty : 0;
                const value = drafts[p.id!] ?? (e ? String(e.counted_qty) : '');
                return (
                  <tr key={p.id} className={e ? 'bg-emerald-50/30' : ''}>
                    <td className="px-3 sm:px-4 py-2.5"><p className="font-semibold text-gray-900 break-words">{p.name}</p><p className="text-[11px] text-gray-500">{p.unit || 'pcs'}</p></td>
                    <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">
                      {hidden ? <span className="inline-flex items-center gap-1 text-gray-400"><EyeOff className="w-3.5 h-3.5" /> ••</span> : <b className="text-gray-700">{e?.expected_qty ?? p.stock}</b>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button tabIndex={-1} onClick={() => step(p, -1)} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 cursor-pointer" aria-label={t('Punguza')}><Minus className="w-3.5 h-3.5" /></button>
                        <input
                          ref={el => { inputs.current[i] = el; }}
                          value={value} inputMode="numeric" placeholder="—" aria-label={p.name}
                          onChange={ev => type(p, ev.target.value)}
                          onKeyDown={ev => {
                            if (ev.key === 'Enter' || ev.key === 'ArrowDown') { ev.preventDefault(); focus(i + 1); }
                            if (ev.key === 'ArrowUp') { ev.preventDefault(); focus(i - 1); }
                          }}
                          className={`w-16 sm:w-20 text-center py-1.5 rounded-lg border text-sm font-bold tabular-nums outline-none focus:ring-2 focus:ring-blue-500 ${e ? 'border-emerald-300 bg-white text-gray-900' : 'border-gray-300 bg-white'}`}
                        />
                        <button tabIndex={-1} onClick={() => step(p, 1)} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 cursor-pointer" aria-label={t('Ongeza')}><Plus className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap hidden sm:table-cell">
                      {!e ? <span className="text-xs text-gray-400">{t('Bado')}</span>
                        : hidden || diff === 0 ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="w-4 h-4" /> {hidden ? t('Imehesabiwa') : t('Sawa')}</span>
                        : <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${diff < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{diff > 0 ? `+${diff}` : diff}</span>}
                    </td>
                  </tr>
                );
              })}
              {!list.length && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">{filter === 'todo' ? t('Hongera! Bidhaa zote zimehesabiwa.') : t('Hakuna bidhaa hapa.')}</td></tr>
              )}
            </tbody>
          </table>
          {list.length > visible && (
            <button onClick={() => setVisible(v => v + PAGE)} className="w-full py-3 text-sm font-bold text-blue-700 border-t border-gray-100 hover:bg-blue-50 rounded-b-2xl cursor-pointer">
              {t('Onyesha zaidi ({n} zimebaki)', { n: list.length - visible })}
            </button>
          )}
        </Card>

        <div className="space-y-4 xl:sticky xl:top-40">
          <Card className="p-4">
            <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
              {hidden ? <EyeOff className="w-4 h-4 text-gray-500" /> : <Eye className="w-4 h-4 text-blue-600" />}
              {hidden ? t('Idadi ya mfumo imefichwa') : t('Idadi ya mfumo inaonekana')}
            </p>
            <p className="text-xs text-gray-500 mt-1">{hidden ? t('Andika unachokiona rafuni. Tofauti zitaonekana wakati wa kukagua.') : t('Unaona idadi ya mfumo na tofauti papo hapo.')}</p>
            {boss && (
              <button onClick={() => onBlind(!take.blind)} className="mt-3 text-xs font-bold text-blue-700 hover:underline cursor-pointer">
                {take.blind ? t('Onyesha idadi ya mfumo') : t('Ficha idadi ya mfumo')}
              </button>
            )}
          </Card>
          <Card className="p-4">
            <p className="text-sm font-bold text-gray-900 flex items-center gap-2"><Keyboard className="w-4 h-4 text-gray-500" /> {t('Kuhesabu haraka')}</p>
            <ul className="text-xs text-gray-600 mt-2 space-y-1.5 list-disc pl-4">
              <li>{t('Andika idadi, bonyeza Enter: unaenda bidhaa inayofuata.')}</li>
              <li>{t('Bidhaa ambayo haipo kabisa: andika 0.')}</li>
              <li>{t('Usiyoihesabu itabaki kama ilivyo, haitawekwa sifuri.')}</li>
              <li>{t('Mauzo yanaweza kuendelea: Venics inazingatia yaliyouzwa wakati wa kuhesabu.')}</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ================================================================ review pieces
function DiffTable({ items, editable = false, signed }: { items: StockTakeItem[]; editable?: boolean; signed: (n: number) => string }) {
  if (!items.length) return <p className="px-5 py-8 text-center text-sm text-emerald-700 font-semibold">{t('Hakuna tofauti: kila kitu kimelingana.')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
            <th className="px-5 py-2.5 font-bold">{t('Bidhaa')}</th>
            <th className="px-3 py-2.5 font-bold text-right">{t('Mfumo')}</th>
            <th className="px-3 py-2.5 font-bold text-right">{t('Rafuni')}</th>
            <th className="px-3 py-2.5 font-bold text-right">{t('Tofauti')}</th>
            <th className="px-3 py-2.5 font-bold text-right">{t('Thamani')}</th>
            <th className="px-5 py-2.5 font-bold">{t('Sababu')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(i => {
            const d = i.counted_qty - i.expected_qty;
            const unknown = !i.reason || i.reason === UNKNOWN_REASON;
            return (
              <tr key={i.id}>
                <td className="px-5 py-3 font-semibold text-gray-900">{i.product_name}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{i.expected_qty}</td>
                <td className="px-3 py-3 text-right tabular-nums font-bold text-gray-900">{i.counted_qty}</td>
                <td className={`px-3 py-3 text-right tabular-nums font-bold ${d < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{d > 0 ? `+${d}` : d}</td>
                <td className={`px-3 py-3 text-right tabular-nums font-bold whitespace-nowrap ${d < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{signed(d * i.buy_price)}</td>
                <td className="px-5 py-3">
                  {d > 0 ? <span className="text-xs text-gray-400">{t('Zimezidi')}</span>
                    : editable ? (
                      <select value={i.reason || UNKNOWN_REASON} onChange={e => void setReason(i, e.target.value)}
                        className={`px-2 py-1.5 rounded-lg border text-xs font-semibold outline-none cursor-pointer ${unknown ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-700'}`}>
                        {REASONS.map(r => <option key={r} value={r}>{tData(r)}</option>)}
                      </select>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${unknown ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{tData(i.reason || UNKNOWN_REASON)}</span>
                    )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SameList({ items }: { items: StockTakeItem[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <Card>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-bold text-gray-800 cursor-pointer">
        <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> {t('Bidhaa {n} zimelingana na mfumo', { n: items.length })}</span>
        <ChevronRight className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[...items].sort((a, b) => a.product_name.localeCompare(b.product_name)).map(i => (
            <div key={i.id} className="flex justify-between px-5 py-2 text-sm border-b border-gray-50"><span className="text-gray-700">{i.product_name}</span><b className="tabular-nums text-gray-900">{i.counted_qty}</b></div>
          ))}
        </div>
      )}
    </Card>
  );
}
