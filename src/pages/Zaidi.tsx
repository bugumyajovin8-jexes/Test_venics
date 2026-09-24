import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { Database, LogOut, RefreshCw, BarChart3, ChevronRight, Phone, Wallet, User, ShieldCheck, Trash2, Clock, AlertTriangle, X, CheckCircle, MessageSquare, Zap, Bell, Users, Plus, Shield, Settings, Ban, FileText, Package, EyeOff, Lock } from 'lucide-react';
import { supabase } from '../supabase';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { notifications } from '../services/notifications';
import { useNavigate, useLocation } from 'react-router-dom';
import { startOfDay, startOfWeek, startOfMonth, startOfYear, subDays, isBefore, isAfter, addDays, format } from 'date-fns';
import { isBatchExpired, isBatchExpiringSoon } from '../utils/stock';
import ExpiryDatePicker from '../components/ExpiryDatePicker';
import TypeToConfirm from '../components/TypeToConfirm';
import { nowIso } from '../services/clock';
import SyncStatusCard from '../components/SyncStatusCard';
import HubPairing from '../components/HubPairing';
import {
  HISTORY_PERIOD_LABELS,
  deleteHistoryPhrase,
  type HistoryPeriod,
} from '../utils/confirmPhrases';

// A product "tracks expiry" if any of its batches carries an expiry date. Products with stock but
// no such batch were stored without an expiry date (either they don't expire, or it was forgotten).
const hasExpiryTracking = (p: any) =>
  Array.isArray(p.batches) && p.batches.some((b: any) => b?.expiry_date && String(b.expiry_date).trim() !== '');

export default function Zaidi() {
  const { user, logout, showAlert, showConfirm, showToast, isBoss, isFeatureEnabled, setIsLoggingOut } = useStore();
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
  const [selectedDeletePeriod, setSelectedDeletePeriod] = useState<HistoryPeriod | null>(null);
  const [showDeleteHistoryConfirm, setShowDeleteHistoryConfirm] = useState(false);
  const [showExpiryList, setShowExpiryList] = useState(false);
  const [activeExpiryTab, setActiveExpiryTab] = useState<'expired' | 'near'>('expired');
  const [showUntrackedList, setShowUntrackedList] = useState(false);
  const [untrackedDrafts, setUntrackedDrafts] = useState<Record<string, string>>({});
  const [lastSavedName, setLastSavedName] = useState<string | null>(null);
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

  // Business phone + location for the printed receipt. Stored in localStorage ONLY — never synced
  // to Supabase, and it survives logout/app-close (logout clears only pos_*/sb-* auth keys).
  const [bizPhone, setBizPhone] = useState(() => localStorage.getItem('venics_business_phone') || '');
  const [bizLocation, setBizLocation] = useState(() => localStorage.getItem('venics_business_location') || '');
  const saveBizPhone = (v: string) => { setBizPhone(v); localStorage.setItem('venics_business_phone', v); };
  const saveBizLocation = (v: string) => { setBizLocation(v); localStorage.setItem('venics_business_location', v); };

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
    // Invitations change when the boss sends or cancels one — both refresh the
    // list on the spot — or when an invitee finishes registering on their own
    // phone. A minute is plenty to notice that. This used to poll every 10
    // seconds for as long as Zaidi stayed open, hidden or not (360 requests an
    // hour from a settings page), and for employees too, who cannot manage
    // invitations at all.
    // isBoss(), not role === 'boss': on Desktop admin and superadmin count too.
    if (!user?.shopId || !isBoss()) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetchPendingInvitations();
    };
    refresh();
    const interval = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user?.shopId, user?.role]);

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
          updated_at: nowIso()
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
          updated_at: nowIso()
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
          created_at: nowIso()
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
          .update({ status: newStatus, updated_at: nowIso() })
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

  // Shop-wide "warn me N days before expiry" window (default 30). Local text mirror of the stored
  // shop.notify_expiry_days so the input can be edited freely before saving on blur.
  const [expiryDaysInput, setExpiryDaysInput] = useState('30');
  useEffect(() => {
    if (shop) setExpiryDaysInput(String(shop.notify_expiry_days ?? 30));
    // Only re-sync when the stored value itself changes — not on every unrelated shop update —
    // so it can't clobber what the user is mid-typing before blur.
  }, [shop?.notify_expiry_days]);

  useEffect(() => {
    if (showExpiryList && user?.shopId) {
      TelemetryService.trackExpiryChecked();
      const fetchExpiryData = async () => {
        setLoadingExpiry(true);

        const expired: any[] = [];
        const nearExpiry: any[] = [];

        // We only fetch products that have batches and are not deleted
        await db.products
          .where('[shop_id+isDeleted]')
          .equals([user.shopId, 0])
          .filter(p => p.batches && p.batches.length > 0)
          .each(p => {
            p.batches.forEach(b => {
              if (Number(b.stock) <= 0) return; // sold-out batch — not real expiring stock
              if (isBatchExpired(b.expiry_date)) {
                expired.push({ ...p, batch: b });
              } else if (isBatchExpiringSoon(b.expiry_date, shop?.notify_expiry_days ?? 30)) {
                nearExpiry.push({ ...p, batch: b });
              }
            });
          });

        setExpiryData({ expired, nearExpiry });
        setLoadingExpiry(false);
      };
      fetchExpiryData();
    }
  }, [showExpiryList, user?.shopId, shop?.notify_expiry_days]);

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
      updated_at: nowIso(),
      synced: 0
    });
    // Forced: an unforced sync() can be swallowed by the 30s full-sync throttle, leaving a
    // shop-wide setting unsynced if the boss toggles it and closes the app straight after.
    SyncService.sync(true);
  };

  // Save the shop-wide expiry-notification window. Clamps to a sane range (1..3650 days).
  const saveExpiryNotifyDays = async (raw?: string) => {
    if (!user?.shopId) return;
    const source = raw !== undefined ? raw : expiryDaysInput;
    let days = parseInt(source, 10);
    if (isNaN(days) || days < 1) days = 30;
    if (days > 3650) days = 3650;
    setExpiryDaysInput(String(days));
    await db.shops.update(user.shopId, {
      notify_expiry_days: days,
      updated_at: nowIso(),
      synced: 0,
    });
    // Forced — see toggleExpiry: an unforced sync can be dropped by the 30s full-sync throttle.
    SyncService.sync(true);
  };

  // Products with stock but no expiry-tracking batch — surfaced so the boss can add a date to any
  // they simply forgot. Derived from the live product list, so a product drops off once saved.
  const untrackedProducts = useMemo(
    () => products.filter(p => Number(p.stock) > 0 && !hasExpiryTracking(p)),
    [products]
  );

  // Attach an expiry date to a not-yet-tracked product by wrapping its existing (unbatched) stock
  // in a batch. Total stock is unchanged — we only categorise it — so stock_delta stays put.
  const handleAddExpiryToProduct = async (product: any) => {
    const dateStr = untrackedDrafts[product.id];
    if (!dateStr) return;
    const existing = Array.isArray(product.batches) ? product.batches : [];
    const batchedStock = existing.reduce((s: number, b: any) => s + Number(b.stock || 0), 0);
    const batchStock = existing.length === 0
      ? Number(product.stock)
      : Math.max(Number(product.stock) - batchedStock, 0);
    const newBatch = {
      id: uuidv4(),
      batch_number: `B-${Date.now()}`,
      expiry_date: new Date(dateStr).toISOString(),
      stock: batchStock,
    };
    await db.products.update(product.id, {
      batches: [...existing, newBatch],
      updated_at: nowIso(),
      synced: 0,
    });
    setUntrackedDrafts(prev => {
      const next = { ...prev };
      delete next[product.id];
      return next;
    });
    setLastSavedName(product.name);
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

  // Device-local: hides stock counts from staff on THIS computer only. Never
  // synced, and survives logout, so the boss can set it on a shared till and
  // walk away.
  const toggleHideStockFromStaff = async () => {
    if (!settings) {
      await db.settings.put({
        id: 1,
        shopName: shop?.name || 'Duka Langu',
        currency: 'TZS',
        taxPercentage: 0,
        darkMode: false,
        lastSync: 0,
        hideStockFromStaff: true,
      });
      return;
    }
    await db.settings.update(settings.id, {
      hideStockFromStaff: !settings.hideStockFromStaff,
    });
  };

  // Device-local: shuts staff out of Historia on THIS computer only. Same
  // contract as the stock toggle above — never synced, survives logout.
  const toggleBlockHistoriaForStaff = async () => {
    if (!settings) {
      await db.settings.put({
        id: 1,
        shopName: shop?.name || 'Duka Langu',
        currency: 'TZS',
        taxPercentage: 0,
        darkMode: false,
        lastSync: 0,
        blockHistoriaForStaff: true,
      });
      return;
    }
    await db.settings.update(settings.id, {
      blockHistoriaForStaff: !settings.blockHistoriaForStaff,
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

  /**
   * Erase sales, expenses and debt payments for the chosen period.
   *
   * Reached only through the typed-sentence gate. This one is worse than
   * deleting products: the shop can retype a catalogue from the shelves, but
   * nobody can reconstruct a year of takings from memory.
   */
  const performDeleteHistory = async () => {
    if (!selectedDeletePeriod) return;
    const period = selectedDeletePeriod;
    {
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
          const now = nowIso();
          await db.sales.update(sale.id, { isDeleted: 1, synced: 0, updated_at: now });
          await db.saleItems.where('sale_id').equals(sale.id).modify({ isDeleted: 1, synced: 0, updated_at: now });
        }

        // Mark expenses as deleted
        const expensesToDelete = await db.expenses.filter(e => filterFn(e)).toArray();
        for (const expense of expensesToDelete) {
          await db.expenses.update(expense.id, { isDeleted: 1, synced: 0, updated_at: nowIso() });
        }

        // Mark debt payments as deleted
        const paymentsToDelete = await db.debtPayments.filter(p => filterFn(p)).toArray();
        for (const payment of paymentsToDelete) {
          await db.debtPayments.update(payment.id, { isDeleted: 1, synced: 0, updated_at: nowIso() });
        }

        setShowDeleteHistoryConfirm(false);
        showAlert('Imefanikiwa', 'Historia imefutwa kwa mafanikio!');
        setShowDeleteModal(false);
        setSelectedDeletePeriod(null);
        SyncService.sync();
      } catch (e) {
        setShowDeleteHistoryConfirm(false);
        showAlert('Kosa', 'Kuna tatizo wakati wa kufuta historia.');
      }
    }
  };

  const handleDeleteHistory = () => {
    if (!selectedDeletePeriod) return;
    setShowDeleteHistoryConfirm(true);
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
    setIsLoggingOut(true);
    try {
      await SyncService.logAction('logout', { platform: 'web' });
      await SyncService.flushAuditLogs();
    } catch (e) {
      console.error('Failed to log logout', e);
    }
    // One last sync, with a deadline. With no internet, waiting for it without
    // one is what left this button spinning. (Signing out is done by logout()
    // itself, with its own deadline.)
    await SyncService.syncBeforeLogout();

    // Logout clears this till's sales, expenses and debt payments so the next
    // cashier starts clean. Anything not yet on the cloud or the shop hub exists
    // nowhere else, and would be cleared with them — say so before it happens.
    const unsent = await SyncService.countUnsentAnywhere();
    if (unsent > 0) {
      setIsLoggingOut(false);
      showConfirm(
        'Kuna rekodi ambazo hazijatumwa',
        `Rekodi ${unsent} (mauzo, matumizi au madeni) ziko kwenye kompyuta hii tu — hazijafika kwenye mtandao wala kwenye kituo cha duka. `
          + 'Ukitoka sasa zitafutwa na hazitapatikana tena. Ni bora uunganishe intaneti au kituo cha duka, usubiri zitumwe, kisha utoke. '
          + 'Toka sasa hata hivyo?',
        () => {
          setIsLoggingOut(true);
          void logout();
        },
      );
      return;
    }
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

  const handleSyncFeatures = async () => {
    if (!navigator.onLine) {
      showAlert('Kosa', 'Tafadhali unganisha mtandao kwanza!');
      return;
    }
    setIsSyncing(true);
    try {
      // Pulls ONLY the features table, not a whole full sync.
      await SyncService.refreshFeatures();
      // Toast, not showAlert — a success confirmation shouldn't block the user behind an "Okay".
      showToast('Ruhusa zimesawazishwa kikamilifu!', 'success');
    } catch (e) {
      showAlert('Kosa', 'Imeshindwa kusawazisha ruhusa.');
    } finally {
      setIsSyncing(false);
    }
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
          updated_at: nowIso(),
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
        <button onClick={handleLogout} className="text-red-600 flex items-center font-medium bg-red-50 px-4 py-2 rounded-xl">
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
              onClick={() => {
                setNewName(user?.name || '');
                setShowProfileModal(true);
              }}
              className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </section>

        {/* How far behind this device is. Everyone sees it: a stuck queue on an
            employee's till is the one nobody would otherwise notice. */}
        <SyncStatusCard />

        {/* The shop's own hub: how devices sync when there is no internet. */}
        <HubPairing />

        {/* Expiry Toggle Section — boss always; employees only when "Ruhusu Wafanyakazi Kuongeza Bidhaa" is on */}
        {(isBoss() || isFeatureEnabled('staff_product_management')) && (
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div 
              onClick={() => shop?.enable_expiry && setShowExpiryList(true)}
              className={`flex items-center flex-1 ${shop?.enable_expiry ? 'cursor-pointer' : ''}`}
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
              onClick={toggleExpiry}
              className={`w-12 h-6 rounded-full transition-colors relative ${shop?.enable_expiry ? 'bg-purple-600' : 'bg-gray-200'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${shop?.enable_expiry ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
          {shop?.enable_expiry && (
            <div className="mt-4 space-y-3">
              <div className="p-3 bg-purple-50 rounded-xl border border-purple-100">
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Nionye siku ngapi kabla bidhaa kuisha muda? (kwa bidhaa zote zinazofuatiliwa)
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={expiryDaysInput}
                    onChange={(e) => setExpiryDaysInput(e.target.value.replace(/[^0-9]/g, ''))}
                    onBlur={() => saveExpiryNotifyDays()}
                    className="w-20 px-3 py-2 rounded-lg border border-purple-200 text-sm font-bold text-purple-700 outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                    placeholder="30"
                  />
                  <span className="text-sm text-gray-600 font-medium">siku</span>
                  <div className="flex gap-1.5 ml-auto">
                    {[30, 60, 90].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => saveExpiryNotifyDays(String(d))}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${(shop.notify_expiry_days ?? 30) === d ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-purple-600 border-purple-200 hover:bg-purple-100'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowExpiryList(true)}
                className="w-full py-2 text-sm font-bold text-purple-600 bg-purple-50 rounded-xl border border-purple-100"
              >
                Tazama Bidhaa Zilizokwisha Muda
              </button>
              <button
                onClick={() => { setLastSavedName(null); setShowUntrackedList(true); }}
                className="w-full py-2 text-sm font-bold text-amber-700 bg-amber-50 rounded-xl border border-amber-100 flex items-center justify-center gap-2"
              >
                <Package className="w-4 h-4" />
                Bidhaa Zisizo na Tarehe ya Kuisha
                {untrackedProducts.length > 0 && (
                  <span className="px-2 py-0.5 bg-amber-500 text-white text-xs rounded-full">{untrackedProducts.length}</span>
                )}
              </button>
            </div>
          )}
        </section>
        )}

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
              {shop?.enable_stock !== false && (
                <button
                  onClick={() => {
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
              )}
            </div>

            {shop?.enable_stock === false ? (
              <div className="mt-4 pt-4 border-t border-gray-50">
                <p className="text-sm text-gray-500 leading-relaxed">
                  Duka lako halifuatilii stock kwa sasa, hivyo thamani ya stock haiwezi kuhesabiwa. Washa ufuatiliaji wa stock kwenye mipangilio ili kuona mtaji na thamani ya bidhaa zako.
                </p>
              </div>
            ) : showInventoryValue && (
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
                onClick={() => setShowInviteModal(true)}
                className="p-2 bg-green-600 text-white rounded-xl shadow-md hover:bg-green-700 transition-colors flex items-center space-x-1"
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
                onClick={() => {
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
                onClick={() => {
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
                onClick={() => {
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
                        onClick={() => {
                          setEditingStaffId(s.id);
                          setStaffName(s.name);
                          setStaffRole(s.role as any);
                          setShowStaffModal(true);
                        }}
                        className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleToggleBlockStaff(s.id, s.name, s.status)}
                        className={`p-2 rounded-lg ${isBlocked ? 'text-green-600 hover:bg-green-50' : 'text-red-500 hover:bg-red-50'}`}
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

        {/* Executive Dashboard Section */}
        {isBoss() && (
          <section className="space-y-3">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <button 
                onClick={async () => {
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

        {/* Hide stock from staff — boss only, and local to this computer. */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div
                onClick={toggleHideStockFromStaff}
                className="flex items-center flex-1 cursor-pointer"
              >
                <div className="bg-amber-100 p-2 rounded-xl mr-3">
                  <EyeOff className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Ficha Idadi ya Bidhaa kwa Wafanyakazi</h2>
                  <p className="text-xs text-gray-500">
                    Mfanyakazi akitumia kompyuta hii hataona idadi ya bidhaa zilizobaki. Wewe kama
                    bosi utaendelea kuona kila kitu.
                  </p>
                </div>
              </div>
              <button
                onClick={toggleHideStockFromStaff}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ml-3 ${settings?.hideStockFromStaff ? 'bg-amber-600' : 'bg-gray-200'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings?.hideStockFromStaff ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
            {settings?.hideStockFromStaff && (
              <p className="mt-3 text-[11px] leading-relaxed text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                Mpangilio huu ni wa kompyuta hii pekee — hauhamii kwenye simu wala kompyuta nyingine.
                Utabaki hata ukitoka (logout).
              </p>
            )}
          </section>
        )}

        {/* Block Historia for staff — boss only, and local to this computer. */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div
                onClick={toggleBlockHistoriaForStaff}
                className="flex items-center flex-1 cursor-pointer"
              >
                <div className="bg-rose-100 p-2 rounded-xl mr-3">
                  <Lock className="w-6 h-6 text-rose-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Zuia Wafanyakazi Kuona Historia</h2>
                  <p className="text-xs text-gray-500">
                    Mfanyakazi akitumia kompyuta hii hataona ukurasa wa Historia kabisa — kitufe
                    chake kitatoweka kwenye Dashibodi na kwenye orodha ya kushoto. Wewe kama bosi
                    utaendelea kuiona.
                  </p>
                </div>
              </div>
              <button
                onClick={toggleBlockHistoriaForStaff}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ml-3 ${settings?.blockHistoriaForStaff ? 'bg-rose-600' : 'bg-gray-200'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings?.blockHistoriaForStaff ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
            {settings?.blockHistoriaForStaff && (
              <p className="mt-3 text-[11px] leading-relaxed text-rose-800 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                Mpangilio huu ni wa kompyuta hii pekee — hauhamii kwenye simu wala kompyuta nyingine.
                Utabaki hata ukitoka (logout). Hata akiandika anwani ya ukurasa moja kwa moja,
                atarudishwa kwenye Dashibodi.
              </p>
            )}
          </section>
        )}

        {/* Auto Invoice Toggle Section */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div 
              onClick={toggleAutoInvoice}
              className="flex items-center flex-1 cursor-pointer"
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
              onClick={toggleAutoInvoice}
              className={`w-12 h-6 rounded-full transition-colors relative ${settings?.autoInvoice ? 'bg-blue-600' : 'bg-gray-200'}`}
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
                onClick={toggleOperate24Hours}
                className="flex items-center flex-1 cursor-pointer"
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
                onClick={toggleOperate24Hours}
                className={`w-12 h-6 rounded-full transition-colors relative ${settings?.operate24Hours ? 'bg-indigo-600' : 'bg-gray-200'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings?.operate24Hours ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </section>
        )}

        {/* Ruhusa Section - Employees (Non-bosses) Only */}
        {!isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 animate-in fade-in duration-355">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="bg-emerald-100 p-2.5 rounded-xl mr-3">
                  <ShieldCheck className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Ruhusa (Permissions)</h2>
                  <p className="text-xs text-gray-500">Sawazisha ruhusa na majukumu kutoka kwa mmiliki</p>
                </div>
              </div>
              <button 
                onClick={handleSyncFeatures}
                disabled={isSyncing}
                className="bg-emerald-600 text-white font-bold px-4 py-2.5 rounded-xl hover:bg-emerald-700 active:scale-95 transition-all duration-150 disabled:opacity-50 text-sm flex items-center space-x-1"
              >
                {isSyncing ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mr-1" />
                )}
                Ruhusa
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
              onClick={() => setShowDeleteModal(true)}
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
                <h2 className="text-lg font-bold text-gray-900">Malipo ya Mfumo</h2>
                <p className="text-xs text-gray-500 font-medium">Usajili na leseni ya matumizi ya mfumo</p>
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
                    <li>Utapokea maelekezo ya kufanya malipo na kuwezeshwa leseni yako mara moja.</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Business Info for Receipt — local to this device, both boss and employee */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center mb-3">
            <div className="bg-blue-100 p-2 rounded-xl mr-3">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Taarifa za Biashara (Risiti)</h2>
              <p className="text-xs text-gray-500">Namba ya simu na eneo huonekana kwenye risiti</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">Namba ya Simu ya Biashara</label>
              <input
                type="tel"
                value={bizPhone}
                onChange={(e) => saveBizPhone(e.target.value)}
                placeholder="Mfano: 0787 979 273"
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">Eneo la Biashara</label>
              <input
                type="text"
                value={bizLocation}
                onChange={(e) => saveBizLocation(e.target.value)}
                placeholder="Mfano: Kariakoo, Dar es Salaam"
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
              />
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed flex items-start gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              Taarifa hizi zinahifadhiwa kwenye kifaa hiki pekee — hazitumwi mtandaoni, na zitabaki hata ukitoka (logout).
            </p>
          </div>
        </section>

        {/* Customer Service Section */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Phone className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Huduma kwa Wateja</h2>
          <p className="text-gray-500 mb-6 text-sm">Kwa msaada wowote au maoni, wasiliana nasi kupitia namba hapa chini:</p>
          <a 
            href="tel:0787979273" 
            className="block w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-md transition-transform active:scale-95 text-lg"
          >
            0787979273
          </a>
        </section>


        <div className="text-center py-8">
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
                                className="w-full py-2.5 bg-white text-red-600 border border-red-200 rounded-xl text-sm font-bold flex items-center justify-center hover:bg-red-100 transition-colors"
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

      {/* Untracked (no expiry date) products modal */}
      {showUntrackedList && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center text-amber-600">
                <Package className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Bidhaa Zisizo na Tarehe</h2>
              </div>
              <button onClick={() => setShowUntrackedList(false)} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              Hizi ni bidhaa zenye stoki lakini hazina tarehe ya kuisha. Kama kuna uliyoisahau, weka tarehe yake hapa moja kwa moja.
            </p>

            {lastSavedName && (
              <div className="mb-4 p-3 bg-green-50 border border-green-100 rounded-2xl flex items-center text-green-700 text-sm font-bold">
                <CheckCircle className="w-4 h-4 mr-2 shrink-0" />
                Tarehe imewekwa kwa {lastSavedName}
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3">
              {untrackedProducts.length > 0 ? (
                untrackedProducts.map(p => (
                  <div key={p.id} className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
                    <div className="flex justify-between items-start mb-3">
                      <p className="font-bold text-gray-800 text-base pr-2">{p.name}</p>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-gray-400 uppercase font-bold">Stock</p>
                        <p className="text-lg font-bold text-gray-900">{p.stock}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 items-stretch">
                      <ExpiryDatePicker
                        value={untrackedDrafts[p.id] || ''}
                        onChange={(v) => setUntrackedDrafts(prev => ({ ...prev, [p.id]: v }))}
                        allowClear={false}
                        className="flex-1"
                      />
                      <button
                        onClick={() => handleAddExpiryToProduct(p)}
                        disabled={!untrackedDrafts[p.id]}
                        className="px-4 rounded-xl bg-amber-600 disabled:bg-gray-300 text-white text-sm font-bold shrink-0"
                      >
                        Hifadhi
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                  <p className="text-gray-500 font-medium">Bidhaa zote zenye stoki zina tarehe ya kuisha.</p>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowUntrackedList(false)}
              className="w-full mt-6 py-4 bg-amber-600 text-white font-bold rounded-2xl shadow-lg"
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
              <button onClick={() => setShowDeleteModal(false)} className="p-1 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <p className="text-gray-600 mb-6 text-sm">Chagua kipindi unachotaka kufuta. Kitendo hiki hakiwezi kurudishwa.</p>
            
            <div className="space-y-2 mb-6">
              {/* Labels come from the same constant the typed sentence is built
                  from, so the button and the phrase can never disagree. */}
              {(Object.entries(HISTORY_PERIOD_LABELS) as [HistoryPeriod, string][]).map(([value, label]) => ({ value, label })).map((p) => (
                <button 
                  key={p.value}
                  onClick={() => setSelectedDeletePeriod(p.value as any)}
                  className={`w-full p-4 text-left font-bold rounded-2xl transition-all border-2 ${
                    selectedDeletePeriod === p.value 
                      ? 'bg-red-50 border-red-500 text-red-700 shadow-sm' 
                      : 'bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100'
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
                className="flex-1 py-4 bg-red-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-red-100"
              >
                Futa Sasa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The typed gate, layered over the period picker so the chosen period
          stays visible behind it and the sentence can be checked against it. */}
      {selectedDeletePeriod && (
        <TypeToConfirm
          open={showDeleteHistoryConfirm}
          title="Futa Historia"
          phrase={deleteHistoryPhrase(selectedDeletePeriod)}
          description={
            <>
              Utafuta <b className="text-gray-900">mauzo, matumizi na malipo ya madeni</b> ya{' '}
              <b className="text-gray-900">{HISTORY_PERIOD_LABELS[selectedDeletePeriod]}</b>.
              Kitendo hiki <b className="text-red-600">hakiwezi kurudishwa</b>, na historia
              itafutwa pia kwenye vifaa vingine vya duka hili.
            </>
          }
          confirmLabel="Futa Sasa"
          onConfirm={performDeleteHistory}
          onClose={() => setShowDeleteHistoryConfirm(false)}
        />
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
              <button onClick={() => { setShowStaffModal(false); setEditingStaffId(null); }} className="p-1 bg-gray-100 rounded-full">
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
                  className="flex-1 py-4 bg-blue-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100"
                >
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
              <button onClick={() => { setShowInviteModal(false); setStaffEmail(''); }} className="p-1 bg-gray-100 rounded-full">
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
                  className="flex-1 py-4 bg-green-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-green-100"
                >
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
              <button onClick={() => setShowProfileModal(false)} className="p-1 bg-gray-100 rounded-full">
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
                  className="flex-1 py-4 bg-blue-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100"
                >
                  {isAddingStaff ? 'Inahifadhi...' : 'Hifadhi'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
