import { useState, useMemo, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { getValidStock, isProductStockTracked, isBatchExpired } from '../utils/stock';
import { useHideStock } from '../hooks/useHideStock';
import { 
  Plus, 
  Minus, 
  Trash2, 
  Search, 
  ShoppingBag, 
  CreditCard, 
  User, 
  Calendar, 
  RefreshCw, 
  CheckCircle2, 
  ArrowLeft, 
  Home, 
  X,
  Smartphone,
  Printer,
  AlertTriangle
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useNavigate } from 'react-router-dom';
import { db, Sale, SaleItem } from '../db';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { printReceipt } from '../utils/receiptPrinter';
import NumberInput from '../components/NumberInput';
import { nowIso } from '../services/clock';

interface CartQtyInputProps {
  item: { id: string; qty: number; stock: number; track_stock?: boolean };
  updateQty: (id: string, qty: number) => void;
}

function CartQtyInput({ item, updateQty }: CartQtyInputProps) {
  const [inputValue, setInputValue] = useState(String(item.qty));

  useEffect(() => {
    setInputValue(String(item.qty));
  }, [item.qty]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    setInputValue(rawVal);

    if (rawVal !== '') {
      const val = parseInt(rawVal);
      if (!isNaN(val) && val > 0) {
        const isStockTracked = item.track_stock !== false;
        const newQty = isStockTracked ? Math.min(val, item.stock) : val;
        updateQty(item.id, newQty);
      }
    }
  };

  const handleBlur = () => {
    const val = parseInt(inputValue);
    if (isNaN(val) || val <= 0) {
      setInputValue('1');
      updateQty(item.id, 1);
    } else {
      const isStockTracked = item.track_stock !== false;
      const fixedQty = isStockTracked ? Math.min(val, item.stock) : val;
      setInputValue(String(fixedQty));
      updateQty(item.id, fixedQty);
    }
  };

  return (
    <NumberInput
      value={inputValue}
      onFocus={(e) => e.target.select()}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-10 md:w-12 text-center font-bold text-slate-900 text-xs md:text-sm bg-transparent border-none focus:ring-0 p-0"
    />
  );
}

export default function Kikapu() {
  const user = useStore(state => state.user);
  const hideStock = useHideStock();
  const showToast = useStore(state => state.showToast);
  const navigate = useNavigate();
  const [shopSettings, setShopSettings] = useState<any>(null);
  const [printReceiptEnabled, setPrintReceiptEnabled] = useState(localStorage.getItem('print_receipt_on_sale') === 'true');
  
  const { cart, addToCart, removeFromCart, updateQty, clearCart, cartTotal, cartProfit, showAlert, cartDeletionCount, resetCartDeletionCount } = useStore();
  
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [isCheckout, setIsCheckout] = useState(false);

  const alphabet = useMemo(() => {
    return ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Frequent Voids (anomaly deletion tracker)
  useEffect(() => {
    if (cartDeletionCount >= 5) {
      void SyncService.logAction('anomaly_frequent_voids', {
        employee_name: user?.name || 'Mhudumu',
        warning: `Amefuta bidhaa kwenye kikapu (Cart Voids) zaidi ya mara ${cartDeletionCount} kwenye huu muamala kabla ya kulipa.`
      });
      resetCartDeletionCount();
    }
  }, [cartDeletionCount, user?.name, resetCartDeletionCount]);

  const [isCredit, setIsCredit] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCartMobile, setShowCartMobile] = useState(false);
  const processingRef = useRef(false);

  const [customTotal, setCustomTotal] = useState<string>('');
  const [showDiscountInput, setShowDiscountInput] = useState(false);
  
  const finalTotalValue = customTotal !== '' && !isNaN(parseInt(customTotal)) ? parseInt(customTotal) : cartTotal();

  useEffect(() => {
    const shopId = user?.shopId || user?.shop_id;
    if (shopId) {
      Promise.all([
        db.settings.get(1),
        db.shops.get(shopId)
      ]).then(([settingsData, shopData]) => {
        setShopSettings({
          ...settingsData,
          ...shopData
        });
      });
    }
  }, [user?.shopId, user?.shop_id]);

  const currency = shopSettings?.currency || 'TZS';

  // Offline-first customers mapping using local IndexedDB
  const customerData = useLiveQuery(async () => {
    const shopId = user?.shopId || user?.shop_id;
    if (!shopId) return { names: [], phones: new Map<string, string>() };
    const customers = new Map<string, string>();
    const phones = new Map<string, string>();
    
    await db.sales
      .where('[shop_id+isDeleted]')
      .equals([shopId, 0])
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
  }, [user?.shopId, user?.shop_id]) || { names: [], phones: new Map() };

  const uniqueCustomers = customerData.names;

  const filteredCustomers = uniqueCustomers.filter(c => 
    c.toLowerCase().includes(customerName.toLowerCase())
  );

  // Optimized product fetching for large datasets using indexed query
  const filteredProducts = useLiveQuery(
    async () => {
      const shopId = user?.shopId || user?.shop_id;
      if (!shopId) return [];
      
      const shop = await db.shops.get(shopId);
      const isExpiryEnabled = shop?.enable_expiry === true;
      const isStockEnabled = shop?.enable_stock !== false;
      
      const activeProducts = await db.products
        .where('[shop_id+isDeleted]')
        .equals([shopId, 0])
        .toArray();
      
      // Map valid stocks correctly and preserve track_stock. `_expired` flags a tracked product
      // that still HAS stock but whose entire valid stock is 0 purely because every batch holding
      // it has expired — we keep those (they'd otherwise be filtered out) to show as disabled cards.
      let filtered = activeProducts.map(p => {
        const isProductTracked = isProductStockTracked(p, shop);
        const validStock = isProductTracked ? getValidStock(p, isExpiryEnabled) : 999999;
        const isExpiredOut = isProductTracked && isExpiryEnabled && validStock === 0 && Number(p.stock) > 0;
        return {
          ...p,
          stock: validStock,
          track_stock: isProductTracked,
          _expired: isExpiredOut,
        };
      }).filter(p => p.track_stock === false || p.stock > 0 || p._expired);
      
      // Filter by search
      if (debouncedSearch.trim()) {
        const s = debouncedSearch.toLowerCase();
        filtered = filtered.filter(p => p.name.toLowerCase().includes(s));
      }

      // Filter by alphabet
      if (selectedLetter) {
        if (selectedLetter === '#') {
          filtered = filtered.filter(p => /^\d/.test(p.name));
        } else {
          filtered = filtered.filter(p => p.name.toUpperCase().startsWith(selectedLetter));
        }
      }

      // Sort results is-starts-with prioritised
      return filtered
        .sort((a, b) => {
          const aName = a.name.toLowerCase();
          const bName = b.name.toLowerCase();
          const s = debouncedSearch.toLowerCase();
          
          const aStarts = aName.startsWith(s);
          const bStarts = bName.startsWith(s);
          
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          
          return aName.localeCompare(bName);
        })
        .slice(0, 100);
    },
    [user?.shopId, user?.shop_id, debouncedSearch, selectedLetter, shopSettings?.enable_expiry, shopSettings?.enable_stock]
  ) || [];

  const handleSelectCustomer = (name: string) => {
    setCustomerName(name);
    setShowSuggestions(false);
    const phone = customerData.phones.get(name.toLowerCase());
    if (phone) {
      setCustomerPhone(phone);
    }
  };

  const handleCompleteSale = async (method: 'cash' | 'credit' | 'mobile_money') => {
    if (cart.length === 0 || !user || isProcessing || processingRef.current) return;
    
    if (method === 'credit' && !customerName) {
      setIsCredit(true);
      setIsCheckout(true);
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);
    const saleId = uuidv4();
    const isCreditSale = method === 'credit';
    const shopId = user?.shopId || user?.shop_id || '';

    try {
      // Use transactional db block for checkout integrity.
      // db.settings is in scope because SyncService.logAction('discounted_sale') is
      // called inside this transaction and reads db.settings during off-hours.
      await db.transaction('rw', [db.products, db.sales, db.saleItems, db.auditLogs, db.settings], async () => {
        // Double check stock availability
        for (const item of cart) {
          const dbProduct = await db.products.get(item.id);
          if (!dbProduct) {
            throw new Error(`Bidhaa "${item.name}" haikupatikana.`);
          }
          const isStockTracked = isProductStockTracked(dbProduct, shopSettings);
          if (isStockTracked) {
            const isExpiryEnabled = shopSettings?.enable_expiry === true;
            const currentStock = getValidStock(dbProduct, isExpiryEnabled);
            if (currentStock < item.qty) {
              throw new Error(`Bidhaa "${item.name}" haina stoki ya kutosha. Stoki iliyopo: ${currentStock}`);
            }
          }
        }

        const totalBuyPrice = cartTotal() - cartProfit();
        const finalProfitVal = finalTotalValue - totalBuyPrice;

        const sale: Sale = {
          id: saleId,
          shop_id: shopId,
          user_id: user.id,
          total_amount: finalTotalValue,
          total_profit: finalProfitVal,
          is_credit: isCreditSale,
          is_paid: !isCreditSale,
          payment_method: method,
          status: isCreditSale ? 'pending' : 'completed',
          customer_name: isCreditSale ? customerName : undefined,
          customer_phone: isCreditSale ? customerPhone : undefined,
          due_date: isCreditSale && dueDate ? new Date(dueDate).toISOString() : undefined,
          date: nowIso(),
          created_at: nowIso(),
          updated_at: nowIso(),
          isDeleted: 0,
          synced: 0
        };

        const saleItems: SaleItem[] = cart.map(item => ({
          id: uuidv4(),
          sale_id: saleId,
          shop_id: shopId,
          product_id: item.id!,
          product_name: item.name,
          qty: item.qty,
          buy_price: item.buy_price,
          sell_price: item.sell_price,
          created_at: nowIso(),
          isDeleted: 0,
          synced: 0
        }));

        // 1. Add Sale
        await db.sales.add(sale);

        // 2. Add Sale Items
        await db.saleItems.bulkAdd(saleItems);

        // 3. Discount Log audits
        const originalTotal = cartTotal();
        if (finalTotalValue < originalTotal) {
          await SyncService.logAction('discounted_sale', {
            sale_id: saleId,
            number_of_items_sold: cart.reduce((sum, item) => sum + item.qty, 0),
            original_price: originalTotal,
            price_on_discount: finalTotalValue,
            name_of_person_who_sold: user?.name,
            name_of_product: cart.map(item => item.name).join(', '),
            time: nowIso()
          });

          // Overall Heavy Discount anomaly check
          const discountPercentage = ((originalTotal - finalTotalValue) / originalTotal) * 100;
          if (discountPercentage > 20) {
            await SyncService.logAction('anomaly_heavy_discount', {
              sale_id: saleId,
              amount: finalTotalValue,
              employee_name: user?.name || 'Mhudumu',
              warning: `Amepunguza bei ya jumla ya kikapu kwa kiasi kikubwa cha asilimia ${discountPercentage.toFixed(1)}% (Kutoka ${originalTotal.toLocaleString()} hadi ${finalTotalValue.toLocaleString()}).`
            });
          }
        }

        // Suspicious Vague customer Fake Debt anomaly check
        if (isCreditSale) {
          const nameWords = customerName.trim().split(/\s+/).length;
          if (finalTotalValue > 10000 && (!customerPhone || customerPhone.replace(/\s+/g, '').length < 9) && nameWords <= 1) {
            await SyncService.logAction('anomaly_fake_debt', {
              sale_id: saleId,
              amount: finalTotalValue,
              employee_name: user?.name || 'Mhudumu',
              customer_name: customerName,
              warning: `Mauzo ya deni kubwa (${finalTotalValue.toLocaleString()}) kwa mteja asiye na namba ya simu kamili au jina linaloeleweka (${customerName}). Hii inahitaji ukaguzi kuzuia mtaji kufichwa kwenye madeni hewa.`
            });
          }
        }

        // 4. Update product stocks FEFO style
        for (const item of cart) {
          const dbProduct = await db.products.get(item.id);
          if (dbProduct) {
            const isStockTracked = isProductStockTracked(dbProduct, shopSettings);
            if (!isStockTracked) {
              continue;
            }

            let remainingQtyToDeduct = item.qty;
            let updatedBatches = dbProduct.batches ? [...dbProduct.batches] : [];

            if (updatedBatches.length === 0 && dbProduct.stock > 0) {
              updatedBatches.push({ id: uuidv4(), batch_number: 'B1', stock: dbProduct.stock, expiry_date: '' });
            }

            // Sort FEFO (old expiry first)
            updatedBatches.sort((a, b) => {
              if (a.expiry_date && b.expiry_date) {
                const dateA = new Date(a.expiry_date).getTime();
                const dateB = new Date(b.expiry_date).getTime();
                if (dateA !== dateB) return dateA - dateB;
              }
              if (a.expiry_date && !b.expiry_date) return -1;
              if (!a.expiry_date && b.expiry_date) return 1;
              return a.id.localeCompare(b.id);
            });

            // Deduct Stocks (skip expired batches — those goods aren't sold)
            for (let i = 0; i < updatedBatches.length; i++) {
              if (remainingQtyToDeduct <= 0) break;
              const batch = updatedBatches[i];
              if (isBatchExpired(batch.expiry_date)) continue;

              if (batch.stock > 0) {
                const deductAmount = Math.min(batch.stock, remainingQtyToDeduct);
                batch.stock -= deductAmount;
                remainingQtyToDeduct -= deductAmount;
              }
            }

            // Drop sold-out batches so empty entries don't pile up over time (which would
            // otherwise inflate the expiry counts). Expired batches that still hold stock are
            // kept — they represent physical stock to write off via the expiry manager.
            updatedBatches = updatedBatches.filter(b => Number(b.stock) > 0);

            await db.products.update(item.id, {
              stock: dbProduct.stock - item.qty,
              stock_delta: (dbProduct.stock_delta || 0) - item.qty,
              batches: updatedBatches,
              updated_at: nowIso(),
              synced: 0
            });
          }
        }
      });

      TelemetryService.trackSale(method, finalTotalValue, cart.length);

      // Print thermal receipt if setting is enabled in Zaidi
      if (localStorage.getItem('print_receipt_on_sale') === 'true') {
        try {
          const dbShop = await db.shops.get(shopId);
          const dbSettings = await db.settings.get(1);
          const finalShopName = (dbShop?.name || dbSettings?.shopName || shopSettings?.name || shopSettings?.shopName || 'Biashara Yangu').toUpperCase();

          // Business phone/location entered in Zaidi — stored locally on this device only
          // (never synced to Supabase), used purely for the printed receipt.
          const bizPhone = localStorage.getItem('venics_business_phone') || undefined;
          const bizLocation = localStorage.getItem('venics_business_location') || undefined;

          printReceipt({
            shopName: finalShopName,
            shopPhone: bizPhone || shopSettings?.phone,
            shopLocation: bizLocation,
            sellerName: user.name,
            sellerEmail: user.email,
            saleId: saleId,
            paymentMethod: method,
            isCredit: isCreditSale,
            customerName: isCreditSale ? customerName : undefined,
            customerPhone: isCreditSale ? customerPhone : undefined,
            dueDate: isCreditSale && dueDate ? dueDate : undefined,
            totalAmount: finalTotalValue,
            currency: currency,
            items: cart.map(item => ({
              name: item.name,
              qty: item.qty,
              sell_price: item.sell_price
            }))
          });
        } catch (printErr) {
          console.error('Failed to auto-print receipt:', printErr);
        }
      }

      clearCart();
      setIsCheckout(false);
      setIsCredit(false);
      setCustomerName('');
      setCustomerPhone('');
      setDueDate('');
      setCustomTotal('');
      setShowDiscountInput(false);
      
      // The sale rows were written with synced: 0, so the write trigger has
      // already scheduled the push. This just makes the intent explicit, and it
      // shares that same 500ms timer rather than starting a second sync. It used
      // to be sync(true) — a forced FULL sync that re-downloaded every table's
      // entire history after every single sale.
      SyncService.scheduleCriticalSync();
      showToast('Sale Success!', 'success');
      
    } catch (error: any) {
      showAlert('Kosa', 'Kuna tatizo lililotokea: ' + error.message);
    } finally {
      setIsProcessing(false);
      processingRef.current = false;
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full bg-slate-50 overflow-hidden relative font-sans">
      {/* Left Side: Product Selection */}
      <div className="flex-1 flex flex-col border-r border-slate-200 bg-white min-w-0 h-full">
        <div className="px-3 py-2 border-b border-slate-100 flex-shrink-0 flex items-center space-x-3">
          <button 
            type="button"
            onClick={() => navigate('/')}
            className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm flex-shrink-0 cursor-pointer active:scale-95"
            title="Dashibodi"
          >
            <Home className="w-5 h-5 pointer-events-none" />
          </button>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Tafuta bidhaa..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm"
            />
          </div>
        </div>
        
        {/* Alphabet Filter */}
        <div className="bg-white border-b border-slate-100 flex-shrink-0 flex items-center overflow-x-auto no-scrollbar py-1 px-2 md:px-4 space-x-1 scroll-smooth select-none">
          <button
            type="button"
            onClick={() => setSelectedLetter(null)}
            className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
              selectedLetter === null 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
            }`}
          >
            Zote
          </button>
          {alphabet.map(letter => (
            <button
              type="button"
              key={letter}
              onClick={() => setSelectedLetter(letter === selectedLetter ? null : letter)}
              className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                selectedLetter === letter 
                  ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-600/20' 
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {letter}
            </button>
          ))}
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 md:p-3 bg-slate-50/30">
          {filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 md:gap-3 items-start">
              {filteredProducts.map(product => {
                const cartItem = cart.find(item => item.id === product.id);
                const isStockTracked = product.track_stock !== false;
                const isExpired = product._expired === true;
                const isAtMaxStock = isStockTracked && cartItem ? cartItem.qty >= product.stock : false;
                const inCart = !!cartItem;

                return (
                  <button
                    type="button"
                    key={product.id}
                    onClick={() => {
                      if (isExpired) {
                        showToast('Bidhaa hii imeisha muda, haiwezi kuuzwa.', 'info');
                        return;
                      }
                      if (isStockTracked && isAtMaxStock) {
                        showToast(`Umeshafikia kikomo cha stoki iliyopo`, 'info');
                        return;
                      }
                      addToCart({ ...product, stock: product.stock, track_stock: product.track_stock });
                    }}
                    className={`group bg-white p-3 md:p-4 rounded-xl border transition-all text-left relative overflow-hidden flex flex-col h-full min-h-[110px] ${
                      isExpired
                        ? 'border-rose-200 bg-rose-50/40 opacity-70 cursor-not-allowed'
                        : `cursor-pointer ${inCart
                            ? 'border-blue-500 ring-2 ring-blue-100 shadow-md'
                            : 'border-slate-200 shadow-sm hover:border-blue-500 hover:shadow-md'}`
                     }`}
                  >
                    {!isExpired && (
                      <div className="absolute top-0 right-0 p-1.5 opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <div className="bg-blue-600 text-white p-1 rounded-lg">
                          <Plus className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    )}
                    <div className="flex-1">
                      <h3 className="font-bold text-slate-900 mb-1 text-xs md:text-sm line-clamp-2 leading-tight pr-4">{product.name}</h3>
                      <p className={`text-base md:text-lg font-black mt-auto ${isExpired ? 'text-rose-400 line-through' : 'text-blue-600'}`}>{formatCurrency(product.sell_price, currency)}</p>
                    </div>
                    {/* Dropped entirely when the count is withheld, rather than
                        left as an empty bordered strip. The expiry warning is
                        not a quantity, so it still shows. */}
                    {(isExpired || !(isStockTracked && hideStock)) && (
                    <div className="mt-3 flex items-center text-[9px] font-bold uppercase tracking-wider border-t border-slate-50 pt-2 select-none">
                      {isExpired ? (
                        <span className="flex items-center text-rose-600">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Imeisha muda
                        </span>
                      ) : isStockTracked ? (
                        <span className="flex items-center text-slate-400">
                          <span className={`w-1.5 h-1.5 rounded-full mr-2 ${product.stock < 10 ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                          STOKI: {product.stock}
                        </span>
                      ) : (
                        <span className="flex items-center text-slate-400">
                          <span className="w-1.5 h-1.5 rounded-full mr-2 bg-slate-400"></span>
                          STOKI: Bila Kikomo
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
              <p className="font-extrabold text-sm text-gray-800">Hakuna bidhaa iliyopatikana</p>
              <p className="text-xs text-gray-400 mt-1">Sajili bidhaa mpya kwenye katalogi ili kuanza</p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Floating Cart Button */}
      {cart.length > 0 && !showCartMobile && (
        <button 
          onClick={() => {
            setShowCartMobile(true);
            setIsCheckout(true);
          }}
          className="md:hidden fixed bottom-6 right-6 bg-emerald-600 text-white p-4 rounded-2xl shadow-2xl z-40 flex items-center space-x-3 animate-in fade-in slide-in-from-bottom-4 duration-300 border-2 border-white/20 active:scale-95"
        >
          <div className="relative">
            <ShoppingBag className="w-6 h-6" />
            <span className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-emerald-600">
              {cart.reduce((sum, item) => sum + item.qty, 0)}
            </span>
          </div>
          <div className="text-left">
            <p className="text-[10px] uppercase font-bold opacity-80 leading-none mb-1">Lipia Sasa</p>
            <p className="font-black text-sm leading-none">{formatCurrency(finalTotalValue, currency)}</p>
          </div>
        </button>
      )}

      {/* Right Side: Cart & Checkout (Desktop) */}
      <div className={`
        fixed inset-0 z-50 md:relative md:z-0 md:flex md:w-[400px] lg:w-[450px] flex-col bg-slate-50 shadow-2xl transition-transform duration-300 h-full overflow-hidden
        ${showCartMobile ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}
      `}>
        <div className="p-6 md:p-8 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0 select-none">
          <div className="flex items-center">
            <button onClick={() => setShowCartMobile(false)} className="md:hidden mr-4 p-2 hover:bg-slate-100 rounded-xl cursor-pointer">
              <ArrowLeft className="w-6 h-6 text-slate-600" />
            </button>
            <h2 className="text-lg md:text-xl font-bold text-slate-900 flex items-center">
              <ShoppingBag className="w-5 h-5 md:w-6 md:h-6 mr-2 md:mr-3 text-blue-600" /> Kikapu
            </h2>
          </div>
          {cart.length > 0 && (
            <button onClick={clearCart} className="text-rose-500 text-xs md:text-sm font-bold hover:underline cursor-pointer">Futa Vyote</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-8 space-y-3 md:space-y-4">
            {cart.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-4 select-none">
                <div className="w-16 h-16 md:w-20 md:h-20 bg-slate-100 rounded-full flex items-center justify-center">
                  <ShoppingBag className="w-8 h-8 md:w-10 md:h-10" />
                </div>
                <p className="font-bold text-sm md:text-base">Kikapu chako kipo tupu</p>
              </div>
            ) : (
              <>
                {isCheckout && isCredit && (
                  <div className="space-y-4 md:space-y-6 animate-in slide-in-from-bottom-4 duration-300 pb-4 select-none">
                    <div className="space-y-3 md:space-y-4 p-4 md:p-6 bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
                      <h3 className="font-bold text-slate-900 flex items-center justify-start text-sm">
                        <User className="w-4 h-4 mr-2 text-blue-600 shrink-0" /> Taarifa za Mkopo
                      </h3>
                      <div className="relative">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 md:mb-2 text-left">Jina la Mteja</label>
                        <div className="relative">
                          <User className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5 md:w-4 md:h-4" />
                          <input 
                            required 
                            placeholder="Tafuta au andika jina..."
                            value={customerName} 
                            onChange={e => {
                              setCustomerName(e.target.value);
                              setShowSuggestions(true);
                            }} 
                            onFocus={() => setShowSuggestions(true)}
                            className="w-full pl-9 md:pl-10 pr-4 py-2 md:py-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 text-sm" 
                          />
                        </div>
                        {showSuggestions && filteredCustomers.length > 0 && customerName && (
                          <div className="absolute z-20 w-full bg-white mt-2 border border-slate-200 rounded-xl md:rounded-2xl shadow-2xl max-h-40 overflow-y-auto">
                            {filteredCustomers.map(c => (
                              <button
                                type="button"
                                key={c}
                                onClick={() => handleSelectCustomer(c)}
                                className="w-full text-left p-3 md:p-4 hover:bg-blue-50 border-b border-slate-100 last:border-0 text-xs md:text-sm font-bold text-slate-700 cursor-pointer"
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 md:mb-2 text-left">Namba ya Simu</label>
                        <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="w-full p-2 md:p-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 text-sm" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 md:mb-2 text-left">Tarehe ya Kulipa</label>
                        <div className="relative">
                          <Calendar className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5 md:w-4 md:h-4" />
                          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full pl-9 md:pl-10 pr-4 py-2 md:py-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 text-sm" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {cart.map(item => {
                  const isStockTracked = item.track_stock !== false;
                  const isAtMaxStock = isStockTracked && (item.qty >= item.stock);
                  return (
                    <div key={item.id} className="bg-white p-4 md:p-5 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex items-center space-x-3 md:space-x-4">
                      <div className="flex-1 min-w-0 text-left">
                        <h4 className="font-bold text-slate-900 text-xs md:text-sm truncate">{item.name}</h4>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <span className="text-blue-600 font-bold text-xs md:text-sm">{formatCurrency(item.sell_price, currency)}</span>
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100/40" title="Bei ya kununulia">
                            {formatCurrency(item.buy_price, currency)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center bg-slate-100 rounded-xl md:rounded-2xl p-0.5 md:p-1 select-none">
                        <button 
                          type="button"
                          onClick={() => item.qty > 1 ? updateQty(item.id, item.qty - 1) : removeFromCart(item.id)} 
                          className="p-1.5 md:p-2 text-slate-600 hover:bg-white rounded-lg md:rounded-xl transition-colors cursor-pointer"
                        >
                          <Minus className="w-3 h-3 md:w-4 md:h-4 pointer-events-none" />
                        </button>
                        <CartQtyInput item={item} updateQty={updateQty} />
                        <button 
                          type="button"
                          onClick={() => (!isStockTracked || item.qty < item.stock) && updateQty(item.id, item.qty + 1)} 
                          disabled={isAtMaxStock}
                          className={`p-1.5 md:p-2 rounded-lg md:rounded-xl transition-colors ${isAtMaxStock ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-white cursor-pointer'}`}
                        >
                          <Plus className="w-3 h-3 md:w-4 md:h-4 pointer-events-none" />
                        </button>
                      </div>
                      <button type="button" onClick={() => removeFromCart(item.id)} className="text-rose-500 p-1.5 md:p-2 hover:bg-rose-50 rounded-lg md:rounded-xl transition-all cursor-pointer">
                        <Trash2 className="w-4 h-4 md:w-5 md:h-5 pointer-events-none" />
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Checkout Section - Fixed at Bottom */}
        <div className="p-6 md:p-8 bg-white border-t border-slate-200 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] flex-shrink-0">
          {/* Compact Receipt Toggle */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 select-none">
            <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center">
              <Printer className="w-4 h-4 mr-1.5 text-blue-600" /> Receipt
            </span>
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setPrintReceiptEnabled(false);
                  localStorage.setItem('print_receipt_on_sale', 'false');
                  showToast('Uchapishaji wa risiti umezimwa.', 'info');
                }}
                className={`px-2.5 py-1 text-[10px] font-black rounded-md transition-all cursor-pointer ${
                  !printReceiptEnabled 
                    ? 'bg-blue-600 text-white shadow-xs' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                OFF
              </button>
              <button
                type="button"
                onClick={() => {
                  setPrintReceiptEnabled(true);
                  localStorage.setItem('print_receipt_on_sale', 'true');
                  showToast('Risiti zitachapishwa kwa kila mauzo!', 'success');
                }}
                className={`px-2.5 py-1 text-[10px] font-black rounded-md transition-all cursor-pointer ${
                  printReceiptEnabled 
                    ? 'bg-emerald-600 text-white shadow-xs' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                ON
              </button>
            </div>
          </div>

          <div className="mb-4 md:mb-6 select-none">
            <div className="flex justify-between text-slate-500 font-bold text-[10px] md:text-xs uppercase tracking-widest mb-1">
              <span>JUMLA YA MALIPO</span>
            </div>
            <div className="flex justify-between items-end">
              <div className="flex flex-col text-left">
                {customTotal !== '' && !isNaN(parseInt(customTotal)) && (
                  <span className="text-slate-400 font-bold text-sm line-through mb-1">{formatCurrency(cartTotal(), currency)}</span>
                )}
                <span className="text-slate-900 font-black text-2xl md:text-3xl">{formatCurrency(finalTotalValue, currency)}</span>
              </div>
              <span className="text-slate-400 text-[10px] md:text-xs font-bold mb-1">{cart.reduce((sum, item) => sum + item.qty, 0)} Bidhaa</span>
            </div>
          </div>

          {!isCheckout ? (
            <div className="flex flex-col space-y-3">
              <div className="flex space-x-3">
                {showDiscountInput ? (
                  <div className="flex-1 relative flex items-center">
                    <NumberInput
                      autoFocus
                      placeholder="Bei mpya"
                      value={customTotal}
                      onChange={e => setCustomTotal(e.target.value)}
                      className="w-full bg-slate-50 border-2 border-blue-200 rounded-2xl py-3.5 pl-3 pr-8 font-bold text-slate-900 focus:border-blue-500 focus:ring-0 outline-none text-sm"
                    />
                    <button 
                      type="button"
                      onClick={() => { setShowDiscountInput(false); setCustomTotal(''); }}
                      className="absolute right-2 p-1.5 text-slate-400 hover:text-rose-500 rounded-lg cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button 
                    type="button"
                    onClick={() => setShowDiscountInput(true)}
                    disabled={cart.length === 0 || isProcessing}
                    className="flex-1 bg-slate-100 disabled:bg-slate-50 text-slate-600 font-bold py-4 rounded-2xl hover:bg-slate-200 transition-all text-sm shadow-sm cursor-pointer"
                  >
                    Punguzo
                  </button>
                )}
                <button 
                  type="button"
                  onClick={() => handleCompleteSale('cash')}
                  disabled={cart.length === 0 || isProcessing}
                  className="flex-[1.5] bg-emerald-600 disabled:bg-slate-200 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all flex items-center justify-center space-x-2 px-2 text-sm cursor-pointer disabled:cursor-not-allowed"
                >
                  {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  <span className="truncate">Kamilisha (Cash)</span>
                </button>
              </div>
              <div className="flex space-x-3">
                <button 
                  type="button"
                  onClick={() => { setIsCredit(true); setIsCheckout(true); }}
                  disabled={cart.length === 0 || isProcessing}
                  className="flex-1 bg-amber-500 disabled:bg-slate-200 text-white font-bold py-4 rounded-2xl shadow-lg shadow-amber-500/20 hover:bg-amber-600 transition-all flex items-center justify-center space-x-2 text-sm cursor-pointer disabled:cursor-not-allowed"
                >
                  <CreditCard className="w-4 h-4" />
                  <span className="truncate">Uza kwa Mkopo</span>
                </button>
                <button 
                  type="button"
                  onClick={() => handleCompleteSale('mobile_money')}
                  disabled={cart.length === 0 || isProcessing}
                  className="flex-1 bg-blue-600 disabled:bg-slate-200 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all flex items-center justify-center space-x-2 text-sm cursor-pointer disabled:cursor-not-allowed"
                >
                  {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                  <span className="truncate">Lipa kwa Simu</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex space-x-3 select-none">
              <button 
                type="button"
                onClick={() => { setIsCheckout(false); setIsCredit(false); }}
                className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 md:py-4 rounded-xl md:rounded-2xl hover:bg-slate-200 transition-colors text-sm md:text-base cursor-pointer"
              >
                Ghairi
              </button>
              <button 
                type="button"
                onClick={() => handleCompleteSale('credit')}
                disabled={!customerName || isProcessing}
                className="flex-[2] bg-emerald-600 disabled:bg-slate-200 text-white font-bold py-3 md:py-4 rounded-xl md:rounded-2xl shadow-xl shadow-emerald-600/20 hover:bg-emerald-700 transition-all flex items-center justify-center space-x-2 md:space-x-3 text-sm md:text-base cursor-pointer disabled:cursor-not-allowed"
              >
                {isProcessing ? <RefreshCw className="w-5 h-5 md:w-6 md:h-6 animate-spin" /> : <CheckCircle2 className="w-5 h-5 md:w-6 md:h-6" />}
                <span>{isProcessing ? 'Inasindika...' : 'Hifadhi Mkopo'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
