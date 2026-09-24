import { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Product } from '../db';
import { formatCurrency } from '../utils/format';
import { getValidStock, getSales30DaysVelocityMap, getDynamicThreshold, isProductStockTracked } from '../utils/stock';
import { useHideStock } from '../hooks/useHideStock';
import { Plus, Search, Edit, Trash2, AlertCircle, FileDown, Upload, Clock, Calendar, Camera, Zap, Send, RefreshCw, TrendingUp, Package } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { SyncService } from '../services/sync';
import { supabase } from '../supabase';
import ExcelImportModal from '../components/ExcelImportModal';
import AIScanModal from '../components/AIScanModal';
import StockAuditModal from '../components/StockAuditModal';
import CatalogModal from '../components/catalog/CatalogModal';
import ExpiryDatePicker from '../components/ExpiryDatePicker';
import TypeToConfirm from '../components/TypeToConfirm';
import { DELETE_ALL_PRODUCTS_PHRASE } from '../utils/confirmPhrases';
import { format, isAfter, isBefore, addDays } from 'date-fns';
import { List, RowComponentProps } from 'react-window';
import { nowIso } from '../services/clock';

export default function Bidhaa() {
  const { user, showAlert, showConfirm, showToast, isBoss, isFeatureEnabled } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const currency = settings?.currency || 'TZS';
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const products = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    // Use compound index for faster filtering
    const query = db.products.where('[shop_id+isDeleted]').equals([user.shopId, 0]);
    
    if (deferredSearch) {
      // If searching, we still have to filter in memory for 'includes'
      // but we can limit the initial fetch if needed.
      // For now, let's fetch all matching names to keep it simple but faster than full objects
      return query.filter(p => p.name.toLowerCase().includes(deferredSearch.toLowerCase())).toArray();
    }
    
    // If not searching, fetch all products to show accurate count and list
    // (react-window handles the DOM performance)
    return query.toArray();
  }, [user?.shopId, deferredSearch]) || [];

  const velocityMap = useLiveQuery(async () => {
    if (!user?.shopId) return {};
    return getSales30DaysVelocityMap(user.shopId);
  }, [user?.shopId]) || {};
  
  const [isAdding, setIsAdding] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAIScanModalOpen, setIsAIScanModalOpen] = useState(false);
  const [isStockAuditModalOpen, setIsStockAuditModalOpen] = useState(false);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [isProcessingQuickAdd, setIsProcessingQuickAdd] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockModalProduct, setStockModalProduct] = useState<Product | null>(null);
  const [batchModalProduct, setBatchModalProduct] = useState<Product | null>(null);
  const [stockToAdd, setStockToAdd] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(500);

  useEffect(() => {
    if (containerRef.current) {
      setListHeight(containerRef.current.offsetHeight);
    }
    const handleResize = () => {
      if (containerRef.current) setListHeight(containerRef.current.offsetHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isAdding, editingProduct]);

  const isExpiryEnabled = shop?.enable_expiry === true;
  const [showCatalog, setShowCatalog] = useState(false);
  const canManageProducts = isBoss() || isFeatureEnabled('staff_product_management');

  // Device-local privacy switch set by the boss in Zaidi on THIS computer.
  const hideStock = useHideStock();

  // One-time propagation: publish the boss's existing shop-level stock setting to the features
  // table (which employees receive — unlike the shops table) if it isn't there yet, so
  // already-configured shops start syncing the flag to their staff.
  useEffect(() => {
    if (!isBoss() || !shop) return;
    if (useStore.getState().features['stock_tracking_enabled'] === undefined) {
      SyncService.toggleFeature('stock_tracking_enabled', shop.enable_stock !== false);
    }
  }, [shop]);

  const toggleStock = async () => {
    if (!user?.shopId) return;
    
    let currentShop = shop;
    if (!currentShop) {
      currentShop = await db.shops.get(user.shopId);
    }
    
    if (!currentShop) {
      return;
    }

    const newValue = currentShop.enable_stock === false;
    await db.shops.update(currentShop.id, { 
      enable_stock: newValue,
      updated_at: nowIso(),
      synced: 0
    });

    if (!newValue) {
      // If turning global stock off, set track_stock to false for all products of this shop
      // so they don't track individually by default.
      // Use highly optimized Dexie collection modify for massive speed improvement
      await db.products.where('[shop_id+isDeleted]').equals([user.shopId, 0]).modify({
        track_stock: false,
        updated_at: nowIso(),
        synced: 0
      });

      // Also directly update Supabase database table products to set track_stock to FALSE instantly
      try {
        await supabase
          .from('products')
          .update({ 
            track_stock: false,
            updated_at: nowIso()
          })
          .eq('shop_id', user.shopId);
      } catch (err) {
        console.error('Failed to update remote products track_stock:', err);
      }
    } else {
      // If turning global stock on, set track_stock to true for all products of this shop
      // so they track individually by default.
      // Use highly optimized Dexie collection modify for massive speed improvement
      await db.products.where('[shop_id+isDeleted]').equals([user.shopId, 0]).modify({
        track_stock: true,
        updated_at: nowIso(),
        synced: 0
      });

      // Also directly update Supabase database table products to set track_stock to TRUE instantly
      try {
        await supabase
          .from('products')
          .update({ 
            track_stock: true,
            updated_at: nowIso()
          })
          .eq('shop_id', user.shopId);
      } catch (err) {
        console.error('Failed to update remote products track_stock:', err);
      }
    }

    // Publish the setting to the features table too, so employees — who never sync the shops
    // table (their `shop` is undefined) — receive the global stock flag and honor it.
    await SyncService.toggleFeature('stock_tracking_enabled', newValue);

    SyncService.sync();
  };

  // Form states for formatting
  const [formBuyPrice, setFormBuyPrice] = useState('');
  const [formSellPrice, setFormSellPrice] = useState('');
  const [formStock, setFormStock] = useState('');
  const [formLowStock, setFormLowStock] = useState('5');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formNotifyDays, setFormNotifyDays] = useState('30');
  const [formTrackStock, setFormTrackStock] = useState(true);

  useEffect(() => {
    if (isAdding) {
      setFormBuyPrice('');
      setFormSellPrice('');
      setFormStock('');
      setFormLowStock('5');
      setFormExpiryDate('');
      setFormNotifyDays('30');
      setFormTrackStock(shop?.enable_stock !== false);
    } else if (editingProduct) {
      setFormBuyPrice(editingProduct.buy_price.toLocaleString());
      setFormSellPrice(editingProduct.sell_price.toLocaleString());
      setFormStock(editingProduct.stock.toLocaleString());
      setFormLowStock(editingProduct.min_stock.toLocaleString());
      setFormTrackStock(isProductStockTracked(editingProduct, shop));
      if (editingProduct.notify_expiry_days) {
        setFormNotifyDays(editingProduct.notify_expiry_days.toString());
      }
    } else {
      setFormBuyPrice('');
      setFormSellPrice('');
      setFormStock('');
      setFormLowStock('5');
      setFormExpiryDate('');
      setFormNotifyDays('30');
      setFormTrackStock(shop?.enable_stock !== false);
    }
  }, [isAdding, editingProduct, shop]);

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

  const filteredProducts = useMemo(() => {
    const s = deferredSearch.toLowerCase();
    // Since we already filtered in the query for search, we just need to sort here
    return [...products].sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aStarts = aName.startsWith(s);
      const bStarts = bName.startsWith(s);
      
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return aName.localeCompare(bName);
    });
  }, [products, deferredSearch]);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const formData = new FormData(e.currentTarget);
      
      const isGlobalStockEnabled = shop?.enable_stock !== false;
      const trackStockVal = isGlobalStockEnabled ? true : formTrackStock;
      
      const stock = trackStockVal ? parseInputNumber(formStock) : 0;
      const notifyDays = parseInputNumber(formNotifyDays);
      
      const currentStock = editingProduct?.stock || 0;
      const stockChange = stock - currentStock;

      let updatedBatches = editingProduct?.batches || [];
      const totalBatchStock = updatedBatches.reduce((sum, b) => sum + Number(b.stock), 0);
      
      // If user reduced stock below total batch stock, we need to adjust batches
      if (trackStockVal && stock < totalBatchStock) {
        let stockToRemove = totalBatchStock - stock;
        // Sort batches by expiry date (earliest first) to remove from oldest first
        updatedBatches.sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime());
        
        updatedBatches = updatedBatches.map(batch => {
          if (stockToRemove <= 0) return batch;
          const batchStock = Number(batch.stock);
          if (batchStock <= stockToRemove) {
            stockToRemove -= batchStock;
            return { ...batch, stock: 0 };
          } else {
            const newBatchStock = batchStock - stockToRemove;
            stockToRemove = 0;
            return { ...batch, stock: newBatchStock };
          }
        }).filter(batch => Number(batch.stock) > 0);
      }
      
      const rawBuyPrice = parseInputNumber(formBuyPrice);
      const rawSellPrice = parseInputNumber(formSellPrice);
      
      const product: Product = {
        id: editingProduct?.id || uuidv4(),
        shop_id: user?.shopId || '',
        name: formData.get('name') as string,
        buy_price: rawBuyPrice,
        sell_price: rawSellPrice,
        stock: stock,
        min_stock: trackStockVal ? parseInputNumber(formLowStock) : 0,
        unit: 'pcs',
        batches: trackStockVal ? updatedBatches : [],
        // Typing a stock figure is a COUNT of the shelf, not a difference. It
        // travels with what this device counted from, so the server can set the
        // stock outright when it still agrees — and tell the shop when another
        // device had already moved it. The pending difference is handed over to
        // the count (which already contains it) and reset, so anything sold
        // after this point is an ordinary delta again. See db.ts Product.count_id.
        ...(editingProduct && trackStockVal && stockChange !== 0
          ? {
              stock_delta: 0,
              count_id: uuidv4(),
              counted_stock: stock,
              counted_base: currentStock,
              counted_delta: editingProduct.stock_delta || 0,
            }
          : { stock_delta: trackStockVal ? ((editingProduct?.stock_delta || 0) + stockChange) : 0 }),
        notify_expiry_days: isExpiryEnabled && trackStockVal ? notifyDays : undefined,
        track_stock: trackStockVal,
        created_at: editingProduct?.created_at || nowIso(),
        updated_at: nowIso(),
        synced: 0,
        isDeleted: 0
      };

      // Only create an initial dated batch when the user actually gave an expiry date. A product
      // with no expiry date (non-perishable) is stored with NO batch — getValidStock then returns
      // its full stock and it never shows up in expiry alerts. (Previously a blank date defaulted
      // to +365 days, which made non-perishables falsely "expire" a year later.)
      if (!editingProduct && trackStockVal && stock > 0 && isExpiryEnabled && formExpiryDate) {
        product.batches = [{
          id: uuidv4(),
          batch_number: `B-${Date.now()}`,
          expiry_date: new Date(formExpiryDate).toISOString(),
          stock: stock
        }];
      }

      await db.products.put(product);
      
      // Log action
      if (editingProduct) {
        const changes: any = {};
        if (product.sell_price !== editingProduct.sell_price) {
          changes.sell_price = { old: editingProduct.sell_price, new: rawSellPrice };
        }
        if (product.buy_price !== editingProduct.buy_price) {
          changes.buy_price = { old: editingProduct.buy_price, new: rawBuyPrice };
        }
        if (product.stock !== editingProduct.stock) {
          changes.stock = { old: editingProduct.stock, new: product.stock };
          
          if (product.stock < editingProduct.stock) {
            SyncService.logAction('anomaly_stock_reduction', {
              product_id: product.id,
              name: product.name,
              old_stock: editingProduct.stock,
              new_stock: product.stock,
              reduction: editingProduct.stock - product.stock,
              employee_name: user?.name || 'Mhudumu',
              warning: `Amepunguza kiwango cha bidhaa hii stoo (${editingProduct.stock - product.stock} zilizopungua) bila kusajili mauzo ya kawaida kwenye mfumo.`
            });
          }
        }
        if (product.name !== editingProduct.name) {
          changes.name = { old: editingProduct.name, new: product.name };
        }
        if (product.notify_expiry_days !== editingProduct.notify_expiry_days) {
          changes.notify_expiry_days = { old: editingProduct.notify_expiry_days || 'N/A', new: product.notify_expiry_days || 'N/A' };
        }

        SyncService.logAction('edit_product', { 
          product_id: product.id, 
          name: product.name,
          changes
        });
      } else {
        SyncService.logAction('add_product', { 
          product_id: product.id, 
          name: product.name,
          stock: product.stock,
          sell_price: rawSellPrice,
          buy_price: rawBuyPrice
        });
      }
      
      setIsAdding(false);
      setEditingProduct(null);
      setFormBuyPrice('');
      setFormSellPrice('');
      setFormStock('');
      setFormLowStock('5');
      setFormExpiryDate('');
      setFormNotifyDays('30');
      SyncService.sync();
    } catch (err) {
      console.error('Save product error:', err);
      // Use a non-blocking alert or just log it
    }
  };

  const handleDelete = (id: string) => {
    showConfirm('Futa Bidhaa', 'Una uhakika unataka kufuta bidhaa hii?', async () => {
      const product = await db.products.get(id);
      await db.products.update(id, { 
          isDeleted: 1, 
          synced: 0, 
          updated_at: nowIso() 
      });
      
      if (product) {
        SyncService.logAction('delete_product', { product_id: id, name: product.name });
      }
      SyncService.sync();
    });
  };

  const toggleProductStockTracking = async (id: string, currentTrackStock: boolean) => {
    try {
      const updatedAt = nowIso();
      await db.products.update(id, {
        track_stock: !currentTrackStock,
        updated_at: updatedAt,
        synced: 0
      });

      // Directly update remote Supabase database to make the toggle instant and 100% reliable
      try {
        await supabase
          .from('products')
          .update({
            track_stock: !currentTrackStock,
            updated_at: updatedAt
          })
          .eq('id', id);
      } catch (err) {
        console.error('Failed to update remote product track_stock:', err);
      }

      SyncService.sync();
    } catch (err) {
      console.error('Failed to toggle product stock tracking:', err);
    }
  };

  /**
   * Wipe the whole catalogue.
   *
   * Gated behind a typed sentence rather than a yes/no confirm. "Ndiyo" lands
   * under the same pointer that just clicked the bin icon, and there is no undo
   * here — the rows sync as deleted to every other device in the shop.
   */
  const performDeleteAll = async () => {
    try {
      const productIds = products.map(p => p.id).filter((id): id is string => !!id);
      const count = productIds.length;

      await Promise.all(productIds.map(id =>
        db.products.update(id, {
          isDeleted: 1,
          synced: 0,
          updated_at: nowIso()
        })
      ));

      // Log action
      await SyncService.logAction('delete_all_products', { count });

      SyncService.sync();
      setIsDeleteAllOpen(false);
      showAlert('Imefanikiwa', `Bidhaa zote ${count} zimefutwa kikamilifu.`);
    } catch (err) {
      console.error('Failed to delete all products:', err);
      setIsDeleteAllOpen(false);
      showAlert('Kosa', 'Imeshindwa kufuta bidhaa zote. Tafadhali jaribu tena.');
    }
  };

  const handleDeleteAll = () => {
    setIsDeleteAllOpen(true);
  };

  const ProductRow = ({ index, style }: RowComponentProps) => {
    const product = filteredProducts[index];
    if (!product) return null;
    
    const isProductTracked = isProductStockTracked(product, shop);
    const validStock = getValidStock(product, isExpiryEnabled);
    const dynamicThreshold = isProductTracked ? getDynamicThreshold(product.id, product.min_stock, velocityMap) : 0;
    const isLow = isProductTracked && (validStock <= dynamicThreshold);
    
    return (
      <div style={style} className="px-1">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center h-[110px]">
          <div className="flex-1 min-w-0 mr-4">
            <h3 className="font-bold text-gray-800 truncate">{product.name}</h3>
            <div className="text-sm text-gray-500 mt-1">
              Bei: {formatCurrency(product.sell_price, currency)}
            </div>
            <div className="flex items-center mt-2">
              {isProductTracked ? (
                // Withheld staff-side: rendered as nothing at all, with no
                // placeholder standing in for it.
                hideStock ? null : (
                  <span className={`text-xs font-medium px-2 py-1 rounded-md ${isLow ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    Zilizopo: {validStock}
                  </span>
                )
              ) : (
                <span className="text-xs font-medium px-2 py-1 rounded-md bg-slate-100 text-slate-700">
                  Stoki: Haifuatiliwi
                </span>
              )}
              {isProductTracked && !hideStock && dynamicThreshold > 0 && (
                <span className="ml-2 bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center shrink-0" title="Kikomo cha mauzo ya siku 7">
                  <TrendingUp className="w-3 h-3 mr-0.5 shrink-0" />
                  AUTO: {dynamicThreshold} pcs
                </span>
              )}
              {isProductTracked && canManageProducts && (
                <button 
                  onClick={() => setStockModalProduct(product)}
                  className="ml-2 bg-blue-100 hover:bg-blue-200 text-blue-700 p-1 rounded-md transition-colors"
                  title="Ongeza idadi ya bidhaa"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              {isProductTracked && canManageProducts && isExpiryEnabled && (
                <button 
                  onClick={() => setBatchModalProduct(product)}
                  className="ml-2 bg-orange-100 hover:bg-orange-200 text-orange-700 p-1 rounded-md transition-colors"
                  title="Simamia tarehe za kuisha"
                >
                  <Calendar className="w-4 h-4" />
                </button>
              )}
              {isProductTracked && !hideStock && isLow && (
                <AlertCircle className="w-4 h-4 text-red-500 ml-2 animate-pulse" />
              )}
            </div>
          </div>
          {canManageProducts && (
            <div className="flex items-center space-x-2 shrink-0">
              {shop?.enable_stock === false && (
                <button 
                  onClick={() => product.id && toggleProductStockTracking(product.id, product.track_stock === true)} 
                  className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center space-x-1 border ${
                    product.track_stock === true
                      ? 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100' 
                      : 'text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}
                  title={product.track_stock === true ? "Acha kufuatilia stoki" : "Anza kufuatilia stoki"}
                >
                  <Package className="w-3.5 h-3.5 shrink-0" />
                  <span>Stock track: {product.track_stock === true ? 'ON' : 'OFF'}</span>
                </button>
              )}
              <button onClick={() => setEditingProduct(product)} className="p-2 text-blue-600 bg-blue-50 rounded-lg">
                <Edit className="w-5 h-5" />
              </button>
              <button onClick={() => product.id && handleDelete(product.id)} className="p-2 text-red-600 bg-red-50 rounded-lg">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleAddStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockModalProduct) return;
    
    const amount = parseInputNumber(stockToAdd);
    if (isNaN(amount) || amount <= 0) {
      showAlert('Kosa', 'Tafadhali weka namba sahihi.');
      return;
    }
    
    if (stockModalProduct.id) {
      try {
        // db.settings is in scope because SyncService.logAction('edit_product') is
        // called inside this transaction and reads db.settings during off-hours.
        await db.transaction('rw', [db.products, db.auditLogs, db.settings], async () => {
          const currentProduct = await db.products.get(stockModalProduct.id!);
          if (!currentProduct) throw new Error('Bidhaa haikupatikana');

          const updatedBatches = [...(currentProduct.batches || [])];
          
          if (isExpiryEnabled && expiryDate) {
            updatedBatches.push({
              id: uuidv4(),
              batch_number: `B-${Date.now()}`,
              expiry_date: new Date(expiryDate).toISOString(),
              stock: amount
            });
          }

          await db.products.update(currentProduct.id!, { 
            stock: currentProduct.stock + amount,
            stock_delta: (currentProduct.stock_delta || 0) + amount,
            batches: updatedBatches,
            updated_at: nowIso(),
            synced: 0
          });

          await SyncService.logAction('edit_product', {
            product_id: currentProduct.id,
            name: currentProduct.name,
            changes: {
              stock: { old: currentProduct.stock, new: currentProduct.stock + amount },
              stock_added: amount,
              ...(expiryDate ? { expiry_date: expiryDate } : {})
            }
          });
        });
        
        SyncService.sync();
      } catch (error: any) {
        showAlert('Kosa', error.message || 'Kuna tatizo wakati wa kuongeza stock');
        return;
      }
    }
    
    setStockModalProduct(null);
    setStockToAdd('');
    setExpiryDate('');
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddText.trim() || isProcessingQuickAdd) return;

    setIsProcessingQuickAdd(true);
    try {
      const text = quickAddText.trim();
      
      // Smart parsing: Extract name and numbers
      // Format: "Name BuyPrice SellPrice Stock"
      const parts = text.split(/\s+/);
      
      // Try to find numbers at the end
      let numbers: number[] = [];
      let nameParts: string[] = [];
      
      for (let i = parts.length - 1; i >= 0; i--) {
        const num = Number(parts[i].replace(/,/g, ''));
        if (!isNaN(num) && numbers.length < 3) {
          numbers.unshift(num);
        } else {
          nameParts = parts.slice(0, i + 1);
          break;
        }
      }

      const name = nameParts.join(' ');
      
      if (!name || numbers.length < 2) {
        throw new Error('Matabiri ya kosa: Andika "Jina Bei_Kununua Bei_Kuuza Stock". Mfano: Soda 500 700 24');
      }

      const buyPrice = numbers[0];
      const sellPrice = numbers[1];
      const stock = numbers[2] || 0;

      const product: Product = {
        id: uuidv4(),
        shop_id: user?.shopId || '',
        name: name,
        buy_price: buyPrice,
        sell_price: sellPrice,
        stock: stock,
        min_stock: 5,
        unit: 'pcs',
        stock_delta: stock,
        batches: [],
        track_stock: shop?.enable_stock !== false,
        created_at: nowIso(),
        updated_at: nowIso(),
        synced: 0,
        isDeleted: 0
      };

      await db.products.put(product);
      SyncService.logAction('add_product', { 
        product_id: product.id, 
        name: product.name,
        stock: product.stock,
        sell_price: product.sell_price,
        buy_price: product.buy_price
      });
      
      SyncService.sync();
      setQuickAddText('');
      showToast(`Biashara "${name}" imeongezwa!`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Kuna tatizo wakati wa kuongeza bidhaa', 'error');
    } finally {
      setIsProcessingQuickAdd(false);
    }
  };

  if (isAdding || editingProduct) {
    if (!canManageProducts) {
      return (
        <div className="p-10 text-center">
          <h2 className="text-xl font-bold text-red-600">Kizuizi</h2>
          <p className="text-gray-500 mt-2">Huna ruhusa ya kuongeza au kuhariri bidhaa.</p>
          <button onClick={() => { setIsAdding(false); setEditingProduct(null); }} className="mt-4 text-blue-600 font-bold underline">Rudi</button>
        </div>
      );
    }
    const p = editingProduct;
    const isGlobalStockEnabled = shop?.enable_stock !== false;

    return (
      <div className="p-4">
        <div className="flex items-center mb-6">
          <button 
            onClick={() => { 
              setIsAdding(false); 
              setEditingProduct(null);
            }}
            className="text-blue-600 font-medium mr-4"
          >
            Nyuma
          </button>
          <h1 className="text-xl font-bold text-gray-800">
            {p ? 'Hariri Bidhaa' : 'Ongeza Bidhaa'}
          </h1>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Jina la bidhaa</label>
            <input required name="name" defaultValue={p?.name} className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bei ya kununua</label>
              <input 
                required 
                type="text" 
                inputMode="numeric" 
                value={formBuyPrice}
                onChange={e => setFormBuyPrice(formatInputNumber(e.target.value))}
                className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bei ya kuuza</label>
              <input 
                required 
                type="text" 
                inputMode="numeric" 
                value={formSellPrice}
                onChange={e => setFormSellPrice(formatInputNumber(e.target.value))}
                className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
          </div>
          {shop?.enable_stock === false && (
            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl mb-4 border border-slate-100 shadow-sm select-none">
              <div>
                <span className="block text-sm font-semibold text-gray-800">Fuatilia Stoki ya Bidhaa</span>
                <span className="block text-xs text-gray-400 mt-0.5">Ruhusu mfumo kufuatilia idadi ya bidhaa hii stoo</span>
              </div>
              <button
                type="button"
                onClick={() => setFormTrackStock(!formTrackStock)}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${formTrackStock ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${formTrackStock ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          )}

          {(formTrackStock || shop?.enable_stock !== false) && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Idadi ya bidhaa</label>
                <input 
                  required={formTrackStock || shop?.enable_stock !== false}
                  type="text" 
                  inputMode="numeric" 
                  value={formStock}
                  onChange={e => setFormStock(formatInputNumber(e.target.value))}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tahadhari ya kuisha</label>
                <input 
                  required={formTrackStock || shop?.enable_stock !== false}
                  type="text" 
                  inputMode="numeric" 
                  value={formLowStock}
                  onChange={e => setFormLowStock(formatInputNumber(e.target.value))}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
            </div>
          )}

          {isExpiryEnabled && (formTrackStock || shop?.enable_stock !== false) && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tarehe ya Kuisha</label>
                <ExpiryDatePicker value={formExpiryDate} onChange={setFormExpiryDate} allowClear />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Siku za Tahadhari</label>
                <input 
                  type="text" 
                  inputMode="numeric" 
                  value={formNotifyDays}
                  onChange={e => setFormNotifyDays(formatInputNumber(e.target.value))}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
            </div>
          )}
          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl mt-6">
            Hifadhi Bidhaa
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="px-3 pt-2 pb-0 flex flex-col h-full bg-gray-50/30">
      <div className="flex flex-col gap-1.5 mb-2">
        <div className="flex items-center justify-between overflow-x-auto no-scrollbar py-0.5">
          <div className="flex items-center space-x-1.5">
            {isBoss() && products.length > 0 && (
              <button 
                onClick={handleDeleteAll}
                className="bg-red-50 text-red-600 p-2 rounded-full border border-red-100 shrink-0"
                title="Futa Bidhaa Zote"
              >
                <Trash2 className="w-6 h-6" />
              </button>
            )}
            {canManageProducts && (
              <button 
                onClick={() => setIsQuickAddOpen(!isQuickAddOpen)}
                className={`p-2 rounded-full border transition-colors shrink-0 ${isQuickAddOpen ? 'bg-orange-600 text-white border-orange-700' : 'bg-orange-50 text-orange-600 border-orange-100'}`}
                title="Quick Add Mode (Chat)"
              >
                <Zap className="w-6 h-6" />
              </button>
            )}
            {/*canManageProducts && (
              <button 
                onClick={() => setIsStockAuditModalOpen(true)}
                className="bg-orange-50 text-orange-600 p-2 rounded-full border border-orange-100 shrink-0"
                title="AI Stock Audit (Hesabu stock)"
              >
                <TrendingUp className="w-6 h-6" />
              </button>
            )*/}
            {canManageProducts && (
              <button 
                onClick={() => setIsAIScanModalOpen(true)}
                className="bg-green-50 text-green-600 p-2 rounded-full border border-green-100 shrink-0"
                title="Sajili kwa Venics Assistant (Picha)"
              >
                <Camera className="w-6 h-6" />
              </button>
            )}
            {canManageProducts && (
              <button 
                onClick={() => setIsImportModalOpen(true)}
                className="bg-white text-gray-700 p-2 rounded-full border border-gray-100 shrink-0"
                title="Ingiza kutoka Excel"
              >
                <Upload className="w-6 h-6" />
              </button>
            )}
            {isBoss() && (
              <button
                onClick={() => setShowCatalog(true)}
                className="bg-blue-50 text-blue-600 p-2 rounded-full border border-blue-100 shrink-0"
                title="Pakua Orodha ya Bidhaa"
              >
                <FileDown className="w-6 h-6" />
              </button>
            )}
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-blue-600 text-white p-2.5 rounded-full shadow-lg hover:bg-blue-700 transition-all shrink-0 ml-1 active:scale-95"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
        <div className="flex justify-center">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.15em] bg-white px-3 py-0.5 rounded-full border border-gray-100 shadow-sm leading-none">
            Stock: <span className="text-gray-900">{products.length}</span>
          </span>
        </div>
      </div>

      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input 
          type="text" 
          placeholder="Tafuta bidhaa..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
        />
      </div>

      {isBoss() && (
        <div className="bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between mb-2 select-none">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-50 p-2 rounded-xl">
              <Package className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <span className="block text-sm font-semibold text-gray-800">Usimamizi wa Stoki (Duka Zima)</span>
              <span className="block text-xs text-gray-400 mt-0.5">Washa au zima ufuatiliaji wa stoki dukanani kwako</span>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleStock}
            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${shop?.enable_stock !== false ? 'bg-blue-600' : 'bg-gray-200'}`}
          >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${shop?.enable_stock !== false ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0" ref={containerRef}>
        {filteredProducts.length > 0 ? (
          <List
            rowCount={filteredProducts.length}
            rowHeight={120} // 110px height + 10px gap
            rowComponent={ProductRow}
            rowProps={{}}
            style={{ width: '100%', height: listHeight || 500 }}
          />
        ) : products.length === 0 && isBoss() ? (
          <div className="flex flex-col items-center justify-center text-center py-12 px-6">
            <div className="text-5xl mb-3">📦</div>
            <h3 className="font-bold text-gray-900 mb-1">Bado hujaweka bidhaa</h3>
            <p className="text-sm text-gray-500 mb-5 max-w-xs">
              Anza haraka — pakua orodha ya bidhaa za duka lako, hariri kisha hifadhi.
            </p>
            <button
              onClick={() => setShowCatalog(true)}
              className="px-6 py-3 rounded-xl bg-blue-600 text-white font-bold shadow-lg hover:bg-blue-700 transition-colors"
            >
              📥 Pakua Orodha ya Bidhaa
            </button>
          </div>
        ) : (
          <div className="text-center text-gray-500 py-10">
            Hakuna bidhaa zilizopatikana.
          </div>
        )}
      </div>

      {isQuickAddOpen && (
        <div className="fixed bottom-20 left-4 right-4 z-40 animate-in slide-in-from-bottom-4 duration-300">
          <form 
            onSubmit={handleQuickAdd}
            className="bg-white p-3 rounded-2xl shadow-2xl border border-orange-100 flex items-center space-x-2"
          >
            <div className="bg-orange-100 p-2 rounded-xl">
              <Zap className="w-5 h-5 text-orange-600" />
            </div>
            <input 
              autoFocus
              value={quickAddText}
              onChange={(e) => setQuickAddText(e.target.value)}
              placeholder="Soda 500 700 24"
              className="flex-1 bg-transparent border-none outline-none text-sm font-bold placeholder:text-gray-300"
              disabled={isProcessingQuickAdd}
            />
            <button 
              type="submit"
              disabled={!quickAddText.trim() || isProcessingQuickAdd}
              className={`p-2 rounded-xl transition-all ${quickAddText.trim() ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-100 text-gray-400'}`}
            >
              {isProcessingQuickAdd ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </form>
          <p className="text-[10px] text-gray-400 mt-2 px-2 italic">
            Andika: <b>Jina Bei_Kununua Bei_Kuuza Stock</b> na bonyeza Enter.
          </p>
        </div>
      )}

      {/* Stock Addition Modal */}
      {stockModalProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-xl font-bold text-gray-800 mb-2">Ongeza Stock</h2>
            <p className="text-gray-600 mb-4">
              Bidhaa: <span className="font-bold text-gray-900">{stockModalProduct.name}</span><br />
              {!hideStock && (
                <>Zilizopo sasa: <span className="font-bold text-gray-900">{stockModalProduct.stock}</span></>
              )}
            </p>
            
            <form onSubmit={handleAddStockSubmit}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Weka idadi ya kuongeza</label>
              <input 
                autoFocus
                required
                type="text"
                inputMode="numeric"
                placeholder="Mfano: 10"
                value={stockToAdd}
                onChange={e => setStockToAdd(formatInputNumber(e.target.value))}
                className="w-full p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-4 text-lg"
              />

              {isExpiryEnabled && (
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                      <Calendar className="w-4 h-4 mr-1" /> Tarehe ya Kuisha (Expiry)
                    </label>
                    <ExpiryDatePicker value={expiryDate} onChange={setExpiryDate} allowClear />
                  </div>
                </div>
              )}
              
              <div className="flex space-x-3">
                <button 
                  type="button"
                  onClick={() => { setStockModalProduct(null); setStockToAdd(''); }}
                  className="flex-1 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl"
                >
                  Ghairi
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-100"
                >
                  Ongeza
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Batch Management Modal */}
      {batchModalProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl flex flex-col max-h-[80vh]">
            <h2 className="text-xl font-bold text-gray-800 mb-2">Simamia Batches & Expiry</h2>
            <p className="text-gray-600 mb-4">
              Bidhaa: <span className="font-bold text-gray-900">{batchModalProduct.name}</span>
            </p>
            
            <div className="flex-1 overflow-y-auto space-y-3 mb-6">
              {batchModalProduct.batches && batchModalProduct.batches.length > 0 ? (
                batchModalProduct.batches.map((batch, index) => (
                  <div key={batch.id} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        {/* Each batch is identified by its count and its expiry
                            date. With the count withheld the rows would be
                            indistinguishable, so they fall back to a number —
                            the boss hid how much is on the shelf, not which
                            row is which. */}
                        <p className="text-xs font-bold text-gray-400 uppercase">{hideStock ? 'Batch' : 'Stock'}</p>
                        <p className="font-bold text-blue-600">{hideStock ? index + 1 : batch.stock}</p>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Tarehe ya Kuisha</label>
                      <ExpiryDatePicker
                        value={batch.expiry_date ? batch.expiry_date.split('T')[0] : ''}
                        allowClear
                        onChange={async (newDate) => {
                          if (!batchModalProduct.id) return;
                          const oldDate = batch.expiry_date;
                          const updatedBatches = [...batchModalProduct.batches];
                          updatedBatches[index] = {
                            ...batch,
                            // '' clears the expiry — the batch is then treated as non-expiring.
                            expiry_date: newDate ? new Date(newDate).toISOString() : '',
                          };
                          await db.products.update(batchModalProduct.id, {
                            batches: updatedBatches,
                            updated_at: nowIso(),
                            synced: 0,
                          });
                          // Refresh the modal's snapshot so the picker reflects the change.
                          setBatchModalProduct({ ...batchModalProduct, batches: updatedBatches });
                          SyncService.logAction('edit_product', {
                            product_id: batchModalProduct.id,
                            name: batchModalProduct.name,
                            changes: {
                              expiry_date: {
                                old: oldDate ? oldDate.split('T')[0] : 'N/A',
                                new: newDate || 'Hakuna',
                              },
                            },
                          });
                          SyncService.sync();
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500 italic">
                  Hakuna batches zilizopatikana kwa bidhaa hii.
                </div>
              )}
            </div>
            
            <button 
              onClick={() => setBatchModalProduct(null)}
              className="w-full py-4 bg-gray-800 text-white font-bold rounded-xl shadow-lg"
            >
              Funga
            </button>
          </div>
        </div>
      )}

      {/* Excel Import Modal */}
      {user?.shopId && (
        <ExcelImportModal 
          isOpen={isImportModalOpen} 
          onClose={() => setIsImportModalOpen(false)} 
          shopId={user.shopId} 
        />
      )}

      {/* Product Catalog (starter pack) Modal — boss only */}
      {user?.shopId && (
        <CatalogModal
          show={showCatalog}
          onClose={() => setShowCatalog(false)}
          shopId={user.shopId}
          enableExpiry={isExpiryEnabled}
          stockEnabled={shop?.enable_stock !== false}
          currency={currency}
        />
      )}

      {/* AI Scan Onboarding Modal */}
      {user?.shopId && (
        <AIScanModal
          isOpen={isAIScanModalOpen}
          onClose={() => setIsAIScanModalOpen(false)}
          shopId={user.shopId}
          onSuccess={() => {
            showToast('Bidhaa zako zimeongezwa kwa mafanikio!', 'success');
          }}
        />
      )}

      {/* Stock Audit Modal */}
      {user?.shopId && (
        <StockAuditModal
          isOpen={isStockAuditModalOpen}
          onClose={() => setIsStockAuditModalOpen(false)}
          products={products}
          onSuccess={(msg) => {
            showToast(msg, 'success');
          }}
        />
      )}

      {/* Wiping the catalogue: typed sentence, not a yes/no click. */}
      <TypeToConfirm
        open={isDeleteAllOpen}
        title="Futa Bidhaa Zote"
        phrase={DELETE_ALL_PRODUCTS_PHRASE}
        description={
          <>
            Utafuta <b className="text-gray-900">bidhaa {products.length}</b> zote zilizopo.
            Kitendo hiki <b className="text-red-600">hakiwezi kutenguliwa</b>, na bidhaa
            zitafutwa pia kwenye simu na kompyuta nyingine za duka hili.
          </>
        }
        confirmLabel="Futa Zote"
        onConfirm={performDeleteAll}
        onClose={() => setIsDeleteAllOpen(false)}
      />
    </div>
  );
}
