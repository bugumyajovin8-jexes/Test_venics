import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { useTap } from '../utils/useTap';
import { formatCurrency, formatInputNumber, parseInputNumber } from '../utils/format';
import { getValidStock, isProductStockTracked } from '../utils/stock';
import { format, startOfDay, startOfWeek, startOfMonth, subMonths, startOfYear, eachDayOfInterval, subDays } from 'date-fns';
import { Receipt, Calendar, Download, TrendingUp, BarChart3, ArrowUpRight, ArrowDownRight, RotateCcw, AlertCircle, FileText, RefreshCw, Plus, Minus, Trash2, X, Search, ShoppingCart, CheckCircle, Edit2, ShoppingBag, Tag, Wallet, ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { notifications } from '../services/notifications';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { v4 as uuidv4 } from 'uuid';
import { Sale, SaleItem, Expense } from '../db';

// Inline pricing component for backdated cart matching Kikapu.tsx PriceInput
const BackdatedInlinePrice = ({ item, currency, onUpdatePrice }: { item: any; currency: string; onUpdatePrice: (productId: string, price: number) => void }) => {
  const tap = useTap();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(item.sell_price.toString());

  if (isEditing) {
    return (
      <input
        type="number"
        className="w-20 text-right p-1.5 border-2 border-blue-500 rounded-xl text-xs font-black outline-hidden shadow-sm"
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
    <div
      role="button"
      onClick={tap(() => {
        setIsEditing(true);
        setValue(item.sell_price.toString());
      })}
      onPointerUp={tap(() => {
        setIsEditing(true);
        setValue(item.sell_price.toString());
      })}
      className="flex items-center bg-blue-50 text-blue-700 px-2 py-1.5 rounded-xl cursor-pointer active:scale-95 transition-all border border-blue-100"
      style={{ touchAction: 'manipulation' }}
    >
      <span className="font-extrabold text-[11px] mr-1">{formatCurrency(item.sell_price, currency)}</span>
      <Edit2 className="w-3 h-3 opacity-50" />
    </div>
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
  const tap = useTap();
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
        showAlert('Taarifa', `Umeshafikia kikomo cha stock kwa ${product.name}`);
        setLocalQty(product.stock.toString());
        updateQty(product.id!, product.stock);
      } else {
        updateQty(product.id!, val);
      }
    }
  };

  return (
    <div className="flex items-center bg-blue-50 rounded-lg p-0.5 w-full justify-between">
      <button
        type="button"
        onClick={tap(() => {
          if (cartItem.qty > 1) {
            updateQty(product.id!, cartItem.qty - 1);
          } else {
            removeFromCart(product.id!);
          }
        })}
        onPointerUp={tap(() => {
          if (cartItem.qty > 1) {
            updateQty(product.id!, cartItem.qty - 1);
          } else {
            removeFromCart(product.id!);
          }
        })}
        className="p-1 text-blue-600 rounded cursor-pointer relative after:absolute after:content-[''] after:-inset-3"
      >
        <Minus className="w-3 h-3" />
      </button>
      <input
        type="number"
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
              showAlert('Taarifa', `Umeshafikia kikomo cha stock kwa ${product.name}`);
              updateQty(product.id!, product.stock);
            }
          }
          setLocalQty(val);
        }}
        onBlur={handleBlur}
        className="w-10 text-center text-[11px] font-black text-blue-700 mx-1 bg-transparent border-none focus:ring-0 p-0 m-0 outline-hidden"
      />
      <button
        type="button"
        onClick={tap(() => {
          if (isAtMaxStock) return;
          updateQty(product.id!, cartItem.qty + 1);
        })}
        onPointerUp={tap(() => {
          if (isAtMaxStock) return;
          updateQty(product.id!, cartItem.qty + 1);
        })}
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
  const [backdatedIsCartMode, setBackdatedIsCartMode] = useState(false);
  const [backdatedIsCheckout, setBackdatedIsCheckout] = useState(false);

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

  // Load all active products for the backdated sale selection
  const allProducts = useLiveQuery(() => 
    db.products.where('isDeleted').equals(0).toArray()
  ) || [];

  const sortedProducts = useMemo(() => {
    return [...allProducts]
      .map(p => ({
        ...p,
        stock: getValidStock(p, isExpiryEnabled)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allProducts, isExpiryEnabled]);

  const backdatedFilteredProducts = useMemo(() => {
    const s = backdatedSearch.toLowerCase();
    return sortedProducts
      .filter(p => {
        if (!p.name) return false;
        // Strict guard: NEVER show or allow products with 0 or negative stock to appear here or be sold
        if (p.stock <= 0) return false;

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
  }, [sortedProducts, backdatedSearch, selectedBackdatedLetter]);

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
    if (product.stock <= 0) {
      showAlert('Taarifa', `Bidhaa ${product.name} haina stoki kwa sasa.`);
      return;
    }
    const existing = backdatedSaleCart.find(item => item.id === product.id);
    if (existing) {
      const newQty = existing.qty + 1;
      if (newQty > product.stock) {
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
    if (newQty > product.stock) {
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



  const handleCompleteBackdatedSale = async (overrideMethod?: 'cash' | 'credit') => {
    if (backdatedSaleCart.length === 0) {
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
        updated_at: new Date().toISOString(),
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
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 0
      }));

      const shopObj = await db.shops.get(user.shopId);

      const anomaliesHeavyDiscountToLog: any[] = [];

      await db.transaction('rw', [db.products, db.sales, db.saleItems, db.auditLogs], async () => {
        // Double check stock and identify discounts
        for (const item of backdatedSaleCart) {
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
        for (const item of backdatedSaleCart) {
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
                const isExpired = batch.expiry_date && new Date(batch.expiry_date) < new Date();
                if (isExpired) continue;

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
            warning: `[Mauzo ya nyuma] Amepunguza bei ya kuuzia kwa kiasi kikubwa au kuuza chini ya bei halisi ya mzigo stoo. Bidhaa: ${anomaliesDesc}`
          });
        }
      });

      TelemetryService.trackBackdatedSale(backdatedSaleTotal, backdatedSaleCart.reduce((a, b) => a + b.qty, 0));
      showToast(`Mauzo ya siku za nyuma yamefanikiwa!`, 'success');
      setBackdatedSaleCart([]);
      setBackdatedIsCartMode(false);
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
    
    const minDate = view === 'ripoti' ? 0 : Math.min(startDateNum, subDays(n, 30).getTime());
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

  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalProfit = filteredSales.reduce((sum, s) => sum + s.total_profit, 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Show net profit for all filters
  const showNetProfit = true;
  const netProfit = totalProfit - totalExpenses;

  // Chart Data: Revenue Trend (Last 30 days)
  const trendData = useMemo(() => {
    const last30Days = eachDayOfInterval({
      start: subDays(now, 29),
      end: now
    });

    return last30Days.map(day => {
      const dayStart = startOfDay(day).getTime();
      const dayEnd = dayStart + 86400000;
      const daySales = sales.filter(s => {
        const t = new Date(s.created_at).getTime();
        return t >= dayStart && t < dayEnd;
      });
      return {
        date: format(day, 'dd/MM'),
        Mapato: daySales.reduce((sum, s) => sum + s.total_amount, 0),
        Faida: daySales.reduce((sum, s) => sum + s.total_profit, 0)
      };
    });
  }, [sales]);

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
      await db.transaction('rw', [db.sales, db.saleItems, db.products, db.debtPayments, db.auditLogs], async () => {
        const sale = await db.sales.get(saleId);
        if (!sale) throw new Error('Sale not found');
        
        const items = await db.saleItems.where('sale_id').equals(saleId).toArray();
        
        const shopObj = await db.shops.get(user.shopId);
        
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
                  const isExpired = updatedBatches[i].expiry_date && new Date(updatedBatches[i].expiry_date) < new Date();
                  if (!isExpired) {
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

  const exportPDFReports = async () => {
    try {
      const doc = new jsPDF();
      
      // Fetch shop details
      const shop = await db.shops.get(user?.shopId || '');
      
      // Professional Colors
      const primaryColor: [number, number, number] = [25, 50, 100]; // Dark blue
      const textColor = [50, 50, 50]; 

      // Header
      doc.setFontSize(22);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFont("helvetica", "bold");
      doc.text(shop?.name || shopName, 14, 20);
      
      doc.setFontSize(14);
      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "normal");
      doc.text("Business Financial Report", 14, 28);
      
      doc.setFontSize(10);
      doc.text(`Kipindi: ${reportType === 'mwezi' ? 'Kila Mwezi' : 'Kila Mwaka'}`, 14, 35);
      doc.text(`Tarehe: ${format(new Date(), 'dd/MM/yyyy')}`, 14, 40);

      // Business Information Section
      doc.setDrawColor(200, 200, 200);
      doc.line(14, 45, 196, 45);
      
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "bold");
      doc.text("BUSINESS INFORMATION", 14, 55);
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Business Name:  ${shop?.name || ''}`, 14, 62);
      doc.text(`Owner:          ${shop?.owner_name || ''}`, 14, 68);
      doc.text(`Phone:          ${shop?.phone || ''}`, 14, 74);
      
      // Income Statement Table
      const tableData = reportData.map(r => [
          r.label,
          formatCurrency(r.mapato, currency),
          formatCurrency(r.faida, currency),
          formatCurrency(r.matumizi, currency),
          formatCurrency(r.faidaHalisi, currency)
      ]);

      autoTable(doc, {
          head: [['Kipindi', 'Mapato', 'Faida', 'Matumizi', 'Faida Halisi']],
          body: tableData,
          startY: 85,
          theme: 'striped',
          headStyles: { fillColor: primaryColor, textColor: 255 },
      });
      
      // Footer Declaration
      const finalY = (doc as any).lastAutoTable.finalY + 15;
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("DECLARATION", 14, finalY);
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "italic");
      doc.text("I, the undersigned, hereby declare that the information provided in this report", 14, finalY + 7);
      doc.text("is true and accurate to the best of my knowledge.", 14, finalY + 12);
      
      doc.setFont("helvetica", "normal");
      doc.text("Signature: __________________________", 14, finalY + 25);
      doc.text(`Name: ${shop?.owner_name || ''}`, 14, finalY + 32);
      doc.text(`Date: ${format(new Date(), 'yyyy-MM-dd')}`, 14, finalY + 39);
      
      doc.save(`ripoti_${reportType}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    } catch (error) {
      console.error("PDF Export Error:", error);
      alert("Imeshindwa kutengeneza PDF: " + error);
    }
  };

  const exportCSV = () => {
    const headers = ['Tarehe', 'Kiasi', 'Faida', 'Aina', 'Mteja'];
    const rows = filteredSales.map(s => [
      format(new Date(s.created_at), 'yyyy-MM-dd HH:mm'),
      s.total_amount,
      s.total_profit,
      s.payment_method === 'credit' ? 'Mkopo' : 'Taslimu',
      s.customer_name || 'Taslimu'
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mauzo_${filter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate Reports Data
  const reportData = useMemo(() => {
    const groups: Record<string, { mapato: number, faida: number, matumizi: number, mauzo: number }> = {};
    
    sales.filter(sale => !sale.isDeleted).forEach(sale => {
      const date = new Date(sale.created_at);
      const dateStr = reportType === 'mwezi' 
        ? format(date, 'MMM yyyy') 
        : format(date, 'yyyy');
        
      if (!groups[dateStr]) {
        groups[dateStr] = { mapato: 0, faida: 0, matumizi: 0, mauzo: 0 };
      }
      groups[dateStr].mapato += sale.total_amount;
      groups[dateStr].faida += sale.total_profit;
      groups[dateStr].mauzo += 1;
    });

    expenses.forEach(expense => {
      const date = new Date(expense.date);
      const dateStr = reportType === 'mwezi' 
        ? format(date, 'MMM yyyy') 
        : format(date, 'yyyy');
        
      if (groups[dateStr]) {
        groups[dateStr].matumizi += expense.amount;
      } else {
        // Even if no sales, we might have expenses
        groups[dateStr] = { mapato: 0, faida: 0, matumizi: expense.amount, mauzo: 0 };
      }
    });

    return Object.entries(groups).map(([label, data]) => ({
      label,
      ...data,
      faidaHalisi: data.faida - data.matumizi
    })).sort((a, b) => {
      // Sort by date descending
      const parseDate = (s: string) => {
        if (reportType === 'mwaka') return new Date(parseInt(s), 0, 1).getTime();
        return new Date(s).getTime();
      };
      return parseDate(b.label) - parseDate(a.label);
    });
  }, [sales, expenses, reportType]);

  return (
    <div className="p-4 flex flex-col h-full pt-safe pt-safe-standalone">
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
      {(user?.role === 'admin' || user?.role === 'boss') && (
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

          <div className="flex space-x-1.5 overflow-x-auto pb-2 mb-4 scrollbar-hide flex-nowrap">
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
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex-1 min-w-[130px]">
                <p className="text-xs text-gray-500 mb-1">Jumla ya Mapato</p>
                <p className="text-base font-bold text-gray-900 break-all">{formatCurrency(totalRevenue, currency)}</p>
              </div>
            ) : (
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex-1 min-w-[130px]">
                <p className="text-xs text-gray-500 mb-1">Jumla ya Risiti Zilizokatwa</p>
                <p className="text-base font-bold text-purple-600 break-all">{filteredSales.length}</p>
              </div>
            )}
            {(user?.role === 'admin' || user?.role === 'boss') && (
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex-1 min-w-[130px]">
                <p className="text-xs text-gray-500 mb-1">Jumla ya Faida</p>
                <p className="text-base font-bold text-green-600 break-all">{formatCurrency(totalProfit, currency)}</p>
              </div>
            )}
            {(user?.role === 'admin' || user?.role === 'boss') && showNetProfit && (
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 shadow-sm w-full">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <div>
                    <p className="text-xs text-blue-600 mb-1 font-semibold">Faida Halisi (Baada ya Matumizi)</p>
                    <p className={`text-lg font-bold break-all ${netProfit >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                      {formatCurrency(netProfit, currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-blue-500 uppercase font-bold">Matumizi</p>
                    <p className="text-sm font-bold text-gray-700 break-all">{formatCurrency(totalExpenses, currency)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold text-gray-800">Risiti za Mauzo</h2>
            <button onClick={tap(() => exportCSV())} onPointerUp={tap(() => exportCSV())} className="text-blue-600 flex items-center text-sm font-medium cursor-pointer touch-manipulation select-none active:scale-95 transition-all" style={{ WebkitTapHighlightColor: 'transparent' }}>
              <Download className="w-4 h-4 mr-1" /> Pakua CSV
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pb-4">
            {filteredSales.length === 0 ? (
              <div className="text-center text-gray-500 py-10">
                Hakuna mauzo katika kipindi hiki.
              </div>
            ) : (
              filteredSales.map(sale => (
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
                      {(user?.role === 'admin' || user?.role === 'boss') && (
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
              ))
            )}
          </div>

          {/* Reverse Sale Confirmation Modal */}
          {reversingSaleId && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
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
            <button onClick={tap(() => exportPDFReports())} onPointerUp={tap(() => exportPDFReports())} className="text-blue-600 flex items-center text-sm font-medium cursor-pointer touch-manipulation select-none active:scale-95 transition-all" style={{ WebkitTapHighlightColor: 'transparent' }}>
              <FileText className="w-4 h-4 mr-1" /> Pakua PDF
            </button>
          </div>
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
                    <Line type="monotone" dataKey="Mapato" stroke="#3b82f6" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="Faida" stroke="#10b981" strokeWidth={3} dot={false} />
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
                          {(user?.role === 'admin' || user?.role === 'boss') && (
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
            <div className="flex flex-col bg-white border-b border-gray-150 flex-shrink-0">
              {/* Top Bar with Date Selector and Close Button */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
                <div className="flex-1 flex items-center space-x-2.5">
                  <span className="text-xs font-black text-gray-500 uppercase flex-shrink-0">Andika tarehe:</span>
                  <input
                    type="date"
                    value={backdatedSaleDate}
                    onChange={(e) => setBackdatedSaleDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="bg-blue-50 px-2.5 py-1.5 rounded-xl text-xs font-black text-blue-700 focus:outline-hidden focus:ring-1 focus:ring-blue-500 border-none outline-hidden"
                  />
                </div>
                <button
                  type="button"
                  onClick={tap(() => {
                    setShowBackdatedSaleModal(false);
                    setBackdatedIsCartMode(false);
                    setBackdatedIsCheckout(false);
                  })}
                  onPointerUp={tap(() => {
                    setShowBackdatedSaleModal(false);
                    setBackdatedIsCartMode(false);
                    setBackdatedIsCheckout(false);
                  })}
                  className="p-1 px-2.5 text-red-500 font-black rounded-xl text-xs active:scale-95 transition-all flex items-center space-x-1 cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                  <span>Funga</span>
                </button>
              </div>

              {/* Search Bar / Back Button row like Kikapu.tsx */}
              <div className="p-3 flex items-center justify-between">
                {backdatedIsCartMode ? (
                  <button
                    type="button"
                    onClick={tap(() => setBackdatedIsCartMode(false))}
                    onPointerUp={tap(() => setBackdatedIsCartMode(false))}
                    className="text-blue-600 font-bold text-xs flex items-center bg-blue-50 px-3 py-1.5 rounded-xl cursor-pointer"
                  >
                     ← Nyuma kwenye Bidhaa
                  </button>
                ) : (
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input 
                      type="text" 
                      placeholder="Tafuta bidhaa ya zamani..." 
                      value={backdatedSearch}
                      onChange={(e) => setBackdatedSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-medium"
                    />
                  </div>
                )}
                
                {backdatedIsCartMode && (
                  <h2 className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">Bidhaa Zilizochaguliwa</h2>
                )}
              </div>

              {/* Alphabet Selector matching Kikapu.tsx */}
              {!backdatedIsCartMode && (
                <div className="flex overflow-x-auto pb-2 px-3 scrollbar-hide space-x-2">
                  <button
                    type="button"
                    onClick={tap(() => setSelectedBackdatedLetter(null))}
                    onPointerUp={tap(() => setSelectedBackdatedLetter(null))}
                    className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-xs font-extrabold transition-all cursor-pointer ${!selectedBackdatedLetter ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
                  >
                    All
                  </button>
                  {['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','#'].map(letter => (
                    <button
                      type="button"
                      key={letter}
                      onClick={tap(() => setSelectedBackdatedLetter(selectedBackdatedLetter === letter ? null : letter))}
                      onPointerUp={tap(() => setSelectedBackdatedLetter(selectedBackdatedLetter === letter ? null : letter))}
                      className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-xs font-extrabold transition-all cursor-pointer ${selectedBackdatedLetter === letter ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
                    >
                      {letter}
                    </button>
                  ))}
                </div>
              )}
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
                  onClick={tap(() => handleCompleteBackdatedSale())}
                  onPointerUp={tap(() => handleCompleteBackdatedSale())}
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
            <div className="flex-1 overflow-hidden p-3 flex flex-col min-h-0 relative">
              <div className="flex-1 min-h-0 bg-white rounded-2xl border border-gray-100 shadow-inner p-2 overflow-y-auto">
                {backdatedIsCartMode ? (
                  backdatedSaleCart.length > 0 ? (
                    <div className="space-y-2 pb-60">
                      {backdatedSaleCart.map((item) => {
                        return (
                          <div key={item.id} className="bg-white border border-gray-150 rounded-xl p-3 flex items-center justify-between shadow-xs">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-gray-800 text-xs truncate">{item.name}</h4>
                              <div className="text-[10px] text-gray-500 font-medium">
                                Qty: {item.qty} • Bei ya kazi: {formatCurrency(item.sell_price, currency)}
                              </div>
                            </div>
                            
                            <div className="flex items-center space-x-2 ml-2">
                              <BackdatedInlinePrice item={item} currency={currency} onUpdatePrice={handleUpdateBackdatedPrice} />
                              
                              <button
                                type="button"
                                onClick={tap(() => handleRemoveFromBackdatedCart(item.id))}
                                onPointerUp={tap(() => handleRemoveFromBackdatedCart(item.id))}
                                className="text-red-400 p-2 rounded-xl cursor-pointer active:scale-90"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-12 flex flex-col items-center justify-center h-full">
                      <ShoppingBag className="w-12 h-12 text-gray-200 mb-3" />
                      <p className="font-bold text-xs animate-pulse">Kikapu cha siku za nyuma kiko tupu</p>
                      <button
                        type="button"
                        onClick={tap(() => setBackdatedIsCartMode(false))}
                        onPointerUp={tap(() => setBackdatedIsCartMode(false))}
                        className="text-blue-600 text-[11px] mt-2 underline font-bold"
                      >
                        Rudi kuongeza bidhaa
                      </button>
                    </div>
                  )
                ) : (
                  backdatedFilteredProducts.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 pb-60">
                      {backdatedFilteredProducts.map((product) => {
                        const cartItem = backdatedSaleCart.find(item => item.id === product.id);
                        const isAtMaxStock = cartItem ? cartItem.qty >= product.stock : false;
                        const inCart = !!cartItem;

                        return (
                          <div 
                            key={product.id}
                            className={`bg-white p-2.5 rounded-xl shadow-xs border flex flex-col justify-between transition-all h-[84px] ${
                              inCart ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-100'
                            } ${isAtMaxStock ? 'opacity-90' : ''}`}
                          >
                            <div 
                              className="min-w-0 cursor-pointer flex-1"
                              onClick={() => {
                                if (product.stock <= 0) {
                                  showAlert('Taarifa', `Bidhaa ${product.name} haina stoki kwa sasa.`);
                                  return;
                                }
                                if (isAtMaxStock) {
                                  showAlert('Taarifa', `Umeshafikia kikomo cha stock kwa ${product.name}`);
                                  return;
                                }
                                handleAddToBackdatedCart(product);
                              }}
                            >
                              <h3 className="font-bold text-gray-900 text-[11px] leading-tight line-clamp-1 tracking-tight">{product.name}</h3>
                              <div className="text-[10px] font-black text-blue-600 mt-0.5">
                                {formatCurrency(product.sell_price, currency)}
                              </div>
                            </div>

                            <div className="flex justify-between items-center mt-1">
                              {inCart ? (
                                <BackdatedQtyControl 
                                  product={product} 
                                  cartItem={cartItem} 
                                  updateQty={handleUpdateBackdatedQty} 
                                  removeFromCart={handleRemoveFromBackdatedCart} 
                                  showAlert={showAlert} 
                                />
                              ) : (
                                <div className="text-[9px] text-gray-400 font-medium">
                                  Stock: {product.stock}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-12 flex flex-col items-center justify-center h-full">
                      <Search className="w-10 h-10 text-gray-200 mb-2" />
                      <p className="font-semibold text-xs">Hakuna bidhaa iliyopatikana</p>
                      <p className="text-[10px] text-gray-4 source-code mt-1">Jaribu jina lingine la bidhaa.</p>
                    </div>
                  )
                )}
              </div>

              {/* Floating Cart Panel matching Kikapu.tsx style */}
              {backdatedSaleCart.length > 0 && (
                <div className="fixed bottom-20 left-3 right-3 animate-in slide-in-from-bottom duration-300 z-50">
                  <div className="bg-gray-900/95 backdrop-blur-lg text-white p-3 rounded-[2.5rem] shadow-2xl border border-white/10 flex flex-col space-y-3">
                    {/* Top Summary */}
                    <div className="flex items-center justify-between px-4 py-1">
                      <div className="flex items-center">
                        <div className="bg-blue-600 p-2.5 rounded-2xl mr-3 relative shadow-lg shadow-blue-500/20">
                          <ShoppingBag className="w-5 h-5 text-white" />
                          <span className="absolute -top-1 -right-1 bg-white text-blue-600 text-[10px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border-2 border-gray-900">
                            {backdatedSaleCart.reduce((a, b) => a + b.qty, 0)}
                          </span>
                        </div>
                        <div>
                          <p className="text-xl font-black tracking-tight">{formatCurrency(backdatedSaleTotal, currency)}</p>
                          <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Jumla ya Kikapu cha Zamani</p>
                        </div>
                      </div>
                      
                      <button 
                        type="button"
                        onClick={tap(() => {
                          setBackdatedSaleCart([]);
                          setBackdatedIsCartMode(false);
                        })}
                        onPointerUp={tap(() => {
                          setBackdatedSaleCart([]);
                          setBackdatedIsCartMode(false);
                        })}
                        className="text-gray-400 p-2 transition-colors cursor-pointer"
                        title="Safi Kikapu"
                      >
                        <Plus className="w-6 h-6 rotate-45" />
                      </button>
                    </div>

                    {/* Bottom Actions grid */}
                    <div className="grid grid-cols-3 gap-2 px-1 pb-1">
                      <button
                        type="button"
                        onClick={tap(() => setBackdatedIsCartMode(!backdatedIsCartMode))}
                        onPointerUp={tap(() => setBackdatedIsCartMode(!backdatedIsCartMode))}
                        className={`${backdatedIsCartMode ? 'bg-blue-600 text-white' : 'bg-white/10  text-white'} py-3.5 rounded-2xl font-bold text-xs transition-all active:scale-95 cursor-pointer`}
                      >
                        {backdatedIsCartMode ? 'Bidhaa' : 'Punguzo'}
                      </button>
                      <button
                        type="button"
                        onClick={tap(() => {
                          setBackdatedPaymentMethod('credit');
                          setBackdatedIsCheckout(true);
                        })}
                        onPointerUp={tap(() => {
                          setBackdatedPaymentMethod('credit');
                          setBackdatedIsCheckout(true);
                        })}
                        className="bg-orange-500/20 text-orange-400 py-3.5 rounded-2xl font-bold text-xs border border-orange-500/30 transition-all active:scale-95 cursor-pointer text-center"
                      >
                        Mkopo
                      </button>
                      <button
                        type="button"
                        onClick={tap(() => handleCompleteBackdatedSale('cash'))}
                        onPointerUp={tap(() => handleCompleteBackdatedSale('cash'))}
                        className="bg-green-600 text-white py-3.5 rounded-2xl font-black text-xs shadow-lg shadow-green-900/20 transition-all active:scale-95 flex items-center justify-center cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        Uza
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}


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
                <input
                  type="date"
                  value={backdatedExpenseDate}
                  onChange={(e) => setBackdatedExpenseDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full bg-gray-50 p-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-800 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                />
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
