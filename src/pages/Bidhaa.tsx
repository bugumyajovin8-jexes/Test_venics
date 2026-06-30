import { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Product } from '../db';
import { formatCurrency, formatInputNumber, parseInputNumber } from '../utils/format';
import { getValidStock, getSales30DaysVelocityMap, getDynamicThreshold, isProductStockTracked } from '../utils/stock';
import { Plus, Search, Edit, Trash2, AlertCircle, FileDown, Upload, Clock, Calendar, Camera, Zap, Send, RefreshCw, TrendingUp } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { SyncService } from '../services/sync';
import ExcelImportModal from '../components/ExcelImportModal';
import AIScanModal from '../components/AIScanModal';
import StockAuditModal from '../components/StockAuditModal';
import { format, isAfter, isBefore, addDays } from 'date-fns';
import { List, RowComponentProps } from 'react-window';

interface ProductRowProps {
  filteredProducts: Product[];
  shop: any;
  isExpiryEnabled: boolean;
  canManageProducts: boolean;
  currency: string;
  velocityMap: Record<string, number>;
  isBoss: () => boolean;
  setStockModalProduct: (p: Product | null) => void;
  setBatchModalProduct: (p: Product | null) => void;
  setEditingProduct: (p: Product | null) => void;
  handleDelete: (id: string) => void;
  setToggleOffWarning: (w: any) => void;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const ProductRow = ({ 
  index, 
  style, 
  filteredProducts,
  shop,
  isExpiryEnabled,
  canManageProducts,
  currency,
  velocityMap,
  isBoss,
  setStockModalProduct,
  setBatchModalProduct,
  setEditingProduct,
  handleDelete,
  setToggleOffWarning,
  showToast
}: RowComponentProps<ProductRowProps>) => {
  const product = filteredProducts[index];
  if (!product) return null;
  
  const isTracked = isProductStockTracked(product, shop);
  const validStock = getValidStock(product, isExpiryEnabled);
  const dynamicThreshold = getDynamicThreshold(product.id, product.min_stock, velocityMap);
  const isLow = isTracked && (validStock <= dynamicThreshold);
  
  return (
    <div style={style} className="px-1">
      <div className={`bg-white p-4 rounded-xl shadow-sm border flex justify-between items-center h-[110px] ${product.sell_price < product.buy_price ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)] animate-pulse' : 'border-gray-100'}`}>
        <div className="flex-1 min-w-0 mr-4">
          <h3 className="font-bold text-gray-800 truncate">{product.name}</h3>
          <div className="text-sm text-gray-500 mt-1">
            Bei: {formatCurrency(product.sell_price, currency)}
          </div>
          <div className="flex items-center mt-2 flex-wrap gap-1.5">
            {isTracked ? (
              <>
                <span className={`text-xs font-medium px-2 py-1 rounded-md ${isLow ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                  Zilizopo: {validStock}
                </span>
                {canManageProducts && (
                  <button 
                    onClick={(e) => { e.preventDefault(); setStockModalProduct(product); }}
                    className="bg-blue-100 text-blue-700 p-1 rounded-md transition-colors relative cursor-pointer touch-manipulation select-none"
                    style={{ 
                      WebkitTapHighlightColor: 'transparent',
                      WebkitTouchCallout: 'none',
                      touchAction: 'manipulation'
                    }}
                    title="Ongeza idadi ya bidhaa"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
                {canManageProducts && isExpiryEnabled && (
                  <button 
                    onClick={(e) => { e.preventDefault(); setBatchModalProduct(product); }}
                    className="bg-orange-100 text-orange-700 p-1 rounded-md transition-colors relative cursor-pointer touch-manipulation select-none"
                    style={{ 
                      WebkitTapHighlightColor: 'transparent',
                      WebkitTouchCallout: 'none',
                      touchAction: 'manipulation'
                    }}
                    title="Simamia tarehe za kuisha"
                  >
                    <Calendar className="w-4 h-4" />
                  </button>
                )}
                {isLow && (
                  <span title="Stock Iko Chini"><AlertCircle className="w-4 h-4 text-red-500 ml-1 animate-pulse" /></span>
                )}
              </>
            ) : (
              <span className="text-xs font-medium px-2 py-1 rounded-md bg-slate-100 text-slate-500">
                Sio lazima stoki
              </span>
            )}

            {isBoss() && shop?.enable_stock === false && (
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const isCurrentlyTracked = product.track_stock === true;
                  if (isCurrentlyTracked) {
                    setToggleOffWarning({
                      type: 'individual',
                      productName: product.name,
                      onConfirm: async () => {
                        await db.products.update(product.id, {
                          track_stock: false,
                          updated_at: new Date().toISOString(),
                          synced: 0
                        });
                        SyncService.sync();
                        showToast(`Ufuatiliaji wa stoki ya ${product.name} umezimwa.`, 'success');
                        setToggleOffWarning(null);
                      }
                    });
                  } else {
                    await db.products.update(product.id, {
                      track_stock: true,
                      updated_at: new Date().toISOString(),
                      synced: 0
                    });
                    SyncService.sync();
                    showToast(`Sasa stoki ya ${product.name} itafuatiliwa.`, 'success');
                  }
                }}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-pointer select-none transition-all touch-manipulation ${product.track_stock === true ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}
                title="Bofya kubadili ufuatiliaji wa stoki kwa bidhaa hii"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                {product.track_stock === true ? 'Fuatilia: Ndio' : 'Fuatilia: Hapana'}
              </button>
            )}

            {product.sell_price < product.buy_price && (
              <span title="Inauzwa kwa Hasara"><AlertCircle className="w-4 h-4 text-red-600 ml-1 animate-pulse" /></span>
            )}
          </div>
        </div>
        {canManageProducts && (
          <div className="flex space-x-2 shrink-0">
            <button 
              onClick={(e) => { e.preventDefault(); setEditingProduct(product); }}
              className="p-2 text-blue-600 bg-blue-50 rounded-lg cursor-pointer touch-manipulation select-none transition-all"
              style={{ 
                WebkitTapHighlightColor: 'transparent',
                WebkitTouchCallout: 'none',
                touchAction: 'manipulation'
              }}
            >
              <Edit className="w-5 h-5" />
            </button>
            <button 
              onClick={(e) => { e.preventDefault(); product.id && handleDelete(product.id); }}
              className="p-2 text-red-600 bg-red-50 rounded-lg cursor-pointer touch-manipulation select-none transition-all"
              style={{ 
                WebkitTapHighlightColor: 'transparent',
                WebkitTouchCallout: 'none',
                touchAction: 'manipulation'
              }}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

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
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [isProcessingQuickAdd, setIsProcessingQuickAdd] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockModalProduct, setStockModalProduct] = useState<Product | null>(null);
  const [batchModalProduct, setBatchModalProduct] = useState<Product | null>(null);
  const [stockToAdd, setStockToAdd] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [isLossModalOpen, setIsLossModalOpen] = useState(false);
  const [guardrailWarning, setGuardrailWarning] = useState<{ buy: number; sell: number; name: string; onConfirm: () => Promise<void> } | null>(null);
  const [toggleOffWarning, setToggleOffWarning] = useState<{ type: 'global' | 'individual' | 'form'; productName?: string; onConfirm: () => Promise<void> | void } | null>(null);

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
  const canManageProducts = isBoss() || isFeatureEnabled('staff_product_management');
  const globalStockEnabled = shop?.enable_stock !== false;

  // Form states for formatting
  const [formBuyPrice, setFormBuyPrice] = useState('');
  const [formSellPrice, setFormSellPrice] = useState('');
  const [formStock, setFormStock] = useState('');
  const [formLowStock, setFormLowStock] = useState('5');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formNotifyDays, setFormNotifyDays] = useState('30');
  const [formTrackStock, setFormTrackStock] = useState(true);

  useEffect(() => {
    if (editingProduct) {
      setFormBuyPrice(editingProduct.buy_price.toLocaleString());
      setFormSellPrice(editingProduct.sell_price.toLocaleString());
      setFormStock(editingProduct.stock.toLocaleString());
      setFormLowStock(editingProduct.min_stock.toLocaleString());
      setFormTrackStock(editingProduct.track_stock === true);
      if (editingProduct.notify_expiry_days) {
        setFormNotifyDays(editingProduct.notify_expiry_days.toString());
      } else {
        setFormNotifyDays('30');
      }
    } else {
      setFormBuyPrice('');
      setFormSellPrice('');
      setFormStock('');
      setFormLowStock('5');
      setFormTrackStock(globalStockEnabled);
      setFormExpiryDate('');
      setFormNotifyDays('30');
    }
  }, [editingProduct, isAdding, globalStockEnabled]);



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

  const lossProducts = useMemo(() => {
    return products.filter(p => p.sell_price < p.buy_price);
  }, [products]);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const formData = new FormData(e.currentTarget);
      const name = formData.get('name') as string;
      const stock = formTrackStock ? parseInputNumber(formStock) : 0;
      const minStock = formTrackStock ? parseInputNumber(formLowStock) : 0;
      const notifyDays = parseInputNumber(formNotifyDays);
      
      const currentStock = editingProduct?.stock || 0;
      const stockChange = stock - currentStock;

      let updatedBatches = formTrackStock ? (editingProduct?.batches || []) : [];
      const totalBatchStock = updatedBatches.reduce((sum, b) => sum + Number(b.stock), 0);
      
      // If user reduced stock below total batch stock, we need to adjust batches
      if (formTrackStock && stock < totalBatchStock) {
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
        name: name,
        buy_price: rawBuyPrice,
        sell_price: rawSellPrice,
        stock: stock,
        min_stock: minStock,
        unit: 'pcs',
        batches: updatedBatches,
        stock_delta: (editingProduct?.stock_delta || 0) + stockChange,
        notify_expiry_days: isExpiryEnabled ? notifyDays : undefined,
        track_stock: globalStockEnabled ? true : formTrackStock,
        created_at: editingProduct?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        synced: 0,
        isDeleted: 0
      };

      // If it's a new product with stock and expiry is enabled, create an initial batch
      if (!editingProduct && stock > 0 && isExpiryEnabled) {
        product.batches = [{
          id: uuidv4(),
          batch_number: `B-${Date.now()}`,
          expiry_date: formExpiryDate ? new Date(formExpiryDate).toISOString() : new Date(addDays(new Date(), 365)).toISOString(),
          stock: stock
        }];
      }

      const executeSave = async () => {
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
        setGuardrailWarning(null);
        SyncService.sync();
      };

      const ratio = rawBuyPrice > 0 ? (rawSellPrice / rawBuyPrice) : 1;
      if (rawBuyPrice > 0 && (ratio > 5 || ratio < 1)) {
        setGuardrailWarning({
          buy: rawBuyPrice,
          sell: rawSellPrice,
          name: name,
          onConfirm: executeSave
        });
        return;
      }

      await executeSave();
    } catch (err) {
      console.error('Save product error:', err);
    }
  };

  const handleDelete = (id: string) => {
    showConfirm('Futa Bidhaa', 'Una uhakika unataka kufuta bidhaa hii?', async () => {
      const product = await db.products.get(id);
      await db.products.update(id, { 
        isDeleted: 1, 
        synced: 0, 
        updated_at: new Date().toISOString() 
      });
      
      if (product) {
        SyncService.logAction('delete_product', { product_id: id, name: product.name });
      }
      SyncService.sync();
    });
  };

  const handleDeleteAll = () => {
    showConfirm('Futa Bidhaa Zote', 'Je, una uhakika unataka kufuta bidhaa ZOTE? Kitendo hiki hakiwezi kutenguliwa na kitafuta bidhaa zote zilizopo.', async () => {
      try {
        const productIds = products.map(p => p.id).filter((id): id is string => !!id);
        const count = productIds.length;
        
        await Promise.all(productIds.map(id => 
          db.products.update(id, { 
            isDeleted: 1, 
            synced: 0, 
            updated_at: new Date().toISOString() 
          })
        ));
        
        // Log action
        await SyncService.logAction('delete_all_products', { count });
        
        SyncService.sync();
        showAlert('Imefanikiwa', `Bidhaa zote ${count} zimefutwa kikamilifu.`);
      } catch (err) {
        console.error('Failed to delete all products:', err);
        showAlert('Kosa', 'Imeshindwa kufuta bidhaa zote. Tafadhali jaribu tena.');
      }
    });
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
        await db.transaction('rw', [db.products, db.auditLogs], async () => {
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
            updated_at: new Date().toISOString(),
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
        track_stock: globalStockEnabled,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        synced: 0,
        isDeleted: 0
      };

      const executeQuickAdd = async () => {
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
        setGuardrailWarning(null);
      };

      const ratio = buyPrice > 0 ? (sellPrice / buyPrice) : 1;
      if (buyPrice > 0 && (ratio > 5 || ratio < 1)) {
        setGuardrailWarning({
          buy: buyPrice,
          sell: sellPrice,
          name: name,
          onConfirm: executeQuickAdd
        });
        setIsProcessingQuickAdd(false);
        return;
      }

      await executeQuickAdd();
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

    return (
      <div className="p-4">
        <div className="flex items-center mb-6">
          <button 
            onClick={() => { 
              setIsAdding(false); 
              setEditingProduct(null);
              setFormBuyPrice('');
              setFormSellPrice('');
              setFormStock('');
              setFormLowStock('5');
              setFormExpiryDate('');
              setFormNotifyDays('30');
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
          {/* Stock Tracking Toggle */}
          {!globalStockEnabled && (
            <div className="flex items-center justify-between bg-gray-50/50 p-3 rounded-xl border border-gray-200">
              <div className="flex flex-col mr-4">
                <span className="text-sm font-semibold text-gray-700">Fuatilia stoki ya bidhaa hii</span>
                <span className="text-[11px] text-gray-400">Ukizima, utaweza kuuza bidhaa hii bila kikomo cha stoki</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (formTrackStock) {
                    const currentName = (document.getElementsByName('name')[0] as HTMLInputElement)?.value || 'Bidhaa hii';
                    setToggleOffWarning({
                      type: 'form',
                      productName: currentName,
                      onConfirm: () => {
                        setFormTrackStock(false);
                        setToggleOffWarning(null);
                      }
                    });
                  } else {
                    setFormTrackStock(true);
                  }
                }}
                className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 outline-none shrink-0 cursor-pointer ${
                  formTrackStock ? 'bg-blue-600' : 'bg-gray-200'
                }`}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <div
                  className={`bg-white w-5 h-5 rounded-full shadow-md transform duration-200 ease-in-out ${
                    formTrackStock ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          )}

          {formTrackStock && (
            <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Idadi ya bidhaa</label>
                <input 
                  required={formTrackStock} 
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
                  required={formTrackStock} 
                  type="text" 
                  inputMode="numeric" 
                  value={formLowStock}
                  onChange={e => setFormLowStock(formatInputNumber(e.target.value))}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
            </div>
          )}

          {isExpiryEnabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tarehe ya Kuisha</label>
                <input 
                  type="date" 
                  value={formExpiryDate}
                  onChange={e => setFormExpiryDate(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                />
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
          <button 
            type="submit" 
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl mt-6 cursor-pointer touch-manipulation select-none transition-all" 
            style={{ 
              WebkitTapHighlightColor: 'transparent',
              WebkitTouchCallout: 'none',
              touchAction: 'manipulation'
            }}
          >
            Hifadhi Bidhaa
          </button>
        </form>

        {/* Pricing guardrail warning modal specifically for the addition/editing overlay */}
        {guardrailWarning && (
          <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200 shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center bg-orange-50">
                <AlertCircle className="w-6 h-6 text-orange-500 mr-2 animate-bounce flex-shrink-0" />
                <h2 className="text-lg font-bold text-orange-700 font-sans">Uhakiki wa Bei</h2>
              </div>
              
              <div className="p-5 text-gray-700 space-y-3 font-sans">
                <p className="font-semibold text-gray-800 text-sm">
                  Bidhaa: <span className="text-blue-600">[{guardrailWarning.name}]</span>
                </p>
                <p className="text-sm leading-relaxed">
                  Umeingiza bei ya kununulia <span className="font-bold text-gray-900">TZS {guardrailWarning.buy.toLocaleString()}</span> na kuuza <span className="font-bold text-gray-900">TZS {guardrailWarning.sell.toLocaleString()}</span>. Je, una uhakika takwimu hizi ni sahihi?
                </p>
              </div>
              
              <div className="p-4 bg-gray-50 border-t border-gray-100 flex space-x-3">
                <button 
                  type="button"
                  onClick={() => setGuardrailWarning(null)}
                  className="flex-1 py-3 bg-gray-200 text-gray-800 font-bold rounded-xl transition-all text-sm cursor-pointer select-none touch-manipulation"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}
                >
                  Hapana, Rekebisha
                </button>
                <button 
                  type="button"
                  onClick={async () => {
                    await guardrailWarning.onConfirm();
                  }}
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl transition-all text-sm cursor-pointer select-none touch-manipulation"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}
                >
                  Ndio, Hifadhi
                </button>
              </div>
            </div>
          </div>
        )}

        {toggleOffWarning && (
          <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200 shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center bg-red-50">
                <AlertCircle className="w-6 h-6 text-red-500 mr-2 animate-bounce flex-shrink-0" />
                <h2 className="text-lg font-bold text-red-700">Kuzima Ufuatiliaji wa Stoki</h2>
              </div>
              
              <div className="p-5 text-gray-700 space-y-3 overflow-y-auto flex-1 font-sans">
                <p className="text-sm font-semibold text-gray-800">
                  {toggleOffWarning.type === 'global' 
                    ? 'Kuzima ufuatiliaji wa stoki globally kutakuacha bila udhibiti wa bidhaa zako zote.' 
                    : `Kuzima ufuatiliaji wa stoki kwa "${toggleOffWarning.productName || 'bidhaa hii'}" kutaondoa udhibiti wa idadi yake.`
                  }
                </p>
                
                <div className="text-xs space-y-2.5 text-gray-600 bg-gray-50 p-3.5 rounded-xl border border-gray-200">
                  <p className="font-bold text-gray-700 text-[11px] uppercase tracking-wider">Madhara ya kuzima:</p>
                  
                  <div className="space-y-2">
                    <div className="flex items-start">
                      <span className="text-red-500 mr-1.5 font-bold">•</span>
                      <p className="leading-tight">
                        <strong className="text-gray-800">Upotevu wa Udhibiti:</strong> Hautajua una kiasi gani cha bidhaa hii dukani, hivyo unaweza kupoteza mali bila kugundua.
                      </p>
                    </div>
                    
                    <div className="flex items-start">
                      <span className="text-red-500 mr-1.5 font-bold">•</span>
                      <p className="leading-tight">
                        <strong className="text-gray-800">Kuuza visivyopo:</strong> Wafanyakazi wataweza kuuza hata kama stoki halisi imeisha, jambo linaloweza kuleta migogoro na wateja.
                      </p>
                    </div>
                    
                    <div className="flex items-start">
                      <span className="text-red-500 mr-1.5 font-bold">•</span>
                      <p className="leading-tight">
                        <strong className="text-gray-800">Kukosa Thamani ya Mtaji:</strong> Thamani ya duka (Jumla ya Mtaji) haitahesabiwa kwa usahihi kwa bidhaa zisizofuatiliwa.
                      </p>
                    </div>
                    
                    <div className="flex items-start">
                      <span className="text-red-500 mr-1.5 font-bold">•</span>
                      <p className="leading-tight">
                        <strong className="text-gray-800">Hakuna Tahadhari:</strong> Programu haitakupa taarifa stoki inapokaribia kuisha ili uagize zingine kwa wakati.
                      </p>
                    </div>
                  </div>
                </div>
                
                <p className="text-xs text-gray-500 leading-tight">
                  Je, una uhakika unataka kuendelea na kuzima ufuatiliaji wa stoki?
                </p>
              </div>
              
              <div className="p-4 bg-gray-50 border-t border-gray-100 flex space-x-3">
                <button 
                  type="button"
                  onClick={() => setToggleOffWarning(null)}
                  className="flex-1 py-3 bg-gray-200 text-gray-800 font-bold rounded-xl transition-all text-sm cursor-pointer select-none touch-manipulation"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}
                >
                  Hapana, Ghairi
                </button>
                <button 
                  type="button"
                  onClick={async () => {
                    await toggleOffWarning.onConfirm();
                  }}
                  className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl transition-all text-sm cursor-pointer select-none touch-manipulation"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}
                >
                  Ndio, Zima
                </button>
              </div>
            </div>
          </div>
        )}
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
                onClick={(e) => { e.preventDefault(); handleDeleteAll(); }}
                className="bg-red-50 text-red-600 p-2 rounded-full border border-red-100 shrink-0 cursor-pointer touch-manipulation select-none transition-all"
                title="Futa Bidhaa Zote"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                <Trash2 className="w-6 h-6" />
              </button>
            )}
            {canManageProducts && (
              <button 
                onClick={(e) => { e.preventDefault(); setIsQuickAddOpen(!isQuickAddOpen); }}
                className={`p-2 rounded-full border transition-all shrink-0 cursor-pointer touch-manipulation select-none ${isQuickAddOpen ? 'bg-orange-600 text-white border-orange-700' : 'bg-orange-50 text-orange-600 border-orange-100'}`}
                title="Quick Add Mode (Chat)"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
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
                onClick={(e) => { e.preventDefault(); setIsAIScanModalOpen(true); }}
                className="bg-green-50 text-green-600 p-2 rounded-full border border-green-100 shrink-0 cursor-pointer touch-manipulation select-none transition-all"
                title="Sajili kwa Venics Smart (Picha)"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                <Camera className="w-6 h-6" />
              </button>
            )}
            {canManageProducts && (
              <button 
                onClick={(e) => { e.preventDefault(); setIsImportModalOpen(true); }}
                className="bg-white text-gray-700 p-2 rounded-full border border-gray-100 shrink-0 cursor-pointer touch-manipulation select-none transition-all"
                title="Ingiza kutoka Excel"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                <Upload className="w-6 h-6" />
              </button>
            )}
          </div>
          <button 
            onClick={(e) => { e.preventDefault(); setIsAdding(true); }}
            className="bg-blue-600 text-white p-2.5 rounded-full shadow-lg transition-all shrink-0 ml-1 cursor-pointer touch-manipulation select-none"
            title="Sajili Bidhaa Mpya"
            style={{ 
              WebkitTapHighlightColor: 'transparent',
              WebkitTouchCallout: 'none',
              touchAction: 'manipulation'
            }}
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
        <div className={`flex items-center px-2 ${lossProducts.length > 0 ? 'justify-between' : 'justify-center'}`}>
          {lossProducts.length > 0 && (
            <button 
              onClick={(e) => { e.preventDefault(); setIsLossModalOpen(true); }}
              className="flex items-center space-x-1 border border-red-200 bg-red-50 text-red-600 px-3 py-1 rounded-full shadow-sm cursor-pointer touch-manipulation select-none transition-all"
              style={{ 
                WebkitTapHighlightColor: 'transparent',
                WebkitTouchCallout: 'none',
                touchAction: 'manipulation'
              }}
            >
              <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              <span className="text-[10px] font-black uppercase tracking-wider">Hasara: {lossProducts.length}</span>
            </button>
          )}
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.15em] bg-white px-3 py-1 rounded-full border border-gray-100 shadow-sm leading-none flex items-center">
            Stock: <span className="text-gray-900 ml-1">{products.length}</span>
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

      {/* Global Stock Tracking Settings Bar */}
      {isBoss() && (
        <div className="bg-white px-3 py-2.5 rounded-xl border border-gray-200/80 shadow-3xs mb-2 flex flex-col gap-1.5 animate-in slide-in-from-top duration-300">
          <div className="flex items-center justify-between">
            <div className="flex flex-col flex-1 mr-4">
              <span className="text-xs font-black text-gray-800 uppercase tracking-wider">Fuatilia Stoki ya Bidhaa</span>
              <span className="text-[10px] text-gray-500 mt-0.5 leading-tight">
                {shop?.enable_stock !== false 
                  ? "Inafuatilia stoki zote na kuzuia mauzo zikiisha kikapuni." 
                  : "Ufuatiliaji umezimwa globally. Unaweza kuchagua bidhaa maalum za kufuatilia hapa chini."}
              </span>
            </div>
             <button
              onClick={async (e) => {
                e.preventDefault();
                if (!shop || !user?.shopId) return;
                const currentVal = shop.enable_stock !== false;
                if (currentVal) {
                  setToggleOffWarning({
                    type: 'global',
                    onConfirm: async () => {
                      await db.shops.update(user.shopId!, {
                        enable_stock: false,
                        updated_at: new Date().toISOString(),
                        synced: 0
                      });

                      const shopProducts = await db.products.where('[shop_id+isDeleted]').equals([user.shopId!, 0]).toArray();
                      for (const prod of shopProducts) {
                        await db.products.update(prod.id, {
                          track_stock: false,
                          updated_at: new Date().toISOString(),
                          synced: 0
                        });
                      }

                      SyncService.sync();
                      showToast('Ufuatiliaji wa stoki globally umezimwa na bidhaa zote zimewekwa kutofuatiliwa.', 'success');
                      setToggleOffWarning(null);
                    }
                  });
                } else {
                  await db.shops.update(user.shopId, {
                    enable_stock: true,
                    updated_at: new Date().toISOString(),
                    synced: 0
                  });

                  const shopProducts = await db.products.where('[shop_id+isDeleted]').equals([user.shopId, 0]).toArray();
                  for (const prod of shopProducts) {
                    await db.products.update(prod.id, {
                      track_stock: true,
                      updated_at: new Date().toISOString(),
                      synced: 0
                    });
                  }

                  SyncService.sync();
                  showToast('Ufuatiliaji wa stoki umewashwa kwa bidhaa zote.', 'success');
                }
              }}
              className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 outline-none shrink-0 cursor-pointer ${
                shop?.enable_stock !== false ? 'bg-blue-600' : 'bg-gray-200'
              }`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <div
                className={`bg-white w-5 h-5 rounded-full shadow-md transform duration-200 ease-in-out ${
                  shop?.enable_stock !== false ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0" ref={containerRef}>
        {filteredProducts.length > 0 ? (
          <List
            rowCount={filteredProducts.length}
            rowHeight={120} // 110px height + 10px gap
            rowComponent={ProductRow}
            rowProps={{
              filteredProducts,
              shop,
              isExpiryEnabled,
              canManageProducts,
              currency,
              velocityMap,
              isBoss,
              setStockModalProduct,
              setBatchModalProduct,
              setEditingProduct,
              handleDelete,
              setToggleOffWarning,
              showToast
            }}
            style={{ width: '100%', height: listHeight || 500 }}
          />
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
             style={{ WebkitTapHighlightColor: 'transparent' }}>
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
              Zilizopo sasa: <span className="font-bold text-gray-900">{stockModalProduct.stock}</span>
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
                    <input 
                      type="date"
                      required
                      value={expiryDate}
                      onChange={e => setExpiryDate(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
              )}
              
              <div className="flex space-x-3">
                <button 
                  type="button"
                  onClick={() => { setStockModalProduct(null); setStockToAdd(''); }}
                  className="flex-1 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl transition-all cursor-pointer touch-manipulation select-none"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}
                >
                  Ghairi
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-100 cursor-pointer touch-manipulation select-none transition-all"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}>
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
                        <p className="text-xs font-bold text-gray-400 uppercase">Stock</p>
                        <p className="font-bold text-blue-600">{batch.stock}</p>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Tarehe ya Kuisha</label>
                      <input 
                        type="date"
                        defaultValue={batch.expiry_date ? batch.expiry_date.split('T')[0] : ''}
                        onChange={async (e) => {
                          const newDate = e.target.value;
                          if (newDate && batchModalProduct.id) {
                            const oldDate = batch.expiry_date;
                            const updatedBatches = [...batchModalProduct.batches];
                            updatedBatches[index] = {
                              ...batch,
                              expiry_date: new Date(newDate).toISOString()
                            };
                            await db.products.update(batchModalProduct.id, {
                              batches: updatedBatches,
                              updated_at: new Date().toISOString(),
                              synced: 0
                            });

                            // Log expiry date change
                            SyncService.logAction('edit_product', {
                              product_id: batchModalProduct.id,
                              name: batchModalProduct.name,
                              changes: {
                                expiry_date: { 
                                  old: oldDate ? oldDate.split('T')[0] : 'N/A', 
                                  new: newDate 
                                }
                              }
                            });

                            SyncService.sync();
                          }
                        }}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
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
              className="w-full py-4 bg-gray-800 text-white font-bold rounded-xl shadow-lg cursor-pointer touch-manipulation select-none transition-all"
              style={{ 
                WebkitTapHighlightColor: 'transparent',
                WebkitTouchCallout: 'none',
                touchAction: 'manipulation'
              }}
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

      {/* Loss Modal */}
      {isLossModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center bg-red-50">
              <AlertCircle className="w-6 h-6 text-red-500 mr-2" />
              <h2 className="text-lg font-bold text-red-700">Bidhaa Zinazouzwa kwa Hasara</h2>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1">
              {lossProducts.length > 0 ? (
                <div className="space-y-3">
                  {lossProducts.map(p => (
                    <div key={p.id} className="p-3 bg-red-50/50 border border-red-100 rounded-xl">
                      <h3 className="font-bold text-gray-800 text-sm truncate mb-1">{p.name}</h3>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-500">Kununua: <span className="font-bold text-gray-700">{formatCurrency(p.buy_price, currency)}</span></span>
                        <span className="text-gray-500">Kuuza: <span className="font-bold text-red-600">{formatCurrency(p.sell_price, currency)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">Hakuna bidhaa inauzwa hasara.</p>
              )}
            </div>
            
            <div className="p-4 bg-gray-50 border-t border-gray-100">
              <button 
                onClick={() => setIsLossModalOpen(false)}
                className="w-full py-4 bg-gray-800 text-white font-bold rounded-xl shadow-lg cursor-pointer touch-manipulation select-none transition-all"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                Funga
              </button>
            </div>
          </div>
        </div>
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

      {/* Smart pricing guardrail modal */}
      {guardrailWarning && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center bg-orange-50">
              <AlertCircle className="w-6 h-6 text-orange-500 mr-2 animate-bounce flex-shrink-0" />
              <h2 className="text-lg font-bold text-orange-700">Uhakiki wa Bei</h2>
            </div>
            
            <div className="p-5 text-gray-700 space-y-3">
              <p className="font-semibold text-gray-800 text-sm">
                Bidhaa: <span className="text-blue-600">[{guardrailWarning.name}]</span>
              </p>
              <p className="text-sm leading-relaxed">
                Umeingiza bei ya kununulia <span className="font-bold text-gray-900">TZS {guardrailWarning.buy.toLocaleString()}</span> na kuuza <span className="font-bold text-gray-900">TZS {guardrailWarning.sell.toLocaleString()}</span>. Je, una uhakika takwimu hizi ni sahihi?
              </p>
            </div>
            
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex space-x-3">
              <button 
                onClick={() => setGuardrailWarning(null)}
                className="flex-1 py-3 bg-gray-200 text-gray-800 font-bold rounded-xl transition-all text-sm cursor-pointer select-none touch-manipulation"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                Hapana, Rekebisha
              </button>
              <button 
                onClick={async () => {
                  await guardrailWarning.onConfirm();
                }}
                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl transition-all text-sm cursor-pointer select-none touch-manipulation"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                Ndio, Hifadhi
              </button>
            </div>
          </div>
        </div>
      )}

      {toggleOffWarning && (
        <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center bg-red-50">
              <AlertCircle className="w-6 h-6 text-red-500 mr-2 animate-bounce flex-shrink-0" />
              <h2 className="text-lg font-bold text-red-700 font-sans">Kuzima Ufuatiliaji wa Stoki</h2>
            </div>
            
            <div className="p-5 text-gray-700 space-y-3 overflow-y-auto flex-1 font-sans">
              <p className="text-sm font-semibold text-gray-800">
                {toggleOffWarning.type === 'global' 
                  ? 'Kuzima ufuatiliaji wa stoki globally kutakuacha bila udhibiti wa bidhaa zako zote.' 
                  : `Kuzima ufuatiliaji wa stoki kwa "${toggleOffWarning.productName || 'bidhaa hii'}" kutaondoa udhibiti wa idadi yake.`
                }
              </p>
              
              <div className="text-xs space-y-2.5 text-gray-600 bg-gray-50 p-3.5 rounded-xl border border-gray-200">
                <p className="font-bold text-gray-700 text-[11px] uppercase tracking-wider">Madhara ya kuzima:</p>
                
                <div className="space-y-2">
                  <div className="flex items-start">
                    <span className="text-red-500 mr-1.5 font-bold">•</span>
                    <p className="leading-tight">
                      <strong className="text-gray-800">Upotevu wa Udhibiti:</strong> Hautajua una kiasi gani cha bidhaa hii dukani, hivyo unaweza kupoteza mali bila kugundua.
                    </p>
                  </div>
                  
                  <div className="flex items-start">
                    <span className="text-red-500 mr-1.5 font-bold">•</span>
                    <p className="leading-tight">
                      <strong className="text-gray-800">Kuuza visivyopo:</strong> Wafanyakazi wataweza kuuza hata kama stoki halisi imeisha, jambo linaloweza kuleta migogoro na wateja.
                    </p>
                  </div>
                  
                  <div className="flex items-start">
                    <span className="text-red-500 mr-1.5 font-bold">•</span>
                    <p className="leading-tight">
                      <strong className="text-gray-800">Kukosa Thamani ya Mtaji:</strong> Thamani ya duka (Jumla ya Mtaji) haitahesabiwa kwa usahihi kwa bidhaa zisizofuatiliwa.
                    </p>
                  </div>
                  
                  <div className="flex items-start">
                    <span className="text-red-500 mr-1.5 font-bold">•</span>
                    <p className="leading-tight">
                      <strong className="text-gray-800">Hakuna Tahadhari:</strong> Programu haitakupa taarifa stoki inapokaribia kuisha ili uagize zingine kwa wakati.
                    </p>
                  </div>
                </div>
              </div>
              
              <p className="text-xs text-gray-500 leading-tight">
                Je, una uhakika unataka kuendelea na kuzima ufuatiliaji wa stoki?
              </p>
            </div>
            
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex space-x-3">
              <button 
                type="button"
                onClick={() => setToggleOffWarning(null)}
                className="flex-1 py-3 bg-gray-200 text-gray-800 font-bold rounded-xl transition-all text-sm cursor-pointer select-none touch-manipulation"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                Hapana, Ghairi
              </button>
              <button 
                type="button"
                onClick={async () => {
                  await toggleOffWarning.onConfirm();
                }}
                className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl transition-all text-sm cursor-pointer select-none touch-manipulation"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}
              >
                Ndio, Zima
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
