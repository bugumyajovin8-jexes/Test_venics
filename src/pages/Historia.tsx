import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { format, startOfDay, startOfWeek, startOfMonth, subMonths, startOfYear, eachDayOfInterval, subDays } from 'date-fns';
import { Receipt, Calendar, TrendingUp, BarChart3, RotateCcw, AlertCircle, RefreshCw, Plus, Minus, Trash2, X, Search, CheckCircle, Edit2, ShoppingBag, Tag, Wallet, History, Printer, ChevronDown, ChevronRight, FileDown, CreditCard, Smartphone, User, ArrowLeft } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { notifications } from '../services/notifications';
import { v4 as uuidv4 } from 'uuid';
import { Sale, SaleItem, Expense } from '../db';
import { getValidStock, isProductStockTracked, isBatchExpired } from '../utils/stock';
import { useHideStock } from '../hooks/useHideStock';
import NumberInput from '../components/NumberInput';
import { nowIso } from '../services/clock';
import { printReceipt } from '../utils/receiptPrinter';
import { downloadSalesReport, reportPeriods, type ReportPeriod } from '../services/salesReport';
import { dailyRows, dailyTotalsReady, ensureDailyTotals, sumRows, dateKey, historyWindowMs, payKind, type DayRow } from '../services/dailyTotals';
import { localReceipts, cloudReceipts, needsCloud, RECEIPTS_PAGE, type Receipt as SaleReceipt, type ReceiptQuery } from '../services/historyReceipts';
import DayReport from '../components/DayReport';

import { t, monthNames, weekdayNames } from '../i18n';

// How a sale was paid. Kikapu records mobile money as 'mobile_money' (older
// rows say 'mobile'); those must not read as cash.
function paymentLabel(method: string): { label: string; badge: string } {
  if (method === 'credit') return { label: t('Mkopo'), badge: 'bg-orange-100 text-orange-700' };
  if (method === 'mobile_money' || method === 'mobile') return { label: t('Kwa Simu'), badge: 'bg-blue-100 text-blue-700' };
  return { label: t('Taslimu'), badge: 'bg-green-100 text-green-700' };
}

// "Novemba 2026" / "November 2026", in the app's language.
function monthLabel(d: Date): string {
  return `${monthNames()[d.getMonth()]} ${d.getFullYear()}`;
}


// A backdated line's price, shown as the Mauzo cart shows it; click to change
// it for this sale. `startEditing` opens it from outside ("Rekebisha bei").
const BackdatedInlinePrice = ({ item, currency, onUpdatePrice, startEditing, onEditingStarted }: { item: any; currency: string; onUpdatePrice: (productId: string, price: number) => void; startEditing?: boolean; onEditingStarted?: () => void }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(item.sell_price.toString());

  useEffect(() => {
    if (!startEditing) return;
    setValue(item.sell_price.toString());
    setIsEditing(true);
    onEditingStarted?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startEditing]);

  if (isEditing) {
    return (
      <NumberInput
        data-testid="backdated-price-input"
        className="w-24 text-right p-1.5 border-2 border-blue-500 rounded-lg text-sm font-black outline-none shadow-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const newPrice = parseFloat(value);
          if (!isNaN(newPrice) && newPrice >= 0) {
            onUpdatePrice(item.id, newPrice);
          }
          setIsEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setIsEditing(true);
        setValue(item.sell_price.toString());
      }}
      title={t('Gusa kubadili bei')}
      data-testid="backdated-price"
      className="inline-flex items-center gap-1 text-blue-600 font-bold text-xs md:text-sm hover:underline cursor-pointer"
    >
      {formatCurrency(item.sell_price, currency)}
      <Edit2 className="w-3 h-3 opacity-50" />
    </button>
  );
};

interface BackdatedQtyControlProps {
  product: any;
  cartItem: any;
  updateQty: (productId: string, qty: number) => void;
  removeFromCart: (productId: string) => void;
  showAlert: (title: string, msg: string) => void;
}

const BackdatedQtyControl = ({ product, cartItem, updateQty, removeFromCart, showAlert }: BackdatedQtyControlProps) => {
  const isAtMaxStock = cartItem ? cartItem.qty >= product.stock : false;
  const [localQty, setLocalQty] = useState<string>(cartItem.qty.toString());

  useEffect(() => {
    setLocalQty(cartItem.qty.toString());
  }, [cartItem.qty]);

  const handleBlur = () => {
    const val = parseInt(localQty, 10);
    if (isNaN(val) || val <= 0) {
      removeFromCart(product.id!);
    } else {
      if (val > product.stock) {
        showAlert(t('Taarifa'), t('Umeshafikia kikomo cha stock kwa {name}', { name: product.name }));
        setLocalQty(product.stock.toString());
        updateQty(product.id!, product.stock);
      } else {
        updateQty(product.id!, val);
      }
    }
  };

  return (
    <div className="flex items-center bg-slate-100 rounded-xl md:rounded-2xl p-0.5 md:p-1 select-none">
      <button 
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (cartItem.qty > 1) {
            updateQty(product.id!, cartItem.qty - 1);
          } else {
            removeFromCart(product.id!);
          }
        }}
        className="p-1.5 md:p-2 text-slate-600 hover:bg-white rounded-lg md:rounded-xl transition-colors cursor-pointer"
      >
        <Minus className="w-3 h-3 md:w-4 md:h-4 pointer-events-none" />
      </button>
      <NumberInput
        inputMode="numeric"
        pattern="[0-9]*"
        min="1"
        max={product.stock}
        value={localQty}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => {
          e.stopPropagation();
          e.target.select();
        }}
        onChange={(e) => {
          let val = e.target.value;
          if (val !== '') {
            const numVal = parseInt(val, 10);
            if (!isNaN(numVal) && numVal > product.stock) {
              val = product.stock.toString();
              showAlert(t('Taarifa'), t('Umeshafikia kikomo cha stock kwa {name}', { name: product.name }));
              updateQty(product.id!, product.stock);
            }
          }
          setLocalQty(val);
        }}
        onBlur={handleBlur}
        className="w-10 text-center text-xs md:text-sm font-black text-slate-900 bg-transparent border-none focus:ring-0 p-0 m-0 outline-none"
      />
      <button 
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isAtMaxStock) return;
          updateQty(product.id!, cartItem.qty + 1);
        }}
        disabled={isAtMaxStock}
        className={`p-1.5 md:p-2 rounded-lg md:rounded-xl transition-colors ${isAtMaxStock ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-white cursor-pointer'}`}
      >
        <Plus className="w-3 h-3 md:w-4 md:h-4 pointer-events-none" />
      </button>
    </div>
  );
};

export default function Historia() {
  const { user, isBoss, isFeatureEnabled, showAlert, showConfirm, syncStatus, showToast } = useStore();
  const hideStock = useHideStock();
  const location = useLocation();
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const settings = useLiveQuery(() => db.settings.get(1));
  const shopObj = useLiveQuery(() => {
    const shopId = user?.shopId || user?.shop_id || '';
    return shopId ? db.shops.get(shopId) : Promise.resolve(null);
  }, [user?.shopId, user?.shop_id]);
  const currency = settings?.currency || 'TZS';
  const shopName = settings?.shopName || 'Biashara Yangu';

  // --- BACKDATED ENTRIES STATE & HANDLERS ---
  const [showBackdatedSaleModal, setShowBackdatedSaleModal] = useState(false);
  const [showBackdatedExpenseModal, setShowBackdatedExpenseModal] = useState(false);

  // Sale Modal state. Dates are the shop's own calendar day: toISOString()
  // gave the UTC day, which in Tanzania is still yesterday until 03:00.
  const [backdatedSaleDate, setBackdatedSaleDate] = useState(() => format(subDays(new Date(), 1), 'yyyy-MM-dd'));
  const [backdatedSaleCart, setBackdatedSaleCart] = useState<{ id: string; name: string; qty: number; buy_price: number; sell_price: number }[]>([]);
  const [backdatedSearch, setBackdatedSearch] = useState('');
  const [backdatedPaymentMethod, setBackdatedPaymentMethod] = useState<'cash' | 'credit' | 'mobile_money'>('cash');
  const [backdatedCustomerName, setBackdatedCustomerName] = useState('');
  const [backdatedCustomerPhone, setBackdatedCustomerPhone] = useState('');
  const [showBackdatedSuggestions, setShowBackdatedSuggestions] = useState(false);
  const [selectedBackdatedLetter, setSelectedBackdatedLetter] = useState<string | null>(null);
  const [backdatedIsCheckout, setBackdatedIsCheckout] = useState(false);
  // Narrow windows: the cart opens over the products, as on the Mauzo page.
  const [backdatedShowCartMobile, setBackdatedShowCartMobile] = useState(false);
  // "Rekebisha bei" from the loss warning: the line whose price opens.
  const [backdatedEditPriceId, setBackdatedEditPriceId] = useState<string | null>(null);

  // Expense Modal state
  const [backdatedExpenseDate, setBackdatedExpenseDate] = useState(() => format(subDays(new Date(), 1), 'yyyy-MM-dd'));
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
    return [...allProducts].sort((a, b) => a.name.localeCompare(b.name));
  }, [allProducts]);

  const backdatedProducts = useMemo(() => {
    const isExpiryEnabled = shopObj?.enable_expiry === true;
    return sortedProducts.map(p => {
      const isProductTracked = isProductStockTracked(p, shopObj);
      return {
        ...p,
        stock: isProductTracked ? getValidStock(p, isExpiryEnabled) : 999999,
        track_stock: isProductTracked
      };
    });
  }, [sortedProducts, shopObj]);
  const backdatedProductById = useMemo(() => new Map(backdatedProducts.map(p => [p.id, p])), [backdatedProducts]);

  const backdatedFilteredProducts = useMemo(() => {
    const s = backdatedSearch.toLowerCase();
    return backdatedProducts
      .filter(p => {
        if (!p.name) return false;
        const nameLower = p.name.toLowerCase();
        if (s && !nameLower.includes(s)) return false;
        if (selectedBackdatedLetter) {
          if (selectedBackdatedLetter === '#') {
            return !/^[a-zA-Z]/.test(p.name);
          }
          return nameLower.startsWith(selectedBackdatedLetter.toLowerCase());
        }
        return p.track_stock === false || p.stock > 0;
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
  }, [backdatedProducts, backdatedSearch, selectedBackdatedLetter]);

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
    const existing = backdatedSaleCart.find(item => item.id === product.id);
    if (existing) {
      const newQty = existing.qty + 1;
      if (newQty > product.stock) {
        showAlert(t('Taarifa'), t('Umeshafikia kikomo cha stoki kwa {name}', { name: product.name }));
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
    const product = backdatedProductById.get(productId);
    if (!product) return;
    if (newQty > product.stock) {
      showAlert(t('Taarifa'), t('Umeshafikia kikomo cha stoki kwa {name}', { name: product.name }));
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

  const handleUpdateBackdatedPrice = (productId: string, newPrice: number) => {
    setBackdatedSaleCart(prev => prev.map(item => 
      item.id === productId ? { ...item, sell_price: newPrice } : item
    ));
  };

  const handleRemoveFromBackdatedCart = (id: string) => {
    setBackdatedSaleCart(prev => prev.filter(item => item.id !== id));
  };

  const backdatedSaleTotal = useMemo(() => {
    return backdatedSaleCart.reduce((sum, item) => sum + (item.sell_price * item.qty), 0);
  }, [backdatedSaleCart]);

  const backdatedSaleProfit = useMemo(() => {
    return backdatedSaleCart.reduce((sum, item) => sum + ((item.sell_price - item.buy_price) * item.qty), 0);
  }, [backdatedSaleCart]);

  const formatInputNumber = (val: string) => {
    let clean = val.replace(/[^0-9.]/g, '');
    const parts = clean.split('.');
    if (parts.length > 2) {
      clean = parts[0] + '.' + parts.slice(1).join('');
    }
    if (!clean) return '';
    if (clean.includes('.')) {
      const [integerPart, decimalPart] = clean.split('.');
      const formattedInt = integerPart ? Number(integerPart).toLocaleString() : '';
      return formattedInt + '.' + decimalPart;
    }
    return Number(clean).toLocaleString();
  };

  const parseInputNumber = (val: string) => {
    return Number(val.replace(/,/g, '')) || 0;
  };

  const handleCompleteBackdatedSale = async (overrideMethod?: 'cash' | 'credit' | 'mobile_money') => {
    if (backdatedSaleCart.length === 0) {
      showAlert(t('Kosa'), t('Tafadhali ongeza angalau bidhaa moja kwenye kikapu.'));
      return;
    }
    if (!user?.shopId) {
      showAlert(t('Kosa'), t('Duka halijatambuliwa kwa sasa.'));
      return;
    }
    const finalMethod = overrideMethod || backdatedPaymentMethod;
    if (finalMethod === 'credit' && !backdatedCustomerName.trim()) {
      showAlert(t('Kosa'), t('Tafadhali weka jina la mteja kwa mauzo ya mkopo.'));
      return;
    }

    // As on the Mauzo page: a line below its buying price is named, with the
    // loss, before the sale is kept. "Rekebisha bei" opens that line's price
    // here — it is what the item went for that day, so the product's own
    // price is left as it is.
    const lossItems = backdatedSaleCart.filter(it => Number(it.sell_price) < Number(it.buy_price));
    if (lossItems.length > 0) {
      const lossLines = lossItems
        .map(it => t('• {name}: {sell_price} (bei ya kununua {buy_price}) — hasara {lineLoss}', { name: it.name, sell_price: formatCurrency(it.sell_price, currency), buy_price: formatCurrency(it.buy_price, currency), lineLoss: formatCurrency((Number(it.buy_price) - Number(it.sell_price)) * it.qty, currency) }))
        .join('\n');
      const totalLoss = lossItems.reduce((sum, it) => sum + (Number(it.buy_price) - Number(it.sell_price)) * it.qty, 0);
      const proceed = await new Promise<boolean>(resolve => {
        showConfirm(
          t('Unauza kwa Hasara!'),
          t('Bidhaa zifuatazo unaziuza CHINI ya bei ya kununua:\n\n{lossLines}\n\nJumla ya hasara: {totalLoss}\n\nUna uhakika unataka kuendelea na mauzo haya?', { lossLines, totalLoss: formatCurrency(totalLoss, currency) }),
          () => resolve(true),
          () => resolve(false),
          { label: t('Rekebisha bei'), onClick: () => { resolve(false); setBackdatedShowCartMobile(true); setBackdatedEditPriceId(lossItems[0].id); } },
        );
      });
      if (!proceed) return;
    }

    setIsSubmittingBackdated(true);

    try {
      const saleId = uuidv4();
      const isCreditSale = finalMethod === 'credit';
      
      const nowTime = new Date();
      // Read as a local day, not UTC midnight.
      const selectedDateObj = new Date(`${backdatedSaleDate}T00:00:00`);
      selectedDateObj.setHours(nowTime.getHours(), nowTime.getMinutes(), nowTime.getSeconds());
      const historicalIsoDate = selectedDateObj.toISOString();

      const sale: Sale = {
        id: saleId,
        shop_id: user.shopId,
        user_id: user.id,
        total_amount: backdatedSaleTotal,
        total_profit: backdatedSaleProfit,
        is_credit: isCreditSale,
        is_paid: !isCreditSale,
        payment_method: finalMethod,
        status: isCreditSale ? 'pending' : 'completed',
        customer_name: isCreditSale ? backdatedCustomerName.trim() : undefined,
        customer_phone: isCreditSale ? backdatedCustomerPhone.trim() : undefined,
        date: historicalIsoDate,
        created_at: historicalIsoDate,
        updated_at: nowIso(),
        isDeleted: 0,
        synced: 0
      };

      const saleItems: SaleItem[] = backdatedSaleCart.map(item => ({
        id: uuidv4(),
        sale_id: saleId,
        shop_id: user.shopId!,
        product_id: item.id,
        product_name: item.name,
        qty: item.qty,
        buy_price: item.buy_price,
        sell_price: item.sell_price,
        created_at: historicalIsoDate,
        updated_at: nowIso(),
        isDeleted: 0,
        synced: 0
      }));

      const shopObj = await db.shops.get(user.shopId);

      const anomaliesHeavyDiscountToLog: any[] = [];

      await db.transaction('rw', [db.products, db.sales, db.saleItems, db.auditLogs], async () => {
        // Double check stock and identify discounts
        for (const item of backdatedSaleCart) {
          const dbProduct = await db.products.get(item.id);
          if (!dbProduct) {
            throw new Error(t('Bidhaa "{name}" haikupatikana.', { name: item.name }));
          }
          const isStockTracked = isProductStockTracked(dbProduct, shopObj);
          if (isStockTracked) {
            const isExpiryEnabled = shopObj?.enable_expiry === true;
            const validStock = getValidStock(dbProduct, isExpiryEnabled);
            if (validStock < item.qty) {
              // The message still has to say WHY the sale was refused, but
              // naming the exact remaining stock would hand back the very
              // number the boss chose to withhold.
              throw new Error(
                hideStock
                  ? t('Bidhaa "{name}" haina stock ya kutosha.', { name: item.name })
                  : t('Bidhaa "{name}" haina stock ya kutosha. Stock iliyopo sasa: {validStock}', { name: item.name, validStock }),
              );
            }
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
        for (const item of backdatedSaleCart) {
          const product = await db.products.get(item.id);
          // Only tracked products move stock. Untracked products must never have their
          // stock / stock_delta changed (mirrors the normal sale and refund paths).
          if (product && isProductStockTracked(product, shopObj)) {
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
              updated_at: nowIso(),
              synced: 0
            });
          }
        }

        // Log this as an anomaly: Backdated Sale
        await SyncService.logAction('anomaly_backdated', {
          sale_id: saleId,
          amount: sale.total_amount,
          items: backdatedSaleCart.map(i => ({ name: i.name, qty: i.qty })),
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
            warning: `[Mauzo ya nyuma] Amepunguza bei kiasi kikubwa au kuuza chini ya bei ya kununulia. Bidhaa: ${anomaliesDesc}`
          });
        }
      });

      TelemetryService.trackBackdatedSale(backdatedSaleTotal, backdatedSaleCart.reduce((a, b) => a + b.qty, 0));
      showToast(t('Mauzo ya siku za nyuma yamefanikiwa!'), 'success');
      setBackdatedSaleCart([]);
      setBackdatedIsCheckout(false);
      setBackdatedPaymentMethod('cash');
      setBackdatedShowCartMobile(false);
      setBackdatedCustomerName('');
      setBackdatedCustomerPhone('');
      SyncService.sync().catch(err => console.error('Sync failed:', err));
    } catch (err: any) {
      console.error('Failed to save backdated sale:', err);
      showAlert(t('Kosa'), err.message || t('Imeshindwa kuhifadhi mauzo ya zamani.'));
    } finally {
      setIsSubmittingBackdated(false);
    }
  };

  const handleSaveBackdatedExpense = async () => {
    const rawAmount = parseInputNumber(backdatedExpenseAmount);
    if (rawAmount <= 0) {
      showAlert(t('Kosa'), t('Tafadhali weka kiasi halali cha fedha asili kwanza.'));
      return;
    }
    if (!user?.shopId) {
      showAlert(t('Kosa'), t('Duka halijatambuliwa kwa sasa.'));
      return;
    }

    setIsSubmittingBackdated(true);

    try {
      const expenseId = uuidv4();
      
      const nowTime = new Date();
      const selectedDateObj = new Date(`${backdatedExpenseDate}T00:00:00`);
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
        updated_at: nowIso(),
        isDeleted: 0,
        synced: 0
      };

      await db.expenses.add(expense);

      await SyncService.logAction('add_expense', {
        category: expense.category,
        amount: rawAmount,
        description: expense.description + ' (Past Entry to ' + backdatedExpenseDate + ')'
      });

      showAlert(t('Imefanikiwa'), t('Matumizi ya tarehe {backdatedExpenseDate} ya {rawAmount} yamehifadhiwa kwa mafanikio vya duka lako.', { backdatedExpenseDate, rawAmount: formatCurrency(rawAmount, currency) }));
      TelemetryService.trackBackdatedExpense(rawAmount, backdatedExpenseCategory);
      setShowBackdatedExpenseModal(false);
      setBackdatedExpenseAmount('');
      setBackdatedExpenseDesc('');
      SyncService.sync().catch(err => console.error('Sync failed:', err));
    } catch (err: any) {
      console.error('Failed to save backdated expense:', err);
      showAlert(t('Kosa'), err.message || t('Imeshindwa kuhifadhi matumizi ya zamani.'));
    } finally {
      setIsSubmittingBackdated(false);
    }
  };

  const [view, setView] = useState<'risiti' | 'ripoti'>('risiti');
  const boss = isBoss();
  const hasMapatoAccess = boss || isFeatureEnabled('show_mapato_to_staff');

  // ---- Which receipts: the period, an exact date range, and the filters ----
  // Staff devices keep only their last 3 days of sales, so longer periods would
  // show nothing more; they get Leo / Jana / Siku 3.
  const [period, setPeriod] = useState('leo');
  // "Chagua tarehe": one day's report, as the Mobile app's Ripoti ya Siku.
  const [dayView, setDayView] = useState(false);
  const [search, setSearch] = useState('');
  const [payFilter, setPayFilter] = useState<'all' | 'cash' | 'mobile' | 'credit'>('all');
  const [sellerFilter, setSellerFilter] = useState('all');
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  // How wide the receipts table really is (the sidebar takes part of the window).
  const tableBoxRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(1200);
  useEffect(() => {
    const box = tableBoxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setTableWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  // The table is drawn anew after the day report, so watch the new one.
  }, [view, dayView]);

  useEffect(() => {
    if (location.state) {
      const state = location.state as any;
      if (state.filter) {
        setPeriod(state.filter);
      }
      if (state.view) {
        setView(state.view);
      }
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const periods = boss
    ? [
        { id: 'leo', label: t('Leo') },
        { id: 'jana', label: t('Jana') },
        { id: 'wiki', label: t('Wiki Hii') },
        { id: 'mwezi', label: t('Mwezi Huu') },
        { id: 'miezi6', label: t('Miezi 6') },
        { id: 'mwaka', label: t('Mwaka Huu') },
        { id: 'yote', label: t('Yote') },
      ]
    : [
        { id: 'leo', label: t('Leo') },
        { id: 'jana', label: t('Jana') },
        { id: 'siku3', label: t('Siku 3') },
      ];

  // Start (inclusive) and end (exclusive) of the chosen period, in ms.
  const range = useMemo(() => {
    const n = new Date();
    switch (period) {
      case 'leo': return { start: startOfDay(n).getTime(), end: Infinity };
      case 'jana': return { start: startOfDay(subDays(n, 1)).getTime(), end: startOfDay(n).getTime() };
      case 'siku3': return { start: startOfDay(subDays(n, 2)).getTime(), end: Infinity };
      // Sunday, as the Mobile app's Historia counts "this week".
      case 'wiki': return { start: startOfWeek(n, { weekStartsOn: 0 }).getTime(), end: Infinity };
      case 'mwezi': return { start: startOfMonth(n).getTime(), end: Infinity };
      case 'miezi6': return { start: subMonths(n, 6).getTime(), end: Infinity };
      case 'mwaka': return { start: startOfYear(n).getTime(), end: Infinity };
      default: return { start: 0, end: Infinity };
    }
  }, [period]);

  const [reportType, setReportType] = useState<'mwezi' | 'mwaka'>('mwezi');
  const [topProductsMetric, setTopProductsMetric] = useState<'qty' | 'profit'>('qty');
  const [reversingSaleId, setReversingSaleId] = useState<string | null>(null);
  const [isReversing, setIsReversing] = useState(false);

  const shopId = user?.shopId || '';
  const query = search.trim().toLowerCase();
  const filtersOn = !!query || payFilter !== 'all' || sellerFilter !== 'all';
  const DAY = 86400000;
  // Last day the period covers, for the daily totals ('yyyy-MM-dd').
  const lastDay = dateKey(Math.min(Number.isFinite(range.end) ? range.end - 1 : Date.now(), Date.now()));
  const firstDay = dateKey(range.start || new Date(2000, 0, 1).getTime());

  // ---- Daily totals: built once on this computer, then kept up to date ----
  const [totalsReady, setTotalsReady] = useState(() => !shopId || dailyTotalsReady(shopId));
  useEffect(() => {
    if (!shopId) return;
    // Quick when they are built already: it only checks they are there.
    if (!dailyTotalsReady(shopId)) setTotalsReady(false);
    let alive = true;
    ensureDailyTotals(shopId).then(() => { if (alive) setTotalsReady(true); }).catch(err => console.error('Daily totals:', err));
    return () => { alive = false; };
  }, [shopId]);

  const periodRows = useLiveQuery(
    () => (shopId && totalsReady ? dailyRows(shopId, firstDay, lastDay) : Promise.resolve([] as DayRow[])),
    [shopId, totalsReady, firstDay, lastDay],
  );
  const dayRowsOf = periodRows ?? [];
  // Staff see only their own sales.
  const sellerScope = boss ? sellerFilter : (user?.id || 'all');
  const totals = sumRows(dayRowsOf, { payment: payFilter, seller: sellerScope });
  const periodProfit = sumRows(dayRowsOf, { seller: boss ? 'all' : sellerScope }).profit;
  const dayTotals = useMemo(() => {
    const byDay = new Map<string, { count: number; revenue: number; profit: number }>();
    for (const r of dayRowsOf) {
      if (payFilter !== 'all' && r.method !== payFilter) continue;
      if (sellerScope !== 'all' && r.user_id !== sellerScope) continue;
      const d = byDay.get(r.date) ?? { count: 0, revenue: 0, profit: 0 };
      d.count += r.count; d.revenue += r.revenue; d.profit += r.profit;
      byDay.set(r.date, d);
    }
    return byDay;
  }, [dayRowsOf, payFilter, sellerScope]);

  const rawExpenses = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const minIso = new Date(view === 'ripoti' ? 0 : range.start).toISOString();
    const queryResult = await db.expenses
      .where('[shop_id+isDeleted+date]')
      .between([user.shopId, 0, minIso], [user.shopId, 0, '￿'])
      .toArray();

    const filteredResult = boss ? queryResult : queryResult.filter(e => e.user_id === user.id);
    return filteredResult.sort((a, b) => b.date.localeCompare(a.date));
  }, [user?.shopId, range.start, boss, user?.id, view]);

  const expenses = rawExpenses || [];
  const inRange = (isoDate: string) => {
    const at = new Date(isoDate).getTime();
    return at >= range.start && at < range.end;
  };
  const periodExpenses = expenses.filter(e => inRange(e.date));
  const totalExpenses = periodExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Sales figures follow the payment and seller filters; expenses belong to
  // the whole period, so net profit is always the whole period's.
  const totalRevenue = totals.revenue;
  const totalProfit = totals.profit;
  const netProfit = periodProfit - totalExpenses;

  // Who sold, by name. Staff see only their own sales, so only bosses need it.
  const shopUsers = useLiveQuery(
    () => (user?.shopId ? db.users.where('shop_id').equals(user.shopId).toArray() : Promise.resolve([])),
    [user?.shopId],
  ) || [];
  const sellerName = (id: string) => shopUsers.find(u => u.id === id)?.name || (id === user?.id ? user?.name : '') || '—';
  const sellers = useMemo(() => shopUsers
    .filter(u => u.role !== 'superadmin')
    .map(u => ({ id: u.id, name: u.name || '—' }))
    .sort((a, b) => a.name.localeCompare(b.name)), [shopUsers]);

  // ---- The receipts, 50 at a time: this computer's, then older ones from the server ----
  const receiptQuery: ReceiptQuery = useMemo(() => ({
    shopId, from: range.start, to: range.end, payment: payFilter, seller: boss ? sellerFilter : 'all',
    onlyUser: boss ? undefined : user?.id, search: query,
  }), [shopId, range.start, range.end, payFilter, sellerFilter, boss, user?.id, query]);
  const queryKey = JSON.stringify(receiptQuery);

  const [shownReceipts, setShownReceipts] = useState(RECEIPTS_PAGE);
  useEffect(() => { setShownReceipts(RECEIPTS_PAGE); }, [queryKey]);

  const localRaw = useLiveQuery(async () => {
    const page = view === 'risiti' && shopId ? await localReceipts(receiptQuery, shownReceipts) : { receipts: [] as SaleReceipt[], more: false };
    return { ...page, key: queryKey, shown: shownReceipts };
  }, [view, queryKey, shownReceipts]);
  // Right after a filter changes, the hook still holds the previous filter's
  // page for a moment. That one is not shown; and only a page read for exactly
  // this filter and length may decide to ask the server for older receipts.
  const local = localRaw && localRaw.key === queryKey ? localRaw : undefined;
  const localExact = local && local.shown === shownReceipts ? local : undefined;

  const [cloud, setCloud] = useState<{ key: string; rows: SaleReceipt[]; done: boolean; loading: boolean; failed: boolean }>(
    { key: '', rows: [], done: false, loading: false, failed: false });
  const cloudNeeded = view === 'risiti' && boss && needsCloud(receiptQuery);
  const cloudState = cloud.key === queryKey ? cloud : { key: queryKey, rows: [], done: false, loading: false, failed: false };
  // One request at a time: two at once would ask for the same 50.
  const fetchingOlder = useRef(false);
  const fetchOlder = async () => {
    if (fetchingOlder.current) return;
    fetchingOlder.current = true;
    const base = cloud.key === queryKey ? cloud : { key: queryKey, rows: [] as SaleReceipt[], done: false, loading: false, failed: false };
    setCloud({ ...base, loading: true, failed: false });
    try {
      const page = await cloudReceipts(receiptQuery, base.rows[base.rows.length - 1] ?? null, RECEIPTS_PAGE);
      setCloud(c => {
        if (c.key !== queryKey) return c;
        const have = new Set(c.rows.map(r => r.id));
        return { ...c, rows: [...c.rows, ...page.receipts.filter(r => !have.has(r.id))], done: page.done, loading: false };
      });
    } catch (err) {
      console.warn('Older receipts could not be fetched:', err);
      setCloud(c => (c.key === queryKey ? { ...c, loading: false, failed: true } : c));
    } finally {
      fetchingOlder.current = false;
    }
  };
  const localDone = !!localExact && !localExact.more;
  const wantFromCloud = localExact ? Math.max(0, shownReceipts - localExact.receipts.length) : 0;
  useEffect(() => {
    if (cloudNeeded && localDone && wantFromCloud > cloudState.rows.length && !cloudState.done && !cloudState.loading && !cloudState.failed) {
      void fetchOlder();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudNeeded, localDone, wantFromCloud, queryKey, cloudState.rows.length, cloudState.done, cloudState.loading, cloudState.failed]);

  const receipts: SaleReceipt[] = local
    ? [...local.receipts, ...(cloudNeeded && !local.more ? cloudState.rows.slice(0, Math.max(0, local.shown - local.receipts.length)) : [])]
    : [];
  const moreReceipts = (local?.more ?? false) || (cloudNeeded && !cloudState.done && !cloudState.failed);
  const receiptsLoading = !local || (cloudNeeded && cloudState.loading);
  const windowStartLabel = (() => {
    const ms = historyWindowMs(shopId);
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getDate()} ${monthNames()[d.getMonth()]} ${d.getFullYear()}`;
  })();

  // Staff: the items in their (at most three days of) receipts.
  const unitsSold = useLiveQuery(async () => {
    if (boss || !shopId || !user?.id) return 0;
    const mine = await db.sales.where('[shop_id+isDeleted+created_at]')
      .between([shopId, 0, new Date(range.start).toISOString()], [shopId, 0, Number.isFinite(range.end) ? new Date(range.end).toISOString() : '￿'], true, false)
      .filter(s => s.user_id === user.id && (payFilter === 'all' || payKind(s.payment_method) === payFilter)).toArray();
    const items = mine.length ? await db.saleItems.where('sale_id').anyOf(mine.map(s => s.id)).filter(i => i.isDeleted !== 1).toArray() : [];
    return items.reduce((a, i) => a + i.qty, 0);
  }, [boss, shopId, user?.id, range.start, range.end, payFilter]) ?? 0;

  // The shown receipts, grouped by day; each day's totals are the whole day's.
  const shownDays: { key: string; date: Date; sales: SaleReceipt[] }[] = [];
  for (const s of receipts) {
    const date = new Date(s.created_at);
    const key = format(date, 'yyyy-MM-dd');
    const last = shownDays[shownDays.length - 1];
    if (last && last.key === key) last.sales.push(s);
    else shownDays.push({ key, date, sales: [s] });
  }
  const dayTitle = (d: Date) => `${weekdayNames()[d.getDay()]}, ${d.getDate()} ${monthNames()[d.getMonth()]} ${d.getFullYear()}`;

  // ---- Reports: every day's totals (a few hundred rows a year) ----
  const today = dateKey(Date.now());
  const allRows = useLiveQuery(
    () => (view === 'ripoti' && shopId && totalsReady ? dailyRows(shopId, '2000-01-01', today) : Promise.resolve([] as DayRow[])),
    [view, shopId, totalsReady, today],
  ) ?? [];

  // Chart Data: Revenue Trend (Last 30 days)
  const trendData = useMemo(() => {
    const byDay = new Map<string, { revenue: number; profit: number }>();
    for (const r of allRows) {
      const d = byDay.get(r.date) ?? { revenue: 0, profit: 0 };
      d.revenue += r.revenue; d.profit += r.profit;
      byDay.set(r.date, d);
    }
    const now = new Date();
    return eachDayOfInterval({ start: subDays(now, 29), end: now }).map(day => {
      const d = byDay.get(dateKey(day));
      return { date: format(day, 'dd/MM'), Mapato: d?.revenue ?? 0, Faida: d?.profit ?? 0 };
    });
  }, [allRows]);

  // Chart Data: Top 10 Products, last 30 days (always on this computer).
  const topProductsData = useLiveQuery(async () => {
    if (view !== 'ripoti' || !shopId) return [];
    const since = startOfDay(subDays(new Date(), 29)).toISOString();
    const recent = await db.sales.where('[shop_id+isDeleted+created_at]').between([shopId, 0, since], [shopId, 0, '￿']).toArray();
    const live = new Set(recent.map(s => s.id));
    // One range read of the lines, not one lookup per sale.
    const items = (await db.saleItems.where('[shop_id+created_at]').between([shopId, since], [shopId, '￿']).toArray())
      .filter(i => i.isDeleted !== 1 && live.has(i.sale_id));
    const productStats: Record<string, { name: string, qty: number, profit: number }> = {};
    items.forEach(item => {
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
        name: p.name.length > 22 ? p.name.substring(0, 20) + '..' : p.name,
        value: topProductsMetric === 'qty' ? p.qty : p.profit
      }));
  }, [view, shopId, topProductsMetric]) ?? [];


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
        if (!sale) throw new Error(t('Sale not found'));

        const items = await db.saleItems.where('sale_id').equals(saleId).toArray();

        // 1. Return stock to products (only for products that track stock)
        for (const item of items) {
          const product = await db.products.get(item.product_id);
          if (product && isProductStockTracked(product, shopObj)) {
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
              updated_at: nowIso(),
              synced: 0
            });
          }
        }
        
        // 2. Soft delete sale and items
        await db.sales.update(saleId, { 
          isDeleted: 1, 
          status: 'refunded',
          updated_at: nowIso(),
          synced: 0 
        });

        // Removed sendAuditAlert because it was alerting local Boss about their own actions.
        // Audit logs are properly tracked via SyncService for employees.
        
        const itemIds = items.map(i => i.id);
        await db.saleItems.where('id').anyOf(itemIds).modify({ 
          isDeleted: 1,
          updated_at: nowIso(),
          synced: 0 
        });

        // 3. Soft delete debt payments if any
        await db.debtPayments.where('sale_id').equals(saleId).modify({
          isDeleted: 1,
          updated_at: nowIso(),
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
        const diffMinutes = (new Date().getTime() - new Date(sale.created_at).getTime()) / (1000 * 60);
        const diffMinutesRounded = Math.round(diffMinutes);
        if (diffMinutesRounded > 30) {
          const formattedSaleDate = format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm');
          let friendlyAgo = `${diffMinutesRounded} min`;
          if (diffMinutesRounded >= 60) {
            const diffHours = diffMinutes / 60;
            const diffHoursRounded = Math.round(diffHours);
            if (diffHoursRounded < 24) {
              friendlyAgo = `masaa ${diffHoursRounded}`;
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
      alert(t('Imeshindwa kurudisha mauzo: ') + error.message);
    } finally {
      setIsReversing(false);
    }
  };

  // The report on A4, through the browser's print window (where "Save as PDF"
  // is one of the printers). It is printed from its own hidden page: the app's
  // print styles are for the thermal receipt and hide everything else, which
  // printed this report as a blank page.

  // The receipt again, on the receipt printer, as Kikapu prints it at the sale.
  const handlePrintReceipt = async (sale: SaleReceipt) => {
    try {
      const dbShop = user?.shopId ? await db.shops.get(user.shopId) : undefined;
      printReceipt({
        shopName: (dbShop?.name || settings?.shopName || 'Biashara Yangu').toUpperCase(),
        shopPhone: localStorage.getItem('venics_business_phone') || dbShop?.phone || undefined,
        shopLocation: localStorage.getItem('venics_business_location') || undefined,
        sellerName: sellerName(sale.user_id),
        saleId: sale.id,
        paymentMethod: sale.payment_method,
        isCredit: sale.payment_method === 'credit',
        customerName: sale.customer_name,
        customerPhone: sale.customer_phone,
        dueDate: sale.due_date,
        totalAmount: sale.total_amount,
        currency,
        items: sale.lines.map(i => ({ name: i.product_name, qty: i.qty, sell_price: i.sell_price })),
      });
    } catch (err) {
      console.error('Failed to print receipt:', err);
      showAlert(t('Kosa'), t('Imeshindwa kufungua print: ') + err);
    }
  };

  // ---- The PDF report: pick a period, then it downloads ----
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('mwezi');
  const [reportFrom, setReportFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [reportTo, setReportTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [makingReport, setMakingReport] = useState(false);

  const handleDownloadReport = async () => {
    if (!user?.shopId || makingReport) return;
    setMakingReport(true);
    try {
      const result = await downloadSalesReport({
        shopId: user.shopId,
        currency,
        fallbackShopName: shopName,
        period: reportPeriod,
        custom: { from: reportFrom <= reportTo ? reportFrom : reportTo, to: reportFrom <= reportTo ? reportTo : reportFrom },
      });
      if (result === 'empty') {
        showAlert(t('Taarifa'), t('Hakuna data ya kutosha kutengeneza ripoti.'));
      } else {
        setShowReportModal(false);
      }
    } catch (error) {
      console.error('PDF Export Error:', error);
      showAlert(t('Kosa'), t('Imeshindwa kutengeneza PDF: ') + error);
    } finally {
      setMakingReport(false);
    }
  };

  // Generate Reports Data
  const reportData = useMemo(() => {
    // Keyed and sorted by the date itself; the label is only for showing, in
    // the app's language ("Novemba 2026"), so it is never parsed back.
    const groups: Record<string, { label: string, sortKey: number, mapato: number, faida: number, matumizi: number, mauzo: number }> = {};
    const groupOf = (date: Date) => {
      const monthly = reportType === 'mwezi';
      const key = monthly ? format(date, 'yyyy-MM') : format(date, 'yyyy');
      return (groups[key] ??= {
        label: monthly ? monthLabel(date) : String(date.getFullYear()),
        sortKey: (monthly ? startOfMonth(date) : startOfYear(date)).getTime(),
        mapato: 0, faida: 0, matumizi: 0, mauzo: 0,
      });
    };

    allRows.forEach(r => {
      const group = groupOf(new Date(`${r.date}T00:00:00`));
      group.mapato += r.revenue;
      group.faida += r.profit;
      group.mauzo += r.count;
    });

    // Even a period with no sales may have expenses.
    expenses.forEach(expense => {
      groupOf(new Date(expense.date)).matumizi += expense.amount;
    });

    return Object.values(groups)
      .sort((a, b) => b.sortKey - a.sortKey)
      .map(({ sortKey: _sortKey, ...data }) => ({ ...data, faidaHalisi: data.faida - data.matumizi }));
  }, [allRows, expenses, reportType]);
  const reportTotals = reportData.reduce((a, r) => ({ mapato: a.mapato + r.mapato, faida: a.faida + r.faida, matumizi: a.matumizi + r.matumizi, mauzo: a.mauzo + r.mauzo }), { mapato: 0, faida: 0, matumizi: 0, mauzo: 0 });

  const openBackdatedSale = () => {
    setBackdatedSaleCart([]);
    setBackdatedPaymentMethod('cash');
    setBackdatedCustomerName('');
    setBackdatedCustomerPhone('');
    setBackdatedIsCheckout(false);
    setBackdatedShowCartMobile(false);
    setShowBackdatedSaleModal(true);
  };
  const closeBackdatedSale = () => {
    setShowBackdatedSaleModal(false);
    setBackdatedIsCheckout(false);
    setBackdatedShowCartMobile(false);
  };
  const openBackdatedExpense = () => {
    setBackdatedExpenseAmount('');
    setBackdatedExpenseDesc('');
    setBackdatedExpenseCategory('Mengineyo');
    setShowBackdatedExpenseModal(true);
  };

  // Totals are read from the daily rows; until this computer has built them once, '…'.
  const money = (n: number) => (totalsReady ? formatCurrency(n, currency) : '…');
  const searchNote = query ? t('Bila utafutaji') : undefined;
  // No icon: the whole width is the number's, so eight digits show in full; a
  // longer figure wraps after "TSh" rather than being cut off.
  const kpi = (label: string, value: string, tone = 'text-gray-900', note?: string) => (
    <div className="min-w-0 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`break-words text-lg font-bold leading-tight tabular-nums ${tone}`}>{value}</div>
      {note && <div className="truncate text-[11px] text-gray-400">{note}</div>}
    </div>
  );
  const select = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer';
  // Table columns. Money columns only for whoever may see money; seller and
  // profit only when the table is wide enough to keep the products readable.
  const showSeller = boss && tableWidth >= 900;
  const showAmount = hasMapatoAccess;
  const showProfit = boss && tableWidth >= 720;
  const columnCount = 6 + (showSeller ? 1 : 0) + (showAmount ? 1 : 0) + (showProfit ? 1 : 0);

  if (dayView) return <DayReport onBack={() => setDayView(false)} sellerName={sellerName} />;

  return (
    // Receipts fill the window, their table scrolling under a fixed header;
    // reports are a long page, so the page itself scrolls.
    <div className={`p-4 md:p-5 flex flex-col gap-3 ${view === 'risiti' ? 'h-full' : ''}`}>
      {/* Header: title, the two views, and the quieter past-day entries */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('Historia ya Mauzo')}</h1>
        {boss && (
          <div className="flex rounded-lg bg-gray-200 p-1">
            <button
              onClick={() => setView('risiti')}
              className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${view === 'risiti' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}
            >
              <Receipt className="h-4 w-4" /> {t('Risiti')}
            </button>
            <button
              onClick={() => setView('ripoti')}
              className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${view === 'ripoti' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}
            >
              <BarChart3 className="h-4 w-4" /> {t('Ripoti')}
            </button>
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={openBackdatedSale} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer">
            <History className="h-4 w-4 text-blue-600" /> {t('Mauzo ya siku zilizopita')}
          </button>
          <button onClick={openBackdatedExpense} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer">
            <History className="h-4 w-4 text-orange-600" /> {t('Matumizi ya siku zilizopita')}
          </button>
        </div>
      </div>

      {view === 'risiti' ? (
        <>
          {/* Filters: period, an exact date range, search, payment and seller */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5">
              {periods.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${period === p.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setDayView(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              <Calendar className="h-4 w-4 text-blue-600" />
              {t('Chagua tarehe')}
            </button>
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('Tafuta bidhaa au mteja...')}
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 cursor-pointer" aria-label={t('Futa')}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select value={payFilter} onChange={e => setPayFilter(e.target.value as typeof payFilter)} className={select} aria-label={t('Malipo')}>
              <option value="all">{t('Malipo: Zote')}</option>
              <option value="cash">{t('Taslimu')}</option>
              <option value="mobile">{t('Kwa Simu')}</option>
              <option value="credit">{t('Mkopo')}</option>
            </select>
            {boss && (
              <select value={sellerFilter} onChange={e => setSellerFilter(e.target.value)} className={select} aria-label={t('Muuzaji')}>
                <option value="all">{t('Muuzaji: Wote')}</option>
                {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>

          {!boss && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
              {t('Kwenye kifaa hiki unaona mauzo yako ya siku 3 zilizopita. Ya zamani zaidi yamehifadhiwa salama, na bosi wako anayaona yote.')}
            </div>
          )}

          {/* Totals for the chosen period, in one row */}
          {boss ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {kpi(t('Mapato'), money(totalRevenue), 'text-gray-900', searchNote)}
              {kpi(t('Faida'), money(totalProfit), 'text-emerald-600', searchNote)}
              {kpi(t('Matumizi'), formatCurrency(totalExpenses, currency), 'text-orange-600', filtersOn ? t('Kipindi chote') : undefined)}
              {kpi(t('Faida Halisi'), money(netProfit), netProfit >= 0 ? 'text-blue-700' : 'text-red-600', filtersOn ? t('Kipindi chote') : undefined)}
              {kpi(t('Risiti'), totalsReady ? totals.count.toLocaleString() : '…', 'text-gray-900', searchNote ?? (totals.count ? t('Wastani {v}', { v: formatCurrency(Math.round(totalRevenue / totals.count), currency) }) : undefined))}
            </div>
          ) : (
            <div className={`grid gap-3 ${hasMapatoAccess ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {kpi(t('Risiti zako'), totalsReady ? totals.count.toLocaleString() : '…', 'text-purple-600', searchNote)}
              {kpi(t('Bidhaa ulizouza'), unitsSold.toLocaleString())}
              {hasMapatoAccess && kpi(t('Mapato'), money(totalRevenue), 'text-gray-900', searchNote)}
            </div>
          )}

          {/* The receipts: a table grouped by day, one line each */}
          <div ref={tableBoxRef} className="flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center border-b border-gray-100 px-4 py-2">
              <span className="text-sm font-semibold text-gray-800">
                {t('Mauzo')} <span className="font-normal text-gray-400">· {query ? `${receipts.length.toLocaleString()}${moreReceipts ? '+' : ''}` : totals.count.toLocaleString()}</span>
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {receipts.length === 0 && receiptsLoading ? (
                <div className="flex items-center justify-center gap-2 py-14 text-sm text-gray-500">
                  <RefreshCw className="h-4 w-4 animate-spin" /> {t('Inapakia...')}
                </div>
              ) : receipts.length === 0 && !moreReceipts && !cloudState.failed ? (
                <div className="py-14 text-center text-sm text-gray-500">
                  {filtersOn ? t('Hakuna risiti inayolingana na utafutaji huu.') : t('Hakuna mauzo katika kipindi hiki.')}
                </div>
              ) : receipts.length === 0 ? null : (
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: 32 }} />
                    <col style={{ width: 60 }} />
                    <col />
                    <col style={{ width: 56 }} />
                    <col style={{ width: 100 }} />
                    {showSeller && <col style={{ width: 100 }} />}
                    {showAmount && <col style={{ width: 112 }} />}
                    {showProfit && <col style={{ width: 100 }} />}
                    <col style={{ width: 80 }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th></th>
                      <th className="px-2 py-2 text-left font-semibold">{t('Saa')}</th>
                      <th className="px-2 py-2 text-left font-semibold">{t('Bidhaa')}</th>
                      <th className="px-2 py-2 text-right font-semibold">{t('Idadi')}</th>
                      <th className="px-2 py-2 text-left font-semibold">{t('Malipo')}</th>
                      {showSeller && <th className="px-2 py-2 text-left font-semibold">{t('Muuzaji')}</th>}
                      {showAmount && <th className="px-2 py-2 text-right font-semibold">{t('Kiasi')}</th>}
                      {showProfit && <th className="px-2 py-2 text-right font-semibold">{t('Faida')}</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownDays.map(day => {
                      const totals = dayTotals.get(day.key);
                      return [
                        <tr key={day.key} className="bg-slate-50">
                          <td colSpan={columnCount} className="border-y border-gray-100 px-4 py-1.5 text-xs">
                            <span className="font-bold text-gray-800">{dayTitle(day.date)}</span>
                            <span className="text-gray-500">
                              {' · '}{t('risiti {n}', { n: totals?.count ?? day.sales.length })}
                              {showAmount && totals && <> · {formatCurrency(totals.revenue, currency)}</>}
                              {boss && totals && <> · {t('faida {v}', { v: formatCurrency(totals.profit, currency) })}</>}
                            </span>
                          </td>
                        </tr>,
                        ...day.sales.flatMap(sale => {
                          const lines = sale.lines;
                          const paid = paymentLabel(sale.payment_method);
                          const isOpen = expandedSaleId === sale.id;
                          return [
                            <tr
                              key={sale.id}
                              onClick={() => setExpandedSaleId(isOpen ? null : sale.id)}
                              className={`cursor-pointer border-b border-gray-50 hover:bg-blue-50/40 ${isOpen ? 'bg-blue-50/40' : ''}`}
                            >
                              <td className="pl-3 text-gray-400">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                              <td className="whitespace-nowrap px-2 py-2 tabular-nums text-gray-600">{format(new Date(sale.created_at), 'HH:mm')}</td>
                              <td className="px-2 py-2">
                                <div className="truncate font-medium text-gray-800">{lines.map(i => i.product_name).join(', ')}</div>
                                {sale.customer_name && <div className="truncate text-xs text-orange-700">{t('Mteja: {name}', { name: sale.customer_name })}</div>}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-gray-600">{lines.reduce((a, i) => a + i.qty, 0)}</td>
                              <td className="px-2 py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${paid.badge}`}>{paid.label}</span></td>
                              {showSeller && <td className="truncate px-2 py-2 text-gray-600">{sellerName(sale.user_id)}</td>}
                              {showAmount && <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-gray-900">{formatCurrency(sale.total_amount, currency)}</td>}
                              {showProfit && <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-emerald-600">{formatCurrency(sale.total_profit, currency)}</td>}
                              <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                                <div className="flex justify-end gap-1">
                                  <button onClick={() => handlePrintReceipt(sale)} title={t('Chapisha risiti')} aria-label={t('Chapisha risiti')} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 cursor-pointer">
                                    <Printer className="h-4 w-4" />
                                  </button>
                                  {isAuthenticated && !sale.cloud && (
                                    <button onClick={() => setReversingSaleId(sale.id)} title={t('Rudisha mauzo')} aria-label={t('Rudisha mauzo')} className="rounded-md p-1.5 text-red-500 hover:bg-red-50 cursor-pointer">
                                      <RotateCcw className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>,
                            isOpen && (
                              <tr key={`${sale.id}-lines`} className="border-b border-gray-100 bg-blue-50/20">
                                <td></td>
                                <td colSpan={columnCount - 1} className="px-2 pb-3 pt-1">
                                  <table className="w-full max-w-2xl text-xs">
                                    <tbody>
                                      {lines.map(i => (
                                        <tr key={i.id} className="text-gray-700">
                                          <td className="py-0.5">{i.product_name}</td>
                                          <td className="py-0.5 text-right tabular-nums">{i.qty} × {showAmount ? formatCurrency(i.sell_price, currency) : ''}</td>
                                          {showAmount && <td className="w-28 py-0.5 text-right font-semibold tabular-nums">{formatCurrency(i.qty * i.sell_price, currency)}</td>}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {sale.customer_phone && <div className="mt-1 text-xs text-gray-500">{t('Simu ya mteja: {phone}', { phone: sale.customer_phone })}</div>}
                                  <div className="mt-2 flex gap-2">
                                    <button onClick={() => handlePrintReceipt(sale)} className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer">
                                      <Printer className="h-3.5 w-3.5" /> {t('Chapisha risiti')}
                                    </button>
                                    {isAuthenticated && !sale.cloud && (
                                      <button onClick={() => setReversingSaleId(sale.id)} className="flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer">
                                        <RotateCcw className="h-3.5 w-3.5" /> {t('Rudisha mauzo')}
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ),
                          ];
                        }),
                      ];
                    })}
                  </tbody>
                </table>
              )}
              {cloudNeeded && cloudState.loading && (
                <div className="flex items-center justify-center gap-2 border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> {t('Inaleta risiti za zamani kutoka mtandaoni...')}
                </div>
              )}
              {cloudNeeded && cloudState.failed && (
                <div className="border-t border-gray-100 px-4 py-3 text-center text-xs text-amber-800 bg-amber-50">
                  {t('Risiti za kabla ya {date} ziko mtandaoni (cloud). Unganisha mtandao ili kuziona.', { date: windowStartLabel })}{' '}
                  <button onClick={() => void fetchOlder()} className="font-semibold text-blue-600 hover:underline cursor-pointer">{t('Jaribu tena')}</button>
                </div>
              )}
              {moreReceipts && !cloudState.loading && receipts.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-3 text-center text-xs text-gray-500">
                  {!query && <>{t('Inaonyesha 1–{shown} kati ya {total}', { shown: receipts.length.toLocaleString(), total: totals.count.toLocaleString() })}{' · '}</>}
                  <button onClick={() => setShownReceipts(n => n + RECEIPTS_PAGE)} className="font-semibold text-blue-600 hover:underline cursor-pointer">
                    {t('Onyesha 50 zaidi')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
              <button onClick={() => setReportType('mwezi')} className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${reportType === 'mwezi' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>{t('Kila Mwezi')}</button>
              <button onClick={() => setReportType('mwaka')} className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${reportType === 'mwaka' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>{t('Kila Mwaka')}</button>
            </div>
            <button onClick={() => setShowReportModal(true)} className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer">
              <FileDown className="h-4 w-4" /> {t('Pakua Ripoti (PDF)')}
            </button>
          </div>

          {hasMapatoAccess && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
              <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-3">
                <div className="mb-2 text-sm font-semibold text-gray-800">{t('Mwenendo wa Mapato (Siku 30)')}</div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} interval={4} />
                      <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${v / 1000}k`} />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value, currency)}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Line type="monotone" dataKey="Mapato" name={t('Mapato')} stroke="#3b82f6" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="Faida" name={t('Faida')} stroke="#10b981" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1 flex justify-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center"><span className="mr-1 h-2.5 w-2.5 rounded-full bg-blue-500"></span>{t('Mapato')}</span>
                  <span className="flex items-center"><span className="mr-1 h-2.5 w-2.5 rounded-full bg-green-500"></span>{t('Faida')}</span>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-800">{t('Bidhaa 10 Zinazoongoza')}</div>
                  <div className="flex rounded-lg bg-gray-100 p-0.5">
                    <button onClick={() => setTopProductsMetric('qty')} className={`rounded-md px-2.5 py-1 text-[10px] font-bold cursor-pointer ${topProductsMetric === 'qty' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>{t('Idadi')}</button>
                    <button onClick={() => setTopProductsMetric('profit')} className={`rounded-md px-2.5 py-1 text-[10px] font-bold cursor-pointer ${topProductsMetric === 'profit' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>{t('Faida')}</button>
                  </div>
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProductsData} layout="vertical" margin={{ left: 4 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" fontSize={10} width={120} tickLine={false} axisLine={false} />
                      <Tooltip
                        formatter={(value: number) => topProductsMetric === 'qty' ? value : formatCurrency(value, currency)}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="value" fill={topProductsMetric === 'qty' ? '#8b5cf6' : '#10b981'} radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Every month (or year) at once, newest first */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            {reportData.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-500">{t('Hakuna data ya ripoti.')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">{reportType === 'mwezi' ? t('Mwezi') : t('Mwaka')}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t('Risiti')}</th>
                    {hasMapatoAccess && <th className="px-4 py-2 text-right font-semibold">{t('Mapato')}</th>}
                    {boss && <th className="px-4 py-2 text-right font-semibold">{t('Faida')}</th>}
                    {boss && <th className="px-4 py-2 text-right font-semibold">{t('Matumizi')}</th>}
                    {boss && <th className="px-4 py-2 text-right font-semibold">{t('Faida Halisi')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {reportData.map(r => (
                    <tr key={r.label} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-800">{r.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">{r.mauzo.toLocaleString()}</td>
                      {hasMapatoAccess && <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.mapato, currency)}</td>}
                      {boss && <td className="px-4 py-2 text-right tabular-nums text-emerald-600">{formatCurrency(r.faida, currency)}</td>}
                      {boss && <td className="px-4 py-2 text-right tabular-nums text-orange-600">{formatCurrency(r.matumizi, currency)}</td>}
                      {boss && <td className={`px-4 py-2 text-right font-semibold tabular-nums ${r.faidaHalisi >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{formatCurrency(r.faidaHalisi, currency)}</td>}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="px-4 py-2 text-gray-900">{t('Jumla')}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{reportTotals.mauzo.toLocaleString()}</td>
                    {hasMapatoAccess && <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(reportTotals.mapato, currency)}</td>}
                    {boss && <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{formatCurrency(reportTotals.faida, currency)}</td>}
                    {boss && <td className="px-4 py-2 text-right tabular-nums text-orange-700">{formatCurrency(reportTotals.matumizi, currency)}</td>}
                    {boss && <td className={`px-4 py-2 text-right tabular-nums ${reportTotals.faida - reportTotals.matumizi >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{formatCurrency(reportTotals.faida - reportTotals.matumizi, currency)}</td>}
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* PDF report: choose the period */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center text-lg font-bold text-gray-900"><FileDown className="mr-2 h-5 w-5 text-blue-600" />{t('Pakua Ripoti (PDF)')}</h3>
              <button onClick={() => !makingReport && setShowReportModal(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 cursor-pointer" aria-label={t('Funga')}><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-4 text-xs text-gray-500">{t('Chagua kipindi cha ripoti. Ripoti ina muhtasari, chati, bidhaa zinazoongoza, mauzo ya kila muuzaji, matumizi na taarifa ya mapato.')}</p>
            <div className="grid gap-2">
              {[...reportPeriods(), { id: 'custom' as const, label: t('Chagua tarehe'), hint: t('Kipindi chochote unachotaka') }].map(p => (
                <button
                  key={p.id}
                  onClick={() => setReportPeriod(p.id)}
                  className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-left cursor-pointer ${reportPeriod === p.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 hover:bg-gray-50'}`}
                >
                  <span className="text-sm font-bold text-gray-800">{p.label}</span>
                  <span className="text-[11px] text-gray-500">{p.hint}</span>
                </button>
              ))}
            </div>
            {reportPeriod === 'custom' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-[11px] font-semibold text-gray-500">
                  {t('Kuanzia')}
                  <input type="date" value={reportFrom} max={reportTo} onChange={e => setReportFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-800" />
                </label>
                <label className="text-[11px] font-semibold text-gray-500">
                  {t('Hadi')}
                  <input type="date" value={reportTo} min={reportFrom} max={format(new Date(), 'yyyy-MM-dd')} onChange={e => setReportTo(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-800" />
                </label>
              </div>
            )}
            <button
              onClick={handleDownloadReport}
              disabled={makingReport || (reportPeriod === 'custom' && (!reportFrom || !reportTo))}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {makingReport ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              {makingReport ? t('Inatayarisha ripoti...') : t('Pakua PDF')}
            </button>
          </div>
        </div>
      )}

      {/* Reverse Sale Confirmation Modal */}
      {reversingSaleId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center text-red-600 mb-4">
              <AlertCircle className="w-6 h-6 mr-2" />
              <h3 className="text-lg font-bold">{t('Rudisha Mauzo?')}</h3>
            </div>
            <p className="text-gray-600 mb-6 text-sm">
              {t('Je, una uhakika unataka kurudisha mauzo haya?')} 
              <br /><br />
              <span className="font-bold text-red-600">{t('Hii itarudisha bidhaa kwenye stock na kufuta rekodi hii ya mauzo.')}</span>
            </p>
            <div className="flex space-x-3">
              <button 
                onClick={() => setReversingSaleId(null)}
                disabled={isReversing}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl disabled:opacity-50"
              >
                {t('Hapana')}
              </button>
              <button 
                onClick={() => handleReverseSale(reversingSaleId)}
                disabled={isReversing}
                className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-200 disabled:opacity-50 flex items-center justify-center"
              >
                {isReversing ? t('Inarudisha...') : t('Ndio, Rudisha')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= BACKDATED SALE MODAL ================= */}
      {/* Laid out as the Mauzo page (Kikapu.tsx): the products on the left, and
          on the right the day of the sale, the cart, its total and the ways to
          pay. The save itself (handleCompleteBackdatedSale) is unchanged. */}
      {showBackdatedSaleModal && (() => {
        const lineCount = backdatedSaleCart.reduce((sum, item) => sum + item.qty, 0);
        const saleDay = new Date(`${backdatedSaleDate}T00:00:00`);
        const saleDayLabel = isNaN(saleDay.getTime()) ? '' : `${weekdayNames()[saleDay.getDay()]}, ${saleDay.getDate()} ${monthNames()[saleDay.getMonth()]} ${saleDay.getFullYear()}`;
        const onCredit = backdatedIsCheckout && backdatedPaymentMethod === 'credit';
        const busy = isSubmittingBackdated;
        return (
        <div className="fixed inset-0 z-50 flex bg-slate-50 overflow-hidden text-left font-sans" data-testid="backdated-sale">
          {/* Left: the products */}
          <div className="flex-1 flex flex-col border-r border-slate-200 bg-white min-w-0 h-full">
            <div className="px-3 py-2 border-b border-slate-100 flex-shrink-0 flex items-center space-x-3">
              <button
                type="button"
                onClick={closeBackdatedSale}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-rose-50 hover:text-rose-600 transition-all shadow-sm flex-shrink-0 cursor-pointer active:scale-95 text-xs font-bold"
              >
                <X className="w-4 h-4 pointer-events-none" />
                <span>{t('Funga')}</span>
              </button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder={t('Tafuta bidhaa...')}
                  value={backdatedSearch}
                  onChange={(e) => setBackdatedSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm"
                />
              </div>
            </div>

            <div className="bg-white border-b border-slate-100 flex-shrink-0 flex items-center overflow-x-auto no-scrollbar py-1 px-2 md:px-4 space-x-1 scroll-smooth select-none">
              <button
                type="button"
                onClick={() => setSelectedBackdatedLetter(null)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                  selectedBackdatedLetter === null ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                }`}
              >
                {t('Zote')}
              </button>
              {['#', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'].map(letter => (
                <button
                  type="button"
                  key={letter}
                  onClick={() => setSelectedBackdatedLetter(selectedBackdatedLetter === letter ? null : letter)}
                  className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                    selectedBackdatedLetter === letter ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-600/20' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {letter}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-2 md:p-3 bg-slate-50/30">
              {backdatedFilteredProducts.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 md:gap-3 items-start">
                  {backdatedFilteredProducts.map((product) => {
                    const cartItem = backdatedSaleCart.find(item => item.id === product.id);
                    const isStockTracked = product.track_stock !== false;
                    const isAtMaxStock = isStockTracked && cartItem ? cartItem.qty >= product.stock : false;
                    const inCart = !!cartItem;
                    return (
                      <button
                        type="button"
                        key={product.id}
                        data-testid="backdated-product"
                        onClick={() => {
                          if (isAtMaxStock) {
                            showToast(t('Umeshafikia kikomo cha stoki iliyopo'), 'info');
                            return;
                          }
                          handleAddToBackdatedCart(product);
                        }}
                        className={`group bg-white p-3 md:p-4 rounded-xl border transition-all text-left relative overflow-hidden flex flex-col h-full min-h-[110px] cursor-pointer ${
                          inCart ? 'border-blue-500 ring-2 ring-blue-100 shadow-md' : 'border-slate-200 shadow-sm hover:border-blue-500 hover:shadow-md'
                        }`}
                      >
                        <div className="absolute top-0 right-0 p-1.5 opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <div className="bg-blue-600 text-white p-1 rounded-lg">
                            <Plus className="w-3.5 h-3.5" />
                          </div>
                        </div>
                        <div className="flex-1">
                          <h3 className="font-bold text-slate-900 mb-1 text-xs md:text-sm line-clamp-2 leading-tight pr-4">{product.name}</h3>
                          <p className="text-base md:text-lg font-black mt-auto text-blue-600">{formatCurrency(product.sell_price, currency)}</p>
                        </div>
                        {!(isStockTracked && hideStock) && (
                          <div className="mt-3 flex items-center text-[9px] font-bold uppercase tracking-wider border-t border-slate-50 pt-2 select-none">
                            {isStockTracked ? (
                              <span className="flex items-center text-slate-400">
                                <span className={`w-1.5 h-1.5 rounded-full mr-2 ${product.stock < 10 ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                                {t('STOKI: {stock}', { stock: product.stock })}
                              </span>
                            ) : (
                              <span className="flex items-center text-slate-400">
                                <span className="w-1.5 h-1.5 rounded-full mr-2 bg-slate-400"></span>
                                {t('STOKI: Bila Kikomo')}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center text-gray-400 py-16 flex flex-col items-center select-none">
                  <div className="bg-gray-100 p-4 rounded-full mb-3">
                    <Search className="w-8 h-8 text-gray-300 pointer-events-none" />
                  </div>
                  <p className="font-extrabold text-sm text-gray-800">{t('Hakuna bidhaa iliyopatikana')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t('Jaribu jina lingine la bidhaa.')}</p>
                </div>
              )}
            </div>
          </div>

          {/* Narrow windows: the cart opens over the products, as on Mauzo */}
          {backdatedSaleCart.length > 0 && !backdatedShowCartMobile && (
            <button
              type="button"
              onClick={() => setBackdatedShowCartMobile(true)}
              className="md:hidden fixed bottom-6 right-6 bg-emerald-600 text-white p-4 rounded-2xl shadow-2xl z-40 flex items-center space-x-3 animate-in fade-in slide-in-from-bottom-4 duration-300 border-2 border-white/20 active:scale-95 cursor-pointer"
            >
              <div className="relative">
                <ShoppingBag className="w-6 h-6" />
                <span className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-emerald-600">
                  {lineCount}
                </span>
              </div>
              <div className="text-left">
                <p className="text-[10px] uppercase font-bold opacity-80 leading-none mb-1">{t('Lipia Sasa')}</p>
                <p className="font-black text-sm leading-none">{formatCurrency(backdatedSaleTotal, currency)}</p>
              </div>
            </button>
          )}

          {/* Right: the day of the sale, the cart, its total and the ways to pay */}
          <div className={`fixed inset-0 z-50 md:relative md:z-0 flex md:w-[400px] lg:w-[450px] flex-col bg-slate-50 shadow-2xl transition-transform duration-300 h-full overflow-hidden ${
            backdatedShowCartMobile ? 'translate-y-0' : 'translate-y-full md:translate-y-0'
          }`}>
            <div className="px-6 md:px-8 pt-6 md:pt-8 pb-4 border-b border-slate-200 bg-white flex-shrink-0 select-none">
              <div className="flex items-center justify-between">
                <div className="flex items-center min-w-0">
                  <button type="button" onClick={() => setBackdatedShowCartMobile(false)} className="md:hidden mr-4 p-2 hover:bg-slate-100 rounded-xl cursor-pointer" aria-label={t('Rudi')}>
                    <ArrowLeft className="w-6 h-6 text-slate-600" />
                  </button>
                  <h2 className="text-lg md:text-xl font-bold text-slate-900 flex items-center min-w-0">
                    <History className="w-5 h-5 md:w-6 md:h-6 mr-2 md:mr-3 text-blue-600 shrink-0" />
                    <span className="truncate">{t('Mauzo ya siku zilizopita')}</span>
                  </h2>
                </div>
                {backdatedSaleCart.length > 0 && (
                  <button type="button" onClick={() => { setBackdatedSaleCart([]); setBackdatedIsCheckout(false); }} className="text-rose-500 text-xs md:text-sm font-bold hover:underline cursor-pointer shrink-0 ml-3">
                    {t('Futa Vyote')}
                  </button>
                )}
              </div>
              {/* The day this sale happened: it is recorded on that day, not today. */}
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">{t('Tarehe ya mauzo')}</div>
                  <div className="truncate text-xs font-bold text-amber-900" data-testid="backdated-day">{saleDayLabel}</div>
                </div>
                <input
                  type="date"
                  value={backdatedSaleDate}
                  onChange={(e) => setBackdatedSaleDate(e.target.value)}
                  max={format(new Date(nowIso()), 'yyyy-MM-dd')}
                  className="shrink-0 bg-white px-2.5 py-1.5 rounded-lg text-xs font-black text-amber-900 border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="p-4 md:p-8 space-y-3 md:space-y-4">
                {backdatedSaleCart.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-4 select-none">
                    <div className="w-16 h-16 md:w-20 md:h-20 bg-slate-100 rounded-full flex items-center justify-center">
                      <ShoppingBag className="w-8 h-8 md:w-10 md:h-10" />
                    </div>
                    <p className="font-bold text-sm md:text-base">{t('Kikapu cha siku za nyuma kiko tupu')}</p>
                  </div>
                ) : (
                  <>
                    {onCredit && (
                      <div className="space-y-4 md:space-y-6 animate-in slide-in-from-bottom-4 duration-300 pb-4 select-none">
                        <div className="space-y-3 md:space-y-4 p-4 md:p-6 bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
                          <h3 className="font-bold text-slate-900 flex items-center justify-start text-sm">
                            <User className="w-4 h-4 mr-2 text-blue-600 shrink-0" /> {t('Taarifa za Mkopo')}
                          </h3>
                          <div className="relative">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 md:mb-2 text-left">{t('Jina la Mteja')}</label>
                            <div className="relative">
                              <User className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5 md:w-4 md:h-4" />
                              <input
                                required
                                placeholder={t('Tafuta au andika jina...')}
                                value={backdatedCustomerName}
                                onChange={e => {
                                  setBackdatedCustomerName(e.target.value);
                                  setShowBackdatedSuggestions(true);
                                }}
                                onFocus={() => setShowBackdatedSuggestions(true)}
                                className="w-full pl-9 md:pl-10 pr-4 py-2 md:py-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 text-sm"
                              />
                            </div>
                            {showBackdatedSuggestions && backdatedFilteredCustomers.length > 0 && backdatedCustomerName && (
                              <div className="absolute z-20 w-full bg-white mt-2 border border-slate-200 rounded-xl md:rounded-2xl shadow-2xl max-h-40 overflow-y-auto">
                                {backdatedFilteredCustomers.map(c => (
                                  <button
                                    type="button"
                                    key={c}
                                    onMouseDown={() => handleSelectBackdatedCustomer(c)}
                                    className="w-full text-left p-3 md:p-4 hover:bg-blue-50 border-b border-slate-100 last:border-0 text-xs md:text-sm font-bold text-slate-700 cursor-pointer"
                                  >
                                    {c}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 md:mb-2 text-left">{t('Namba ya Simu')}</label>
                            <input type="tel" value={backdatedCustomerPhone} onChange={e => setBackdatedCustomerPhone(e.target.value)} className="w-full p-2 md:p-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 text-sm" />
                          </div>
                        </div>
                      </div>
                    )}

                    {backdatedSaleCart.map(item => {
                      const product = backdatedProductById.get(item.id) ?? { ...item, stock: 999999 };
                      return (
                        <div key={item.id} data-testid="backdated-line" className="bg-white p-4 md:p-5 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex items-center space-x-3 md:space-x-4">
                          <div className="flex-1 min-w-0 text-left">
                            <h4 className="font-bold text-slate-900 text-xs md:text-sm truncate">{item.name}</h4>
                            <div className="flex items-center space-x-2 mt-0.5">
                              <BackdatedInlinePrice
                                item={item}
                                currency={currency}
                                onUpdatePrice={handleUpdateBackdatedPrice}
                                startEditing={backdatedEditPriceId === item.id}
                                onEditingStarted={() => setBackdatedEditPriceId(null)}
                              />
                              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100/40" title={t('Bei ya kununulia')}>
                                {formatCurrency(item.buy_price, currency)}
                              </span>
                            </div>
                          </div>
                          <BackdatedQtyControl
                            product={product}
                            cartItem={item}
                            updateQty={handleUpdateBackdatedQty}
                            removeFromCart={handleRemoveFromBackdatedCart}
                            showAlert={showAlert}
                          />
                          <button type="button" onClick={() => handleRemoveFromBackdatedCart(item.id)} className="text-rose-500 p-1.5 md:p-2 hover:bg-rose-50 rounded-lg md:rounded-xl transition-all cursor-pointer" aria-label={t('Futa')}>
                            <Trash2 className="w-4 h-4 md:w-5 md:h-5 pointer-events-none" />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* Total and the ways to pay — fixed at the bottom, as on Mauzo */}
            <div className="p-6 md:p-8 bg-white border-t border-slate-200 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] flex-shrink-0">
              <div className="mb-4 md:mb-6 select-none">
                <div className="flex justify-between text-slate-500 font-bold text-[10px] md:text-xs uppercase tracking-widest mb-1">
                  <span>{t('JUMLA YA MALIPO')}</span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-slate-900 font-black text-2xl md:text-3xl" data-testid="backdated-total">{formatCurrency(backdatedSaleTotal, currency)}</span>
                  <span className="text-slate-400 text-[10px] md:text-xs font-bold mb-1">{t('{reduce} Bidhaa', { reduce: lineCount })}</span>
                </div>
              </div>

              {!onCredit ? (
                <div className="flex flex-col space-y-3">
                  <button
                    type="button"
                    onClick={() => handleCompleteBackdatedSale('cash')}
                    disabled={backdatedSaleCart.length === 0 || busy}
                    className="w-full bg-emerald-600 disabled:bg-slate-200 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all flex items-center justify-center space-x-2 px-2 text-sm cursor-pointer disabled:cursor-not-allowed"
                  >
                    {busy ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                    <span className="truncate">{t('Kamilisha (Cash)')}</span>
                  </button>
                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onClick={() => { setBackdatedPaymentMethod('credit'); setBackdatedIsCheckout(true); }}
                      disabled={backdatedSaleCart.length === 0 || busy}
                      className="flex-1 bg-amber-500 disabled:bg-slate-200 text-white font-bold py-4 rounded-2xl shadow-lg shadow-amber-500/20 hover:bg-amber-600 transition-all flex items-center justify-center space-x-2 text-sm cursor-pointer disabled:cursor-not-allowed"
                    >
                      <CreditCard className="w-4 h-4" />
                      <span className="truncate">{t('Uza kwa Mkopo')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCompleteBackdatedSale('mobile_money')}
                      disabled={backdatedSaleCart.length === 0 || busy}
                      className="flex-1 bg-blue-600 disabled:bg-slate-200 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all flex items-center justify-center space-x-2 text-sm cursor-pointer disabled:cursor-not-allowed"
                    >
                      {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                      <span className="truncate">{t('Lipa kwa Simu')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex space-x-3 select-none">
                  <button
                    type="button"
                    onClick={() => { setBackdatedIsCheckout(false); setBackdatedPaymentMethod('cash'); }}
                    className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 md:py-4 rounded-xl md:rounded-2xl hover:bg-slate-200 transition-colors text-sm md:text-base cursor-pointer"
                  >
                    {t('Ghairi')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCompleteBackdatedSale('credit')}
                    disabled={!backdatedCustomerName.trim() || busy}
                    className="flex-[2] bg-emerald-600 disabled:bg-slate-200 text-white font-bold py-3 md:py-4 rounded-xl md:rounded-2xl shadow-xl shadow-emerald-600/20 hover:bg-emerald-700 transition-all flex items-center justify-center space-x-2 md:space-x-3 text-sm md:text-base cursor-pointer disabled:cursor-not-allowed"
                  >
                    {busy ? <RefreshCw className="w-5 h-5 md:w-6 md:h-6 animate-spin" /> : <CheckCircle className="w-5 h-5 md:w-6 md:h-6" />}
                    <span>{busy ? t('Inasindika...') : t('Hifadhi Mkopo')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}


      {/* ================= BACKDATED EXPENSE MODAL ================= */}
      {showBackdatedExpenseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-gray-100 flex flex-col animate-in fade-in zoom-in-95 duration-150 text-left">
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 shadow-sm">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900 leading-tight">{t('Matumizi ya Siku za Nyuma')}</h3>
                  <p className="text-xs text-gray-500 font-medium">{t('Sajili matumizi yaliyopita kwenye tarehe husika')}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowBackdatedExpenseModal(false)}
                className="p-1.5 rounded-lg bg-gray-50 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors active:scale-95"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form controls */}
            <div className="py-4 space-y-4">
              
              {/* Backdated Date picker */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 flex items-center">
                  <Calendar className="w-3.5 h-3.5 mr-1 text-orange-500" /> {t('Tarehe ya Matumizi ya Nyuma *')}
                </label>
                <input
                  type="date"
                  value={backdatedExpenseDate}
                  onChange={(e) => setBackdatedExpenseDate(e.target.value)}
                  max={format(new Date(nowIso()), 'yyyy-MM-dd')}
                  className="w-full bg-gray-50 p-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                />
              </div>

              {/* Expense Amount with dynamic thousands separator formatting */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 flex items-center">
                  <Tag className="w-3.5 h-3.5 mr-1 text-orange-500" /> {t('Kiasi cha Matumizi ({currency}) *', { currency })}
                </label>
                <input
                  type="text"
                  placeholder={t('Mfano: 15,000')}
                  value={backdatedExpenseAmount}
                  onChange={(e) => setBackdatedExpenseAmount(formatInputNumber(e.target.value))}
                  className="w-full bg-gray-50 p-3 rounded-xl border border-gray-200 text-sm font-black text-gray-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                />
                {backdatedExpenseAmount && (
                  <p className="text-[10px] text-orange-600 font-bold mt-1 pl-1">
                    {t('Value: {formatCurrency}', { formatCurrency: formatCurrency(parseInputNumber(backdatedExpenseAmount), currency) })}
                  </p>
                )}
              </div>

              {/* Expense Category Choice */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  {t('Kundi la Matumizi (Kundi) *')}
                </label>
                <select
                  value={backdatedExpenseCategory}
                  onChange={(e) => setBackdatedExpenseCategory(e.target.value)}
                  className="w-full bg-gray-50 p-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                >
                  <option value="Kodi ya pango">{t('Kodi ya Pango / Fremu')}</option>
                  <option value="Maji ya duka">{t('Maji na Usafi')}</option>
                  <option value="Umeme wa duka">{t('Umeme / LUKU')}</option>
                  <option value="Mikopo & riba">{t('Kurejesha Mikopo / Riba')}</option>
                  <option value="Usafiri & mizigo">{t('Usafiri, Nauli, Kubeba Mizigo')}</option>
                  <option value="Chakula & vinywaji">{t('Chakula na Vinywaji vya duka')}</option>
                  <option value="Mishahara ya duka">{t('Mishahara na Posho za Wafanyakazi')}</option>
                  <option value="Ulinzi & usalama">{t('Ulinzi wa Duka')}</option>
                  <option value="Ukarabati & fanicha">{t('Ukarabati na Vifaa vya duka')}</option>
                  <option value="Kodi ya serikali/Laini">{t('Kodi ya Serikali / TRA, Leseni')}</option>
                  <option value="Mengineyo">{t('Matumizi Mengineyo (Nyingine)')}</option>
                </select>
              </div>

              {/* Expense Description */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  {t('Maelezo kwa Ufupi')}
                </label>
                <textarea
                  placeholder={t('Eleza matumizi haya yalikuwa ya nini kwa utambuzi mzuri...')}
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
                onClick={() => setShowBackdatedExpenseModal(false)}
                disabled={isSubmittingBackdated}
                className="px-5 py-3 bg-gray-50 font-bold rounded-xl text-xs text-gray-600 hover:bg-gray-100 cursor-pointer text-center transition-colors active:scale-95"
              >
                {t('Ghairi')}
              </button>
              <button
                type="button"
                onClick={handleSaveBackdatedExpense}
                disabled={isSubmittingBackdated || !backdatedExpenseAmount}
                className="px-6 py-3 bg-orange-600 hover:bg-orange-700 active:scale-95 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-md shadow-orange-500/10 cursor-pointer transition-all"
              >
                {isSubmittingBackdated ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{t('Inahifadhi...')}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>{t('Hifadhi Matumizi')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
