import { useState, useMemo, useRef, useEffect, useDeferredValue, useCallback } from 'react';
import { useTap } from '../utils/useTap';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Sale, SaleItem } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { getValidStock, isProductStockTracked, isBatchExpired } from '../utils/stock';
import { Plus, Minus, Trash2, Search, ShoppingBag, RefreshCw, Edit2, AlertTriangle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { addDays, format } from 'date-fns';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
// jspdf + autotable are lazy-loaded inside the invoice block below (only used when
// autoInvoice is on) so ~450 kB of PDF code stays out of the initial bundle. App.tsx
// warms this chunk after mount, so it's cached (works offline) before the first receipt.

const PriceInput = ({ item, currency }: { item: any, currency: string }) => {
  const tap = useTap();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(item.sell_price.toString());
  const updateCartItemPrice = useStore(state => state.updateCartItemPrice);

  if (isEditing) {
    return (
      <input
        type="number"
        className="w-24 text-right p-2 border-2 border-blue-500 rounded-xl text-sm font-black outline-none shadow-lg"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const newPrice = parseFloat(value);
          if (!isNaN(newPrice) && newPrice >= 0) {
            updateCartItemPrice(item.id!, newPrice);
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
    <div
      role="button"
      onClick={tap(() => { setIsEditing(true); setValue(item.sell_price.toString()); })}
      onPointerUp={tap(() => { setIsEditing(true); setValue(item.sell_price.toString()); })}
      className="flex items-center bg-blue-50 text-blue-700 px-3 py-2 rounded-xl cursor-pointer active:scale-95  border border-blue-100"
      style={{ touchAction: 'manipulation' }}
    >
      <span className="font-black text-xs mr-2">{formatCurrency(item.sell_price, currency)}</span>
      <Edit2 className="w-3.5 h-3.5 opacity-50" />
    </div>
  );
};

const QtyControl = ({ product, cartItem, updateQty, removeFromCart, showToast, onQtyClick, activeKeypad }: any) => {
  const tap = useTap();
  const isAtMaxStock = cartItem ? cartItem.qty >= product.stock : false;

  const isKeypadActive = activeKeypad && activeKeypad.itemId === product.id;
  const isQtyActive = isKeypadActive && activeKeypad.type === 'qty';
  const displayQty = isQtyActive ? activeKeypad.value || '0' : cartItem.qty;

  return (
    <div className="flex items-center bg-blue-50/50 border border-blue-100 rounded-lg p-0.5 w-full justify-between">
      <button
        onClick={() => {
          if (cartItem.qty > 1) {
            updateQty(product.id!, cartItem.qty - 1);
          } else {
            removeFromCart(product.id!);
          }
        }}
        className="p-1.5 text-blue-600 hover:bg-blue-100/80 rounded cursor-pointer select-none transition-colors active:scale-95"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={tap(() => { if (onQtyClick) onQtyClick(); })}
        onPointerUp={tap(() => { if (onQtyClick) onQtyClick(); })}
        className={`flex-1 text-center py-1 px-1.5 rounded  active:scale-95 text-[11.5px] font-black whitespace-nowrap underline decoration-dashed underline-offset-4 decoration-slate-400 mx-1 ${isQtyActive ? 'text-amber-600 animate-pulse bg-amber-50' : 'text-blue-600 hover:text-blue-700'}`}
      >
        {displayQty}
      </button>
      <button
        onClick={() => {
          if (isAtMaxStock) {
            showToast(`Umeshafikia kikomo cha stock za bidhaa hii.`, 'info');
            return;
          }
          updateQty(product.id!, cartItem.qty + 1);
        }}
        disabled={isAtMaxStock}
        className={`p-1.5 rounded cursor-pointer select-none transition-colors active:scale-95 ${isAtMaxStock ? 'text-blue-200' : 'text-blue-600 hover:bg-blue-100/80'}`}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// The grand-total figure in the cart header, tappable to type a negotiated total for
// the whole cart. Owns its own useTap() (like PriceInput/QtyControl) so opening the
// keypad and the first digit press don't share a debounce window.
const CartTotalButton = ({ displayTotal, activeKeypad, onTotalClick }: any) => {
  const tap = useTap();
  const isTotalActive = activeKeypad && activeKeypad.type === 'total';
  return (
    <button
      onClick={tap(() => { if (onTotalClick) onTotalClick(); })}
      onPointerUp={tap(() => { if (onTotalClick) onTotalClick(); })}
      className={`text-sm font-black rounded px-1 active:scale-95 underline decoration-dashed underline-offset-4 decoration-slate-400 touch-manipulation select-none ${isTotalActive ? 'text-amber-600 animate-pulse bg-amber-50' : 'text-slate-800'}`}
      title="Gusa kubadili jumla ya mauzo"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      TZS {displayTotal.toLocaleString()}
    </button>
  );
};

const CartItemRowItem = ({
  item,
  currency,
  onQtyDecrease,
  onQtyIncrease, 
  maxStock,
  onQtyClick,
  onPriceClick,
  activeKeypad
}: { 
  item: any; 
  currency: string; 
  onQtyDecrease?: () => void;
  onQtyIncrease?: () => void;
  maxStock?: number;
  onQtyClick?: () => void;
  onPriceClick?: () => void;
  activeKeypad?: any;
}) => {
  const tap = useTap();
  const removeFromCart = useStore(state => state.removeFromCart);

  // Determine if this item has the keypad active on it
  const isKeypadActive = activeKeypad && activeKeypad.itemId === item.id;
  const isQtyActive = isKeypadActive && activeKeypad.type === 'qty';
  const isPriceActive = isKeypadActive && activeKeypad.type === 'price';

  // Use activeKeypad’s typed value if active, otherwise original value
  const displayQty = isQtyActive ? activeKeypad.value || '0' : item.qty;
  const displayPrice = isPriceActive ? parseFloat(activeKeypad.value || '0') : item.sell_price;

  return (
    <div className={`flex items-center justify-between py-1.5 px-2 bg-slate-50/50 hover:bg-blue-50/20 border rounded-xl  shadow-3xs hover:shadow-2xs ${isKeypadActive ? 'border-amber-400 bg-amber-50/20' : 'border-slate-100'}`}>
      {/* Delete and Name + Qty Indicator (Lean, plenty of room for name & qty) */}
      <div className="flex items-center min-w-0 flex-1 mr-2">
        <button
          onClick={() => removeFromCart(item.id!)}
          className="text-red-400 hover:text-red-500 hover:bg-red-50/60 p-1 mr-1 rounded active:scale-95 shrink-0 transition-colors cursor-pointer"
          title="Futa"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center min-w-0 flex-1 gap-1.5">
          <button
            onClick={tap(() => { if (onQtyClick) onQtyClick(); })}
            onPointerUp={tap(() => { if (onQtyClick) onQtyClick(); })}
            className={`text-[11px] font-black cursor-pointer  active:scale-95 shrink-0 touch-manipulation select-none underline decoration-dashed underline-offset-4 decoration-slate-400 ${isQtyActive ? 'text-amber-600 animate-pulse bg-amber-50 rounded px-0.5' : 'text-blue-600 hover:text-blue-700'}`}
            title="Kubadili idadi"
           style={{ WebkitTapHighlightColor: 'transparent' }}>
            {displayQty}x
          </button>
          <span className="font-extrabold text-slate-800 truncate text-[11.5px] leading-tight" title={item.name}>
            {item.name}
          </span>
        </div>
      </div>

      {/* Price Area: Click to Edit (Comfortable width, text-right, super clean) */}
      <div className="shrink-0 flex items-center justify-end ml-2">
        <button
          onClick={tap(() => { if (onPriceClick) onPriceClick(); })}
          onPointerUp={tap(() => { if (onPriceClick) onPriceClick(); })}
          className={`text-right cursor-pointer py-1 px-1.5 rounded  active:scale-95 text-[11.5px] font-black whitespace-nowrap underline decoration-dashed underline-offset-4 decoration-slate-400 ${isPriceActive ? 'text-amber-600 animate-pulse bg-amber-50' : 'text-blue-600 hover:text-blue-700'}`}
          title="Gusa kubadili bei au kuweka punguzo"
         style={{ WebkitTapHighlightColor: 'transparent' }}>
          {formatCurrency(isQtyActive ? (parseInt(displayQty, 10) || 0) * item.sell_price : item.qty * displayPrice, currency)}
        </button>
      </div>
    </div>
  );
};

export default function Kikapu() {
  const tap = useTap();
  const user = useStore(state => state.user);
  const settings = useLiveQuery(() => db.settings.get(1));
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const currency = settings?.currency || 'TZS';
  const isExpiryEnabled = shop?.enable_expiry === true;
  const [search, setSearch] = useState('');
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [activeKeypad, setActiveKeypad] = useState<{
    itemId: string;
    type: 'qty' | 'price' | 'total';
    name: string;
    value: string;
    maxStock?: number;
    isFirstOverride?: boolean;
  } | null>(null);

  const [blockClicks, setBlockClicks] = useState(false);

  const closeKeypadAndBlockClicks = () => {
    setActiveKeypad(null);
    setBlockClicks(true);
    setTimeout(() => {
      setBlockClicks(false);
    }, 350);
  };

  // Single source of truth for writing a keypad value into the cart. Used by every
  // commit path: the field-switch flush, the ↓/✓ keys, MKOPO, and the direct UZA sale.
  const commitKeypad = (kp: typeof activeKeypad) => {
    if (!kp) return;
    const store = useStore.getState();
    if (kp.type === 'qty') {
      const parsed = parseInt(kp.value || '1', 10);
      store.updateQty(kp.itemId, Math.max(1, isNaN(parsed) ? 1 : parsed));
    } else if (kp.type === 'price') {
      const parsed = parseFloat(kp.value || '0');
      if (!isNaN(parsed) && parsed >= 0) store.updateCartItemPrice(kp.itemId, parsed);
    } else if (kp.type === 'total') {
      // Negotiated grand total: spread it across every line proportionally so each
      // line's sell_price stays truthful (profit, inventory and discount logs all read
      // from it) and Σ(qty × price) equals the typed total exactly.
      const target = parseFloat(kp.value || '0');
      if (!isNaN(target) && target >= 0) {
        const currentSum = store.cart.reduce((s, it) => s + it.sell_price * it.qty, 0);
        if (currentSum > 0) {
          const ratio = target / currentSum;
          store.cart.forEach(it => store.updateCartItemPrice(it.id!, it.sell_price * ratio));
        }
      }
    }
  };

  const openKeypad = (config: any) => {
    // Flush whatever the currently-open keypad has pending into the cart BEFORE switching
    // fields — otherwise the value typed into the old field (qty/price/total) is discarded
    // and snaps back to the stored value, because each field re-seeds from the committed cart.
    if (activeKeypad) commitKeypad(activeKeypad);
    setActiveKeypad(config);
  };

  const handleKeypadPress = (key: string) => {
    setActiveKeypad(prev => {
      if (!prev) return null;
      let newVal = prev.value;
      
      if (prev.isFirstOverride) {
        newVal = key === '00' || key === '000' ? '0' : key;
      } else if (newVal === '0') {
        if (key !== '0' && key !== '00' && key !== '000') {
          newVal = key;
        }
      } else {
        newVal = newVal + key;
      }

      if ((prev.type === 'price' || prev.type === 'total') && newVal.length > 10) {
        return prev;
      }

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
  const deferredSearch = useDeferredValue(search);
  const { cart, cartDeletionCount, resetCartDeletionCount, addToCart, removeFromCart, updateQty, updateCartItemPrice, clearCart, cartTotal, cartProfit, showAlert, showConfirm, showToast } = useStore();

  // Total that reflects the value being typed on the keypad right now — the cart line already
  // previews it via activeKeypad, so the header total must match. Falls back to cartTotal().
  const displayCartTotal = (activeKeypad && activeKeypad.type === 'total')
    ? (parseFloat(activeKeypad.value || '0') || 0) // previewing a negotiated grand total being typed
    : cart.reduce((sum, item) => {
        let qty = item.qty;
        let price = item.sell_price;
        if (activeKeypad && activeKeypad.itemId === item.id) {
          if (activeKeypad.type === 'qty') qty = parseInt(activeKeypad.value || '0', 10) || 0;
          else if (activeKeypad.type === 'price') price = parseFloat(activeKeypad.value || '0') || 0;
        }
        return sum + price * qty;
      }, 0);
  
  useEffect(() => {
    if (cartDeletionCount >= 5) {
      // Log anomaly for excessive cart voids
      void SyncService.logAction('anomaly_frequent_voids', {
        employee_name: user?.name || 'Mhudumu',
        warning: `Amefuta bidhaa kikapuni mara ${cartDeletionCount} kwenye muamala mmoja kabla ya mteja kukamilisha malipo.`
      });
      resetCartDeletionCount();
      // Only optional to show a subtle toast, let's just log it quietly
    }
  }, [cartDeletionCount, user?.name, resetCartDeletionCount]);

  const products = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    const searchLower = deferredSearch ? deferredSearch.toLowerCase() : '';
    
    const filtered = await db.products
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .filter(p => {
        if (searchLower && !p.name.toLowerCase().includes(searchLower)) return false;
        const isTracked = isProductStockTracked(p, shop);
        if (!isTracked) return true;
        const validStock = getValidStock(p, isExpiryEnabled);
        // Keep sellable stock, and also products whose stock is entirely locked in expired
        // batches (valid 0 but raw > 0) so they can be shown as disabled "Imeisha muda" cards.
        return validStock > 0 || (isExpiryEnabled && Number(p.stock) > 0);
      })
      .toArray();

    return filtered.map(p => {
      const isTracked = isProductStockTracked(p, shop);
      const validStock = isTracked ? getValidStock(p, isExpiryEnabled) : 999999;
      const isExpiredOut = isTracked && isExpiryEnabled && validStock === 0 && Number(p.stock) > 0;
      return {
        ...p,
        stock: validStock,
        _isTracked: isTracked,
        _expired: isExpiredOut,
      };
    });
  }, [user?.shopId, deferredSearch, isExpiryEnabled, shop]) || [];
  const [isCheckout, setIsCheckout] = useState(false);
  const [isCredit, setIsCredit] = useState(false);
  const [isDiscountMode, setIsDiscountMode] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(300);

  useEffect(() => {
    if (containerRef.current) {
      setListHeight(containerRef.current.offsetHeight);
    }
    const handleResize = () => {
      if (containerRef.current) setListHeight(containerRef.current.offsetHeight);
    };
    window.addEventListener('resize', handleResize);

    const timer = setTimeout(() => {
      if (containerRef.current) setListHeight(containerRef.current.offsetHeight);
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [isCheckout, isDiscountMode, cart.length]);

  const customerData = useLiveQuery(async () => {
    if (!user?.shopId) return { names: [], phones: new Map<string, string>() };
    const customers = new Map<string, string>();
    const phones = new Map<string, string>();
    
    await db.sales
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .reverse()
      .limit(2000) // Only look at the last 2000 sales to save memory
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

  const uniqueCustomers = customerData.names;

  const filteredCustomers = uniqueCustomers.filter(c => 
    c.toLowerCase().includes(customerName.toLowerCase())
  );

  const filteredProducts = useMemo(() => {
    const s = deferredSearch.toLowerCase();
    return products
      .filter(p => {
        if (!p.name) return false;
        // Strict guard: NEVER show or allow products with 0 or negative stock to appear here or be
        // sold (if tracked) — EXCEPT expired-but-in-stock ones, kept to show as disabled cards.
        if (p._isTracked !== false && p.stock <= 0 && !p._expired) return false;

        const nameLower = p.name.toLowerCase();
        if (s && !nameLower.includes(s)) return false;
        if (selectedLetter) {
          if (selectedLetter === '#') {
            return !/^[a-zA-Z]/.test(p.name);
          }
          return nameLower.startsWith(selectedLetter.toLowerCase());
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
  }, [products, deferredSearch, selectedLetter]);

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');



  const handleSelectCustomer = (name: string) => {
    setCustomerName(name);
    setShowSuggestions(false);
    // Try to find the phone number for this customer
    const phone = customerData.phones.get(name.toLowerCase());
    if (phone) {
      setCustomerPhone(phone);
    }
  };

  const handleCompleteSale = async (paymentMethod: 'cash' | 'credit' | 'mobile') => {
    let currentCart = cart;
    let currentCartTotal = cartTotal();
    let currentCartProfit = cartProfit();

    if (activeKeypad) {
      commitKeypad(activeKeypad);
      setActiveKeypad(null);

      const freshState = useStore.getState();
      currentCart = freshState.cart;
      currentCartTotal = freshState.cartTotal();
      currentCartProfit = freshState.cartProfit();
    }

    if (currentCart.length === 0 || !user) return;

    if (currentCartTotal <= 0) {
      showToast('Jumla ya mauzo lazima iwe zaidi ya sifuri.', 'error');
      return;
    }

    if (paymentMethod === 'credit' && !customerName) {
      showToast('Tafadhali weka jina la mteja kwa mauzo ya mkopo.', 'error');
      return;
    }

    // Loss guard: before finalizing, warn the cashier if any line is priced below its buy
    // price, naming exactly which products and how much is being lost. The boss still gets
    // the audit log — this is a live chance to catch a mistyped/over-negotiated price.
    const lossItems = currentCart.filter(it => Number(it.sell_price) < Number(it.buy_price));
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

    const saleId = uuidv4();
    const isCreditSale = paymentMethod === 'credit';

    const sale: Sale = {
      id: saleId,
      shop_id: user.shopId || '',
      user_id: user.id,
      total_amount: currentCartTotal,
      total_profit: currentCartProfit,
      is_credit: isCreditSale,
      is_paid: !isCreditSale,
      payment_method: paymentMethod,
      status: isCreditSale ? 'pending' : 'completed',
      customer_name: isCreditSale ? customerName : undefined,
      customer_phone: isCreditSale ? customerPhone : undefined,
      due_date: isCreditSale && dueDate ? new Date(dueDate).toISOString() : undefined,
      date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      isDeleted: 0,
      synced: 0
    };

    const saleItems: SaleItem[] = currentCart.map(item => ({
      id: uuidv4(),
      sale_id: saleId,
      shop_id: user.shopId || '',
      product_id: item.id!,
      product_name: item.name,
      qty: item.qty,
      buy_price: item.buy_price,
      sell_price: item.sell_price,
      created_at: new Date().toISOString(),
      isDeleted: 0,
      synced: 0
    }));

    const discountsToLog: any[] = [];
    const anomaliesHeavyDiscountToLog: any[] = [];
    let fakeDebtAnomalyDetails: object | null = null;

    try {
      // Update stock and save sale atomically
      await db.transaction('rw', db.products, db.sales, db.saleItems, async () => {
        // Final stock check from local DB INSIDE transaction to prevent race conditions
        for (const item of currentCart) {
          const dbProduct = await db.products.get(item.id!);
          const isTracked = isProductStockTracked(dbProduct, shop);
          const validStock = dbProduct ? getValidStock(dbProduct, isExpiryEnabled) : 0;
          if (isTracked && (!dbProduct || validStock < item.qty)) {
            throw new Error(`Bidhaa "${item.name}" haina stock ya kutosha. Stock iliyopo: ${validStock}`);
          }
          
          if (dbProduct && Number(item.sell_price) < Number(dbProduct.sell_price)) {
            discountsToLog.push({
              product_id: item.id,
              name: item.name,
              original_price: Number(dbProduct.sell_price) * item.qty,
              discounted_price: Number(item.sell_price) * item.qty,
              qty: item.qty
            });

            // Anomaly Check: Sold below buy_price OR discount > 20%
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

        await db.sales.add(sale);
        TelemetryService.trackSale(sale.payment_method, sale.total_amount, currentCart.length);
        
        if (isCreditSale) {
          const nameWords = customerName.trim().split(/\s+/).length;
          const totalCartAmt = currentCartTotal;
          
          // Anomaly: Large debt sale to vaguely named customer with no phone
          if (totalCartAmt > 10000 && (!customerPhone || customerPhone.trim().length < 9) && nameWords <= 1) {
            fakeDebtAnomalyDetails = {
              sale_id: saleId,
              amount: totalCartAmt,
              employee_name: user?.name || 'Mhudumu',
              customer_name: customerName,
              warning: `Mauzo ya deni kubwa (${currentCartTotal.toLocaleString()}) kwa mteja asiye na namba ya simu kamili au jina linaloeleweka (${customerName}). Hii inahitaji ukaguzi kuzuia mtaji kufichwa kwenye madeni hewa.`
            };
          }
        }

        await db.saleItems.bulkAdd(saleItems);

        for (const item of currentCart) {
          const product = await db.products.get(item.id!);
          if (product) {
            const isTracked = isProductStockTracked(product, shop);
            if (isTracked) {
              let remainingQtyToDeduct = Number(item.qty);
              let updatedBatches = product.batches ? JSON.parse(JSON.stringify(product.batches)) : [];

              // Sort batches by expiry date (ascending, oldest first). Batches without expiry go last.
              updatedBatches.sort((a: any, b: any) => {
                if (!a.expiry_date) return 1;
                if (!b.expiry_date) return -1;
                return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
              });

              // Deduct from batches
              for (let i = 0; i < updatedBatches.length; i++) {
                if (remainingQtyToDeduct <= 0) break;
                
                const batch = updatedBatches[i];

                // Skip expired batches (valid through the end of the expiry day)
                if (isBatchExpired(batch.expiry_date)) continue;

                if (batch.stock > 0) {
                  const deductAmount = Math.min(Number(batch.stock), remainingQtyToDeduct);
                  batch.stock = Number(batch.stock) - deductAmount;
                  remainingQtyToDeduct -= deductAmount;
                }
              }

              // Remove empty batches
              updatedBatches = updatedBatches.filter((b: any) => Number(b.stock) > 0);

              let newStock = Math.max(0, Number(product.stock) - Number(item.qty));
              if (shop?.enable_expiry) {
                const totalBatchStock = updatedBatches.reduce((sum: number, b: any) => sum + Number(b.stock), 0);
                const originalTotalBatchStock = (product.batches || []).reduce((sum: number, b: any) => sum + Number(b.stock), 0);
                const unbatchedStock = Math.max(0, Number(product.stock) - originalTotalBatchStock);
                
                const deductedFromBatches = originalTotalBatchStock - totalBatchStock;
                const deductedFromUnbatched = Math.max(0, Number(item.qty) - deductedFromBatches);
                const remainingUnbatched = Math.max(0, unbatchedStock - deductedFromUnbatched);
                
                newStock = totalBatchStock + remainingUnbatched;
              }

              await db.products.update(product.id!, { 
                stock: newStock,
                stock_delta: (product.stock_delta || 0) - Number(item.qty),
                batches: updatedBatches,
                updated_at: new Date().toISOString(),
                synced: 0
              });
            }
          }
        }
      });

      if (fakeDebtAnomalyDetails) {
        await SyncService.logAction('anomaly_fake_debt', fakeDebtAnomalyDetails);
      }

      if (discountsToLog.length > 0) {
        const totalOriginalPrice = discountsToLog.reduce((sum, d) => sum + d.original_price, 0);
        const totalDiscountedPrice = discountsToLog.reduce((sum, d) => sum + d.discounted_price, 0);
        const totalQty = discountsToLog.reduce((sum, d) => sum + d.qty, 0);
        const productNames = discountsToLog.map(d => d.name).join(', ');

        await SyncService.logAction('discounted_sale', {
          sale_id: saleId,
          number_of_items_sold: totalQty,
          original_price: totalOriginalPrice,
          price_on_discount: totalDiscountedPrice,
          name_of_person_who_sold: user.name || 'Unknown',
          name_of_product: productNames,
          time: sale.created_at
        });
      }
      
      if (anomaliesHeavyDiscountToLog.length > 0) {
        const anomaliesDesc = anomaliesHeavyDiscountToLog.map(d => `${d.name} (Ameuza ${d.discounted_price}, Badala ya ${d.original_price})`).join(', ');
        await SyncService.logAction('anomaly_heavy_discount', {
          sale_id: saleId,
          amount: anomaliesHeavyDiscountToLog.reduce((sum, d) => sum + d.discounted_price, 0),
          employee_name: user?.name || 'Mhudumu',
          details: anomaliesHeavyDiscountToLog,
          warning: `Amepunguza bei ya kuuzia kwa kiasi kikubwa sana au kuuza chini ya bei halisi ya kununulia (bei ya mzigo stoo). Bidhaa: ${anomaliesDesc}`
        });
      }

      // Generate Invoice if enabled
      if (settings?.autoInvoice) {
        try {
          const { default: JsPDF } = await import('jspdf');
          const { default: autoTable } = await import('jspdf-autotable');
          const doc = new JsPDF();
          
          const primaryColor: [number, number, number] = [25, 50, 100]; 
          
          // Header
          doc.setFontSize(22);
          doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          doc.setFont("helvetica", "bold");
          doc.text(shop?.name || settings.shopName || 'Shop', 14, 20);
          
          doc.setFontSize(14);
          doc.setTextColor(100, 100, 100);
          doc.setFont("helvetica", "normal");
          doc.text("INVOICE / RISITI", 14, 28);
          
          doc.setFontSize(10);
          doc.text(`Tarehe: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 35);
          doc.text(`Namba ya Risiti: ${saleId.split('-')[0].toUpperCase()}`, 14, 40);
          if (isCreditSale && customerName) {
            doc.text(`Mteja: ${customerName}`, 14, 45);
          }
          
          doc.setDrawColor(200, 200, 200);
          doc.line(14, 50, 196, 50);

          const tableData = currentCart.map(item => [
            item.name,
            item.qty.toString(),
            formatCurrency(item.sell_price, currency),
            formatCurrency(item.qty * item.sell_price, currency)
          ]);

          autoTable(doc, {
            head: [['Bidhaa', 'Idadi', 'Bei', 'Jumla']],
            body: tableData,
            startY: 55,
            theme: 'striped',
            headStyles: { fillColor: primaryColor, textColor: 255 },
          });

          const finalY = (doc as any).lastAutoTable.finalY + 10;
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(0, 0, 0);
          doc.text(`Jumla Kuu: ${formatCurrency(currentCartTotal, currency)}`, 14, finalY);

          if (isCreditSale) {
            doc.setTextColor(220, 38, 38);
            doc.text(`Aina: Mkopo (Halijalipwa)`, 14, finalY + 7);
          } else {
            doc.setTextColor(22, 163, 74);
            doc.text(`Aina: Taslimu (Limelipwa)`, 14, finalY + 7);
          }

          doc.setFontSize(10);
          doc.setTextColor(100, 100, 100);
          doc.setFont("helvetica", "italic");
          doc.text("Asante kwa kufanya biashara na sisi!", 14, finalY + 20);

          doc.save(`Invoice_${saleId.substring(0, 8)}.pdf`);
        } catch (pdfErr) {
          console.error("Failed to generate PDF invoice:", pdfErr);
        }
      }

      clearCart();
      setIsDiscountMode(false);
      setIsCheckout(false);
      setIsCredit(false);
      setCustomerName('');
      setCustomerPhone('');
      setDueDate('');
      
      SyncService.sync();
      showToast('Sale yamefanikiwa!', 'success');
    } catch (error: any) {
      showAlert('Kosa', 'Kuna tatizo: ' + error.message);
    }
  };

  if (isCheckout) {
    return (
      <div className="p-4 flex flex-col h-full bg-white">
        <div className="flex items-center mb-6">
          <button onClick={tap(() => setIsCheckout(false))} onPointerUp={tap(() => setIsCheckout(false))} className="text-blue-600 font-medium mr-4">Nyuma</button>
          <h1 className="text-xl font-bold text-gray-800">Taarifa za Mkopo</h1>
        </div>

        <div className="bg-orange-50 p-6 rounded-2xl border border-orange-100 mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-orange-800 font-medium">Jumla ya Deni:</span>
            <span className="text-3xl font-bold text-orange-900">{formatCurrency(displayCartTotal, currency)}</span>
          </div>
          <div className="text-sm text-orange-600">Idadi ya bidhaa: {cart.reduce((a, b) => a + b.qty, 0)}</div>
        </div>

        <div className="space-y-6 flex-1">
          <div className="relative">
            <label className="block text-sm font-bold text-gray-700 mb-2">Jina la Mteja</label>
            <input 
              required 
              value={customerName} 
              onChange={e => {
                setCustomerName(e.target.value);
                setShowSuggestions(true);
              }} 
              onFocus={() => setShowSuggestions(true)}
              placeholder="Andika jina la mteja..."
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" 
            />
            {showSuggestions && filteredCustomers.length > 0 && customerName && (
              <div className="absolute z-10 w-full bg-white mt-1 border border-gray-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto">
                {filteredCustomers.map(c => (
                  <button
                    key={c}
                    onClick={tap(() => handleSelectCustomer(c))}
                    onPointerUp={tap(() => handleSelectCustomer(c))}
                    className="w-full text-left p-4 border-b border-gray-100 last:border-0 text-sm font-medium"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Namba ya Simu</label>
            <input 
              type="tel" 
              value={customerPhone} 
              onChange={e => setCustomerPhone(e.target.value)} 
              placeholder="Mfano: 0787..."
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" 
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Tarehe ya Kulipa</label>
            <input 
              type="date" 
              value={dueDate} 
              onChange={e => setDueDate(e.target.value)} 
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" 
            />
          </div>
        </div>

        <button
          onClick={tap(() => handleCompleteSale('credit'))}
          onPointerUp={tap(() => handleCompleteSale('credit'))}
          disabled={!customerName}
          className="w-full bg-orange-600 disabled:bg-gray-400 text-white font-bold py-5 rounded-2xl mt-6 shadow-xl text-lg flex items-center justify-center space-x-2"
        >
          <span>Kamilisha Mkopo</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 relative overflow-hidden">
      {/* Product Discovery Mode */}
      <div 
        className="flex-1 p-4 overflow-y-auto overflow-x-hidden pb-16 scrollbar-hide space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Tafuta bidhaa..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500 outline-none text-xs"
            />
          </div>
        </div>

        <div className="flex overflow-x-auto pb-1 scrollbar-hide space-x-1.5">
          <button
            onClick={tap(() => setSelectedLetter(null))}
            onPointerUp={tap(() => setSelectedLetter(null))}
            className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[10.5px] font-black  cursor-pointer ${!selectedLetter ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
          >
            All
          </button>
          {alphabet.map(letter => (
            <button
              key={letter}
              onClick={tap(() => setSelectedLetter(selectedLetter === letter ? null : letter))}
              onPointerUp={tap(() => setSelectedLetter(selectedLetter === letter ? null : letter))}
              className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[10.5px] font-black  cursor-pointer ${selectedLetter === letter ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
            >
              {letter}
            </button>
          ))}
        </div>
        
        {/* Selected Items area at the top pushing the list down */}
        {cart.length > 0 && (
          <div className={cart.length <= 3 ? "sticky z-20 bg-gray-50 pb-2 space-y-1.5 -mx-4 px-4" : "space-y-1.5"} style={{ top: cart.length <= 3 ? '-16px' : 'auto', paddingTop: cart.length <= 3 ? '16px' : '0' }}>
            <div className="bg-white border border-gray-150 rounded-2xl p-2.5 shadow-xs flex flex-col shrink-0 animate-in fade-in duration-200">
              {/* Box Top Header */}
              <div className="flex items-center justify-between pb-1.5 border-b border-gray-100 mb-1.5 px-1">
                <div className="flex items-baseline space-x-2">
                  <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Total:</span>
                  <CartTotalButton
                    displayTotal={displayCartTotal}
                    activeKeypad={activeKeypad}
                    onTotalClick={() => {
                      const currentSum = useStore.getState().cart.reduce((s, it) => s + it.sell_price * it.qty, 0);
                      openKeypad({
                        itemId: '__cart_total__',
                        type: 'total',
                        name: 'Jumla',
                        value: Math.round(currentSum).toString(),
                        isFirstOverride: true,
                      });
                    }}
                  />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    ({cart.reduce((a, b) => a + b.qty, 0)} Bidhaa)
                  </span>
                </div>
                <button
                  onClick={tap(() => {
                    clearCart();
                    setBlockClicks(true);
                    setTimeout(() => setBlockClicks(false), 350);
                  })}
                  onPointerUp={tap(() => {
                    clearCart();
                    setBlockClicks(true);
                    setTimeout(() => setBlockClicks(false), 350);
                  })}
                  className="text-[10px] font-black text-red-500 uppercase tracking-wider px-3 py-1.5 active:scale-95 cursor-pointer hover:bg-red-50 rounded touch-manipulation select-none"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  Futa Vyote
                </button>
              </div>

              {/* Column Headers at top as requested */}
              <div className="flex items-center justify-between px-1.5 py-0.5 text-[9px] font-extrabold text-gray-400 uppercase tracking-wider border-b border-gray-100 mb-1 shrink-0">
                <div className="flex-1">Bidhaa</div>
                <div className="text-right">Bei / Punguzo</div>
              </div>

              <div className="space-y-1.5 flex flex-col mt-1">
                {cart.map((item) => {
                  const productObj = products.find(p => p.id === item.id);
                  const isTracked = productObj ? isProductStockTracked(productObj, shop) : true;
                  const maxStock = productObj && isTracked ? productObj.stock : 999999;
                  return (
                    <CartItemRowItem 
                      key={item.id} 
                      item={item} 
                      currency={currency} 
                      activeKeypad={activeKeypad} 
                      onQtyDecrease={() => {
                        if (item.qty > 1) {
                          updateQty(item.id!, item.qty - 1);
                        } else {
                          removeFromCart(item.id!);
                        }
                      }}
                      onQtyIncrease={() => {
                        if (item.qty < maxStock) {
                          updateQty(item.id!, item.qty + 1);
                        } else {
                          showToast(`Umeshafikia kikomo cha stock za bidhaa hii.`, 'info');
                        }
                      }}
                      onQtyClick={() => {
                        openKeypad({
                          itemId: item.id!,
                          type: 'qty',
                          name: item.name,
                          value: item.qty.toString(),
                          maxStock,
                          isFirstOverride: true
                        });
                      }}
                      onPriceClick={() => {
                        openKeypad({
                          itemId: item.id!,
                          type: 'price',
                          name: item.name,
                          value: item.sell_price.toString(),
                          isFirstOverride: true
                        });
                      }}
                      maxStock={maxStock}
                    />
                  );
                })}
              </div>
            </div>

            {/* Combined checkout buttons directly beneath the list (3 buttons layout - wrapped responsive to magnification) */}
            <div className="flex flex-wrap gap-1.5 shrink-0">
              <button
                onClick={tap(() => {
                  if (activeKeypad) {
                    commitKeypad(activeKeypad);
                    setActiveKeypad(null);
                  }
                  setIsCheckout(true);
                })}
                onPointerUp={tap(() => {
                  if (activeKeypad) {
                    commitKeypad(activeKeypad);
                    setActiveKeypad(null);
                  }
                  setIsCheckout(true);
                })}
                className="bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl font-extrabold text-[10px] tracking-tight active:scale-95 shadow-xs flex flex-col items-center justify-center cursor-pointer select-none touch-manipulation flex-1 min-w-[85px]"
                title="Sajili kama mauzo ya mkopo"
              >
                <span>MKOPO</span>
              </button>
              <button
                onClick={tap(() => handleCompleteSale('mobile'))}
                onPointerUp={tap(() => handleCompleteSale('mobile'))}
                className="bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-extrabold text-[10px] tracking-tight active:scale-95 shadow-xs flex flex-col items-center justify-center cursor-pointer select-none touch-manipulation flex-1 min-w-[85px]"
                title="Lipa kwa njia ya Mtandao wa Simu (M-Pesa, TigoPesa, AirtelMoney, n.k.)"
              >
                <span>UZA (SIMU/BANK)</span>
              </button>
              <button
                onClick={tap(() => handleCompleteSale('cash'))}
                onPointerUp={tap(() => handleCompleteSale('cash'))}
                className="bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-extrabold text-[10px] tracking-tight active:scale-95 shadow-xs flex flex-col items-center justify-center cursor-pointer select-none touch-manipulation flex-1 min-w-[85px]"
                title="Kamilisha mauzo ya pesa taslimu (Cash)"
              >
                <span>UZA (CASH)</span>
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 mt-2 overflow-y-auto pb-24 scrollbar-hide px-1" ref={containerRef}>
          {isDiscountMode ? (
            cart.length > 0 ? (
              <div className="h-full overflow-y-auto w-full pb-20 scrollbar-hide">
                {cart.map((item) => {
                  const product = products.find(p => p.id === item.id);
                  const isTracked = product ? isProductStockTracked(product, shop) : true;
                  const maxStock = product && isTracked ? product.stock : 999999;
                  return (
                    <CartItemRowItem 
                      key={item.id} 
                      item={item} 
                      currency={currency} 
                      activeKeypad={activeKeypad}
                      onQtyClick={() => {
                        openKeypad({
                          itemId: item.id!,
                          type: 'qty',
                          name: item.name,
                          value: item.qty.toString(),
                          maxStock,
                          isFirstOverride: true
                        });
                      }}
                      onPriceClick={() => {
                        openKeypad({
                          itemId: item.id!,
                          type: 'price',
                          name: item.name,
                          value: item.sell_price.toString(),
                          isFirstOverride: true
                        });
                      }}
                      maxStock={maxStock}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-gray-500 py-12">
                <ShoppingBag className="w-12 h-12 text-gray-100 mx-auto mb-4" />
                <p className="font-bold">Mauzo yako tupu</p>
                <button
                  onClick={tap(() => setIsDiscountMode(false))}
                  onPointerUp={tap(() => setIsDiscountMode(false))}
                  className="text-blue-600 text-xs mt-2 underline"
                >
                  Rudi kuongeza bidhaa
                </button>
              </div>
            )
          ) : filteredProducts.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 pb-8">
              {filteredProducts.map(product => {
                const cartItem = cart.find(item => item.id === product.id);
                const isTracked = isProductStockTracked(product, shop);
                const isExpired = product._expired === true;
                const isAtMaxStock = isTracked && cartItem ? cartItem.qty >= product.stock : false;
                const inCart = !!cartItem;

                return (
                  <div
                    key={product.id}
                    className={`bg-white p-2.5 rounded-xl border flex flex-col justify-between  h-[74px] shadow-xs ${isExpired ? 'border-rose-200 bg-rose-50/40 opacity-70' : inCart ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-100'} ${isAtMaxStock ? 'opacity-90' : ''}`}
                  >
                    <div
                      className={`min-w-0 ${isExpired ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                      onClick={() => {
                        if (isExpired) {
                          showToast('Bidhaa hii imeisha muda, haiwezi kuuzwa.', 'info');
                          return;
                        }
                        if (isTracked && product.stock <= 0) {
                          showToast(`Bidhaa ${product.name} haina stoki kwa sasa.`, 'error');
                          return;
                        }
                        if (isAtMaxStock) {
                          showToast(`Umeshafikia kikomo cha stock kwa ${product.name}`, 'info');
                          return;
                        }
                        addToCart(product);
                      }}
                    >
                      <h3 className="font-bold text-gray-900 text-[12px] leading-tight line-clamp-1 tracking-tight">{product.name}</h3>
                      <div className={`text-[10px] font-bold mt-0.5 ${isExpired ? 'text-rose-400 line-through' : 'text-blue-600'}`}>
                        {formatCurrency(product.sell_price, currency)}
                      </div>
                    </div>

                    <div className="flex justify-between items-center mt-0">
                      {isExpired ? (
                        <div className="flex items-center text-[9px] font-bold text-rose-600">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Imeisha muda
                        </div>
                      ) : inCart ? (
                        <QtyControl
                          product={{ ...product, stock: isTracked ? product.stock : 999999 }} 
                          cartItem={cartItem} 
                          updateQty={updateQty} 
                          removeFromCart={removeFromCart} 
                          showToast={showToast} 
                          activeKeypad={activeKeypad}
                          onQtyClick={() => {
                            openKeypad({
                              itemId: product.id!,
                              type: 'qty',
                              name: product.name,
                              value: cartItem.qty.toString(),
                              maxStock: isTracked ? product.stock : 999999,
                              isFirstOverride: true
                            });
                          }}
                        />
                      ) : (
                        <div className="text-[9px] text-gray-400 font-medium">
                          {isTracked ? `Stoki: ${product.stock}` : 'Sio lazima stoki'}
                        </div>
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
              <p className="text-xs text-gray-400">Jaribu neno lingine ama ungeza bidhaa mpya</p>
            </div>
          )}
        </div>
      </div>

      {/* Unique Custom Small-Sized On-Screen Numeric Keypad Overlay - No fog/backdrop */}
      {activeKeypad && (
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="bg-slate-900 border-t border-slate-800 shadow-[0_-15px_40px_rgba(0,0,0,0.45)] flex flex-col p-2.5 rounded-t-3xl rounded-b-none w-full max-w-md pointer-events-auto">
            {/* Keypad numbers grid in requested 4x4 layout */}
            <div className="grid grid-cols-4 gap-1.5">
              {/* Row 1 */}
              <button
                onClick={tap(() => handleKeypadPress('1'))}
                onPointerUp={tap(() => handleKeypadPress('1'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                1
              </button>
              <button
                onClick={tap(() => handleKeypadPress('2'))}
                onPointerUp={tap(() => handleKeypadPress('2'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                2
              </button>
              <button
                onClick={tap(() => handleKeypadPress('3'))}
                onPointerUp={tap(() => handleKeypadPress('3'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                3
              </button>
              <button
                onClick={tap(() => {
                  if (activeKeypad) commitKeypad(activeKeypad);
                  closeKeypadAndBlockClicks();
                })}
                onPointerUp={tap(() => {
                  if (activeKeypad) commitKeypad(activeKeypad);
                  closeKeypadAndBlockClicks();
                })}
                className="h-12 bg-blue-500/20 active:scale-90 text-blue-400 font-black text-[22px] rounded-2xl  border border-blue-500/25 shadow-3xs flex items-center justify-center cursor-pointer select-none"
                title="Funga kibodi"
              >
                ↓
              </button>

              {/* Row 2 */}
              <button
                onClick={tap(() => handleKeypadPress('4'))}
                onPointerUp={tap(() => handleKeypadPress('4'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                4
              </button>
              <button
                onClick={tap(() => handleKeypadPress('5'))}
                onPointerUp={tap(() => handleKeypadPress('5'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                5
              </button>
              <button
                onClick={tap(() => handleKeypadPress('6'))}
                onPointerUp={tap(() => handleKeypadPress('6'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                6
              </button>
              <button
                onClick={tap(() => setActiveKeypad(prev => prev ? { ...prev, value: '' } : null))}
                onPointerUp={tap(() => setActiveKeypad(prev => prev ? { ...prev, value: '' } : null))}
                className="h-12 bg-red-500/20 active:scale-95 text-red-500 font-black text-[13px] rounded-2xl  border border-red-500/20 shadow-3xs flex items-center justify-center cursor-pointer select-none uppercase font-sans tracking-wide"
                title="Futa vyote"
              >
                Clear
              </button>

              {/* Row 3 */}
              <button
                onClick={tap(() => handleKeypadPress('7'))}
                onPointerUp={tap(() => handleKeypadPress('7'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                7
              </button>
              <button
                onClick={tap(() => handleKeypadPress('8'))}
                onPointerUp={tap(() => handleKeypadPress('8'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                8
              </button>
              <button
                onClick={tap(() => handleKeypadPress('9'))}
                onPointerUp={tap(() => handleKeypadPress('9'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                9
              </button>
              <button
                onClick={tap(() => setActiveKeypad(prev => {
                  if (!prev) return null;
                  const newVal = prev.value.slice(0, -1);
                  return { ...prev, value: newVal };
                }))}
                onPointerUp={tap(() => setActiveKeypad(prev => {
                  if (!prev) return null;
                  const newVal = prev.value.slice(0, -1);
                  return { ...prev, value: newVal };
                }))}
                className="h-12 bg-orange-500/20 active:scale-95 text-orange-400 font-extrabold rounded-2xl  border border-orange-500/25 shadow-3xs flex items-center justify-center cursor-pointer select-none"
                title="Futa namba"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                  <line x1="18" y1="9" x2="12" y2="15" />
                  <line x1="12" y1="9" x2="18" y2="15" />
                </svg>
              </button>

              {/* Row 4 */}
              <button
                onClick={tap(() => handleKeypadPress('0'))}
                onPointerUp={tap(() => handleKeypadPress('0'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                0
              </button>
              <button
                onClick={tap(() => handleKeypadPress('00'))}
                onPointerUp={tap(() => handleKeypadPress('00'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                00
              </button>
              <button
                onClick={tap(() => handleKeypadPress('000'))}
                onPointerUp={tap(() => handleKeypadPress('000'))}
                className="h-12 bg-slate-800  text-slate-100 font-extrabold text-[24px] rounded-2xl  active:scale-95 border border-slate-700/60 shadow-inner flex items-center justify-center cursor-pointer select-none"
              >
                000
              </button>
              <button
                onClick={tap(() => {
                  if (activeKeypad) commitKeypad(activeKeypad);
                  closeKeypadAndBlockClicks();
                })}
                onPointerUp={tap(() => {
                  if (activeKeypad) commitKeypad(activeKeypad);
                  closeKeypadAndBlockClicks();
                })}
                className="h-12 bg-emerald-500/20 active:scale-95 text-emerald-400 rounded-2xl  border border-emerald-500/30 shadow-[0_4px_12px_rgba(16,185,129,0.2)] flex items-center justify-center cursor-pointer select-none"
                title="Hifadhi na Funga"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </button>
            </div>
          </div>
        </div>
      )}
      {blockClicks && (
        <div 
          className="fixed inset-0 z-[9999] bg-transparent pointer-events-auto cursor-default" 
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      )}
    </div>
  );
}
