import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { Database, LogOut, RefreshCw, BarChart3, ChevronRight, Phone, Wallet, User, ShieldCheck, Trash2, Clock, AlertTriangle, X, CheckCircle, MessageSquare, Zap, Bell, Users, Plus, Shield, Settings, Ban, FileText, Store } from 'lucide-react';
import { supabase } from '../supabase';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { LicenseService } from '../services/license';
import { TelemetryService } from '../services/telemetry';
import { notifications } from '../services/notifications';
import { useNavigate, useLocation } from 'react-router-dom';
import { startOfDay, startOfWeek, startOfMonth, startOfYear, subDays, isBefore, isAfter, addDays, format } from 'date-fns';

export default function Zaidi() {
  const { user, logout, showAlert, showConfirm, isBoss, isFeatureEnabled, syncHealth } = useStore();
  const location = useLocation();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const products = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.products.filter(p => p.isDeleted !== 1 && p.shop_id === user.shopId).toArray();
  }, [user?.shopId]) || [];
  const navigate = useNavigate();

  const [isSyncing, setIsSyncing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedDeletePeriod, setSelectedDeletePeriod] = useState<'today' | 'week' | 'month' | 'year' | 'all' | null>(null);
  const [showExpiryList, setShowExpiryList] = useState(false);
  const [activeExpiryTab, setActiveExpiryTab] = useState<'expired' | 'near'>('expired');
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<'employee' | 'staff' | 'manager' | 'cashier'>('employee');
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showInventoryValue, setShowInventoryValue] = useState(false);
  const [newName, setNewName] = useState('');

  // --- MULTI-SHOP SYSTEM ---
  const [userShops, setUserShops] = useState<any[]>([]);
  const [loadingShops, setLoadingShops] = useState(false);
  const [showAddShopModal, setShowAddShopModal] = useState(false);
  const [newShopName, setNewShopName] = useState('');
  const [isAddingShop, setIsAddingShop] = useState(false);
  const [switchingShopId, setSwitchingShopId] = useState<string | null>(null);

  const fetchUserShops = async () => {
    if (!user?.id) return;
    setLoadingShops(true);
    try {
      const { data, error: err } = await supabase
        .from('shops')
        .select('*')
        .eq('created_by', user.id);
      
      if (err) throw err;
      setUserShops(data || []);

      // Cache locally
      if (data) {
        for (const s of data) {
          const existing = await db.shops.get(s.id);
          await db.shops.put({
            id: s.id,
            name: s.name,
            status: s.status,
            owner_name: s.owner_name,
            created_by: s.created_by,
            enable_expiry: s.enable_expiry,
            enable_stock: s.enable_stock !== undefined ? s.enable_stock : (existing ? existing.enable_stock : true),
            created_at: s.created_at,
            updated_at: s.updated_at,
            isDeleted: 0,
            synced: 1
          });
        }
      }
    } catch (e) {
      console.error('Error fetching shops:', e);
    } finally {
      setLoadingShops(false);
    }
  };

  useEffect(() => {
    if (isBoss()) {
      fetchUserShops();
    }
  }, [user?.id]);

  const handleAddShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShopName.trim() || !user) return;
    setIsAddingShop(true);
    try {
      const newShopId = uuidv4();
      const shopData = {
        id: newShopId,
        name: newShopName.trim(),
        status: 'active' as const,
        owner_name: user.name || user.email.split('@')[0],
        created_by: user.id,
        enable_expiry: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 1
      };

      // 1. Insert in Supabase
      const { error: shopError } = await supabase
        .from('shops')
        .insert({
          id: shopData.id,
          name: shopData.name,
          status: shopData.status,
          owner_name: shopData.owner_name,
          created_by: shopData.created_by,
          enable_expiry: shopData.enable_expiry,
          created_at: shopData.created_at,
          updated_at: shopData.updated_at
        });

      if (shopError) throw shopError;

      // 2. Put locally
      await db.shops.put(shopData);

      showAlert('Imefanikiwa', `Duka jipya "${newShopName}" limeundwa kikamilifu! Trial ya siku 14 na leseni zitaanzishwa utakapoingia kwenye duka hili.`);
      setNewShopName('');
      setShowAddShopModal(false);
      fetchUserShops();
    } catch (err: any) {
      console.error('Error adding shop:', err);
      showAlert('Kosa', err.message || 'Imeshindwa kuongeza duka.');
    } finally {
      setIsAddingShop(false);
    }
  };

  const handleSwitchShop = async (targetShopId: string, targetShopName: string) => {
    if (!user) return;
    if (user.shopId === targetShopId) {
      showAlert('Taarifa', 'Tayari upo kwenye duka hili.');
      return;
    }

    showConfirm('Badilisha Duka', `Je, una uhakika unataka kuhamia kwenye duka la "${targetShopName}"? Kikapu cha sasa kitafutwa na data za duka hili mpya zitasawazishwa bila kufuta data zako za duka hili la sasa kwenye kifaa hiki.`, async () => {
      setSwitchingShopId(targetShopId);
      try {
        // 1. Clear cart
        useStore.getState().clearCart();

        // 2. Update user.shop_id in Supabase
        const { error: userUpdateError } = await supabase
          .from('users')
          .update({
            shop_id: targetShopId,
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id);

        if (userUpdateError) throw userUpdateError;

        // 3. Clear pull throttle to allow immediate sync for the new shop
        SyncService.clearPullThrottleCache();

        // 4. Update state and local DB users
        const updatedUser = {
          ...user,
          shop_id: targetShopId,
          shopId: targetShopId,
          synced: 1
        };
        await db.users.put(updatedUser as any);
        useStore.getState().setAuth(useStore.getState().token!, updatedUser);

        // 5. Sync license for the new shop
        await LicenseService.syncLicense(true);

        // 6. Sync all other data tables full-sync for the new shop
        SyncService.sync(true, 'full').catch(console.error);

        showAlert('Imefanikiwa', `Umehamia kwenye duka la "${targetShopName}" kwa mafanikio! Mfumo unaanza kusawazisha bidhaa na rekodi.`);
        
        // Wait a small timeout to let state update, then navigate
        setTimeout(() => {
          navigate('/executive', { replace: true });
        }, 300);
      } catch (err: any) {
        console.error('Error switching shop:', err);
        showAlert('Kosa', err.message || 'Imeshindwa kuhamia kwenye duka jingine.');
      } finally {
        setSwitchingShopId(null);
      }
    });
  };

  // --- PENDING INVITATIONS SYSTEM ---
  const [pendingInvitations, setPendingInvitations] = useState<{ id: string; email: string; role: string; created_at: string }[]>([]);

  const fetchPendingInvitations = async () => {
    if (!user?.shopId) {
      setPendingInvitations([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('shop_invitations')
        .select('*')
        .eq('shop_id', user.shopId);
      if (error) {
        console.error('Error fetching shop_invitations:', error);
        return;
      }
      setPendingInvitations(data || []);
    } catch (e) {
      console.error('Error in fetchPendingInvitations:', e);
    }
  };

  useEffect(() => {
    fetchPendingInvitations();
    const interval = setInterval(() => {
      fetchPendingInvitations();
    }, 10000);
    return () => clearInterval(interval);
  }, [user?.shopId]);

  const handleCancelInvitation = async (id: string, email: string) => {
    showConfirm('Ghairi Mwaliko', `Je, una uhakika unataka kufuta mwaliko kwa ajili ya ${email}?`, async () => {
      try {
        const { error } = await supabase
          .from('shop_invitations')
          .delete()
          .eq('id', id);
        if (error) throw error;
        showAlert('Imefanikiwa', 'Mwaliko umefutwa kwa mafanikio.');
        fetchPendingInvitations();
      } catch (err: any) {
        console.error('Cancel invitation error:', err);
        showAlert('Kosa', err.message || 'Imeshindwa kufuta mwaliko');
      }
    });
  };

  const staff = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.users.filter(u => u.shop_id === user.shopId && u.id !== user.id).toArray();
  }, [user?.shopId, user?.id]) || [];

  const inventoryMetrics = useMemo(() => {
    return products.reduce((acc, p) => {
      acc.totalBuyingValue += (p.buy_price * p.stock);
      acc.totalSellingValue += (p.sell_price * p.stock);
      return acc;
    }, { totalBuyingValue: 0, totalSellingValue: 0 });
  }, [products]);

  const handleUpdateStaff = async () => {
    if (!editingStaffId) return;
    setIsAddingStaff(true);
    try {
      // Update the user's role and name
      const { error: updateError } = await supabase
        .from('users')
        .update({
          name: staffName,
          role: staffRole,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingStaffId)
        .eq('shop_id', user?.shopId); // Extra safety check

      if (updateError) throw updateError;

      // Update local db
      await db.users.update(editingStaffId, { 
        name: staffName,
        role: staffRole 
      });

      showAlert('Imefanikiwa', `Taarifa za ${staffName} zimebadilishwa kikamilifu.`);
      setShowStaffModal(false);
      setEditingStaffId(null);
      setStaffName('');
      setStaffRole('employee');
      
      // Trigger sync
      SyncService.sync();
    } catch (err: any) {
      console.error('Update staff error:', err);
      showAlert('Kosa', err.message || 'Imeshindwa kubadilisha taarifa');
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!user || !newName.trim()) return;
    setIsAddingStaff(true);
    try {
      const { error: updateError } = await supabase
        .from('users')
        .update({
          name: newName.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      // Update local db
      await db.users.update(user.id, { name: newName.trim() });
      
      // Update store
      useStore.getState().setAuth(useStore.getState().token!, {
        ...user,
        name: newName.trim()
      });

      showAlert('Imefanikiwa', 'Wasifu wako umesasishwa.');
      setShowProfileModal(false);
      
      // Trigger sync
      SyncService.sync();
    } catch (err: any) {
      console.error('Update profile error:', err);
      showAlert('Kosa', err.message || 'Imeshindwa kusasisha wasifu');
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleInviteStaff = async () => {
    if (!staffEmail || !user?.shopId) return;
    setIsAddingStaff(true);
    try {
      // 1. Check if user is already in this shop
      const { data: existingUser } = await supabase
        .from('users')
        .select('id, shop_id')
        .eq('email', staffEmail.toLowerCase())
        .single();

      if (existingUser && existingUser.shop_id === user.shopId) {
        throw new Error('Mfanyakazi huyu tayari yupo kwenye duka lako.');
      }

      // 2. Create invitation in Supabase
      const { error: inviteError } = await supabase
        .from('shop_invitations')
        .insert({
          shop_id: user.shopId,
          email: staffEmail.toLowerCase(),
          role: staffRole,
          created_at: new Date().toISOString()
        });

      if (inviteError) {
        if (inviteError.code === '23505') {
          throw new Error('Mwaliko kwa email hii tayari upo. Mfanyakazi anapaswa tu kujisajili (Register) ili kujiunga.');
        }
        throw inviteError;
      }

      showAlert('Mwaliko Umetumwa', `Mwaliko wa kujiunga na duka lako umetumwa kwa ${staffEmail}. Mwambie mfanyakazi ajisajili (Register) kwa kutumia email hii.`);
      TelemetryService.trackAddStaff(staffEmail, staffRole);
      setShowInviteModal(false);
      setStaffEmail('');
      setStaffRole('employee');
      fetchPendingInvitations();
    } catch (err: any) {
      console.error('Invite staff error:', err);
      showAlert('Kosa', err.message || 'Imeshindwa kutuma mwaliko');
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleToggleBlockStaff = async (staffId: string, name: string, currentStatus: string) => {
    const isBlocking = currentStatus !== 'blocked';
    const actionText = isBlocking ? 'kumzuia (block)' : 'kumfungulia (unblock)';
    const successText = isBlocking ? 'Mfanyakazi amezuiwa.' : 'Mfanyakazi amefunguliwa.';
    
    showConfirm(isBlocking ? 'Zuia Mfanyakazi' : 'Fungulia Mfanyakazi', `Je, una uhakika unataka ${actionText} ${name}? ${isBlocking ? 'Hataweza tena kuingia kwenye duka hili.' : 'Ataweza kuingia tena.'}`, async () => {
      try {
        const newStatus = isBlocking ? 'blocked' : 'active';
        
        // 1. Update in Supabase
        const { error } = await supabase
          .from('users')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', staffId);

        if (error) throw error;

        // 2. Update local DB
        await db.users.update(staffId, { status: newStatus });
        showAlert('Imefanikiwa', successText);
        
        // Trigger sync
        SyncService.sync();
      } catch (err: any) {
        console.error('Toggle block staff error:', err);
        showAlert('Kosa', `Imeshindwa ${actionText} mfanyakazi`);
      }
    });
  };

  useEffect(() => {
    if (location.state?.openExpiryList) {
      setShowExpiryList(true);
    }
  }, [location.state]);

  const [expiryData, setExpiryData] = useState<{ expired: any[], nearExpiry: any[] }>({ expired: [], nearExpiry: [] });
  const [loadingExpiry, setLoadingExpiry] = useState(false);

  useEffect(() => {
    if (showExpiryList && user?.shopId) {
      TelemetryService.trackExpiryChecked();
      const fetchExpiryData = async () => {
        setLoadingExpiry(true);
        const now = new Date();
        const thirtyDaysFromNow = addDays(now, 30);
        
        const expired: any[] = [];
        const nearExpiry: any[] = [];

        // We only fetch products that have batches and are not deleted
        await db.products
          .where('[shop_id+isDeleted]')
          .equals([user.shopId, 0])
          .filter(p => p.batches && p.batches.length > 0)
          .each(p => {
            p.batches.forEach(b => {
              const expiryDate = new Date(b.expiry_date);
              if (isBefore(expiryDate, now)) {
                expired.push({ ...p, batch: b });
              } else if (isBefore(expiryDate, thirtyDaysFromNow)) {
                nearExpiry.push({ ...p, batch: b });
              }
            });
          });

        setExpiryData({ expired, nearExpiry });
        setLoadingExpiry(false);
      };
      fetchExpiryData();
    }
  }, [showExpiryList, user?.shopId]);

  const toggleExpiry = async () => {
    if (!user?.shopId) return;
    
    let currentShop = shop;
    if (!currentShop) {
      currentShop = await db.shops.get(user.shopId);
    }
    
    if (!currentShop) {
      return;
    }

    const newValue = !currentShop.enable_expiry;
    await db.shops.update(currentShop.id, { 
      enable_expiry: newValue,
      updated_at: new Date().toISOString(),
      synced: 0
    });
    SyncService.sync();
  };

  const toggleOperate24Hours = async () => {
    if (!settings) {
      await db.settings.put({
        id: 1,
        shopName: shop?.name || 'Duka Langu',
        currency: 'TZS',
        taxPercentage: 0,
        darkMode: false,
        lastSync: 0,
        operate24Hours: true
      });
      return;
    }
    await db.settings.update(settings.id, {
      operate24Hours: !settings.operate24Hours
    });
  };

  const toggleAutoInvoice = async () => {
    if (!settings) {
      await db.settings.put({
        id: 1,
        shopName: shop?.name || 'Shop',
        currency: 'TZS',
        taxPercentage: 0,
        darkMode: false,
        lastSync: 0,
        autoInvoice: true
      });
      return;
    }
    await db.settings.update(settings.id, {
      autoInvoice: !settings.autoInvoice
    });
  };

  const toggleCompactLayout = async () => {
    const newVal = !settings?.compactLayout;
    if (!settings) {
      await db.settings.put({
        id: 1,
        shopName: shop?.name || 'Shop',
        currency: 'TZS',
        taxPercentage: 0,
        darkMode: false,
        lastSync: 0,
        compactLayout: newVal
      });
    } else {
      await db.settings.update(settings.id, {
        compactLayout: newVal
      });
    }
    localStorage.setItem('pos_compact_layout', newVal ? 'true' : 'false');
    if (newVal) {
      document.documentElement.style.zoom = '85%';
    } else {
      document.documentElement.style.zoom = '100%';
    }
  };

  const handleDeleteHistory = () => {
    if (!selectedDeletePeriod) return;
    
    const period = selectedDeletePeriod;
    const periodLabel = {
      today: 'Leo',
      week: 'Wiki Hii',
      month: 'Mwezi Huu',
      year: 'Mwaka Huu',
      all: 'Zote'
    }[period];

    showConfirm('Futa Historia', `Je, una uhakika unataka kufuta historia ya ${periodLabel}? Kitendo hiki hakiwezi kurudishwa.`, async () => {
      let startDate: Date | null = null;
      const now = new Date();

      if (period === 'today') startDate = startOfDay(now);
      else if (period === 'week') startDate = startOfWeek(now);
      else if (period === 'month') startDate = startOfMonth(now);
      else if (period === 'year') startDate = startOfYear(now);

      const filterFn = (item: any) => {
        if (item.shop_id !== user?.shopId) return false;
        if (period === 'all') return true;
        if (!startDate) return false;
        return new Date(item.created_at || item.date) >= startDate;
      };

      try {
        // Mark sales as deleted
        const salesToDelete = await db.sales.filter(s => filterFn(s)).toArray();
        for (const sale of salesToDelete) {
          const now = new Date().toISOString();
          await db.sales.update(sale.id, { isDeleted: 1, synced: 0, updated_at: now });
          await db.saleItems.where('sale_id').equals(sale.id).modify({ isDeleted: 1, synced: 0, updated_at: now });
        }

        // Mark expenses as deleted
        const expensesToDelete = await db.expenses.filter(e => filterFn(e)).toArray();
        for (const expense of expensesToDelete) {
          await db.expenses.update(expense.id, { isDeleted: 1, synced: 0, updated_at: new Date().toISOString() });
        }

        // Mark debt payments as deleted
        const paymentsToDelete = await db.debtPayments.filter(p => filterFn(p)).toArray();
        for (const payment of paymentsToDelete) {
          await db.debtPayments.update(payment.id, { isDeleted: 1, synced: 0, updated_at: new Date().toISOString() });
        }

        showAlert('Imefanikiwa', 'Historia imefutwa kwa mafanikio!');
        setShowDeleteModal(false);
        setSelectedDeletePeriod(null);
        SyncService.sync();
      } catch (e) {
        showAlert('Kosa', 'Kuna tatizo wakati wa kufuta historia.');
      }
    });
  };

  const handleBackup = async () => {
    try {
      const products = await db.products.filter(p => p.shop_id === user?.shopId).toArray();
      const sales = await db.sales.filter(s => s.shop_id === user?.shopId).toArray();
      const sets = await db.settings.toArray();
      
      const backupData = JSON.stringify({ products, sales, settings: sets });
      const blob = new Blob([backupData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `pos_backup_${new Date().getTime()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      showAlert('Kosa', 'Kuna tatizo wakati wa kuhifadhi nakala.');
    }
  };

  const handleLogout = async () => {
    try {
      await SyncService.logAction('logout', { platform: 'web' });
      await SyncService.sync(); // Force sync so the logout event goes through
    } catch (e) {
      console.error('Failed to log logout', e);
    }
    await supabase.auth.signOut();
    logout();
  };

  const handleManualSync = async () => {
    if (!navigator.onLine) {
      showAlert('Kosa', 'Tafadhali unganisha mtandao kwanza!');
      return;
    }
    setIsSyncing(true);
    await SyncService.sync(true);
    setIsSyncing(false);
    showAlert('Imefanikiwa', 'Usawazishaji (Sync) umekamilika!');
  };

  const handleRemoveBatch = (productId: string, batchId: string, skipConfirm = false) => {
    const removeLogic = async () => {
      try {
        const product = await db.products.get(productId);
        if (!product) return;

        const batchToRemove = product.batches.find(b => b.id === batchId);
        if (!batchToRemove) return;

        const updatedBatches = product.batches.filter(b => b.id !== batchId);
        const updatedStock = product.stock - batchToRemove.stock;

        await db.products.update(productId, {
          batches: updatedBatches,
          stock: Math.max(0, updatedStock),
          stock_delta: (product.stock_delta || 0) - batchToRemove.stock,
          updated_at: new Date().toISOString(),
          synced: 0
        });

        // Refresh data
        setExpiryData(prev => ({
          expired: prev.expired.filter(item => !(item.id === productId && item.batch.id === batchId)),
          nearExpiry: prev.nearExpiry.filter(item => !(item.id === productId && item.batch.id === batchId))
        }));

        SyncService.sync();
      } catch (e) {
        showAlert('Kosa', 'Kuna tatizo wakati wa kuondoa bidhaa.');
      }
    };

    if (!skipConfirm) {
      showConfirm('Ondoa Bidhaa', 'Je, una uhakika unataka kuondoa bidhaa hii iliyokwisha muda? Hii itapunguza idadi ya bidhaa zilizopo.', removeLogic);
    } else {
      removeLogic();
    }
  };

  return (
    <div className="p-4 pb-20">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Zaidi</h1>
        <button 
          onClick={(e) => { e.preventDefault(); handleLogout(); }}
          className="text-red-600 flex items-center font-medium bg-red-50 px-4 py-2 rounded-xl cursor-pointer touch-manipulation select-none transition-all" 
          style={{ 
            WebkitTapHighlightColor: 'transparent',
            WebkitTouchCallout: 'none',
            touchAction: 'manipulation'
          }}
        >
          <LogOut className="w-5 h-5 mr-2" /> Ondoka (Logout)
        </button>
      </div>

      <div className="space-y-6">
        {/* User Profile Section */}
        <section className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="bg-blue-100 p-3 rounded-2xl mr-4">
                <User className="w-8 h-8 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-gray-900 truncate">
                  {user?.name || 'Mtumiaji'}
                </h2>
                <p className="text-sm text-gray-500 truncate">
                  {user?.email}
                </p>
                <span className="inline-block mt-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded uppercase tracking-wider">
                  {user?.role || 'Admin'}
                </span>
              </div>
            </div>
            <button 
              onClick={(e) => {
                e.preventDefault();
                setNewName(user?.name || '');
                setShowProfileModal(true);
              }}
              className="p-2 text-blue-600 rounded-xl transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </section>

        {/* Expiry Toggle Section */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div
              role="button"
              onClick={(e) => { if (shop?.enable_expiry) { e.preventDefault(); setShowExpiryList(true); } }}
              className={`flex items-center flex-1 ${shop?.enable_expiry ? 'cursor-pointer' : ''}`}
              style={{ touchAction: 'manipulation' }}
            >
              <div className="bg-purple-100 p-2 rounded-xl mr-3">
                <Clock className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Usimamizi wa Expiry</h2>
                <p className="text-xs text-gray-500">Washa/Zima kipengele cha tarehe za kuisha</p>
              </div>
            </div>
            <button 
              onClick={(e) => { e.preventDefault(); toggleExpiry(); }}
              className={`w-12 h-6 rounded-full transition-colors relative ${shop?.enable_expiry ? 'bg-purple-600' : 'bg-gray-200'}`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${shop?.enable_expiry ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
          {shop?.enable_expiry && (
            <button 
              onClick={(e) => { e.preventDefault(); setShowExpiryList(true); }}
              className="w-full mt-4 py-2 text-sm font-bold text-purple-600 bg-purple-50 rounded-xl border border-purple-100"
            >
              Tazama Bidhaa Zilizokwisha Muda
            </button>
          )}
        </section>

        {/* Inventory Value Section - Boss Only */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="bg-green-100 p-2 rounded-xl mr-3">
                  <Database className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Thamani ya Stock</h2>
                  <p className="text-xs text-gray-500">Thamani ya bidhaa zote zilizopo</p>
                </div>
              </div>
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  const nextVal = !showInventoryValue;
                  setShowInventoryValue(nextVal);
                  if (nextVal) {
                    TelemetryService.trackStockValuationChecked();
                  }
                }}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${showInventoryValue ? 'bg-gray-100 text-gray-600' : 'bg-green-600 text-white'}`}
              >
                {showInventoryValue ? 'Ficha' : 'Tazama'}
              </button>
            </div>
            
            {showInventoryValue && (
              <div className="mt-4 pt-4 border-t border-gray-50 grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Jumla ya Manunuzi</p>
                  <p className="text-lg font-black text-gray-900">{formatCurrency(inventoryMetrics.totalBuyingValue, currency)}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Jumla ya Mauzo</p>
                  <p className="text-lg font-black text-blue-600">{formatCurrency(inventoryMetrics.totalSellingValue, currency)}</p>
                </div>
                <div className="col-span-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] text-blue-600 uppercase font-bold tracking-wider">Tarajio la Faida</p>
                    <p className="text-xl font-black text-blue-700">
                      {formatCurrency(inventoryMetrics.totalSellingValue - inventoryMetrics.totalBuyingValue, currency)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}


        {/* Staff Management Section */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <div className="bg-green-100 p-2 rounded-xl mr-3">
                  <Users className="w-6 h-6 text-green-600" />
                </div>
                <div className="text-left">
                  <h2 className="text-lg font-semibold text-gray-800">Wafanyakazi</h2>
                  <p className="text-xs text-gray-500">Dhibiti wafanyakazi wa duka lako</p>
                </div>
              </div>
              <button 
                onClick={(e) => { e.preventDefault(); setShowInviteModal(true); }}
                className="p-2 bg-green-600 text-white rounded-xl shadow-md transition-colors flex items-center space-x-1"
              >
                <Plus className="w-4 h-4" />
                <span className="text-xs font-bold">Ongeza</span>
              </button>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl mb-4">
              <p className="text-sm text-blue-800 font-medium mb-2">Jinsi ya kuongeza mfanyakazi:</p>
              <ol className="list-decimal list-inside text-xs text-blue-700 space-y-1">
                <li>Bonyeza kitufe cha <b>(+ Ongeza)</b> hapo juu.</li>
                <li>Ingiza <b>Email</b> ya mfanyakazi.</li>
                <li>Mwambie mfanyakazi ajisajili (Register) kwa kutumia email hiyo.</li>
                <li>Atajiunga na duka lako moja kwa moja baada ya kujisajili.</li>
              </ol>
            </div>

            {/* Feature Toggle: Staff Product Management */}
            <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-100 rounded-2xl mb-4">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-blue-900">Ruhusu Wafanyakazi Kuongeza Bidhaa</h3>
                <p className="text-[10px] text-blue-700">Wafanyakazi wataweza kuongeza, kuhariri na kuingiza bidhaa kwa Excel.</p>
              </div>
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  const nextVal = !isFeatureEnabled('staff_product_management');
                  SyncService.toggleFeature('staff_product_management', nextVal);
                  TelemetryService.trackFeatureFlagToggle('staff_product_management', nextVal);
                }}
                className={`w-12 h-6 rounded-full transition-colors relative ${isFeatureEnabled('staff_product_management') ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isFeatureEnabled('staff_product_management') ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {/* Feature Toggle: Staff Expense Management */}
            <div className="flex items-center justify-between p-4 bg-orange-50 border border-orange-100 rounded-2xl mb-4">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-orange-900">Ruhusu Wafanyakazi Kuona/Kuongeza Matumizi</h3>
                <p className="text-[10px] text-orange-700">Wafanyakazi wataweza kuona na kuongeza matumizi ya duka.</p>
              </div>
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  const nextVal = !isFeatureEnabled('staff_expense_management');
                  SyncService.toggleFeature('staff_expense_management', nextVal);
                  TelemetryService.trackFeatureFlagToggle('staff_expense_management', nextVal);
                }}
                className={`w-12 h-6 rounded-full transition-colors relative ${isFeatureEnabled('staff_expense_management') ? 'bg-orange-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isFeatureEnabled('staff_expense_management') ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {/* Feature Toggle: Staff Revenue Visibility */}
            <div className="flex items-center justify-between p-4 bg-purple-50 border border-purple-100 rounded-2xl mb-4">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-purple-900">Ruhusu Wafanyakazi Kuona Mapato</h3>
                <p className="text-[10px] text-purple-700">Wafanyakazi wataweza kuona mapato na mauzo yote kwenye Dashibodi na Historia.</p>
              </div>
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  const nextVal = !isFeatureEnabled('show_mapato_to_staff');
                  SyncService.toggleFeature('show_mapato_to_staff', nextVal);
                  TelemetryService.trackFeatureFlagToggle('show_mapato_to_staff', nextVal);
                }}
                className={`w-12 h-6 rounded-full transition-colors relative ${isFeatureEnabled('show_mapato_to_staff') ? 'bg-purple-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isFeatureEnabled('show_mapato_to_staff') ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {staff.length > 0 ? (
              <div className="space-y-3">
                {staff.map(s => {
                  const isBlocked = s.status === 'blocked';
                  return (
                  <div key={s.id} className={`flex items-center justify-between p-3 rounded-xl border ${isBlocked ? 'bg-red-50 border-red-100 opacity-75' : 'bg-gray-50 border-gray-100'}`}>
                    <div className="flex items-center">
                      <div className={`w-10 h-10 bg-white rounded-full flex items-center justify-center border ${isBlocked ? 'border-red-200' : 'border-gray-200'} mr-3`}>
                        <User className={`w-5 h-5 ${isBlocked ? 'text-red-400' : 'text-gray-400'}`} />
                      </div>
                      <div>
                        <p className={`text-sm font-bold ${isBlocked ? 'text-red-900 line-through' : 'text-gray-900'}`}>
                          {s.name}
                        </p>
                        <div className="flex items-center space-x-2">
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">{s.role}</p>
                          {isBlocked && (
                            <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded uppercase font-bold">Imezuiwa</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          setEditingStaffId(s.id);
                          setStaffName(s.name);
                          setStaffRole(s.role as any);
                          setShowStaffModal(true);
                        }}
                        className="p-2 text-blue-500 rounded-lg"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(e) => { e.preventDefault(); handleToggleBlockStaff(s.id, s.name, s.status); }}
                        className={`p-2 rounded-lg ${isBlocked ? 'text-green-600 ' : 'text-red-500 '}`}
                        title={isBlocked ? 'Fungulia Mfanyakazi' : 'Zuia Mfanyakazi'}
                      >
                        {isBlocked ? <CheckCircle className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4 italic">Hujasajili mfanyakazi yeyote bado.</p>
            )}
          </section>
        )}

        {/* Shop Management Section */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <div className="bg-blue-100 p-2 rounded-xl mr-3">
                  <Store className="w-6 h-6 text-blue-600" />
                </div>
                <div className="text-left">
                  <h2 className="text-lg font-semibold text-gray-800">Usimamizi wa Maduka</h2>
                  <p className="text-xs text-gray-500">Menejimenti na kubadili duka lako</p>
                </div>
              </div>
              <button 
                onClick={(e) => { e.preventDefault(); setShowAddShopModal(true); }}
                className="p-2 bg-blue-600 text-white rounded-xl shadow-md transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span className="text-xs font-bold">Ongeza Duka</span>
              </button>
            </div>

            {loadingShops ? (
              <div className="flex justify-center py-4">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : userShops.length > 0 ? (
              <div className="space-y-3">
                {userShops.map((s) => {
                  const isActive = s.id === user?.shopId;
                  const isSwitching = switchingShopId === s.id;
                  return (
                    <div 
                      key={s.id} 
                      className={`flex items-center justify-between p-3 rounded-xl border ${isActive ? 'bg-blue-50/70 border-blue-200' : 'bg-gray-50 border-gray-100'}`}
                    >
                      <div className="flex items-center flex-1 min-w-0 mr-2">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${isActive ? 'bg-blue-100 border-blue-300 text-blue-600' : 'bg-white border-gray-200 text-gray-400'} mr-3 shrink-0`}>
                          <Store className="w-5 h-5" />
                        </div>
                        <div className="truncate text-left">
                          <p className={`text-sm font-bold ${isActive ? 'text-blue-900' : 'text-gray-900'}`}>
                            {s.name}
                          </p>
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] text-gray-500 font-medium">Trial / Leseni Inafanya kazi</span>
                          </div>
                        </div>
                      </div>
                      <div>
                        {isActive ? (
                          <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-1 rounded-lg">Active</span>
                        ) : (
                          <button 
                            disabled={!!switchingShopId}
                            onClick={(e) => { e.preventDefault(); handleSwitchShop(s.id, s.name); }}
                            className="text-xs font-bold text-blue-600 bg-white border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                          >
                            {isSwitching ? 'Inahamisha...' : 'Hamia Hapa'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4 italic">Hakuna maduka mengine yaliyopatikana.</p>
            )}
          </section>
        )}

        {/* Executive Dashboard Section */}
        {isBoss() && (
          <section className="space-y-3">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <button 
                onClick={async (e) => {
                  e.preventDefault();
                  const granted = await notifications.requestPermission();
                  if (granted) {
                    notifications.sendNotification('Hongera!', 'Notifications sasa zimeunganishwa kikamilifu.');
                  } else {
                    showAlert('Kosa', 'Tafadhali ruhusu notifications kwenye browser yako.');
                  }
                }}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center">
                  <div className="bg-purple-100 p-2 rounded-xl mr-3">
                    <Bell className="w-6 h-6 text-purple-600" />
                  </div>
                  <div className="text-left">
                    <h2 className="text-lg font-semibold text-gray-800">Washa Notifications</h2>
                    <p className="text-xs text-gray-500">Pokea ripoti za Pulse na Master kila siku</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </section>
        )}

        {/* Auto Invoice Toggle Section */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div
              role="button"
              onClick={(e) => { e.preventDefault(); toggleAutoInvoice(); }}
              className="flex items-center flex-1 cursor-pointer"
              style={{ touchAction: 'manipulation' }}
            >
              <div className="bg-blue-100 p-2 rounded-xl mr-3">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Pakua Risiti (PDF)</h2>
                <p className="text-xs text-gray-500">Ipakue ukikamilisha mauzo</p>
              </div>
            </div>
            <button 
              onClick={(e) => { e.preventDefault(); toggleAutoInvoice(); }}
              className={`w-12 h-6 rounded-full transition-colors relative ${settings?.autoInvoice ? 'bg-blue-600' : 'bg-gray-200'}`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings?.autoInvoice ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
        </section>


        {/* Operate 24 Hours Toggle Section */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div
                role="button"
                onClick={(e) => { e.preventDefault(); toggleOperate24Hours(); }}
                className="flex items-center flex-1 cursor-pointer"
                style={{ touchAction: 'manipulation' }}
              >
                <div className="bg-indigo-100 p-2 rounded-xl mr-3">
                  <Clock className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Duka la Saa 24</h2>
                  <p className="text-xs text-gray-500">Zima ulinzi wa tahadhari nyakati za usiku sana</p>
                </div>
              </div>
              <button 
                onClick={(e) => { e.preventDefault(); toggleOperate24Hours(); }}
                className={`w-12 h-6 rounded-full transition-colors relative ${settings?.operate24Hours ? 'bg-indigo-600' : 'bg-gray-200'}`}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings?.operate24Hours ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </section>
        )}

        {/* Delete History Section */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
              <Trash2 className="w-5 h-5 mr-2 text-red-500" /> Futa Historia
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Futa historia ya mauzo na matumizi kwa kipindi fulani.
            </p>
            <button 
              onClick={(e) => { e.preventDefault(); setShowDeleteModal(true); }}
              className="w-full bg-red-50 text-red-600 font-bold py-3 rounded-xl border border-red-100"
            >
              Futa Historia
            </button>
          </section>
        )}

        {/* Subscription / Malipo ya Mfumo Section */}
        {isBoss() && (
          <section className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 animate-in fade-in duration-300">
            <div className="flex items-center mb-4">
              <div className="bg-blue-100 p-2.5 rounded-xl mr-3 text-blue-600">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Matumizi ya Mfumo</h2>
                <p className="text-xs text-gray-500 font-medium">Ulipiaji wa huduma za Mfumo</p>
              </div>
            </div>
            
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
                <span className="text-sm font-semibold text-blue-900">Gharama ya Mwezi:</span>
                <span className="text-lg font-black text-blue-700 bg-white px-3 py-1 rounded-xl shadow-xs border border-blue-100">
                  {formatCurrency(20000, currency)} / Mwezi
                </span>
              </div>
              <div className="text-xs text-blue-800 space-y-2 leading-relaxed">
                <p>
                  Ili kuendelea kutumia mfumo huu wa <strong>Venics Sales</strong> kuhifadhi na kusimamia bidhaa, mauzo, wafanyakazi na kupata ripoti zako kikamilifu, unapaswa kulipia TZS 20,000 kila mwezi.
                </p>
                <div className="mt-3 p-3 bg-white rounded-xl border border-blue-100">
                  <p className="font-bold text-blue-900 mb-1">Jinsi ya Kulipia:</p>
                  <ul className="list-disc list-inside space-y-1.5 text-gray-700">
                    <li>Wasiliana na huduma kwa wateja kupitia namba <strong>0787979273</strong></li>
                    <li>Taja barua pepe yako (Email): <strong className="text-blue-700">{user?.email || 'Akaunti yako'}</strong></li>
                    <li>Utapokea maelekezo ya kufanya malipo na kuwezeshwa huduma yako mara moja.</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Ruhusa Section - Employee only */}
        {user?.role === 'employee' && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <div className="bg-amber-100 p-2 rounded-xl mr-3">
                  <ShieldCheck className="w-6 h-6 text-amber-600" />
                </div>
                <div className="text-left">
                  <h2 className="text-lg font-semibold text-gray-800">Ruhusa</h2>
                  <p className="text-xs text-gray-500">Usawazishaji wa ruhusa na vipengele</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
              <p className="text-xs text-amber-800 mb-4 font-medium leading-relaxed">
                Ikiwa huwezi kuona baadhi ya vipengele ambavyo bosi wako amekuruhusu, bofya kitufe hapa chini kusasisha ruhusa zako upesi kutoka kwenye seva.
              </p>
              <button 
                onClick={async (e) => {
                  e.preventDefault();
                  if (isSyncing) return;
                  if (!navigator.onLine) {
                    showAlert('Kosa', 'Tafadhali unganisha mtandao kwanza!');
                    return;
                  }
                  setIsSyncing(true);
                  try {
                    await SyncService.sync(true, 'full');
                    showAlert('Imefanikiwa', 'Ruhusa zako zimesasishwa kikamilifu!');
                  } catch (e) {
                    console.error('Feature sync error:', e);
                    showAlert('Kosa', 'Imeshindwa kusasisha ruhusa. Jaribu tena baadae au unganisha mtandao vizuri.');
                  } finally {
                    setIsSyncing(false);
                  }
                }}
                disabled={isSyncing}
                className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center space-x-2 shadow-sm transition-all active:scale-[0.98] ${isSyncing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-amber-600 text-white'}`}
              >
                {isSyncing ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Inasasisha Ruhusa...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    <span>Sasisha Ruhusa Sasa</span>
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        {/* Customer Service Section */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Phone className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Huduma kwa Wateja</h2>
          <p className="text-gray-500 mb-6 text-sm">Kwa msaada wowote au maoni, wasiliana nasi kupitia namba hapa chini:</p>
          <a 
            href="tel:0787979273" 
            className="block w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-md transition-transform text-lg text-center select-none cursor-pointer touch-manipulation active:scale-95"
            style={{ 
              WebkitTapHighlightColor: 'transparent',
              WebkitTouchCallout: 'none',
              touchAction: 'manipulation'
            }}
          >
            0787979273
          </a>
        </section>


        <div className="flex flex-col items-center justify-center py-8">
          <div className="flex items-center space-x-2 mb-4 bg-white px-4 py-2 rounded-full border border-gray-100 shadow-sm">
            <div className={`w-3 h-3 rounded-full ${syncHealth === 'healthy' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'} transition-colors duration-500`} />
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              {syncHealth === 'healthy' ? 'Umesawazishwa' : 'Hitilafu ya Mtandao'}
            </span>
          </div>
          <p className="text-lg font-bold text-blue-600">Venics Sales</p>
          <p className="text-xs text-gray-400 mt-1">Version 1.0.0</p>
          <p className="text-[10px] text-gray-300 mt-4">Made by Venics Software Company</p>
        </div>
      </div>

      {/* Expiry List Modal */}
      {showExpiryList && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-purple-600">
                <Clock className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Usimamizi wa Expiry</h2>
              </div>
              <button onClick={() => setShowExpiryList(false)} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex p-1 bg-gray-100 rounded-2xl mb-6">
              <button 
                onClick={() => setActiveExpiryTab('expired')}
                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${activeExpiryTab === 'expired' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500'}`}
              >
                Zilizokwisha ({expiryData.expired.length})
              </button>
              <button 
                onClick={() => setActiveExpiryTab('near')}
                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${activeExpiryTab === 'near' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}
              >
                Zinazoisha ({expiryData.nearExpiry.length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6">
              {loadingExpiry ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 border-4 border-purple-100 border-t-purple-600 rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-500 font-medium">Inapakia data...</p>
                </div>
              ) : (
                <>
                  {activeExpiryTab === 'expired' ? (
                    /* Expired Section */
                    <div>
                      {expiryData.expired.length > 0 ? (
                        <div className="space-y-3">
                          <button 
                            onClick={() => {
                              showConfirm('Ondoa Zote', `Je, una uhakika unataka kuondoa bidhaa ZOTE ${expiryData.expired.length} zilizokwisha muda?`, async () => {
                                for (const item of expiryData.expired) {
                                  await handleRemoveBatch(item.id, item.batch.id, true);
                                }
                                showAlert('Imefanikiwa', 'Bidhaa zote zilizokwisha muda zimeondolewa.');
                              });
                            }}
                            className="w-full py-3 bg-red-600 text-white rounded-2xl text-sm font-bold flex items-center justify-center mb-4 shadow-md"
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Ondoa Zote Zilizokwisha
                          </button>
                          {expiryData.expired.map((item, idx) => (
                            <div key={`${item.id}-${idx}`} className="p-4 bg-red-50 border border-red-100 rounded-2xl">
                              <div className="flex justify-between items-start mb-3">
                                <div>
                                  <p className="font-bold text-gray-800 text-lg">{item.name}</p>
                                  <p className="text-sm text-red-600 font-medium flex items-center">
                                    <AlertTriangle className="w-4 h-4 mr-1" />
                                    Iliisha: {format(new Date(item.batch.expiry_date), 'dd/MM/yyyy')}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-gray-400 uppercase font-bold">Stock</p>
                                  <p className="text-xl font-bold text-gray-900">{item.batch.stock}</p>
                                </div>
                              </div>
                              <button 
                                onClick={() => handleRemoveBatch(item.id, item.batch.id)}
                                className="w-full py-2.5 bg-white text-red-600 border border-red-200 rounded-xl text-sm font-bold flex items-center justify-center transition-colors"
                              >
                                <Trash2 className="w-4 h-4 mr-2" /> Ondoa Bidhaa Hii
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-green-500" />
                          </div>
                          <p className="text-gray-500 font-medium">Hongera! Hakuna bidhaa zilizokwisha muda.</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Near Expiry Section */
                    <div>
                      {expiryData.nearExpiry.length > 0 ? (
                        <div className="space-y-3">
                          {expiryData.nearExpiry.map((item, idx) => (
                            <div key={`${item.id}-${idx}`} className="p-4 bg-orange-50 border border-orange-100 rounded-2xl">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-bold text-gray-800 text-lg">{item.name}</p>
                                  <p className="text-sm text-orange-600 font-medium flex items-center">
                                    <Clock className="w-4 h-4 mr-1" />
                                    Inaisha: {format(new Date(item.batch.expiry_date), 'dd/MM/yyyy')}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-gray-400 uppercase font-bold">Stock</p>
                                  <p className="text-xl font-bold text-gray-900">{item.batch.stock}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Clock className="w-8 h-8 text-gray-300" />
                          </div>
                          <p className="text-gray-500 font-medium">Hakuna bidhaa zinazoisha karibuni (ndani ya siku 30).</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            
            <button 
              onClick={() => setShowExpiryList(false)}
              className="w-full mt-6 py-4 bg-purple-600 text-white font-bold rounded-2xl shadow-lg"
            >
              Funga
            </button>
          </div>
        </div>
      )}

      {/* Delete History Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center text-red-600">
                <Trash2 className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Futa Historia</h2>
              </div>
              <button onClick={() => setShowDeleteModal(false)} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <p className="text-gray-600 mb-6 text-sm">Chagua kipindi unachotaka kufuta. Kitendo hiki hakiwezi kurudishwa.</p>
            
            <div className="space-y-2 mb-6">
              {[
                { label: 'Leo', value: 'today' },
                { label: 'Wiki Hii', value: 'week' },
                { label: 'Mwezi Huu', value: 'month' },
                { label: 'Mwaka Huu', value: 'year' },
                { label: 'Zote', value: 'all' }
              ].map((p) => (
                <button 
                  key={p.value}
                  onClick={() => setSelectedDeletePeriod(p.value as any)}
                  className={`w-full p-4 text-left font-bold rounded-2xl transition-all border-2 ${
                    selectedDeletePeriod === p.value 
                      ? 'bg-red-50 border-red-500 text-red-700 shadow-sm' 
                      : 'bg-gray-50 border-transparent text-gray-700 '
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span>{p.label}</span>
                    {selectedDeletePeriod === p.value && <CheckCircle className="w-5 h-5" />}
                  </div>
                </button>
              ))}
            </div>
            
            <div className="flex space-x-3">
              <button 
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedDeletePeriod(null);
                }}
                className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
              >
                Ghairi
              </button>
              <button 
                onClick={handleDeleteHistory}
                disabled={!selectedDeletePeriod}
                className="flex-1 py-4 bg-red-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-red-100 cursor-pointer touch-manipulation select-none transition-all"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  WebkitTouchCallout: 'none',
                  touchAction: 'manipulation'
                }}>
                Futa Sasa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {showStaffModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-blue-600">
                <Settings className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Hariri Mfanyakazi</h2>
              </div>
              <button onClick={() => { setShowStaffModal(false); setEditingStaffId(null); }} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">Jina la Mfanyakazi</label>
                <input 
                  type="text"
                  value={staffName}
                  onChange={e => setStaffName(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
                  placeholder="Jina Kamili"
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => { setShowStaffModal(false); setEditingStaffId(null); }}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
                >
                  Ghairi
                </button>
                <button 
                  onClick={handleUpdateStaff}
                  disabled={isAddingStaff || !staffName.trim()}
                  className="flex-1 py-4 bg-blue-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100 cursor-pointer touch-manipulation select-none transition-all"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}>
                  {isAddingStaff ? 'Inahifadhi...' : 'Hifadhi'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite Staff Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-green-600">
                <Plus className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Mwaliko Mpya</h2>
              </div>
              <button onClick={() => { setShowInviteModal(false); setStaffEmail(''); }} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">Email ya Mfanyakazi</label>
                <input 
                  type="email"
                  value={staffEmail}
                  onChange={e => setStaffEmail(e.target.value)}
                  placeholder="mfano@email.com"
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-green-500 outline-none font-bold text-gray-700"
                  autoFocus
                />
              </div>

              <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl text-orange-700 text-[10px] leading-relaxed">
                <b>Kumbuka:</b> Mfanyakazi lazima ajisajili (Register) kwa kutumia email hii ili kujiunga na duka lako moja kwa moja.
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => { setShowInviteModal(false); setStaffEmail(''); }}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
                >
                  Ghairi
                </button>
                <button 
                  onClick={handleInviteStaff}
                  disabled={isAddingStaff || !staffEmail}
                  className="flex-1 py-4 bg-green-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-green-100 cursor-pointer touch-manipulation select-none transition-all"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}>
                  {isAddingStaff ? 'Inatuma...' : 'Tuma Mwaliko'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Edit Profile Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-blue-600">
                <User className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Hariri Wasifu</h2>
              </div>
              <button onClick={() => setShowProfileModal(false)} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">Jina Lako Kamili</label>
                <input 
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
                  placeholder="Jina Kamili"
                  autoFocus
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => setShowProfileModal(false)}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
                >
                  Ghairi
                </button>
                <button 
                  onClick={handleUpdateProfile}
                  disabled={isAddingStaff || !newName.trim()}
                  className="flex-1 py-4 bg-blue-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100 cursor-pointer touch-manipulation select-none transition-all"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}>
                  {isAddingStaff ? 'Inahifadhi...' : 'Hifadhi'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ongeza Duka Modal */}
      {showAddShopModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-blue-600">
                <Store className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Ongeza Duka</h2>
              </div>
              <button onClick={() => { setShowAddShopModal(false); setNewShopName(''); }} className="p-2 bg-gray-100 rounded-full cursor-pointer">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleAddShop} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">Jina la Duka</label>
                <input 
                  type="text"
                  value={newShopName}
                  onChange={e => setNewShopName(e.target.value)}
                  placeholder="mfano: Duka la Kariakoo"
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
                  autoFocus
                  required
                />
              </div>

              <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-700 text-[10px] leading-relaxed">
                <b>Maelezo:</b> Duka jipya litakuwa na trial na leseni yake mpya ya kujitegemea kabisa. Unaweza kuongeza wafanyakazi maalum kwa ajili ya duka hili pekee.
              </div>

              <div className="flex space-x-3 pt-2">
                <button 
                  type="button"
                  onClick={() => { setShowAddShopModal(false); setNewShopName(''); }}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl cursor-pointer"
                >
                  Ghairi
                </button>
                <button 
                  type="submit"
                  disabled={isAddingShop || !newShopName.trim()}
                  className="flex-1 py-4 bg-blue-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100 cursor-pointer touch-manipulation select-none transition-all"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    touchAction: 'manipulation'
                  }}
                >
                  {isAddingShop ? 'Inatengeneza...' : 'Tengeneza Duka'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}