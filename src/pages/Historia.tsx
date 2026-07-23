import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { useTap } from '../utils/useTap';
import GhostClickGuard from '../components/GhostClickGuard';
import { formatCurrency, formatInputNumber, parseInputNumber } from '../utils/format';
import { getValidStock, isProductStockTracked, isBatchExpired } from '../utils/stock';
import { getSalesTotals, getEmployeeTotals, getDailySeries, getEmployeeDailySeries, msToDateStr, ensureSummariesBackfill, flushDirtyNow } from '../services/summaries';
import { useMagnified } from '../utils/useMagnified';
import { format, startOfDay, startOfWeek, startOfMonth, subMonths, startOfYear, eachDayOfInterval, subDays } from 'date-fns';
import { Receipt, Calendar, TrendingUp, BarChart3, ArrowUpRight, ArrowDownRight, RotateCcw, AlertCircle, AlertTriangle, FileText, RefreshCw, Plus, Minus, Trash2, X, Search, ShoppingCart, CheckCircle, Tag, Wallet, ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { notifications } from '../services/notifications';
// jsPDF is imported as a TYPE ONLY (erased at build, zero bundle cost) so the helper
// signatures below can still annotate `doc: jsPDF`. The runtime class + autoTable are
// lazy-loaded via `await import(...)` inside exportPDFReports so ~450 kB of PDF code
// stays out of the initial bundle. App.tsx warms this chunk in the background after
// mount, so it's cached (works offline) before a report is ever generated.
import type { jsPDF } from 'jspdf';
import { v4 as uuidv4 } from 'uuid';
import { Sale, SaleItem, Expense } from '../db';
import { Capacitor } from '@capacitor/core';

// ---------------------------------------------------------------------------
// PDF report helpers.
// Charts are drawn with jsPDF vector primitives (not captured from the DOM), so
// they render identically in the browser, the installed PWA and the Android APK.
// Saving is platform-aware: a browser downloads the blob directly, but the APK
// WebView has no download manager, so we write the file to the app cache and hand
// it to the OS share/open sheet instead.
// ---------------------------------------------------------------------------
type RGB = [number, number, number];

async function savePdfDocument(doc: jsPDF, fileName: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const dataUri = doc.output('datauristring');
    const base64 = dataUri.substring(dataUri.indexOf('base64,') + 7);
    const written = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    await Share.share({ title: fileName, url: written.uri, dialogTitle: 'Hifadhi au Tuma Ripoti' });
  } else {
    doc.save(fileName);
  }
}

// Grouped vertical bar chart (e.g. revenue vs net profit per period).
function drawGroupedBars(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  labels: string[],
  series: { name: string; color: RGB; values: number[] }[],
  fmt: (n: number) => string,
): void {
  const gridColor: RGB = [223, 227, 233];
  const textGray: RGB = [120, 126, 138];
  const plotBottom = y + h;
  const maxVal = Math.max(1, ...series.flatMap(s => s.values).map(v => Math.abs(v)));

  doc.setFontSize(6.5);
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const gy = plotBottom - (h * i) / steps;
    doc.setDrawColor(gridColor[0], gridColor[1], gridColor[2]);
    doc.setLineWidth(0.15);
    doc.line(x, gy, x + w, gy);
    doc.setTextColor(textGray[0], textGray[1], textGray[2]);
    doc.text(fmt((maxVal * i) / steps), x - 2, gy + 1, { align: 'right' });
  }

  const groups = Math.max(1, labels.length);
  const groupW = w / groups;
  const barGap = groupW * 0.14;
  const innerW = groupW - barGap * 2;
  const barW = innerW / Math.max(1, series.length);

  labels.forEach((label, gi) => {
    const gx = x + gi * groupW + barGap;
    series.forEach((s, si) => {
      const val = Math.max(0, s.values[gi] || 0);
      const bh = (val / maxVal) * h;
      doc.setFillColor(s.color[0], s.color[1], s.color[2]);
      doc.rect(gx + si * barW, plotBottom - bh, barW * 0.84, bh, 'F');
    });
    doc.setFontSize(6.5);
    doc.setTextColor(textGray[0], textGray[1], textGray[2]);
    doc.text(label, gx + innerW / 2, plotBottom + 4, { align: 'center' });
  });

  let lx = x;
  const ly = plotBottom + 10;
  doc.setFontSize(7.5);
  series.forEach(s => {
    doc.setFillColor(s.color[0], s.color[1], s.color[2]);
    doc.rect(lx, ly - 2.4, 3, 3, 'F');
    doc.setTextColor(80, 80, 80);
    doc.text(s.name, lx + 4.2, ly);
    lx += 4.2 + doc.getTextWidth(s.name) + 8;
  });
}

// Donut chart with a legend to the right.
function drawDonut(
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  slices: { label: string; value: number; color: RGB }[],
  fmt: (n: number) => string,
): void {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  let angle = -Math.PI / 2;
  slices.forEach(s => {
    const sweep = (Math.max(0, s.value) / total) * Math.PI * 2;
    const stepCount = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * 64));
    doc.setFillColor(s.color[0], s.color[1], s.color[2]);
    for (let i = 0; i < stepCount; i++) {
      const a0 = angle + (sweep * i) / stepCount;
      const a1 = angle + (sweep * (i + 1)) / stepCount;
      doc.triangle(cx, cy, cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1), 'F');
    }
    angle += sweep;
  });

  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, r * 0.56, 'F');

  let ly = cy - r + 3;
  const lx = cx + r + 9;
  slices.forEach(s => {
    const pct = ((Math.max(0, s.value) / total) * 100).toFixed(1);
    doc.setFillColor(s.color[0], s.color[1], s.color[2]);
    doc.rect(lx, ly - 2.6, 3.4, 3.4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(55, 55, 55);
    doc.text(`${s.label}  ${pct}%`, lx + 5, ly);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(125, 125, 125);
    doc.text(fmt(Math.max(0, s.value)), lx + 5, ly + 4);
    ly += 10.5;
  });
}

// Group daily rollup rows (+ expenses) into report rows by day / month / year.
// Shared by the on-screen report list and the PDF (which re-fetches fresh, so the
// two never disagree). Sorted newest-first.
type ReportGroup = 'day' | 'month' | 'year';
interface ReportRow {
  label: string;
  sortKey: number;
  mapato: number;
  faida: number;
  matumizi: number;
  mauzo: number;
  faidaHalisi: number;
}
function buildReportRows(
  series: { date: string; revenue: number; profit: number; count: number }[],
  expenses: { date: string; amount: number }[],
  group: ReportGroup,
): ReportRow[] {
  const keyOf = (d: Date) => (group === 'day' ? format(d, 'yyyy-MM-dd') : group === 'month' ? format(d, 'yyyy-MM') : format(d, 'yyyy'));
  const labelOf = (d: Date) => (group === 'day' ? format(d, 'dd MMM') : group === 'month' ? format(d, 'MMM yyyy') : format(d, 'yyyy'));
  const groups: Record<string, ReportRow> = {};
  const ensure = (d: Date) => {
    const k = keyOf(d);
    if (!groups[k]) groups[k] = { label: labelOf(d), sortKey: d.getTime(), mapato: 0, faida: 0, matumizi: 0, mauzo: 0, faidaHalisi: 0 };
    return groups[k];
  };
  for (const s of series) {
    const g = ensure(new Date(`${s.date}T00:00:00`));
    g.mapato += s.revenue;
    g.faida += s.profit;
    g.mauzo += s.count;
  }
  for (const e of expenses) {
    ensure(new Date(e.date)).matumizi += e.amount;
  }
  return Object.values(groups)
    .map(g => ({ ...g, faidaHalisi: g.faida - g.matumizi }))
    .sort((a, b) => b.sortKey - a.sortKey);
}

// PDF report periods offered in the "Pakua PDF" popup (no all-time — a full report
// should always be scoped to a real window).
type PdfPeriod = 'month' | 'quarter' | 'half' | 'year';
const PDF_PERIODS: { id: PdfPeriod; label: string; hint: string }[] = [
  { id: 'month', label: 'Mwezi Huu', hint: 'Mchanganuo wa kila siku' },
  { id: 'quarter', label: 'Miezi 3', hint: 'Robo ya mwaka, kwa mwezi' },
  { id: 'half', label: 'Miezi 6', hint: 'Nusu mwaka, kwa mwezi' },
  { id: 'year', label: 'Mwaka Huu', hint: 'Mwaka mzima, kwa mwezi' },
];
function pdfPeriodRange(period: PdfPeriod): { start: Date; end: Date; group: ReportGroup } {
  const now = new Date();
  switch (period) {
    case 'month': return { start: startOfMonth(now), end: now, group: 'day' };
    case 'quarter': return { start: startOfMonth(subMonths(now, 2)), end: now, group: 'month' };
    case 'half': return { start: startOfMonth(subMonths(now, 5)), end: now, group: 'month' };
    case 'year':
    default: return { start: startOfYear(now), end: now, group: 'month' };
  }
}

interface BackdatedQtyControlProps {
  product: any;
  cartItem: any;
  updateQty: (productId: string, qty: number) => void;
  removeFromCart: (productId: string) => void;
  onQtyClick: () => void;
  activeKeypad: any;
}

// The grand-total figure in the backdated cart header, tappable to type a negotiated total
// for the whole cart. Owns its own useTap() (like BackdatedQtyControl) so opening the keypad
// and the first digit press don't share a debounce window.
const BackdatedTotalButton = ({ displayTotal, currency, activeKeypad, onTotalClick }: any) => {
  const tap = useTap();
  const isTotalActive = activeKeypad && activeKeypad.type === 'total';
  return (
    <button
      type="button"
      onClick={tap(() => onTotalClick())}
      onPointerUp={tap(() => onTotalClick())}
      className={`text-sm font-black rounded px-1 active:scale-95 underline decoration-dashed underline-offset-4 decoration-slate-400 touch-manipulation select-none ${isTotalActive ? 'text-amber-600 animate-pulse bg-amber-50' : 'text-slate-800'}`}
      title="Gusa kubadili jumla ya mauzo"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {formatCurrency(displayTotal, currency)}
    </button>
  );
};

const BackdatedQtyControl = ({ product, cartItem, updateQty, removeFromCart, onQtyClick, activeKeypad }: BackdatedQtyControlProps) => {
  const tap = useTap();
  const isAtMaxStock = cartItem ? cartItem.qty >= product.stock : false;
  // Show the value being typed on the keypad live while it's active on this item.
  const isQtyActive = activeKeypad && activeKeypad.itemId === product.id && activeKeypad.type === 'qty';
  const displayQty = isQtyActive ? (activeKeypad.value || '0') : cartItem.qty;

  return (
    <div className="flex items-center bg-blue-50 rounded-lg p-0.5 w-full justify-between">
      <button
        type="button"
        onClick={tap(() => { if (cartItem.qty > 1) updateQty(product.id!, cartItem.qty - 1); else removeFromCart(product.id!); })}
        onPointerUp={tap(() => { if (cartItem.qty > 1) updateQty(product.id!, cartItem.qty - 1); else removeFromCart(product.id!); })}
        className="p-1 text-blue-600 rounded cursor-pointer relative after:absolute after:content-[''] after:-inset-3"
      >
        <Minus className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={tap(() => onQtyClick())}
        onPointerUp={tap(() => onQtyClick())}
        className={`flex-1 mx-1 text-center text-[11px] font-black cursor-pointer select-none touch-manipulation underline decoration-dashed underline-offset-2 decoration-slate-400 ${isQtyActive ? 'text-amber-600 animate-pulse bg-amber-50 rounded' : 'text-blue-700'}`}
        title="Gusa kubadili idadi"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        {displayQty}
      </button>
      <button
        type="button"
        onClick={tap(() => { if (isAtMaxStock) return; updateQty(product.id!, cartItem.qty + 1); })}
        onPointerUp={tap(() => { if (isAtMaxStock) return; updateQty(product.id!, cartItem.qty + 1); })}
        disabled={isAtMaxStock}
        className={`p-1 rounded cursor-pointer relative after:absolute after:content-[''] after:-inset-3 ${isAtMaxStock ? 'text-gray-300' : 'text-blue-600 '}`}
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
};

export default function Historia() {
  const tap = useTap();
  const isMagnified = useMagnified();
  const { user, isBoss, isFeatureEnabled, showAlert, showConfirm, syncStatus, showToast } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const settings = useLiveQuery(() => db.settings.get(1));
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const isExpiryEnabled = shop?.enable_expiry === true;
  const currency = settings?.currency || 'TZS';
  const shopName = settings?.shopName || 'Biashara Yangu';

  // --- BACKDATED ENTRIES STATE & HANDLERS ---
  const [showBackdatedSaleModal, setShowBackdatedSaleModal] = useState(false);
  const [showBackdatedExpenseModal, setShowBackdatedExpenseModal] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);

  // Sale Modal state
  const [backdatedSaleDate, setBackdatedSaleDate] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  });
  const [backdatedSaleCart, setBackdatedSaleCart] = useState<{ id: string; name: string; qty: number; buy_price: number; sell_price: number }[]>([]);
  const [backdatedSearch, setBackdatedSearch] = useState('');
  const [backdatedPaymentMethod, setBackdatedPaymentMethod] = useState<'cash' | 'credit'>('cash');
  const [backdatedCustomerName, setBackdatedCustomerName] = useState('');
  const [backdatedCustomerPhone, setBackdatedCustomerPhone] = useState('');
  const [showBackdatedSuggestions, setShowBackdatedSuggestions] = useState(false);
  const [selectedBackdatedLetter, setSelectedBackdatedLetter] = useState<string | null>(null);
  const [backdatedIsCheckout, setBackdatedIsCheckout] = useState(false);
  // On-screen numeric keypad for the backdated sale cart (mirrors Kikapu)
  const [backdatedKeypad, setBackdatedKeypad] = useState<{
    itemId: string;
    type: 'qty' | 'price' | 'total';
    name: string;
    value: string;
    maxStock?: number;
    isFirstOverride?: boolean;
  } | null>(null);
  const [backdatedBlockClicks, setBackdatedBlockClicks] = useState(false);

  // Expense Modal state
  const [backdatedExpenseDate, setBackdatedExpenseDate] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  });
  const [backdatedExpenseAmount, setBackdatedExpenseAmount] = useState('');
  const [backdatedExpenseCategory, setBackdatedExpenseCategory] = useState('Mengineyo');
  const [backdatedExpenseDesc, setBackdatedExpenseDesc] = useState('');
  const [isSubmittingBackdated, setIsSubmittingBackdated] = useState(false);

  // Load all active products for the backdated sale selection. Scoped to the active shop — the
  // local cache retains products from every shop this device has logged into, so an unscoped read
  // listed another shop's products in the backdated picker.
  const allProducts = useLiveQuery(
    () => user?.shopId
      ? db.products.where('[shop_id+isDeleted]').equals([user.shopId, 0]).toArray()
      : Promise.resolve([]),
    [user?.shopId]
  ) || [];

  const sortedProducts = useMemo(() => {
    return [...allProducts]
      .map(p => {
        const isTracked = isProductStockTracked(p, shop);
        const validStock = getValidStock(p, isExpiryEnabled);
        // `_expired` flags a tracked product that still HAS stock but whose valid stock is 0 purely
        // because every batch holding it has expired — shown as a disabled card, mirroring Kikapu.
        const isExpiredOut = isTracked && isExpiryEnabled && validStock === 0 && Number(p.stock) > 0;
        return { ...p, stock: validStock, _expired: isExpiredOut };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allProducts, isExpiryEnabled, shop]);

  const backdatedFilteredProducts = useMemo(() => {
    const s = backdatedSearch.toLowerCase();
    return sortedProducts
      .filter(p => {
        if (!p.name) return false;
        // Mirror Kikapu: untracked products have no stock concept, so always show them.
        // Only tracked products are hidden when out of stock — except expired-but-in-stock ones,
        // which are kept so they can render as disabled "Imeisha muda" cards.
        if (isProductStockTracked(p, shop) && p.stock <= 0 && !p._expired) return false;

        const nameLower = p.name.toLowerCase();
        if (s && !nameLower.includes(s)) return false;
        if (selectedBackdatedLetter) {
          if (selectedBackdatedLetter === '#') {
            return !/^[a-zA-Z]/.test(p.name);
          }
          return nameLower.startsWith(selectedBackdatedLetter.toLowerCase());
        }
        return true;
      })
      .sort((a, b) => {
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        const aStarts = aName.startsWith(s);
        const bStarts = bName.startsWith(s);
        
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aName.localeCompare(bName);
      });
  }, [sortedProducts, backdatedSearch, selectedBackdatedLetter, shop]);

  // Retrieve customer names and phones for autocomplete (matching Kikapu.tsx)
  const customerData = useLiveQuery(async () => {
    if (!user?.shopId) return { names: [], phones: new Map<string, string>() };
    const customers = new Map<string, string>();
    const phones = new Map<string, string>();
    
    await db.sales
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .reverse()
      .limit(1000)
      .each(s => {
        if (s.customer_name) {
          const lower = s.customer_name.toLowerCase();
          if (!customers.has(lower)) {
            customers.set(lower, s.customer_name);
            if (s.customer_phone) {
              phones.set(lower, s.customer_phone);
            }
          }
        }
      });
      
    return {
      names: Array.from(customers.values()),
      phones
    };
  }, [user?.shopId]) || { names: [], phones: new Map() };

  const backdatedFilteredCustomers = useMemo(() => {
    const names = customerData.names || [];
    return names.filter(c => 
      c.toLowerCase().includes(backdatedCustomerName.toLowerCase())
    );
  }, [customerData.names, backdatedCustomerName]);

  const handleSelectBackdatedCustomer = (name: string) => {
    setBackdatedCustomerName(name);
    setShowBackdatedSuggestions(false);
    const phone = customerData.phones.get(name.toLowerCase());
    if (phone) {
      setBackdatedCustomerPhone(phone);
    }
  };

  const handleAddToBackdatedCart = (product: any) => {
    if (!product) return;
    // Untracked products have no stock concept — never block them (mirrors Kikapu).
    const isTracked = isProductStockTracked(product, shop);
    if (isTracked && product.stock <= 0) {
      showAlert('Taarifa', `Bidhaa ${product.name} haina stoki kwa sasa.`);
      return;
    }
    const existing = backdatedSaleCart.find(item => item.id === product.id);
    if (existing) {
      const newQty = existing.qty + 1;
      if (isTracked && newQty > product.stock) {
        showAlert('Taarifa', `Umeshafikia kikomo cha stoki kwa ${product.name}`);
        return;
      }
      setBackdatedSaleCart(prev => prev.map(item => 
        item.id === product.id ? { ...item, qty: newQty } : item
      ));
    } else {
      setBackdatedSaleCart(prev => [...prev, {
        id: product.id,
        name: product.name,
        qty: 1,
        buy_price: product.buy_price || 0,
        sell_price: product.sell_price || 0
      }]);
    }
  };

  const handleUpdateBackdatedQty = (productId: string, newQty: number) => {
    const product = sortedProducts.find(p => p.id === productId);
    if (!product) return;
    // Only tracked products are capped at available stock (mirrors Kikapu).
    if (isProductStockTracked(product, shop) && newQty > product.stock) {
      showAlert('Taarifa', `Umeshafikia kikomo cha stoki kwa ${product.name}`);
      return;
    }
    if (newQty <= 0) {
      setBackdatedSaleCart(prev => prev.filter(item => item.id !== productId));
    } else {
      setBackdatedSaleCart(prev => prev.map(item => 
        item.id === productId ? { ...item, qty: newQty } : item
      ));
    }
  };

  const handleRemoveFromBackdatedCart = (id: string) => {
    setBackdatedSaleCart(prev => prev.filter(item => item.id !== id));
  };

  // --- Backdated numeric keypad (mirrors Kikapu's keypad behaviour) ---
  // Flush the currently-open keypad into the cart BEFORE switching fields, else the value
  // typed into the old field (qty/price/total) is discarded and snaps back to the stored value.
  const openBackdatedKeypad = (config: any) => {
    if (backdatedKeypad) commitBackdatedKeypad();
    setBackdatedKeypad(config);
  };

  const closeBackdatedKeypadAndBlock = () => {
    setBackdatedKeypad(null);
    setBackdatedBlockClicks(true);
    setTimeout(() => setBackdatedBlockClicks(false), 350);
  };

  // Commit the keypad's typed value into the cart, then callers clear the keypad.
  // Apply the keypad's typed value into the cart and return the resulting cart SYNCHRONOUSLY,
  // so a caller can sell with the up-to-date qty/price without waiting for the async re-render
  // (the setState below won't have flushed yet within the same tap).
  const commitBackdatedKeypad = (): typeof backdatedSaleCart => {
    const kp = backdatedKeypad;
    if (!kp) return backdatedSaleCart;
    let newCart = backdatedSaleCart;
    if (kp.type === 'qty') {
      const parsed = parseInt(kp.value || '1', 10);
      let qty = Math.max(1, isNaN(parsed) ? 1 : parsed);
      const product = sortedProducts.find(p => p.id === kp.itemId);
      if (product && isProductStockTracked(product, shop) && qty > product.stock) qty = product.stock;
      newCart = backdatedSaleCart.map(item => (item.id === kp.itemId ? { ...item, qty } : item));
    } else if (kp.type === 'price') {
      const parsed = parseFloat(kp.value || '0');
      if (!isNaN(parsed) && parsed >= 0) {
        newCart = backdatedSaleCart.map(item => (item.id === kp.itemId ? { ...item, sell_price: parsed } : item));
      }
    } else if (kp.type === 'total') {
      // Negotiated grand total: spread it across every line proportionally so each line's
      // sell_price stays truthful (profit, stock and discount logs read from it) and
      // Σ(qty × price) equals the typed total exactly.
      const target = parseFloat(kp.value || '0');
      if (!isNaN(target) && target >= 0) {
        const currentSum = backdatedSaleCart.reduce((s, it) => s + it.sell_price * it.qty, 0);
        if (currentSum > 0) {
          const ratio = target / currentSum;
          newCart = backdatedSaleCart.map(item => ({ ...item, sell_price: item.sell_price * ratio }));
        }
      }
    }
    if (newCart !== backdatedSaleCart) setBackdatedSaleCart(newCart);
    return newCart;
  };

  const handleBackdatedKeypadPress = (key: string) => {
    setBackdatedKeypad(prev => {
      if (!prev) return null;
      let newVal = prev.value;
      if (prev.isFirstOverride) {
        newVal = key === '00' || key === '000' ? '0' : key;
      } else if (newVal === '0') {
        if (key !== '0' && key !== '00' && key !== '000') newVal = key;
      } else {
        newVal = newVal + key;
      }
      if ((prev.type === 'price' || prev.type === 'total') && newVal.length > 10) return prev;
      if (prev.type === 'qty') {
        const parsed = parseInt(newVal, 10) || 0;
        if (prev.maxStock !== undefined && parsed > prev.maxStock) {
          newVal = prev.maxStock.toString();
          showToast(`Kikomo cha stock (${prev.maxStock}) kimefikiwa!`, 'info');
        }
      }
      return { ...prev, value: newVal, isFirstOverride: false };
    });
  };

  const backdatedSaleTotal = useMemo(() => {
    // Previewing a negotiated grand total being typed on the keypad.
    if (backdatedKeypad && backdatedKeypad.type === 'total') {
      return parseFloat(backdatedKeypad.value || '0') || 0;
    }
    return backdatedSaleCart.reduce((sum, item) => {
      let qty = item.qty;
      let price = item.sell_price;
      // Reflect the value being typed on the keypad right now so the total matches the line preview.
      if (backdatedKeypad && backdatedKeypad.itemId === item.id) {
        if (backdatedKeypad.type === 'qty') qty = parseInt(backdatedKeypad.value || '0', 10) || 0;
        else if (backdatedKeypad.type === 'price') price = parseFloat(backdatedKeypad.value || '0') || 0;
      }
      return sum + price * qty;
    }, 0);
  }, [backdatedSaleCart, backdatedKeypad]);

  const backdatedSaleProfit = useMemo(() => {
    return backdatedSaleCart.reduce((sum, item) => sum + ((item.sell_price - item.buy_price) * item.qty), 0);
  }, [backdatedSaleCart]);



  const handleCompleteBackdatedSale = async (overrideMethod?: 'cash' | 'credit' | 'mobile', cartArg?: typeof backdatedSaleCart) => {
    // Prefer the passed cart when provided — it reflects a just-committed keypad value that
    // hasn't re-rendered into `backdatedSaleCart` yet. Compute totals from it too (the memoized
    // backdatedSaleTotal/Profit are derived from state and would be stale here).
    const cart = cartArg ?? backdatedSaleCart;
    const total = cart.reduce((sum, item) => sum + item.sell_price * item.qty, 0);
    const profit = cart.reduce((sum, item) => sum + (item.sell_price - item.buy_price) * item.qty, 0);
    if (cart.length === 0) {
      showAlert('Kosa', 'Tafadhali ongeza angalau bidhaa moja kwenye kikapu.');
      return;
    }
    if (!user?.shopId) {
      showAlert('Kosa', 'Duka halijatambuliwa kwa sasa.');
      return;
    }
    const finalMethod = overrideMethod || backdatedPaymentMethod;
    if (finalMethod === 'credit' && !backdatedCustomerName.trim()) {
      showAlert('Kosa', 'Tafadhali weka jina la mteja kwa mauzo ya mkopo.');
      return;
    }

    // Loss guard: before recording, warn if any line is priced below its buy price, naming
    // exactly which products and how much is lost. The boss still gets the audit log — this is
    // a live chance to catch a mistyped/over-negotiated price on a backdated sale.
    const lossItems = cart.filter(it => Number(it.sell_price) < Number(it.buy_price));
    if (lossItems.length > 0) {
      const lossLines = lossItems
        .map(it => {
          const lineLoss = (Number(it.buy_price) - Number(it.sell_price)) * it.qty;
          return `• ${it.name}: ${formatCurrency(it.sell_price, currency)} (bei ya kununua ${formatCurrency(it.buy_price, currency)}) — hasara ${formatCurrency(lineLoss, currency)}`;
        })
        .join('\n');
      const totalLoss = lossItems.reduce((s, it) => s + (Number(it.buy_price) - Number(it.sell_price)) * it.qty, 0);
      const proceed = await new Promise<boolean>(resolve => {
        showConfirm(
          'Unauza kwa Hasara!',
          `Bidhaa zifuatazo unaziuza CHINI ya bei ya kununua:\n\n${lossLines}\n\nJumla ya hasara: ${formatCurrency(totalLoss, currency)}\n\nUna uhakika unataka kuendelea na mauzo haya?`,
          () => resolve(true),
          () => resolve(false)
        );
      });
      if (!proceed) return;
    }

    setIsSubmittingBackdated(true);

    try {
      const saleId = uuidv4();
      const isCreditSale = finalMethod === 'credit';
      
      const nowTime = new Date();
      const selectedDateObj = new Date(backdatedSaleDate);
      selectedDateObj.setHours(nowTime.getHours(), nowTime.getMinutes(), nowTime.getSeconds());
      const historicalIsoDate = selectedDateObj.toISOString();

      const sale: Sale = {
        id: saleId,
        shop_id: user.shopId,
        user_id: user.id,
        total_amount: total,
        total_profit: profit,
        is_credit: isCreditSale,
        is_paid: !isCreditSale,
        payment_method: finalMethod,
        status: isCreditSale ? 'pending' : 'completed',
        customer_name: isCreditSale ? backdatedCustomerName.trim() : undefined,
        customer_phone: isCreditSale ? backdatedCustomerPhone.trim() : undefined,
        date: historicalIsoDate,
        created_at: historicalIsoDate,
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 0
      };

      const saleItems: SaleItem[] = cart.map(item => ({
        id: uuidv4(),
        sale_id: saleId,
        shop_id: user.shopId!,
        product_id: item.id,
        product_name: item.name,
        qty: item.qty,
        buy_price: item.buy_price,
        sell_price: item.sell_price,
        created_at: historicalIsoDate,
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 0
      }));

      const shopObj = await db.shops.get(user.shopId);

      const anomaliesHeavyDiscountToLog: any[] = [];

      await db.transaction('rw', [db.products, db.sales, db.saleItems, db.auditLogs], async () => {
        // Double check stock and identify discounts
        for (const item of cart) {
          const dbProduct = await db.products.get(item.id);
          const isTracked = dbProduct ? isProductStockTracked(dbProduct, shopObj) : false;
          const validStock = dbProduct ? getValidStock(dbProduct, isExpiryEnabled) : 0;
          if (isTracked && (!dbProduct || validStock < item.qty)) {
            throw new Error(`Bidhaa "${item.name}" haina stock ya kutosha. Stock iliyopo sasa: ${validStock}`);
          }

          if (dbProduct && Number(item.sell_price) < Number(dbProduct.sell_price)) {
            const discountPercentage = ((Number(dbProduct.sell_price) - Number(item.sell_price)) / Number(dbProduct.sell_price)) * 100;
            if (Number(item.sell_price) < Number(dbProduct.buy_price) || discountPercentage > 20) {
              anomaliesHeavyDiscountToLog.push({
                product_id: item.id,
                name: item.name,
                original_price: Number(dbProduct.sell_price),
                discounted_price: Number(item.sell_price),
                buy_price: Number(dbProduct.buy_price),
                qty: item.qty
              });
            }
          }
        }

        // Write
        await db.sales.add(sale);
        await db.saleItems.bulkAdd(saleItems);

        // Deduct quantities
        for (const item of cart) {
          const product = await db.products.get(item.id);
          if (product) {
            const isTracked = isProductStockTracked(product, shopObj);
            if (isTracked) {
              let remainingQtyToDeduct = Number(item.qty);
              let updatedBatches = product.batches ? JSON.parse(JSON.stringify(product.batches)) : [];

              updatedBatches.sort((a: any, b: any) => {
                if (!a.expiry_date) return 1;
                if (!b.expiry_date) return -1;
                return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
              });

              for (let i = 0; i < updatedBatches.length; i++) {
                if (remainingQtyToDeduct <= 0) break;
                const batch = updatedBatches[i];
                if (isBatchExpired(batch.expiry_date)) continue;

                if (batch.stock > 0) {
                  const deductAmount = Math.min(Number(batch.stock), remainingQtyToDeduct);
                  batch.stock = Number(batch.stock) - deductAmount;
                  remainingQtyToDeduct -= deductAmount;
                }
              }

              updatedBatches = updatedBatches.filter((b: any) => Number(b.stock) > 0);

              let newStock = Math.max(0, Number(product.stock) - Number(item.qty));
              if (shopObj?.enable_expiry) {
                const totalBatchStock = updatedBatches.reduce((sum: number, b: any) => sum + Number(b.stock), 0);
                const originalTotalBatchStock = (product.batches || []).reduce((sum: number, b: any) => sum + Number(b.stock), 0);
                const unbatchedStock = Math.max(0, Number(product.stock) - originalTotalBatchStock);
                
                const deductedFromBatches = originalTotalBatchStock - totalBatchStock;
                const deductedFromUnbatched = Math.max(0, Number(item.qty) - deductedFromBatches);
                const remainingUnbatched = Math.max(0, unbatchedStock - deductedFromUnbatched);
                
                newStock = totalBatchStock + remainingUnbatched;
              }

              await db.products.update(product.id, {
                stock: newStock,
                stock_delta: (product.stock_delta || 0) - Number(item.qty),
                batches: updatedBatches,
                updated_at: new Date().toISOString(),
                synced: 0
              });
            }
          }
        }

        // Log this as an anomaly: Backdated Sale
        await SyncService.logAction('anomaly_backdated', {
          sale_id: saleId,
          amount: sale.total_amount,
          items: cart.map(i => ({ name: i.name, qty: i.qty })),
          employee_name: user?.name || 'Mhudumu',
          historical_date: historicalIsoDate,
          warning: `Amerekodi mauzo ya tarehe ya nyuma (Backdated). Hii inamaanisha ameingiza muamala baada ya siku husika kupita.`
        });

        if (anomaliesHeavyDiscountToLog.length > 0) {
          const anomaliesDesc = anomaliesHeavyDiscountToLog.map(d => `${d.name} (Ameuza ${d.discounted_price}, Badala ya ${d.original_price})`).join(', ');
          await SyncService.logAction('anomaly_heavy_discount', {
            sale_id: saleId,
            amount: anomaliesHeavyDiscountToLog.reduce((sum, d) => sum + d.discounted_price, 0),
            employee_name: user?.name || 'Mhudumu',
            details: anomaliesHeavyDiscountToLog,
            warning: `[Mauzo ya nyuma] Amepunguza bei ya kuuzia kwa kiasi kikubwa au kuuza chini ya bei halisi ya mzigo stoo. Bidhaa: ${anomaliesDesc}`
          });
        }
      });

      TelemetryService.trackBackdatedSale(total, cart.reduce((a, b) => a + b.qty, 0));
      showToast(`Mauzo ya siku za nyuma yamefanikiwa!`, 'success');
      setBackdatedSaleCart([]);
      setBackdatedIsCheckout(false);
      setBackdatedCustomerName('');
      setBackdatedCustomerPhone('');
      SyncService.sync().catch(err => console.error('Sync failed:', err));
    } catch (err: any) {
      console.error('Failed to save backdated sale:', err);
      showAlert('Kosa', err.message || 'Imeshindwa kuhifadhi mauzo ya zamani.');
    } finally {
      setIsSubmittingBackdated(false);
    }
  };

  const handleSaveBackdatedExpense = async () => {
    const rawAmount = parseInputNumber(backdatedExpenseAmount);
    if (rawAmount <= 0) {
      showAlert('Kosa', 'Tafadhali weka kiasi halali cha fedha asili kwanza.');
      return;
    }
    if (!user?.shopId) {
      showAlert('Kosa', 'Duka halijatambuliwa kwa sasa.');
      return;
    }

    setIsSubmittingBackdated(true);

    try {
      const expenseId = uuidv4();
      
      const nowTime = new Date();
      const selectedDateObj = new Date(backdatedExpenseDate);
      selectedDateObj.setHours(nowTime.getHours(), nowTime.getMinutes(), nowTime.getSeconds());
      const historicalIsoDate = selectedDateObj.toISOString();

      const expense: Expense = {
        id: expenseId,
        shop_id: user.shopId,
        user_id: user.id,
        amount: rawAmount,
        category: backdatedExpenseCategory,
        description: backdatedExpenseDesc.trim() || 'Maelezo ya asili ya kipindi kilichopita',
        date: historicalIsoDate,
        created_at: historicalIsoDate,
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 0
      };

      await db.expenses.add(expense);

      await SyncService.logAction('add_expense', {
        category: expense.category,
        amount: rawAmount,
        description: expense.description + ' (Past Entry to ' + backdatedExpenseDate + ')'
      });

      showAlert('Imefanikiwa', `Matumizi ya tarehe ${backdatedExpenseDate} ya ${formatCurrency(rawAmount, currency)} yamehifadhiwa kwa mafanikio vya duka lako.`);
      TelemetryService.trackBackdatedExpense(rawAmount, backdatedExpenseCategory);
      setShowBackdatedExpenseModal(false);
      setBackdatedExpenseAmount('');
      setBackdatedExpenseDesc('');
      SyncService.sync().catch(err => console.error('Sync failed:', err));
    } catch (err: any) {
      console.error('Failed to save backdated expense:', err);
      showAlert('Kosa', err.message || 'Imeshindwa kuhifadhi matumizi ya zamani.');
    } finally {
      setIsSubmittingBackdated(false);
    }
  };

  const [view, setView] = useState<'risiti' | 'ripoti'>('risiti');
  const [filter, setFilter] = useState('leo'); // leo, wiki, mwezi, miezi6, mwaka, yote

  useEffect(() => {
    if (location.state) {
      const state = location.state as any;
      if (state.filter) {
        setFilter(state.filter);
      }
      if (state.view) {
        setView(state.view);
      }
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);
  const [reportType, setReportType] = useState<'mwezi' | 'mwaka'>('mwezi');
  const [topProductsMetric, setTopProductsMetric] = useState<'qty' | 'profit'>('qty');
  const [loadedReports, setLoadedReports] = useState<Record<string, boolean>>({});
  const [loadingReports, setLoadingReports] = useState<Record<string, boolean>>({});
  const [showReportModal, setShowReportModal] = useState(false);
  const [preparingReport, setPreparingReport] = useState(false);
  const [pdfPeriod, setPdfPeriod] = useState<PdfPeriod>('month');

  const handleLoadReport = (label: string) => {
    setLoadingReports(prev => ({ ...prev, [label]: true }));
    setTimeout(() => {
      setLoadingReports(prev => ({ ...prev, [label]: false }));
      setLoadedReports(prev => ({ ...prev, [label]: true }));
    }, 1200);
  };

  const handleReportTypeChange = (type: 'mwezi' | 'mwaka') => {
    setReportType(type);
    setLoadedReports({});
    setLoadingReports({});
  };
  const [reversingSaleId, setReversingSaleId] = useState<string | null>(null);
  const [isReversing, setIsReversing] = useState(false);
  
  const boss = isBoss();
  const hasMapatoAccess = boss || isFeatureEnabled('show_mapato_to_staff');
  
  const rawSales = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    let startDateNum = 0;
    const n = new Date();
    if (view === 'ripoti') {
      startDateNum = 0;
    } else {
      switch(filter) {
        case 'leo': startDateNum = startOfDay(n).getTime(); break;
        case 'jana': startDateNum = startOfDay(subDays(n, 1)).getTime(); break;
        case 'wiki': startDateNum = startOfWeek(n, { weekStartsOn: 0 }).getTime(); break;
        case 'mwezi': startDateNum = startOfMonth(n).getTime(); break;
        case 'miezi6': startDateNum = subMonths(n, 6).getTime(); break;
        case 'mwaka': startDateNum = startOfYear(n).getTime(); break;
        default: startDateNum = 0; break;
      }
    }
    
    // Raw sales are loaded only for the recent window (transaction list, 30-day
    // trend, top products). All-time / long-period TOTALS and monthly/yearly
    // reports come from the salesDaily rollups instead, so we never load years
    // of raw sales into memory.
    const windowStart = subDays(n, 90).getTime();
    const minDate = Math.max(windowStart, view === 'ripoti' ? windowStart : Math.min(startDateNum, subDays(n, 30).getTime()));
    const minIso = new Date(minDate).toISOString();

    const queryResult = await db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, minIso], [user.shopId, 0, '\uffff'])
      .toArray();

    const filteredResult = boss ? queryResult : queryResult.filter(s => s.user_id === user.id);
    return filteredResult.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [user?.shopId, filter, boss, user?.id, view]);

  const sales = rawSales || [];

  const rawSaleItems = useLiveQuery(async () => {
    if (!user?.shopId || sales.length === 0) return [];
    const saleIds = sales.map(s => s.id);
    return db.saleItems
      .where('sale_id')
      .anyOf(saleIds)
      .filter(i => i.isDeleted !== 1)
      .toArray();
  }, [sales]);

  const saleItems = rawSaleItems || [];
  
  const rawExpenses = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    let startDateNum = 0;
    const n = new Date();
    if (view === 'ripoti') {
      startDateNum = 0;
    } else {
      switch(filter) {
        case 'leo': startDateNum = startOfDay(n).getTime(); break;
        case 'jana': startDateNum = startOfDay(subDays(n, 1)).getTime(); break;
        case 'wiki': startDateNum = startOfWeek(n, { weekStartsOn: 0 }).getTime(); break;
        case 'mwezi': startDateNum = startOfMonth(n).getTime(); break;
        case 'miezi6': startDateNum = subMonths(n, 6).getTime(); break;
        case 'mwaka': startDateNum = startOfYear(n).getTime(); break;
        default: startDateNum = 0; break;
      }
    }
    const minIso = new Date(startDateNum).toISOString();

    const queryResult = await db.expenses
      .where('[shop_id+isDeleted+date]')
      .between([user.shopId, 0, minIso], [user.shopId, 0, '\uffff'])
      .toArray();

    const filteredResult = boss ? queryResult : queryResult.filter(e => e.user_id === user.id);
    return filteredResult.sort((a, b) => b.date.localeCompare(a.date));
  }, [user?.shopId, filter, boss, user?.id, view]);

  const expenses = rawExpenses || [];

  const isLoading = rawSales === undefined || rawExpenses === undefined || (sales.length > 0 && rawSaleItems === undefined) || syncStatus === 'active';

  const now = new Date();
  const getStartDate = () => {
    switch(filter) {
      case 'leo': return startOfDay(now).getTime();
      case 'jana': return startOfDay(subDays(now, 1)).getTime();
      case 'wiki': return startOfWeek(now, { weekStartsOn: 0 }).getTime();
      case 'mwezi': return startOfMonth(now).getTime();
      case 'miezi6': return subMonths(now, 6).getTime();
      case 'mwaka': return startOfYear(now).getTime();
      default: return 0;
    }
  };

  const getEndDate = () => {
    if (filter === 'jana') {
      return startOfDay(now).getTime();
    }
    return Infinity;
  };

  const startDate = getStartDate();
  const endDate = getEndDate();
  const filteredSales = sales.filter(s => {
    const t = new Date(s.created_at).getTime();
    return t >= startDate && t < endDate;
  });
  const filteredExpenses = expenses.filter(e => {
    const t = new Date(e.date).getTime();
    return t >= startDate && t < endDate;
  });

  // Short periods (leo/jana/wiki/mwezi) fit inside the 90-day raw window, so their
  // totals come straight from raw sales (exact, no rollup dependency). Long periods
  // (miezi6/mwaka/zote/ripoti) can't load raw, so they read the salesDaily rollups.
  const longPeriod = view === 'ripoti' || filter === 'yote' || filter === 'miezi6' || filter === 'mwaka';
  const summaryStartStr = msToDateStr(startDate || 0);
  const summaryEndStr = msToDateStr(filter === 'jana' ? startOfDay(subDays(now, 1)).getTime() : now.getTime());
  const summaryTotals = useLiveQuery(async () => {
    if (!user?.shopId || !longPeriod) return null;
    if (boss) return getSalesTotals(user.shopId, summaryStartStr, summaryEndStr);
    const empMap = await getEmployeeTotals(user.shopId, summaryStartStr, summaryEndStr);
    return empMap.get(user.id) || { revenue: 0, profit: 0, count: 0 };
  }, [user?.shopId, boss, user?.id, longPeriod, summaryStartStr, summaryEndStr]);

  const totalRevenue = longPeriod ? (summaryTotals?.revenue ?? 0) : filteredSales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalProfit = longPeriod ? (summaryTotals?.profit ?? 0) : filteredSales.reduce((sum, s) => sum + s.total_profit, 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Show net profit for all filters
  const showNetProfit = true;
  const netProfit = totalProfit - totalExpenses;

  // --- Loading feedback for period switches -----------------------------------
  // The rollup TOTALS are instant (~one row per day), but useLiveQuery keeps the
  // previous period's numbers on screen while the new query runs — and switching to
  // a long period (Miezi 6 / Mwaka / Yote) still re-loads the recent raw-sales window
  // that feeds the list, trend and top products. That gap looks frozen, so show
  // skeletons from the moment the period changes until fresh data settles.
  const periodKey = `${view}|${filter}`;
  const [loadedPeriodKey, setLoadedPeriodKey] = useState('');
  useEffect(() => {
    setLoadedPeriodKey(`${view}|${filter}`);
  }, [rawSales, rawExpenses, rawSaleItems, summaryTotals]);
  const summaryLoading =
    rawSales === undefined ||
    loadedPeriodKey !== periodKey ||
    (longPeriod && summaryTotals === undefined);
  const skel = (w: string) => (
    <span className={`inline-block h-5 ${w} bg-gray-200 rounded animate-pulse align-middle`} />
  );

  // Transaction list is paginated (render-only): 50 most recent, +50 per tap, so a
  // long period never renders thousands of cards at once. Reset to 50 whenever the
  // period/view changes so each period starts from its most recent 50.
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => { setVisibleCount(50); }, [filter, view]);

  // On-screen report rows come from the salesDaily rollups (all-time), grouped by
  // month or year per the Kila Mwezi / Kila Mwaka toggle — never from raw sales.
  const reportDailySeries = useLiveQuery(() => {
    if (!user?.shopId || view !== 'ripoti') return [];
    return getDailySeries(user.shopId, '1970-01-01', msToDateStr(Date.now()));
  }, [user?.shopId, view]);

  // Chart Data: Revenue Trend (Last 30 days) — sourced from the daily rollups
  // (one row per day) instead of filtering the raw sales window, so the chart stays
  // cheap and correct regardless of the selected period. Boss sees the whole shop
  // (salesDaily); an employee sees only their own days (salesEmployeeDaily).
  const trendSeries = useLiveQuery(async () => {
    if (!user?.shopId) return [] as { date: string; revenue: number; profit: number }[];
    const startStr = msToDateStr(subDays(new Date(), 29).getTime());
    const endStr = msToDateStr(Date.now());
    const rows: { date: string; revenue: number; profit: number }[] = boss
      ? await getDailySeries(user.shopId, startStr, endStr)
      : await getEmployeeDailySeries(user.shopId, user.id, startStr, endStr);
    return rows;
  }, [user?.shopId, boss, user?.id]);

  const trendData = useMemo(() => {
    const byDate = new Map<string, { revenue: number; profit: number }>();
    (trendSeries || []).forEach(r => byDate.set(r.date, { revenue: r.revenue, profit: r.profit }));
    return eachDayOfInterval({ start: subDays(now, 29), end: now }).map(day => {
      const r = byDate.get(format(day, 'yyyy-MM-dd'));
      return {
        date: format(day, 'dd/MM'),
        Mapato: r?.revenue ?? 0,
        Faida: r?.profit ?? 0
      };
    });
  }, [trendSeries]);

  // Chart Data: Top 10 Products
  const topProductsData = useMemo(() => {
    const productStats: Record<string, { name: string, qty: number, profit: number }> = {};
    
    saleItems.forEach(item => {
      if (!productStats[item.product_id]) {
        productStats[item.product_id] = { name: item.product_name, qty: 0, profit: 0 };
      }
      productStats[item.product_id].qty += item.qty;
      productStats[item.product_id].profit += (item.sell_price - item.buy_price) * item.qty;
    });

    return Object.values(productStats)
      .sort((a, b) => topProductsMetric === 'qty' ? b.qty - a.qty : b.profit - a.profit)
      .slice(0, 10)
      .map(p => ({
        name: p.name.length > 12 ? p.name.substring(0, 10) + '..' : p.name,
        value: topProductsMetric === 'qty' ? p.qty : p.profit
      }));
  }, [saleItems, topProductsMetric]);

  const handleReverseSale = async (saleId: string) => {
    if (!user?.shopId) return;
    setIsReversing(true);
    
    try {
      // db.shops is NOT part of the transaction scope, so it must be read BEFORE
      // the transaction begins — reading it inside throws "object store not found".
      // db.settings is added to the scope because SyncService.logAction reads it
      // during off-hours refunds (which would otherwise throw the same error).
      const shopObj = await db.shops.get(user.shopId);

      await db.transaction('rw', [db.sales, db.saleItems, db.products, db.debtPayments, db.auditLogs, db.settings], async () => {
        const sale = await db.sales.get(saleId);
        if (!sale) throw new Error('Sale not found');

        const items = await db.saleItems.where('sale_id').equals(saleId).toArray();

        // 1. Return stock to products
        for (const item of items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            const isTracked = isProductStockTracked(product, shopObj);
            if (isTracked) {
              let updatedBatches = product.batches ? JSON.parse(JSON.stringify(product.batches)) : [];
              
              if (updatedBatches.length > 0) {
                // Return to the first non-expired batch, or the first one if all expired
                let returned = false;
                for (let i = 0; i < updatedBatches.length; i++) {
                  if (!isBatchExpired(updatedBatches[i].expiry_date)) {
                    updatedBatches[i].stock = Number(updatedBatches[i].stock) + item.qty;
                    returned = true;
                    break;
                  }
                }
                if (!returned) {
                  updatedBatches[0].stock = Number(updatedBatches[0].stock) + item.qty;
                }
              }
              
              await db.products.update(item.product_id, {
                stock: Number(product.stock) + item.qty,
                stock_delta: (product.stock_delta || 0) + item.qty,
                batches: updatedBatches,
                updated_at: new Date().toISOString(),
                synced: 0
              });
            }
          }
        }
        
        // 2. Soft delete sale and items
        await db.sales.update(saleId, { 
          isDeleted: 1, 
          status: 'refunded',
          updated_at: new Date().toISOString(),
          synced: 0 
        });

        // Removed sendAuditAlert because it was alerting local Boss about their own actions.
        // Audit logs are properly tracked via SyncService for employees.
        
        const itemIds = items.map(i => i.id);
        await db.saleItems.where('id').anyOf(itemIds).modify({ 
          isDeleted: 1,
          updated_at: new Date().toISOString(),
          synced: 0 
        });

        // 3. Soft delete debt payments if any
        await db.debtPayments.where('sale_id').equals(saleId).modify({
          isDeleted: 1,
          updated_at: new Date().toISOString(),
          synced: 0 
        });

        // 4. Log to audit logs for the boss to see
        await SyncService.logAction('refund_sale', {
          sale_id: saleId,
          amount: sale.total_amount,
          items: items.map(i => ({ name: i.product_name, qty: i.qty })),
          customer: sale.customer_name
        });

        TelemetryService.trackRefundSale(saleId, sale.total_amount);

        // 5. Anomaly Detection: Delayed Sale Deletion
        const saleCreatedAt = new Date(sale.created_at);
        const timeDiffMinutes = (new Date().getTime() - saleCreatedAt.getTime()) / (1000 * 60);
        if (timeDiffMinutes > 30) {
          const formattedSaleDate = format(saleCreatedAt, 'dd MMM yyyy, HH:mm');
          
          let friendlyAgo = '';
          const diffMinutesRounded = Math.round(timeDiffMinutes);
          if (diffMinutesRounded < 60) {
            friendlyAgo = `dakika ${diffMinutesRounded}`;
          } else {
            const diffHours = Math.round(diffMinutesRounded / 60);
            if (diffHours < 24) {
              friendlyAgo = `saa ${diffHours}`;
            } else {
              const diffDays = Math.round(diffHours / 24);
              if (diffDays < 7) {
                friendlyAgo = `siku ${diffDays}`;
              } else if (diffDays < 30) {
                const diffWeeks = Math.round(diffDays / 7);
                friendlyAgo = `wiki ${diffWeeks}`;
              } else {
                const diffMonths = Math.round(diffDays / 30);
                friendlyAgo = `miezi ${diffMonths}`;
              }
            }
          }

          const productNames = items.map(i => `${i.product_name} (${i.qty} pcs)`).join(', ');

          await SyncService.logAction('anomaly_delayed_delete', {
            sale_id: saleId,
            time_passed_minutes: diffMinutesRounded,
            amount: sale.total_amount,
            employee_name: user?.name || 'Mhudumu',
            name: productNames,
            warning: `Amefuta (delete) mauzo ya tarehe ${formattedSaleDate} (takriban ${friendlyAgo} zilizopita) tangu yafanyike.`
          });
        }
      });
      
      setReversingSaleId(null);
      SyncService.sync();
    } catch (error: any) {
      console.error('Failed to reverse sale:', error);
      alert('Imeshindwa kurudisha mauzo: ' + error.message);
    } finally {
      setIsReversing(false);
    }
  };

  const exportPDFReports = async (period: PdfPeriod) => {
    try {
      const { default: JsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new JsPDF();
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const M = 14;
      const contentW = pageW - M * 2;

      const shop = await db.shops.get(user?.shopId || '');

      // Re-fetch the report rows FRESH from the rollups at generation time (not the
      // reactive state), so the PDF always reflects the latest synced/rebuilt data.
      const range = pdfPeriodRange(period);
      const startMs = range.start.getTime();
      const endMs = range.end.getTime();
      const series = user?.shopId ? await getDailySeries(user.shopId, msToDateStr(startMs), msToDateStr(endMs)) : [];
      const allExps = user?.shopId ? await db.expenses.where('[shop_id+isDeleted]').equals([user.shopId, 0]).toArray() : [];
      const exps = allExps.filter(e => { const t = new Date(e.date).getTime(); return t >= startMs && t <= endMs; });
      const reportData = buildReportRows(series, exps, range.group);
      if (reportData.length === 0) {
        alert('Hakuna data ya kutosha kutengeneza ripoti.');
        return;
      }
      const periodLabel = PDF_PERIODS.find(p => p.id === period)?.label || '';

      const money = (n: number) => formatCurrency(n, currency);
      const compact = (n: number) => {
        const a = Math.abs(n);
        if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (a >= 1e3) return Math.round(n / 1e3) + 'K';
        return String(Math.round(n));
      };

      // Palette
      const brand: RGB = [37, 99, 235];
      const green: RGB = [22, 163, 74];
      const purple: RGB = [124, 58, 237];
      const orange: RGB = [234, 88, 12];
      const grey: RGB = [148, 163, 184];

      // Aggregate totals
      const totalRevenue = reportData.reduce((a, r) => a + r.mapato, 0);
      const totalGross = reportData.reduce((a, r) => a + r.faida, 0);
      const totalExpenses = reportData.reduce((a, r) => a + r.matumizi, 0);
      const totalNet = totalGross - totalExpenses;
      const totalCount = reportData.reduce((a, r) => a + r.mauzo, 0);
      const cogs = Math.max(0, totalRevenue - totalGross);
      const marginPct = totalRevenue > 0 ? (totalNet / totalRevenue) * 100 : 0;
      const avgSale = totalCount > 0 ? totalRevenue / totalCount : 0;

      // ---- Header banner ----
      doc.setFillColor(brand[0], brand[1], brand[2]);
      doc.rect(0, 0, pageW, 30, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(19);
      doc.text(shop?.name || shopName || 'Biashara', M, 14);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('Ripoti ya Kifedha na Uamuzi wa Biashara', M, 21);
      doc.setFontSize(8);
      doc.text(`Imetolewa: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, pageW - M, 13, { align: 'right' });
      doc.text(`Muhtasari: ${periodLabel}`, pageW - M, 20, { align: 'right' });

      // ---- Business meta ----
      doc.setTextColor(90, 90, 90);
      doc.setFontSize(9);
      const rangeLabel = `${reportData[reportData.length - 1].label} - ${reportData[0].label}`;
      doc.text(`Mmiliki: ${shop?.owner_name || '-'}`, M, 38);
      doc.text(`Simu: ${shop?.phone || '-'}`, M + 68, 38);
      doc.text(`Kipindi: ${rangeLabel}`, M + 120, 38);

      // ---- KPI cards ----
      const cards = [
        { label: 'Jumla ya Mapato', value: money(totalRevenue), color: brand },
        { label: 'Faida Halisi', value: money(totalNet), color: totalNet >= 0 ? green : orange },
        { label: 'Margin ya Faida', value: `${marginPct.toFixed(1)}%`, color: purple },
        { label: 'Idadi ya Mauzo', value: String(totalCount), color: orange },
      ];
      const gap = 4;
      const cardW = (contentW - gap * (cards.length - 1)) / cards.length;
      const cardH = 20;
      const cardY = 44;
      cards.forEach((c, i) => {
        const cx = M + i * (cardW + gap);
        doc.setFillColor(247, 248, 250);
        doc.roundedRect(cx, cardY, cardW, cardH, 2, 2, 'F');
        doc.setFillColor(c.color[0], c.color[1], c.color[2]);
        doc.rect(cx, cardY + 2, 1.6, cardH - 4, 'F');
        doc.setTextColor(120, 120, 120);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(c.label, cx + 5, cardY + 6.5);
        doc.setTextColor(30, 30, 30);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(c.value, cx + 5, cardY + 14.5);
      });

      // ---- Bar chart: revenue vs net profit (chronological, last 8 periods) ----
      doc.setTextColor(40, 40, 40);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Mwenendo wa Mapato na Faida Halisi', M, 74);
      const chrono = [...reportData].reverse().slice(-8);
      drawGroupedBars(
        doc, M + 16, 80, contentW - 16, 42,
        chrono.map(r => r.label),
        [
          { name: 'Mapato', color: brand, values: chrono.map(r => r.mapato) },
          { name: 'Faida Halisi', color: green, values: chrono.map(r => Math.max(0, r.faidaHalisi)) },
        ],
        compact,
      );

      // ---- Donut: where each shilling of revenue goes ----
      doc.setTextColor(40, 40, 40);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Mgawanyo wa Kila Shilingi ya Mapato', M, 140);
      drawDonut(
        doc, M + 26, 166, 22,
        [
          { label: 'Gharama ya Bidhaa', value: cogs, color: grey },
          { label: 'Matumizi', value: totalExpenses, color: orange },
          { label: 'Faida Halisi', value: Math.max(0, totalNet), color: green },
        ],
        money,
      );

      // ---- Page 2: analysis + income statement + declaration ----
      doc.addPage();
      doc.setFillColor(brand[0], brand[1], brand[2]);
      doc.rect(0, 0, pageW, 4, 'F');
      doc.setTextColor(40, 40, 40);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('Uchambuzi na Mapendekezo', M, 18);

      const insights: string[] = [];
      insights.push(
        marginPct < 0
          ? `Biashara ina hasara ya ${money(Math.abs(totalNet))}. Kagua gharama za bidhaa na matumizi haraka.`
          : marginPct < 10
            ? `Margin ya faida ni ${marginPct.toFixed(1)}% — ni ya chini. Ongeza bei kidogo au punguza gharama ili kuboresha faida.`
            : `Margin ya faida ni ${marginPct.toFixed(1)}% — kiwango kizuri na chenye afya kwa biashara.`,
      );
      const best = [...reportData].sort((a, b) => b.mapato - a.mapato)[0];
      insights.push(`Kipindi bora ni ${best.label} chenye mapato ya ${money(best.mapato)}.`);
      if (reportData.length >= 2) {
        const latest = reportData[0];
        const prev = reportData[1];
        const g = prev.mapato > 0 ? ((latest.mapato - prev.mapato) / prev.mapato) * 100 : 0;
        insights.push(`Mapato ${g >= 0 ? 'yameongezeka' : 'yamepungua'} kwa ${Math.abs(g).toFixed(1)}% (${prev.label} kwenda ${latest.label}).`);
      }
      const expRatio = totalRevenue > 0 ? (totalExpenses / totalRevenue) * 100 : 0;
      insights.push(`Matumizi ni ${expRatio.toFixed(1)}% ya mapato${expRatio > 30 ? ' — ni juu, jaribu kubana gharama za uendeshaji.' : '.'}`);
      insights.push(`Gharama ya bidhaa ni ${totalRevenue > 0 ? ((cogs / totalRevenue) * 100).toFixed(1) : '0'}% ya mapato.`);
      insights.push(`Wastani wa mauzo kwa risiti moja ni ${money(avgSale)}.`);

      let y = 27;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(55, 55, 55);
      insights.forEach(line => {
        doc.setFillColor(brand[0], brand[1], brand[2]);
        doc.circle(M + 1.2, y - 1.2, 0.9, 'F');
        const wrapped = doc.splitTextToSize(line, contentW - 6);
        doc.text(wrapped, M + 5, y);
        y += wrapped.length * 5 + 2.5;
      });

      y += 4;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 40);
      doc.text('Taarifa ya Mapato (Income Statement)', M, y);

      const body = reportData.map(r => [
        r.label,
        money(r.mapato),
        money(r.faida),
        money(r.matumizi),
        money(r.faidaHalisi),
        String(r.mauzo),
      ]);
      body.push(['JUMLA', money(totalRevenue), money(totalGross), money(totalExpenses), money(totalNet), String(totalCount)]);

      autoTable(doc, {
        head: [['Kipindi', 'Mapato', 'Faida Ghafi', 'Matumizi', 'Faida Halisi', 'Mauzo']],
        body,
        startY: y + 4,
        theme: 'striped',
        styles: { fontSize: 8.5, cellPadding: 2 },
        headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [246, 248, 251] },
        didParseCell: (data: any) => {
          if (data.row.index === body.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [232, 238, 246];
          }
        },
      });

      // ---- Declaration ----
      let fy = (doc as any).lastAutoTable.finalY + 14;
      if (fy > pageH - 45) { doc.addPage(); fy = 24; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text('Uthibitisho', M, fy);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(90, 90, 90);
      doc.text('Ninathibitisha kuwa taarifa zilizopo kwenye ripoti hii ni sahihi kwa ufahamu wangu.', M, fy + 7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      doc.text('Sahihi: __________________________', M, fy + 20);
      doc.text(`Jina: ${shop?.owner_name || ''}`, M, fy + 28);
      doc.text(`Tarehe: ${format(new Date(), 'dd/MM/yyyy')}`, M, fy + 36);

      // ---- Footer (page numbers) on every page ----
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setTextColor(150, 150, 150);
        doc.text('Imetengenezwa na Venics Sales', M, pageH - 8);
        doc.text(`Ukurasa ${i}/${pages}`, pageW - M, pageH - 8, { align: 'right' });
      }

      await savePdfDocument(doc, `ripoti_${period}_${format(new Date(), 'yyyy-MM-dd_HHmmss')}.pdf`);
    } catch (error) {
      console.error('PDF Export Error:', error);
      alert('Imeshindwa kutengeneza PDF: ' + error);
    }
  };

  // "Load all data first, then generate." Pulls the latest from the server, ensures
  // the one-time rollup backfill has run, then rebuilds the report window's rollups
  // from raw sales (capped ~400 days) so the report is never built on partial data.
  // Longer periods (e.g. Mwaka Huu) take a few seconds to prepare.
  const handleGenerateReport = async (period: PdfPeriod) => {
    if (preparingReport || !user?.shopId) return;
    setPdfPeriod(period);
    setPreparingReport(true);
    try {
      // No blocking sync here — the background sync already keeps local data fresh.
      // We just ensure the one-time rollup backfill has run, then rebuild ONLY the
      // days that actually changed (from the sales hooks). Fast and accurate.
      await ensureSummariesBackfill(user.shopId);
      await flushDirtyNow();
      await exportPDFReports(period);
      setShowReportModal(false);
    } catch (e) {
      console.error('Report preparation failed', e);
      alert('Imeshindwa kuandaa ripoti. Tafadhali jaribu tena.');
    } finally {
      setPreparingReport(false);
    }
  };

  // On-screen report list — all-time, grouped by month or year (Kila Mwezi / Kila
  // Mwaka). The PDF popup is scoped separately; this stays as it was.
  const reportData = useMemo(() => {
    const group: ReportGroup = reportType === 'mwezi' ? 'month' : 'year';
    return buildReportRows(reportDailySeries || [], expenses, group);
  }, [reportDailySeries, expenses, reportType]);

  return (
    <div className={`p-4 flex flex-col h-full pt-safe pt-safe-standalone ${isMagnified ? 'overflow-y-auto' : ''}`}>
      <div className="flex items-center mb-4">
        <button
          onClick={tap(() => { navigate(-1); })}
          onPointerUp={tap(() => { navigate(-1); })}
          className="mr-3 p-2 bg-white rounded-full shadow-sm border border-gray-100 cursor-pointer"
        >
           <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-gray-800">Historia ya Mauzo</h1>
      </div>

      {/* View Toggle */}
      {(user?.role === 'boss') && (
        <div className="flex bg-gray-200 p-1 rounded-xl mb-6">
          <button
            onClick={tap(() => { setView('risiti'); })}
            onPointerUp={tap(() => { setView('risiti'); })}
            className={`flex-1 py-2 text-sm font-bold rounded-lg flex justify-center items-center transition-colors ${view === 'risiti' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}
          >
            <Receipt className="w-4 h-4 mr-2" /> Risiti
          </button>
          <button
            onClick={tap(() => { setView('ripoti'); })}
            onPointerUp={tap(() => { setView('ripoti'); })}
            className={`flex-1 py-2 text-sm font-bold rounded-lg flex justify-center items-center transition-colors ${view === 'ripoti' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}
          >
            <BarChart3 className="w-4 h-4 mr-2" /> Ripoti
          </button>
        </div>
      )}

      {view === 'risiti' ? (
        <>

          <div className={isMagnified ? "flex flex-wrap gap-1.5 pb-2 mb-4" : "flex space-x-1.5 overflow-x-auto pb-2 mb-4 scrollbar-hide flex-nowrap"}>
            {[
              { id: 'leo', label: 'Leo' },
              { id: 'jana', label: 'Jana' },
              { id: 'wiki', label: 'Wiki Hii' },
              { id: 'mwezi', label: 'Mwezi Huu' },
              { id: 'miezi6', label: 'Miezi 6' },
              { id: 'mwaka', label: 'Mwaka Huu' },
              { id: 'yote', label: 'Yote' }
            ].map(f => (
              <button
                key={f.id}
                onClick={tap(() => { setFilter(f.id); })}
                onPointerUp={tap(() => { setFilter(f.id); })}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${
                  filter === f.id ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mb-6">
            {hasMapatoAccess ? (
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex-1 min-w-[150px]">
                <p className="text-xs text-gray-500 mb-1">Jumla ya Mapato</p>
                <p className="text-base font-bold text-gray-900 break-all">{summaryLoading ? skel('w-24') : formatCurrency(totalRevenue, currency)}</p>
              </div>
            ) : (
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex-1 min-w-[150px]">
                <p className="text-xs text-gray-500 mb-1">Jumla ya Risiti Zilizokatwa</p>
                <p className="text-base font-bold text-purple-600 break-all">{summaryLoading ? skel('w-12') : (longPeriod ? (summaryTotals?.count ?? 0) : filteredSales.length)}</p>
              </div>
            )}
            {(user?.role === 'boss') && (
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex-1 min-w-[150px]">
                <p className="text-xs text-gray-500 mb-1">Jumla ya Faida</p>
                <p className="text-base font-bold text-green-600 break-all">{summaryLoading ? skel('w-24') : formatCurrency(totalProfit, currency)}</p>
              </div>
            )}
            {(user?.role === 'boss') && showNetProfit && (
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 shadow-sm w-full">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <div>
                    <p className="text-xs text-blue-600 mb-1 font-semibold">Faida Halisi (Baada ya Matumizi)</p>
                    <p className={`text-lg font-bold break-all ${netProfit >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                      {summaryLoading ? skel('w-28') : formatCurrency(netProfit, currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-blue-500 uppercase font-bold">Matumizi</p>
                    <p className="text-sm font-bold text-gray-700 break-all">{summaryLoading ? skel('w-16') : formatCurrency(totalExpenses, currency)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold text-gray-800">Risiti za Mauzo</h2>
          </div>

          {/* When magnified the header stack (tabs + wrapped date chips + summary cards) grows
              tall; trapping the list in its own scroll pane pushed the refund rows off-screen.
              So when magnified, let the whole page scroll (root gets overflow-y-auto) and this
              list flows naturally instead of being a squeezed inner pane. */}
          <div className={`space-y-3 pb-4 ${isMagnified ? '' : 'flex-1 overflow-y-auto'}`}>
            {filteredSales.length === 0 ? (
              <div className="text-center text-gray-500 py-10">
                Hakuna mauzo katika kipindi hiki.
              </div>
            ) : (
              <>
              {filteredSales.slice(0, visibleCount).map(sale => (
                <div key={sale.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center text-gray-600 text-sm">
                      <Calendar className="w-4 h-4 mr-1.5" />
                      {format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm')}
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded ${sale.payment_method === 'credit' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                      {sale.payment_method === 'credit' ? 'Mkopo' : 'Taslimu'}
                    </span>
                  </div>
                  <div className="flex justify-between items-end mt-3">
                    <div className="text-sm text-gray-500">
                      <div className="font-medium text-gray-700">
                        {saleItems.filter(i => i.sale_id === sale.id).map(i => i.product_name).join(', ')}
                      </div>
                      Idadi: {saleItems.filter(i => i.sale_id === sale.id).reduce((a, b) => a + b.qty, 0)}
                    </div>
                    <div className="flex flex-col items-end">
                      {hasMapatoAccess && (
                        <div className="font-bold text-gray-900">{formatCurrency(sale.total_amount, currency)}</div>
                      )}
                      {(user?.role === 'boss') && (
                        <div className="text-xs text-green-600 mb-2">Faida: {formatCurrency(sale.total_profit, currency)}</div>
                      )}
                      
                      {isAuthenticated && (
                        <button
                          onClick={tap(() => setReversingSaleId(sale.id))}
                          onPointerUp={tap(() => setReversingSaleId(sale.id))}
                          className="flex items-center text-[10px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded-lg transition-colors"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" /> RUDISHA MAUZO
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {filteredSales.length > visibleCount && (
                <button
                  onClick={tap(() => setVisibleCount(v => v + 50))}
                  onPointerUp={tap(() => setVisibleCount(v => v + 50))}
                  className="w-full py-3 bg-blue-50 text-blue-600 font-bold rounded-xl border border-blue-100 active:bg-blue-100 transition-colors"
                >
                  Onyesha 50 Zaidi ({filteredSales.length - visibleCount} zimebaki)
                </button>
              )}
              </>
            )}
          </div>

          {/* Reverse Sale Confirmation Modal */}
          {reversingSaleId && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
              {/* Absorbs the iOS ghost click from the tap that opened this dialog. */}
              <GhostClickGuard />
              <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
                <div className="flex items-center text-red-600 mb-4">
                  <AlertCircle className="w-6 h-6 mr-2" />
                  <h3 className="text-lg font-bold">Rudisha Mauzo?</h3>
                </div>
                <p className="text-gray-600 mb-6 text-sm">
                  Je, una uhakika unataka kurudisha mauzo haya? 
                  <br /><br />
                  <span className="font-bold text-red-600">Hii itarudisha bidhaa kwenye stock na kufuta rekodi hii ya mauzo.</span>
                </p>
                <div className="flex space-x-3">
                  <button
                    onClick={tap(() => setReversingSaleId(null))}
                    onPointerUp={tap(() => setReversingSaleId(null))}
                    disabled={isReversing}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl disabled:opacity-50"
                  >
                    Hapana
                  </button>
                  <button
                    onClick={tap(() => handleReverseSale(reversingSaleId))}
                    onPointerUp={tap(() => handleReverseSale(reversingSaleId))}
                    disabled={isReversing}
                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-200 disabled:opacity-50 flex items-center justify-center"
                  >
                    {isReversing ? 'Inarudisha...' : 'Ndio, Rudisha'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-6 pb-4 scrollbar-hide">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-bold text-gray-800">Ripoti ya Biashara</h2>
            <button onClick={tap(() => setShowReportModal(true))} onPointerUp={tap(() => setShowReportModal(true))} className="text-blue-600 flex items-center text-sm font-medium cursor-pointer touch-manipulation select-none active:scale-95 transition-all" style={{ WebkitTapHighlightColor: 'transparent' }}>
              <FileText className="w-4 h-4 mr-1" /> Pakua Ripoti
            </button>
          </div>

          {/* PDF period picker popup */}
          {showReportModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
              {/* Absorbs the iOS ghost click from the tap that opened this dialog. */}
              <GhostClickGuard />
              <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-lg font-bold text-gray-800">Chagua Kipindi cha Ripoti</h3>
                  <button
                    onClick={tap(() => { if (!preparingReport) setShowReportModal(false); })}
                    onPointerUp={tap(() => { if (!preparingReport) setShowReportModal(false); })}
                    disabled={preparingReport}
                    className="p-1 text-gray-400 disabled:opacity-40"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-4">Ripoti ya PDF itatengenezwa kwa kipindi utakachochagua.</p>
                <div className="space-y-2">
                  {PDF_PERIODS.map(p => {
                    const busy = preparingReport && pdfPeriod === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={tap(() => handleGenerateReport(p.id))}
                        onPointerUp={tap(() => handleGenerateReport(p.id))}
                        disabled={preparingReport}
                        className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-200 bg-white active:scale-[0.98] transition-all disabled:opacity-60"
                      >
                        <div className="flex items-center space-x-3 text-left">
                          <div className="bg-blue-50 p-2 rounded-lg">
                            <Calendar className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-bold text-gray-800 text-sm">{p.label}</p>
                            <p className="text-[11px] text-gray-400">{p.hint}</p>
                          </div>
                        </div>
                        {busy ? <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" /> : <FileText className="w-4 h-4 text-gray-300" />}
                      </button>
                    );
                  })}
                </div>
                {preparingReport && (
                  <p className="text-xs text-blue-600 mt-4 text-center font-medium">
                    Inapakia data zote za kipindi hiki... Tafadhali subiri.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Revenue Trend Chart */}
          {hasMapatoAccess && (
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Mwenendo wa Mapato (Siku 30)</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis 
                      dataKey="date" 
                      fontSize={10} 
                      tickLine={false} 
                      axisLine={false} 
                      interval={4}
                    />
                    <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${v/1000}k`} />
                    <Tooltip 
                      formatter={(value: number) => formatCurrency(value, currency)}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Line type="monotone" dataKey="Mapato" stroke="#3b82f6" strokeWidth={3} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Faida" stroke="#10b981" strokeWidth={3} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center space-x-4 mt-2">
                <div className="flex items-center text-xs text-gray-500">
                  <div className="w-3 h-3 bg-blue-500 rounded-full mr-1"></div> Mapato
                </div>
                <div className="flex items-center text-xs text-gray-500">
                  <div className="w-3 h-3 bg-green-500 rounded-full mr-1"></div> Faida
                </div>
              </div>
            </div>
          )}

          {/* Top Products Chart */}
          {hasMapatoAccess && (
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-800">Bidhaa 10 Zinazoongoza</h2>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={tap(() => setTopProductsMetric('qty'))}
                    onPointerUp={tap(() => setTopProductsMetric('qty'))}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${topProductsMetric === 'qty' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
                  >
                    Idadi
                  </button>
                  <button
                    onClick={tap(() => setTopProductsMetric('profit'))}
                    onPointerUp={tap(() => setTopProductsMetric('profit'))}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${topProductsMetric === 'profit' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
                  >
                    Faida
                  </button>
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProductsData} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      fontSize={10} 
                      width={80} 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <Tooltip 
                      formatter={(value: number) => topProductsMetric === 'qty' ? value : formatCurrency(value, currency)}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Bar
                      dataKey="value"
                      fill={topProductsMetric === 'qty' ? '#8b5cf6' : '#10b981'}
                      radius={[0, 4, 4, 0]}
                      barSize={20}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="flex space-x-2 mb-2">
            <button
              onClick={tap(() => handleReportTypeChange('mwezi'))}
              onPointerUp={tap(() => handleReportTypeChange('mwezi'))}
              className={`flex-1 py-2 rounded-xl text-sm font-medium ${reportType === 'mwezi' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              Kila Mwezi
            </button>
            <button
              onClick={tap(() => handleReportTypeChange('mwaka'))}
              onPointerUp={tap(() => handleReportTypeChange('mwaka'))}
              className={`flex-1 py-2 rounded-xl text-sm font-medium ${reportType === 'mwaka' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              Kila Mwaka
            </button>
          </div>

          <div className="space-y-4">
            {reportData.length === 0 ? (
              <div className="text-center text-gray-500 py-10">
                Hakuna data ya ripoti.
              </div>
            ) : (
              reportData.map((report, idx) => {
                const isLoaded = loadedReports[report.label];
                const isLoadingSingle = loadingReports[report.label];

                return (
                  <div key={idx} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 transition-all duration-200">
                    {isLoadingSingle ? (
                      <div className="flex flex-col items-center justify-center py-6">
                        <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mb-2" />
                        <span className="text-xs font-semibold text-gray-500">Inatayarisha taarifa za {report.label}...</span>
                      </div>
                    ) : !isLoaded ? (
                      <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-3">
                          <div className="bg-blue-50/50 p-2 rounded-xl">
                            <Calendar className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <h3 className="font-bold text-gray-800 text-base">{report.label}</h3>
                            <p className="text-xs text-gray-400">{reportType === 'mwezi' ? 'Ripoti ya Mwezi' : 'Ripoti ya Mwaka'}</p>
                          </div>
                        </div>
                        <button
                          onClick={tap(() => handleLoadReport(report.label))}
                          onPointerUp={tap(() => handleLoadReport(report.label))}
                          className="bg-blue-600 active:scale-95 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm shadow-blue-600/10 cursor-pointer"
                        >
                          Tengeneza Ripoti
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
                          <h3 className="font-bold text-gray-800 text-lg flex items-center">
                            <Calendar className="w-5 h-5 mr-2 text-blue-500" />
                            {report.label}
                          </h3>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                              Mauzo {report.mauzo}
                            </span>
                            <button
                              onClick={tap(() => setLoadedReports(prev => ({ ...prev, [report.label]: false })))}
                              onPointerUp={tap(() => setLoadedReports(prev => ({ ...prev, [report.label]: false })))}
                              className="text-xs text-red-500 font-bold px-2 py-1 cursor-pointer bg-red-50 rounded-lg transition-all active:scale-95"
                            >
                              Ficha
                            </button>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          {hasMapatoAccess && (
                            <div className="col-span-2 flex justify-between items-center pb-2 border-b border-gray-50">
                              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Mapato</p>
                              <p className="text-lg font-bold text-gray-900">{formatCurrency(report.mapato, currency)}</p>
                            </div>
                          )}
                          {(user?.role === 'boss') && (
                            <>
                              <div>
                                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">Jumla ya Faida</p>
                                <p className="text-lg font-bold text-green-600">{formatCurrency(report.faida, currency)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">Faida Halisi</p>
                                <p className={`text-lg font-bold flex items-center ${report.faidaHalisi >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                  {report.faidaHalisi >= 0 ? <ArrowUpRight className="w-4 h-4 mr-1" /> : <ArrowDownRight className="w-4 h-4 mr-1" />}
                                  {formatCurrency(report.faidaHalisi, currency)}
                                </p>
                                {report.matumizi > 0 && (
                                  <p className="text-[10px] text-gray-400 mt-1">Matumizi: {formatCurrency(report.matumizi, currency)}</p>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ================= BACKDATED SALE MODAL ================= */}
      {showBackdatedSaleModal && (
        <div className="fixed inset-0 bg-gray-50 z-50 flex flex-col text-left overflow-hidden select-none pt-safe pt-safe-standalone">
          {/* Absorbs the iOS ghost click from the tap that opened this modal. */}
          <GhostClickGuard />
          {backdatedIsCheckout ? (
            <div className="flex items-center px-4 py-3 bg-white border-b border-gray-150">
              <button
                type="button"
                onClick={tap(() => setBackdatedIsCheckout(false))}
                onPointerUp={tap(() => setBackdatedIsCheckout(false))}
                className="text-blue-600 font-extrabold text-xs mr-4 px-2 py-1.5 bg-blue-50/60 rounded-xl cursor-pointer"
              >
                ← Nyuma
              </button>
              <h1 className="text-sm font-black text-gray-800">Taarifa za Kikapu cha Zamani</h1>
            </div>
          ) : (
            <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-150 flex-shrink-0">
              <div className="flex items-center space-x-2.5 min-w-0">
                <span className="text-xs font-black text-gray-500 uppercase flex-shrink-0">Tarehe:</span>
                {/* Native <input type="date"> renders in the OS locale (often mm/dd/yyyy), which
                    can't be reformatted. So we show the date as dd/mm/yyyy in a pill and lay a
                    transparent native date input over it to still open the picker on tap. */}
                <div className="relative bg-blue-50 px-2.5 py-1.5 rounded-xl">
                  <span className="text-xs font-black text-blue-700 whitespace-nowrap">
                    {backdatedSaleDate ? backdatedSaleDate.split('-').reverse().join('/') : 'Chagua tarehe'}
                  </span>
                  <input
                    type="date"
                    value={backdatedSaleDate}
                    onChange={(e) => setBackdatedSaleDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    aria-label="Chagua tarehe ya mauzo ya zamani"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={tap(() => {
                  setShowBackdatedSaleModal(false);
                  setBackdatedIsCheckout(false);
                  setBackdatedKeypad(null);
                })}
                onPointerUp={tap(() => {
                  setShowBackdatedSaleModal(false);
                  setBackdatedIsCheckout(false);
                  setBackdatedKeypad(null);
                })}
                className="p-1 px-2.5 text-red-500 font-black rounded-xl text-xs active:scale-95 transition-all flex items-center space-x-1 cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
                <span>Funga</span>
              </button>
            </div>
          )}

          {/* Modal Content */}
          {backdatedIsCheckout ? (
            <div className="p-4 flex flex-col flex-1 bg-white overflow-y-auto">
              <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100 mb-6 flex-shrink-0">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-orange-800 font-bold text-xs">Jumla ya Deni:</span>
                  <span className="text-2xl font-black text-orange-900">{formatCurrency(backdatedSaleTotal, currency)}</span>
                </div>
                <div className="text-[10px] text-orange-600 font-bold">Idadi ya bidhaa ya zamani: {backdatedSaleCart.reduce((a, b) => a + b.qty, 0)}</div>
              </div>

              <div className="space-y-4 flex-1">
                {/* Payment method selection matching Kikapu/Historia selection */}
                <div>
                  <label className="block text-xs font-bold text-gray-755 mb-1.5 uppercase">Njia ya malipo ya siku za nyuma</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={tap(() => setBackdatedPaymentMethod('cash'))}
                      onPointerUp={tap(() => setBackdatedPaymentMethod('cash'))}
                      className={`p-3 rounded-xl border text-center flex items-center justify-center text-xs font-extrabold transition-all cursor-pointer ${
                        backdatedPaymentMethod === 'cash' 
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-1 ring-emerald-500' 
                          : 'bg-white border-gray-200 text-gray-600'
                      }`}
                    >
                      TASLIMU (CASH)
                    </button>
                    <button
                      type="button"
                      onClick={tap(() => setBackdatedPaymentMethod('credit'))}
                      onPointerUp={tap(() => setBackdatedPaymentMethod('credit'))}
                      className={`p-3 rounded-xl border text-center flex items-center justify-center text-xs font-extrabold transition-all cursor-pointer ${
                        backdatedPaymentMethod === 'credit' 
                          ? 'bg-amber-50 border-amber-500 text-amber-800 ring-1 ring-amber-500' 
                          : 'bg-white border-gray-200 text-gray-600'
                      }`}
                    >
                      MKOPO (DENI)
                    </button>
                  </div>
                </div>

                {backdatedPaymentMethod === 'credit' && (
                  <div className="space-y-4 animate-in slide-in-from-top-2 duration-100">
                    <div className="relative">
                      <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase">Jina la Mteja *</label>
                      <input 
                        required 
                        value={backdatedCustomerName} 
                        onChange={e => {
                          setBackdatedCustomerName(e.target.value);
                          setShowBackdatedSuggestions(true);
                        }} 
                        onFocus={() => setShowBackdatedSuggestions(true)}
                        placeholder="Andika jina la mteja..."
                        className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none shadow-xs text-xs font-bold" 
                      />
                      {showBackdatedSuggestions && backdatedFilteredCustomers.length > 0 && backdatedCustomerName && (
                        <div className="absolute left-0 right-0 z-55 bg-white mt-1 border border-gray-150 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                          {backdatedFilteredCustomers.map(c => (
                            <button
                              type="button"
                              key={c}
                              onMouseDown={() => handleSelectBackdatedCustomer(c)}
                              className="w-full text-left p-3 border-b border-gray-100 last:border-0 text-xs font-bold text-gray-700 cursor-pointer"
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-750 mb-1.5 uppercase">Namba ya Simu</label>
                      <input 
                        type="tel" 
                        value={backdatedCustomerPhone} 
                        onChange={e => setBackdatedCustomerPhone(e.target.value)} 
                        placeholder="Mfano: 0787..."
                        className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none shadow-xs text-xs font-medium" 
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-gray-100 mt-6 flex-shrink-0">
                <button
                  type="button"
                  onClick={tap(() => handleCompleteBackdatedSale(undefined, commitBackdatedKeypad()))}
                  onPointerUp={tap(() => handleCompleteBackdatedSale(undefined, commitBackdatedKeypad()))}
                  disabled={isSubmittingBackdated || (backdatedPaymentMethod === 'credit' && !backdatedCustomerName)}
                  className="w-full bg-blue-600 active:scale-95 disabled:bg-gray-400 text-white font-black py-4 rounded-xl shadow-lg text-sm flex items-center justify-center space-x-2 cursor-pointer transition-all"
                >
                  {isSubmittingBackdated ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  <span>Hifadhi Mauzo ya Siku ya Zamani</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 p-4 overflow-y-auto overflow-x-hidden pb-24 scrollbar-hide space-y-3">
              {/* Search (Kikapu style) */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Tafuta bidhaa ya zamani..."
                  value={backdatedSearch}
                  onChange={(e) => setBackdatedSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500 outline-none text-xs"
                />
              </div>

              {/* Alphabet selector (Kikapu style) */}
              <div className="flex overflow-x-auto pb-1 scrollbar-hide space-x-1.5">
                <button
                  type="button"
                  onClick={tap(() => setSelectedBackdatedLetter(null))}
                  onPointerUp={tap(() => setSelectedBackdatedLetter(null))}
                  className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[10.5px] font-black cursor-pointer ${!selectedBackdatedLetter ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
                >
                  All
                </button>
                {['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','#'].map(letter => (
                  <button
                    key={letter}
                    type="button"
                    onClick={tap(() => setSelectedBackdatedLetter(selectedBackdatedLetter === letter ? null : letter))}
                    onPointerUp={tap(() => setSelectedBackdatedLetter(selectedBackdatedLetter === letter ? null : letter))}
                    className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[10.5px] font-black cursor-pointer ${selectedBackdatedLetter === letter ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
                  >
                    {letter}
                  </button>
                ))}
              </div>

              {/* Cart at the top (Kikapu style) with tap-to-edit qty / price via keypad */}
              {backdatedSaleCart.length > 0 && (
                <div
                  className={backdatedSaleCart.length <= 3 ? "sticky z-20 bg-gray-50 pb-2 space-y-1.5 -mx-4 px-4" : "space-y-1.5"}
                  style={{ top: backdatedSaleCart.length <= 3 ? '-16px' : 'auto', paddingTop: backdatedSaleCart.length <= 3 ? '16px' : '0' }}
                >
                  <div className="bg-white border border-gray-150 rounded-2xl p-2.5 shadow-xs flex flex-col shrink-0 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between pb-1.5 border-b border-gray-100 mb-1.5 px-1">
                      <div className="flex items-baseline space-x-2">
                        <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Total:</span>
                        <BackdatedTotalButton
                          displayTotal={backdatedSaleTotal}
                          currency={currency}
                          activeKeypad={backdatedKeypad}
                          onTotalClick={() => {
                            const currentSum = backdatedSaleCart.reduce((s, it) => s + it.sell_price * it.qty, 0);
                            openBackdatedKeypad({
                              itemId: '__cart_total__',
                              type: 'total',
                              name: 'Jumla',
                              value: Math.round(currentSum).toString(),
                              isFirstOverride: true,
                            });
                          }}
                        />
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">({backdatedSaleCart.reduce((a, b) => a + b.qty, 0)} Bidhaa)</span>
                      </div>
                      <button
                        type="button"
                        onClick={tap(() => { setBackdatedSaleCart([]); closeBackdatedKeypadAndBlock(); })}
                        onPointerUp={tap(() => { setBackdatedSaleCart([]); closeBackdatedKeypadAndBlock(); })}
                        className="text-[10px] font-black text-red-500 uppercase tracking-wider px-3 py-1.5 active:scale-95 cursor-pointer hover:bg-red-50 rounded touch-manipulation select-none"
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                      >
                        Futa Vyote
                      </button>
                    </div>

                    <div className="flex items-center justify-between px-1.5 py-0.5 text-[9px] font-extrabold text-gray-400 uppercase tracking-wider border-b border-gray-100 mb-1 shrink-0">
                      <div className="flex-1">Bidhaa</div>
                      <div className="text-right">Bei / Punguzo</div>
                    </div>

                    <div className="space-y-1.5 flex flex-col mt-1">
                      {backdatedSaleCart.map((item) => {
                        const productObj = sortedProducts.find(p => p.id === item.id);
                        const maxStock = productObj && isProductStockTracked(productObj, shop) ? productObj.stock : 999999;
                        const isKeypadActive = backdatedKeypad && backdatedKeypad.itemId === item.id;
                        const isQtyActive = !!isKeypadActive && backdatedKeypad!.type === 'qty';
                        const isPriceActive = !!isKeypadActive && backdatedKeypad!.type === 'price';
                        const displayQty = isQtyActive ? (backdatedKeypad!.value || '0') : item.qty;
                        const displayPrice = isPriceActive ? parseFloat(backdatedKeypad!.value || '0') : item.sell_price;
                        return (
                          <div key={item.id} className={`flex items-center justify-between py-1.5 px-2 bg-slate-50/50 border rounded-xl shadow-3xs ${isKeypadActive ? 'border-amber-400 bg-amber-50/20' : 'border-slate-100'}`}>
                            <div className="flex items-center min-w-0 flex-1 mr-2">
                              <button
                                type="button"
                                onClick={() => handleRemoveFromBackdatedCart(item.id)}
                                className="text-red-400 hover:text-red-500 hover:bg-red-50/60 p-1 mr-1 rounded active:scale-95 shrink-0 transition-colors cursor-pointer"
                                title="Futa"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <div className="flex items-center min-w-0 flex-1 gap-1.5">
                                <button
                                  type="button"
                                  onClick={tap(() => openBackdatedKeypad({ itemId: item.id, type: 'qty', name: item.name, value: item.qty.toString(), maxStock, isFirstOverride: true }))}
                                  onPointerUp={tap(() => openBackdatedKeypad({ itemId: item.id, type: 'qty', name: item.name, value: item.qty.toString(), maxStock, isFirstOverride: true }))}
                                  className={`text-[11px] font-black cursor-pointer active:scale-95 shrink-0 touch-manipulation select-none underline decoration-dashed underline-offset-4 decoration-slate-400 ${isQtyActive ? 'text-amber-600 animate-pulse bg-amber-50 rounded px-0.5' : 'text-blue-600 hover:text-blue-700'}`}
                                  title="Kubadili idadi"
                                  style={{ WebkitTapHighlightColor: 'transparent' }}
                                >
                                  {displayQty}x
                                </button>
                                <span className="font-extrabold text-slate-800 truncate text-[11.5px] leading-tight" title={item.name}>
                                  {item.name}
                                </span>
                              </div>
                            </div>
                            <div className="shrink-0 flex items-center justify-end ml-2">
                              <button
                                type="button"
                                onClick={tap(() => openBackdatedKeypad({ itemId: item.id, type: 'price', name: item.name, value: item.sell_price.toString(), isFirstOverride: true }))}
                                onPointerUp={tap(() => openBackdatedKeypad({ itemId: item.id, type: 'price', name: item.name, value: item.sell_price.toString(), isFirstOverride: true }))}
                                className={`text-right cursor-pointer py-1 px-1.5 rounded active:scale-95 text-[11.5px] font-black whitespace-nowrap underline decoration-dashed underline-offset-4 decoration-slate-400 ${isPriceActive ? 'text-amber-600 animate-pulse bg-amber-50' : 'text-blue-600 hover:text-blue-700'}`}
                                title="Gusa kubadili bei au kuweka punguzo"
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                              >
                                {formatCurrency(isQtyActive ? (parseInt(String(displayQty), 10) || 0) * item.sell_price : item.qty * displayPrice, currency)}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Checkout buttons directly beneath the cart (Kikapu style) */}
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={tap(() => { commitBackdatedKeypad(); setBackdatedKeypad(null); setBackdatedPaymentMethod('credit'); setBackdatedIsCheckout(true); })}
                      onPointerUp={tap(() => { commitBackdatedKeypad(); setBackdatedKeypad(null); setBackdatedPaymentMethod('credit'); setBackdatedIsCheckout(true); })}
                      className="bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl font-extrabold text-[10px] tracking-tight active:scale-95 shadow-xs flex flex-col items-center justify-center cursor-pointer select-none touch-manipulation flex-1 min-w-[85px]"
                      title="Sajili kama mauzo ya mkopo ya siku ya zamani"
                    >
                      <span>MKOPO</span>
                    </button>
                    <button
                      type="button"
                      onClick={tap(() => { const c = commitBackdatedKeypad(); setBackdatedKeypad(null); handleCompleteBackdatedSale('mobile', c); })}
                      onPointerUp={tap(() => { const c = commitBackdatedKeypad(); setBackdatedKeypad(null); handleCompleteBackdatedSale('mobile', c); })}
                      className="bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-extrabold text-[10px] tracking-tight active:scale-95 shadow-xs flex flex-col items-center justify-center cursor-pointer select-none touch-manipulation flex-1 min-w-[85px]"
                      title="Lipa kwa njia ya Mtandao wa Simu (M-Pesa, TigoPesa, AirtelMoney, n.k.)"
                    >
                      <span>UZA (SIMU/BANK)</span>
                    </button>
                    <button
                      type="button"
                      onClick={tap(() => { const c = commitBackdatedKeypad(); setBackdatedKeypad(null); handleCompleteBackdatedSale('cash', c); })}
                      onPointerUp={tap(() => { const c = commitBackdatedKeypad(); setBackdatedKeypad(null); handleCompleteBackdatedSale('cash', c); })}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-extrabold text-[10px] tracking-tight active:scale-95 shadow-xs flex flex-col items-center justify-center cursor-pointer select-none touch-manipulation flex-1 min-w-[85px]"
                      title="Kamilisha mauzo ya pesa taslimu (Cash)"
                    >
                      <span>UZA (CASH)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Product grid (Kikapu style) */}
              {backdatedFilteredProducts.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {backdatedFilteredProducts.map((product) => {
                    const cartItem = backdatedSaleCart.find(item => item.id === product.id);
                    const isTracked = isProductStockTracked(product, shop);
                    const isExpired = product._expired === true;
                    const isAtMaxStock = isTracked && cartItem ? cartItem.qty >= product.stock : false;
                    const inCart = !!cartItem;
                    return (
                      <div
                        key={product.id}
                        className={`bg-white p-2.5 rounded-xl border flex flex-col justify-between h-[74px] shadow-xs ${isExpired ? 'border-rose-200 bg-rose-50/40 opacity-70' : inCart ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-100'} ${isAtMaxStock ? 'opacity-90' : ''}`}
                      >
                        <div
                          className={`min-w-0 ${isExpired ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                          onClick={() => {
                            if (isExpired) { showToast('Bidhaa hii imeisha muda, haiwezi kuuzwa.', 'info'); return; }
                            if (isTracked && product.stock <= 0) { showToast(`Bidhaa ${product.name} haina stoki kwa sasa.`, 'error'); return; }
                            if (isAtMaxStock) { showToast(`Umeshafikia kikomo cha stock kwa ${product.name}`, 'info'); return; }
                            handleAddToBackdatedCart(product);
                          }}
                        >
                          <h3 className="font-bold text-gray-900 text-[12px] leading-tight line-clamp-1 tracking-tight">{product.name}</h3>
                          <div className={`text-[10px] font-bold mt-0.5 ${isExpired ? 'text-rose-400 line-through' : 'text-blue-600'}`}>{formatCurrency(product.sell_price, currency)}</div>
                        </div>
                        <div className="flex justify-between items-center mt-0">
                          {isExpired ? (
                            <div className="flex items-center text-[9px] font-bold text-rose-600">
                              <AlertTriangle className="w-3 h-3 mr-1" /> Imeisha muda
                            </div>
                          ) : inCart ? (
                            <BackdatedQtyControl
                              product={{ ...product, stock: isTracked ? product.stock : 999999 }}
                              cartItem={cartItem}
                              updateQty={handleUpdateBackdatedQty}
                              removeFromCart={handleRemoveFromBackdatedCart}
                              onQtyClick={() => openBackdatedKeypad({ itemId: product.id, type: 'qty', name: product.name, value: cartItem.qty.toString(), maxStock: isTracked ? product.stock : undefined, isFirstOverride: true })}
                              activeKeypad={backdatedKeypad}
                            />
                          ) : (
                            <div className="text-[9px] text-gray-400 font-medium">{isTracked ? `Stoki: ${product.stock}` : 'Sio lazima stoki'}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-12 flex flex-col items-center">
                  <div className="bg-gray-100 p-4 rounded-full mb-3">
                    <Search className="w-8 h-8 text-gray-300" />
                  </div>
                  <p className="font-medium">Hakuna bidhaa iliyopatikana</p>
                  <p className="text-xs text-gray-400">Jaribu neno lingine la bidhaa</p>
                </div>
              )}
            </div>
          )}

          {/* On-screen numeric keypad overlay (mirrors Kikapu) */}
          {!backdatedIsCheckout && backdatedKeypad && (
            <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-[60] flex justify-center pointer-events-none">
              <div className="bg-slate-900 border-t border-slate-800 shadow-[0_-15px_40px_rgba(0,0,0,0.45)] flex flex-col p-2.5 rounded-t-3xl rounded-b-none w-full max-w-md pointer-events-auto">
                <div className="grid grid-cols-4 gap-1.5">
                  {['1','2','3'].map((n) => (
                    <button key={n} type="button"
                      onClick={tap(() => handleBackdatedKeypadPress(n))}
                      onPointerUp={tap(() => handleBackdatedKeypadPress(n))}
                      className="h-12 bg-slate-800 text-slate-100 font-extrabold text-[24px] rounded-2xl active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
                    >{n}</button>
                  ))}
                  <button type="button"
                    onClick={tap(() => { commitBackdatedKeypad(); closeBackdatedKeypadAndBlock(); })}
                    onPointerUp={tap(() => { commitBackdatedKeypad(); closeBackdatedKeypadAndBlock(); })}
                    className="h-12 bg-blue-500/20 active:scale-90 text-blue-400 font-black text-[22px] rounded-2xl border border-blue-500/25 shadow-3xs flex items-center justify-center cursor-pointer select-none"
                    title="Funga kibodi"
                  >↓</button>

                  {['4','5','6'].map((n) => (
                    <button key={n} type="button"
                      onClick={tap(() => handleBackdatedKeypadPress(n))}
                      onPointerUp={tap(() => handleBackdatedKeypadPress(n))}
                      className="h-12 bg-slate-800 text-slate-100 font-extrabold text-[24px] rounded-2xl active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
                    >{n}</button>
                  ))}
                  <button type="button"
                    onClick={tap(() => setBackdatedKeypad(prev => prev ? { ...prev, value: '' } : null))}
                    onPointerUp={tap(() => setBackdatedKeypad(prev => prev ? { ...prev, value: '' } : null))}
                    className="h-12 bg-red-500/20 active:scale-95 text-red-500 font-black text-[13px] rounded-2xl border border-red-500/20 shadow-3xs flex items-center justify-center cursor-pointer select-none uppercase font-sans tracking-wide"
                    title="Futa vyote"
                  >Clear</button>

                  {['7','8','9'].map((n) => (
                    <button key={n} type="button"
                      onClick={tap(() => handleBackdatedKeypadPress(n))}
                      onPointerUp={tap(() => handleBackdatedKeypadPress(n))}
                      className="h-12 bg-slate-800 text-slate-100 font-extrabold text-[24px] rounded-2xl active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
                    >{n}</button>
                  ))}
                  <button type="button"
                    onClick={tap(() => setBackdatedKeypad(prev => prev ? { ...prev, value: prev.value.slice(0, -1) } : null))}
                    onPointerUp={tap(() => setBackdatedKeypad(prev => prev ? { ...prev, value: prev.value.slice(0, -1) } : null))}
                    className="h-12 bg-orange-500/20 active:scale-95 text-orange-400 font-extrabold rounded-2xl border border-orange-500/25 shadow-3xs flex items-center justify-center cursor-pointer select-none"
                    title="Futa namba"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                      <line x1="18" y1="9" x2="12" y2="15" />
                      <line x1="12" y1="9" x2="18" y2="15" />
                    </svg>
                  </button>

                  {['0','00','000'].map((n) => (
                    <button key={n} type="button"
                      onClick={tap(() => handleBackdatedKeypadPress(n))}
                      onPointerUp={tap(() => handleBackdatedKeypadPress(n))}
                      className="h-12 bg-slate-800 text-slate-100 font-extrabold text-[24px] rounded-2xl active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
                    >{n}</button>
                  ))}
                  <button type="button"
                    onClick={tap(() => { commitBackdatedKeypad(); closeBackdatedKeypadAndBlock(); })}
                    onPointerUp={tap(() => { commitBackdatedKeypad(); closeBackdatedKeypadAndBlock(); })}
                    className="h-12 bg-emerald-500/20 active:scale-95 text-emerald-400 rounded-2xl border border-emerald-500/30 shadow-[0_4px_12px_rgba(16,185,129,0.2)] flex items-center justify-center cursor-pointer select-none"
                    title="Hifadhi na Funga"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {backdatedBlockClicks && (
            <div
              className="fixed inset-0 z-[9999] bg-transparent pointer-events-auto cursor-default"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
            />
          )}
        </div>
      )}


      {/* ================= BACKDATED EXPENSE MODAL ================= */}
      {showBackdatedExpenseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          {/* Absorbs the iOS ghost click from the tap that opened this modal. */}
          <GhostClickGuard />
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-gray-100 flex flex-col animate-in fade-in zoom-in-95 duration-150 text-left">
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 shadow-sm">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900 leading-tight">Matumizi ya Siku za Nyuma</h3>
                  <p className="text-xs text-gray-500 font-medium">Sajili matumizi yaliyopita kwenye tarehe husika</p>
                </div>
              </div>
              <button
                onClick={tap(() => setShowBackdatedExpenseModal(false))}
                onPointerUp={tap(() => setShowBackdatedExpenseModal(false))}
                className="p-1.5 rounded-lg bg-gray-50 text-gray-400 cursor-pointer transition-colors active:scale-95"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form controls */}
            <div className="py-4 space-y-4">
              
              {/* Backdated Date picker */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 flex items-center">
                  <Calendar className="w-3.5 h-3.5 mr-1 text-orange-500" /> Tarehe ya Matumizi ya Nyuma *
                </label>
                {/* Native <input type="date"> renders in the OS locale (often mm/dd/yyyy) and
                    can't be reformatted, so show dd/mm/yyyy in the box and overlay a transparent
                    native date input to still open the picker on tap. */}
                <div className="relative w-full bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                    {backdatedExpenseDate ? backdatedExpenseDate.split('-').reverse().join('/') : 'Chagua tarehe'}
                  </span>
                  <input
                    type="date"
                    value={backdatedExpenseDate}
                    onChange={(e) => setBackdatedExpenseDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    aria-label="Chagua tarehe ya matumizi ya nyuma"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
              </div>

              {/* Expense Amount with dynamic thousands separator formatting */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 flex items-center">
                  <Tag className="w-3.5 h-3.5 mr-1 text-orange-500" /> Kiasi cha Matumizi ({currency}) *
                </label>
                <input
                  type="text"
                  placeholder="Mfano: 15,000"
                  value={backdatedExpenseAmount}
                  onChange={(e) => setBackdatedExpenseAmount(formatInputNumber(e.target.value))}
                  className="w-full bg-gray-50 p-3 rounded-xl border border-gray-200 text-sm font-black text-gray-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                />
                {backdatedExpenseAmount && (
                  <p className="text-[10px] text-orange-600 font-bold mt-1 pl-1">
                    Value: {formatCurrency(parseInputNumber(backdatedExpenseAmount), currency)}
                  </p>
                )}
              </div>

              {/* Expense Category Choice */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Kundi la Matumizi (Kundi) *
                </label>
                <select
                  value={backdatedExpenseCategory}
                  onChange={(e) => setBackdatedExpenseCategory(e.target.value)}
                  className="w-full bg-gray-50 p-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                >
                  <option value="Kodi ya pango">Kodi ya Pango / Fremu</option>
                  <option value="Maji ya duka">Maji na Usafi</option>
                  <option value="Umeme wa duka">Umeme / LUKU</option>
                  <option value="Mikopo & riba">Kurejesha Mikopo / Riba</option>
                  <option value="Usafiri & mizigo">Usafiri, Nauli, Kubeba Mizigo</option>
                  <option value="Chakula & vinywaji">Chakula na Vinywaji vya duka</option>
                  <option value="Mishahara ya duka">Mishahara na Posho za Wafanyakazi</option>
                  <option value="Ulinzi & usalama">Ulinzi wa Duka</option>
                  <option value="Ukarabati & fanicha">Ukarabati na Vifaa vya duka</option>
                  <option value="Kodi ya serikali/Laini">Kodi ya Serikali / TRA, Kibali</option>
                  <option value="Mengineyo">Matumizi Mengineyo (Nyingine)</option>
                </select>
              </div>

              {/* Expense Description */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Maelezo kwa Ufupi
                </label>
                <textarea
                  placeholder="Eleza matumizi haya yalikuwa ya nini kwa utambuzi mzuri..."
                  rows={3}
                  value={backdatedExpenseDesc}
                  onChange={(e) => setBackdatedExpenseDesc(e.target.value)}
                  className="w-full bg-gray-50 p-3 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors resize-none mb-1 font-bold"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-4 border-t border-gray-100 flex gap-3 justify-end flex-shrink-0">
              <button
                type="button"
                onClick={tap(() => setShowBackdatedExpenseModal(false))}
                onPointerUp={tap(() => setShowBackdatedExpenseModal(false))}
                disabled={isSubmittingBackdated}
                className="px-5 py-3 bg-gray-50 font-bold rounded-xl text-xs text-gray-600 cursor-pointer text-center transition-colors active:scale-95"
              >
                Ghairi
              </button>
              <button
                type="button"
                onClick={tap(() => handleSaveBackdatedExpense())}
                onPointerUp={tap(() => handleSaveBackdatedExpense())}
                disabled={isSubmittingBackdated || !backdatedExpenseAmount}
                className="px-6 py-3 bg-orange-600 active:scale-95 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-md shadow-orange-500/10 cursor-pointer transition-all cursor-pointer touch-manipulation select-none active:scale-95 transition-all"
               style={{ WebkitTapHighlightColor: 'transparent' }}>
                {isSubmittingBackdated ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Inahifadhi...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Hifadhi Matumizi</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Button (FAB) for backdated entries */}
      {view === 'risiti' && (
        <>
          {/* Menu backdrop (optional) */}
          {showActionMenu && (
             <div 
               className="fixed inset-0 z-30 bg-black/5" 
               onClick={() => setShowActionMenu(false)}
             />
          )}
          <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] right-4 z-40 flex flex-col items-end">
            {showActionMenu && (
              <div className="flex flex-col gap-3 mb-4 items-end animate-in fade-in slide-in-from-bottom-5">
                <button
                  onClick={tap(() => {
                    setShowActionMenu(false);
                    setBackdatedExpenseAmount('');
                    setBackdatedExpenseDesc('');
                    setBackdatedExpenseCategory('Mengineyo');
                    setShowBackdatedExpenseModal(true);
                  })}
                  onPointerUp={tap(() => {
                    setShowActionMenu(false);
                    setBackdatedExpenseAmount('');
                    setBackdatedExpenseDesc('');
                    setBackdatedExpenseCategory('Mengineyo');
                    setShowBackdatedExpenseModal(true);
                  })}
                  className="flex items-center gap-3 bg-white px-4 py-3 rounded-full shadow-lg border border-orange-100 text-orange-600 font-bold active:scale-95 transition-transform"
                >
                  <span className="text-sm">Andika Matumizi Nyuma</span>
                  <div className="bg-orange-100 p-2 rounded-full">
                    <Wallet className="w-5 h-5" />
                  </div>
                </button>
                <button
                  onClick={tap(() => {
                    setShowActionMenu(false);
                    setBackdatedSaleCart([]);
                    setBackdatedPaymentMethod('cash');
                    setBackdatedCustomerName('');
                    setBackdatedCustomerPhone('');
                    setShowBackdatedSaleModal(true);
                  })}
                  onPointerUp={tap(() => {
                    setShowActionMenu(false);
                    setBackdatedSaleCart([]);
                    setBackdatedPaymentMethod('cash');
                    setBackdatedCustomerName('');
                    setBackdatedCustomerPhone('');
                    setShowBackdatedSaleModal(true);
                  })}
                  className="flex items-center gap-3 bg-white px-4 py-3 rounded-full shadow-lg border border-blue-100 text-blue-600 font-bold active:scale-95 transition-transform"
                >
                  <span className="text-sm">Andika Mauzo Nyuma</span>
                  <div className="bg-blue-100 p-2 rounded-full">
                    <ShoppingCart className="w-5 h-5" />
                  </div>
                </button>
              </div>
            )}
            <button
              onClick={tap(() => setShowActionMenu(!showActionMenu))}
              onPointerUp={tap(() => setShowActionMenu(!showActionMenu))}
              className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all transform active:scale-95 z-50 ${showActionMenu ? 'bg-gray-800 rotate-45' : 'bg-blue-600'} text-white`}
            >
              <Plus className="w-7 h-7" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
