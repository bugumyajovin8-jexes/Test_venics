import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { Database, LogOut, RefreshCw, BarChart3, ChevronRight, Phone, Wallet, User, ShieldCheck, Trash2, Clock, AlertTriangle, X, CheckCircle, MessageSquare, Zap, Bell, Users, Plus, Shield, Settings, Ban, FileText, Package, EyeOff, Lock, Globe, Store, Monitor, Info, Eye, SunMoon, Moon } from 'lucide-react';
import { supabase } from '../supabase';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { endPresence } from '../services/presence';
import { TelemetryService } from '../services/telemetry';
import { notifications } from '../services/notifications';
import { useNavigate, useLocation } from 'react-router-dom';
import { startOfDay, startOfWeek, startOfMonth, startOfYear, subDays, isBefore, isAfter, addDays, format } from 'date-fns';
import { isBatchExpired, isBatchExpiringSoon } from '../utils/stock';
import ExpiryDatePicker from '../components/ExpiryDatePicker';
import TypeToConfirm from '../components/TypeToConfirm';
import { nowIso } from '../services/clock';
import { inviteStaffByPhone } from '../services/staffInvite';
import { formatTzPhone, normalizeTzPhone } from '../utils/phone';
import { Panel, Row, Section, Toggle } from '../components/zaidi/SettingsPanels';
import { staffPermissions, storedFlag, isAllowed, setAllowed, TONE, type StaffPermission } from '../components/staff/staffPermissions';
import SyncStatusCard from '../components/SyncStatusCard';
import ShopSwitcher from '../components/ShopSwitcher';
import HubPairing from '../components/HubPairing';
import LanguageSwitch from '../components/LanguageSwitch';
import ThemeSwitch from '../components/ThemeSwitch';
import {
  HISTORY_PERIOD_LABELS,
  deleteHistoryPhrase,
  type HistoryPeriod,
} from '../utils/confirmPhrases';

import { t } from '../i18n';
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
  const [staffPhone, setStaffPhone] = useState('');
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
  const [pendingInvitations, setPendingInvitations] = useState<{ id: string; email: string | null; phone: string | null; role: string; created_at: string }[]>([]);

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

  const handleCancelInvitation = async (id: string, contact: string) => {
    showConfirm(t('Ghairi Mwaliko'), t('Je, una uhakika unataka kufuta mwaliko kwa ajili ya {contact}?', { contact }), async () => {
      try {
        const { error } = await supabase
          .from('shop_invitations')
          .delete()
          .eq('id', id);
        if (error) throw error;
        showAlert(t('Imefanikiwa'), t('Mwaliko umefutwa kwa mafanikio.'));
        fetchPendingInvitations();
      } catch (err: any) {
        console.error('Cancel invitation error:', err);
        showAlert(t('Kosa'), err.message || t('Imeshindwa kufuta mwaliko'));
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

      showAlert(t('Imefanikiwa'), t('Taarifa za {staffName} zimebadilishwa kikamilifu.', { staffName }));
      setShowStaffModal(false);
      setEditingStaffId(null);
      setStaffName('');
      setStaffRole('employee');
      
      // Trigger sync
      SyncService.sync();
    } catch (err: any) {
      console.error('Update staff error:', err);
      showAlert(t('Kosa'), err.message || t('Imeshindwa kubadilisha taarifa'));
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

      showAlert(t('Imefanikiwa'), t('Wasifu wako umesasishwa.'));
      setShowProfileModal(false);
      
      // Trigger sync
      SyncService.sync();
    } catch (err: any) {
      console.error('Update profile error:', err);
      showAlert(t('Kosa'), err.message || t('Imeshindwa kusasisha wasifu'));
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleInviteStaff = async () => {
    if (!staffPhone || !user?.shopId) return;
    setIsAddingStaff(true);
    try {
      const outcome = await inviteStaffByPhone(staffPhone);
      if (!outcome.ok) {
        showAlert(t('Kosa'), outcome.message);
        return;
      }
      showAlert(outcome.sms === 'sent' ? t('Mwaliko Umetumwa') : t('Mwaliko Umehifadhiwa'), outcome.message);
      setShowInviteModal(false);
      setStaffPhone('');
      setStaffRole('employee');
      fetchPendingInvitations();
    } catch (err: any) {
      console.error('Invite staff error:', err);
      showAlert(t('Kosa'), err.message || t('Imeshindwa kutuma mwaliko'));
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleToggleBlockStaff = async (staffId: string, name: string, currentStatus: string) => {
    const isBlocking = currentStatus !== 'blocked';
    const actionText = isBlocking ? t('kumzuia (block)') : t('kumfungulia (unblock)');
    const successText = isBlocking ? t('Mfanyakazi amezuiwa.') : t('Mfanyakazi amefunguliwa.');
    
    showConfirm(isBlocking ? t('Zuia Mfanyakazi') : t('Fungulia Mfanyakazi'), t('Je, una uhakika unataka {actionText} {name}? {v}', { actionText, name, v: isBlocking ? 'Hataweza tena kuingia kwenye duka hili.' : 'Ataweza kuingia tena.' }), async () => {
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
        showAlert(t('Imefanikiwa'), successText);
        
        // Trigger sync
        SyncService.sync();
      } catch (err: any) {
        console.error('Toggle block staff error:', err);
        showAlert(t('Kosa'), t('Imeshindwa {actionText} mfanyakazi', { actionText }));
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

  // "Ficha Idadi…" / "Zuia… Historia" were switches for an old copy kept on
  // this computer; the shop-wide switches are in the Wafanyakazi section now
  // (staff/staffPermissions.ts). "Pakua Risiti (PDF)" switched a setting
  // nothing read. All three left with the new layout (2026-11-24).

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
        showAlert(t('Imefanikiwa'), t('Historia imefutwa kwa mafanikio!'));
        setShowDeleteModal(false);
        setSelectedDeletePeriod(null);
        SyncService.sync();
      } catch (e) {
        setShowDeleteHistoryConfirm(false);
        showAlert(t('Kosa'), t('Kuna tatizo wakati wa kufuta historia.'));
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
      showAlert(t('Kosa'), t('Kuna tatizo wakati wa kuhifadhi nakala.'));
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      // Close the presence block first so the shift ends at logout rather than
      // being left open and later swept with a stale end time.
      await endPresence();
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
        t('Kuna rekodi ambazo hazijatumwa'),
        t('Rekodi {unsent} (mauzo, matumizi au madeni) ziko kwenye kompyuta hii tu — hazijafika kwenye mtandao wala kwenye kituo cha duka. Ukitoka sasa zitafutwa na hazitapatikana tena. Ni bora uunganishe intaneti au kituo cha duka, usubiri zitumwe, kisha utoke. Toka sasa hata hivyo?', { unsent }),
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
      showAlert(t('Kosa'), t('Tafadhali unganisha mtandao kwanza!'));
      return;
    }
    setIsSyncing(true);
    await SyncService.sync(true);
    setIsSyncing(false);
    showAlert(t('Imefanikiwa'), t('Usawazishaji (Sync) umekamilika!'));
  };

  const handleSyncFeatures = async () => {
    if (!navigator.onLine) {
      showAlert(t('Kosa'), t('Tafadhali unganisha mtandao kwanza!'));
      return;
    }
    setIsSyncing(true);
    try {
      // Pulls ONLY the features table, not a whole full sync.
      await SyncService.refreshFeatures();
      // Toast, not showAlert — a success confirmation shouldn't block the user behind an "Okay".
      showToast(t('Ruhusa zimesawazishwa kikamilifu!'), 'success');
    } catch (e) {
      showAlert(t('Kosa'), t('Imeshindwa kusawazisha ruhusa.'));
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
        showAlert(t('Kosa'), t('Kuna tatizo wakati wa kuondoa bidhaa.'));
      }
    };

    if (!skipConfirm) {
      showConfirm(t('Ondoa Bidhaa'), t('Je, una uhakika unataka kuondoa bidhaa hii iliyokwisha muda? Hii itapunguza idadi ya bidhaa zilizopo.'), removeLogic);
    } else {
      removeLogic();
    }
  };

  // ------------------------------------------------------------------ layout
  // Rebuilt 2026-11-24 from the layout the owner saw on 9 November: a header
  // that stays at the top (who, Hariri wasifu, Ondoka) with tabs to each
  // section, and the sections in two columns instead of one stretched column.
  const boss = isBoss();
  const canExpiry = boss || isFeatureEnabled('staff_product_management');
  const features = useStore(s => s.features);
  const sections = [
    { id: 'akaunti', label: t('Akaunti na Duka'), icon: Store, show: true },
    { id: 'wafanyakazi', label: t('Wafanyakazi'), icon: Users, show: boss },
    { id: 'bidhaa', label: t('Bidhaa na Stock'), icon: Package, show: canExpiry },
    { id: 'kompyuta', label: t('Kompyuta Hii'), icon: Monitor, show: true },
    { id: 'malipo', label: boss ? t('Malipo na Msaada') : t('Msaada'), icon: Wallet, show: true },
    { id: 'hatari', label: t('Eneo la Hatari'), icon: AlertTriangle, show: boss },
  ].filter(s => s.show);

  // The tab of the section in view, following the page's own scroll area.
  const [activeSection, setActiveSection] = useState('akaunti');
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-main-scroll]');
    if (!root) return;
    const onScroll = () => {
      const els = [...root.querySelectorAll<HTMLElement>('[data-section]')];
      const top = root.getBoundingClientRect().top + 190;
      let cur = els[0]?.id;
      for (const el of els) if (el.getBoundingClientRect().top <= top) cur = el.id;
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) cur = els[els.length - 1]?.id;
      if (cur) setActiveSection(cur);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener('scroll', onScroll);
  }, [boss, canExpiry]);
  const goToSection = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const initials = (user?.name || 'M').trim().slice(0, 2).toUpperCase();

  // Invitations still waiting: not those whose person has already joined.
  const knownPhones = new Set(staff.map(s => normalizeTzPhone(s.phone)).filter(Boolean));
  const knownEmails = new Set(staff.map(s => (s.email || '').toLowerCase()).filter(Boolean));
  const waitingInvites = pendingInvitations.filter(inv =>
    !(inv.phone && knownPhones.has(normalizeTzPhone(inv.phone))) && !(inv.email && knownEmails.has(inv.email.toLowerCase())));

  // The five staff switches (staff/staffPermissions.ts): ON is always "allowed".
  const [permBusy, setPermBusy] = useState<string | null>(null);
  const flipPermission = async (p: StaffPermission) => {
    if (permBusy) return;
    setPermBusy(p.key);
    try { await setAllowed(p, !isAllowed(p, storedFlag(p, features, settings))); }
    catch (e) { console.error('[Zaidi] permission change failed:', e); }
    finally { setPermBusy(null); }
  };
  const TILE: Record<string, string> = { blue: 'text-blue-600 bg-blue-50', orange: 'text-orange-600 bg-orange-50', purple: 'text-purple-600 bg-purple-50', teal: 'text-teal-600 bg-teal-50', rose: 'text-rose-600 bg-rose-50' };

  const stockValueRows: Array<[string, number, string, string]> = [
    [t('Kwa bei ya kununua'), inventoryMetrics.totalBuyingValue, 'text-lg text-gray-900', 'text-sm text-gray-600'],
    [t('Kwa bei ya kuuza'), inventoryMetrics.totalSellingValue, 'text-lg text-blue-700', 'text-sm text-gray-600'],
    [t('Faida inayotarajiwa'), inventoryMetrics.totalSellingValue - inventoryMetrics.totalBuyingValue, 'text-xl text-emerald-700', 'text-sm font-bold text-gray-800'],
  ];

  return (
    <div className="min-h-full bg-gray-50" data-testid="zaidi-page">
      {/* Who you are, and the page's sections: stays at the top while scrolling. */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 md:px-8 pt-4 md:pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-6">
            <div className="flex items-center gap-3 md:gap-4 min-w-0">
              <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center text-lg font-black shrink-0">{initials}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-gray-900 truncate">{user?.name || t('Mtumiaji')}</h1>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider uppercase bg-blue-50 text-blue-700">{boss ? t('Bosi') : t('Mfanyakazi')}</span>
                </div>
                <p className="text-sm text-gray-500 truncate">{[user?.phone ? formatTzPhone(user.phone) : user?.email, shop?.name].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="zaidi-edit-profile"
                onClick={() => { setNewName(user?.name || ''); setShowProfileModal(true); }}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                <Settings className="w-4 h-4" /> {t('Hariri wasifu')}
              </button>
              <button
                type="button"
                data-testid="zaidi-logout"
                onClick={handleLogout}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100 cursor-pointer"
              >
                <LogOut className="w-4 h-4" /> {t('Ondoka')}
              </button>
            </div>
          </div>
          <nav className="flex gap-1 mt-3 md:mt-5 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0" aria-label={t('Sehemu za ukurasa')}>
            {sections.map(s => (
              <button
                key={s.id}
                type="button"
                data-testid={`zaidi-tab-${s.id}`}
                onClick={() => goToSection(s.id)}
                aria-current={activeSection === s.id ? 'true' : undefined}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap cursor-pointer transition-colors ${activeSection === s.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                <s.icon className="w-4 h-4" /> {s.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8 space-y-10">
        {/* 1. Account and shop */}
        <Section id="akaunti" title={t('Akaunti na Duka')} sub={t('Biashara zako na taarifa zinazoonekana kwenye risiti')}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            {boss && <ShopSwitcher allowCreate onSwitched={() => navigate('/dashibodi', { replace: true })} />}
            <Panel title={t('Taarifa za Biashara (Risiti)')} sub={t('Namba ya simu na eneo huonekana kwenye risiti')} icon={FileText} className={boss ? '' : 'lg:col-span-2'} testId="zaidi-receipt-info">
              <div className={`px-5 py-4 grid grid-cols-1 gap-4 ${boss ? '' : 'md:grid-cols-2'}`}>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">{t('Namba ya Simu ya Biashara')}</span>
                  <input type="tel" value={bizPhone} onChange={e => saveBizPhone(e.target.value)} placeholder={t('Mfano: 0787 979 273')} className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500" />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">{t('Eneo la Biashara')}</span>
                  <input type="text" value={bizLocation} onChange={e => saveBizLocation(e.target.value)} placeholder={t('Mfano: Kariakoo, Dar es Salaam')} className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500" />
                </label>
                <p className={`text-[11px] text-gray-500 flex items-center gap-1.5 ${boss ? '' : 'md:col-span-2'}`}>
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" /> {t('Zinahifadhiwa kwenye kifaa hiki pekee, na zinabaki hata ukitoka (logout).')}
                </p>
              </div>
            </Panel>
          </div>
        </Section>

        {/* 2. Staff (boss only) */}
        {boss && (
          <Section id="wafanyakazi" title={t('Wafanyakazi')} sub={t('Nani anatumia duka lako, na wanaruhusiwa nini')}>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
              <Panel
                className="xl:col-span-2"
                title={t('Wafanyakazi ({n})', { n: staff.length })}
                sub={t('Wanaingia kwa namba zao za simu')}
                icon={Users}
                tone="text-green-600 bg-green-50"
                testId="zaidi-staff"
                action={
                  <button type="button" data-testid="zaidi-add-staff" onClick={() => setShowInviteModal(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 cursor-pointer">
                    <Plus className="w-4 h-4" /> {t('Ongeza mfanyakazi')}
                  </button>
                }
              >
                {staff.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                        <th className="px-3 sm:px-5 py-2.5 font-bold">{t('Jina')}</th>
                        <th className="px-3 py-2.5 font-bold hidden sm:table-cell">{t('Simu')}</th>
                        <th className="px-3 py-2.5 font-bold hidden sm:table-cell">{t('Hali')}</th>
                        <th className="px-3 sm:px-5 py-2.5"><span className="sr-only">{t('Vitendo')}</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {staff.map(s => {
                        const blocked = s.status === 'blocked';
                        return (
                          <tr key={s.id} className="hover:bg-gray-50">
                            <td className="px-3 sm:px-5 py-3">
                              <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${blocked ? 'bg-red-50 text-red-400' : 'bg-blue-50 text-blue-700'}`}>{(s.name || '?').slice(0, 2).toUpperCase()}</div>
                                <div className="min-w-0">
                                  <p className={`font-semibold truncate ${blocked ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{s.name}</p>
                                  {/* On a narrow window the phone and status columns are hidden: shown here instead. */}
                                  <p className="text-[11px] text-gray-500 sm:hidden">{blocked ? <span className="font-bold text-red-600">{t('Amezuiwa')}</span> : (s.phone ? formatTzPhone(s.phone) : s.role)}</p>
                                  <p className="text-[11px] text-gray-500 hidden sm:block capitalize">{s.role}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-gray-700 hidden sm:table-cell">{s.phone ? formatTzPhone(s.phone) : '—'}</td>
                            <td className="px-3 py-3 hidden sm:table-cell">
                              {blocked
                                ? <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-50 text-red-600">{t('Amezuiwa')}</span>
                                : <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700">{t('Hai')}</span>}
                            </td>
                            <td className="px-3 sm:px-5 py-3">
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  title={t('Hariri Mfanyakazi')}
                                  aria-label={t('Hariri Mfanyakazi')}
                                  onClick={() => { setEditingStaffId(s.id); setStaffName(s.name); setStaffRole(s.role as any); setShowStaffModal(true); }}
                                  className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 cursor-pointer"
                                >
                                  <Settings className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  title={blocked ? t('Fungulia Mfanyakazi') : t('Zuia Mfanyakazi')}
                                  aria-label={blocked ? t('Fungulia Mfanyakazi') : t('Zuia Mfanyakazi')}
                                  onClick={() => handleToggleBlockStaff(s.id, s.name, s.status)}
                                  className={`p-2 rounded-lg cursor-pointer ${blocked ? 'text-green-600 hover:bg-green-50' : 'text-red-500 hover:bg-red-50'}`}
                                >
                                  {blocked ? <CheckCircle className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-5 py-6 text-sm text-gray-500 text-center">{t('Hujasajili mfanyakazi yeyote bado.')}</p>
                )}

                {/* Invited, not registered yet. */}
                {waitingInvites.length > 0 && (
                  <div className="border-t border-gray-100 px-5 py-3 space-y-2" data-testid="zaidi-pending-invites">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">{t('Mialiko Inayosubiri ({n})', { n: waitingInvites.length })}</p>
                    {waitingInvites.map(inv => {
                      const contact = inv.phone ? formatTzPhone(inv.phone) : (inv.email || '');
                      return (
                        <div key={inv.id} className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                            <span className="text-sm font-semibold text-gray-900 truncate">{contact}</span>
                            <span className="text-[11px] text-gray-500 shrink-0">{t('Alialikwa {date}', { date: format(new Date(inv.created_at), 'dd MMM yyyy') })}</span>
                          </div>
                          <button type="button" onClick={() => handleCancelInvitation(inv.id, contact)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 cursor-pointer" title={t('Ghairi Mwaliko')} aria-label={t('Ghairi Mwaliko')}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="px-5 py-3 border-t border-gray-100 text-xs text-gray-500 flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-500 shrink-0" />
                  {t('Ukimwongeza kwa namba yake ya simu, atapokea SMS ya mwaliko. Akijisajili kwa namba hiyo, ataingia kwenye duka lako moja kwa moja.')}
                </p>
              </Panel>

              <Panel title={t('Ruhusa za wafanyakazi')} sub={t('Zinatumika kwenye simu na kompyuta zote')} icon={ShieldCheck} tone="text-emerald-600 bg-emerald-50" testId="zaidi-permissions">
                <div className="divide-y divide-gray-100">
                  {staffPermissions().map(p => {
                    const allowed = isAllowed(p, storedFlag(p, features, settings));
                    return (
                      <Row key={p.key} icon={p.icon} tone={TILE[p.tone]} title={p.title}>
                        <Toggle on={allowed} onClick={() => { void flipPermission(p); }} color={TONE[p.tone][3]} label={p.title} disabled={permBusy === p.key} testId={`perm-${p.key}`} />
                      </Row>
                    );
                  })}
                </div>
                <p className="px-5 py-3 border-t border-gray-100 text-[11px] text-gray-500">{t('Ikiwa imewashwa, wanaruhusiwa. Ikiwa imezimwa, hawaruhusiwi.')}</p>
              </Panel>
            </div>
          </Section>
        )}

        {/* 3. Products and stock */}
        {canExpiry && (
          <Section id="bidhaa" title={t('Bidhaa na Stock')} sub={t('Tarehe za kuisha na thamani ya bidhaa zilizopo')}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              <Panel
                title={t('Usimamizi wa Expiry')}
                sub={t('Fuatilia tarehe za kuisha kwa bidhaa')}
                icon={Clock}
                tone="text-purple-600 bg-purple-50"
                testId="zaidi-expiry"
                action={<Toggle on={!!shop?.enable_expiry} onClick={() => { void toggleExpiry(); }} color="bg-purple-600" label={t('Usimamizi wa Expiry')} testId="expiry-switch" />}
              >
                {shop?.enable_expiry ? (
                  <div className="px-5 py-4 space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-800 mb-2">{t('Nionye siku ngapi kabla bidhaa kuisha muda? (kwa bidhaa zote zinazofuatiliwa)')}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {[30, 60, 90].map(d => (
                          <button key={d} type="button" onClick={() => saveExpiryNotifyDays(String(d))} className={`px-3.5 py-2 rounded-xl text-sm font-bold border cursor-pointer ${(shop.notify_expiry_days ?? 30) === d ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50'}`}>{d}</button>
                        ))}
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={t('siku')}
                          value={expiryDaysInput}
                          onChange={(e) => setExpiryDaysInput(e.target.value.replace(/[^0-9]/g, ''))}
                          onBlur={() => saveExpiryNotifyDays()}
                          className="w-20 px-3 py-2 rounded-xl border border-purple-200 text-sm font-bold text-purple-700 outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                        />
                        <span className="text-sm text-gray-500">{t('siku')}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button type="button" onClick={() => setShowExpiryList(true)} className="py-2.5 rounded-xl text-sm font-bold text-purple-700 bg-purple-50 border border-purple-100 hover:bg-purple-100 cursor-pointer">{t('Zilizokwisha muda')}</button>
                      <button type="button" onClick={() => { setLastSavedName(null); setShowUntrackedList(true); }} className="py-2.5 rounded-xl text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 hover:bg-amber-100 cursor-pointer flex items-center justify-center gap-2">
                        {t('Zisizo na tarehe')} {untrackedProducts.length > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs">{untrackedProducts.length}</span>}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="px-5 py-4 text-sm text-gray-500">{t('Imezimwa. Iwashe ili Venics ikuonye kabla bidhaa hazijaisha muda.')}</p>
                )}
              </Panel>

              {boss && (
                <Panel
                  title={t('Thamani ya Stock')}
                  sub={t('Thamani ya bidhaa zote zilizopo')}
                  icon={Database}
                  tone="text-green-600 bg-green-50"
                  testId="zaidi-stock-value"
                  action={shop?.enable_stock !== false && (
                    <button
                      type="button"
                      data-testid="stock-value-toggle"
                      onClick={() => { const next = !showInventoryValue; setShowInventoryValue(next); if (next) TelemetryService.trackStockValuationChecked(); }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${showInventoryValue ? 'bg-gray-100 text-gray-700' : 'bg-green-600 text-white'}`}
                    >
                      {showInventoryValue ? <><EyeOff className="w-3.5 h-3.5" /> {t('Ficha')}</> : <><Eye className="w-3.5 h-3.5" /> {t('Tazama')}</>}
                    </button>
                  )}
                >
                  {shop?.enable_stock === false ? (
                    <p className="px-5 py-4 text-sm text-gray-500 leading-relaxed">{t('Duka lako halifuatilii stock kwa sasa, hivyo thamani ya stock haiwezi kuhesabiwa. Washa ufuatiliaji wa stock kwenye mipangilio ili kuona mtaji na thamani ya bidhaa zako.')}</p>
                  ) : (
                    // One figure per row, across the whole panel: a 10-digit sum
                    // still fits, and if it ever does not, it moves under its label.
                    <div className="px-5 py-1 divide-y divide-gray-100">
                      {stockValueRows.map(([label, n, c, l]) => (
                        <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3">
                          <span className={l}>{label}</span>
                          <span className={`font-black tabular-nums whitespace-nowrap ${c}`}>{showInventoryValue ? formatCurrency(n, currency) : 'TSh •••••'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              )}
            </div>
          </Section>
        )}

        {/* 4. This computer: sync, its settings, and the shop's hub */}
        <Section id="kompyuta" title={t('Kompyuta Hii')} sub={t('Usawazishaji, Kituo cha Duka na mipangilio inayohusu kompyuta hii pekee')}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <div className="space-y-5">
              {/* Everyone sees it: a stuck queue on an employee's till is the one nobody would otherwise notice. */}
              <SyncStatusCard />
              <Panel title={t('Mipangilio ya kompyuta hii')} sub={t('Haihamii kwenye simu wala kompyuta nyingine')} icon={Settings} tone="text-gray-600 bg-gray-100" testId="zaidi-computer">
                <div className="divide-y divide-gray-100">
                  <Row icon={Globe} tone="text-sky-600 bg-sky-50" title={t('Lugha')} desc={t('Chagua lugha ya programu kwenye kifaa hiki')}><LanguageSwitch compact /></Row>
                  <Row icon={SunMoon} tone="text-indigo-600 bg-indigo-50" title={t('Mwonekano')} desc={t('Mwanga, giza, au kama kompyuta yako ilivyo')}><ThemeSwitch compact /></Row>
                  {boss && (
                    <Row icon={Moon} tone="text-purple-600 bg-purple-50" title={t('Duka la Saa 24')} testId="zaidi-24h">
                      <Toggle on={!!settings?.operate24Hours} onClick={() => { void toggleOperate24Hours(); }} color="bg-indigo-600" label={t('Duka la Saa 24')} />
                    </Row>
                  )}
                  {boss && (
                    <Row icon={Bell} tone="text-orange-600 bg-orange-50" title={t('Notifications')} desc={t('Pokea ripoti za kila siku kwenye kompyuta hii')}>
                      <button
                        type="button"
                        onClick={async () => {
                          const granted = await notifications.requestPermission();
                          if (granted) notifications.sendNotification(t('Hongera!'), t('Notifications sasa zimeunganishwa kikamilifu.'));
                          else showAlert(t('Kosa'), t('Tafadhali ruhusu notifications kwenye browser yako.'));
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 cursor-pointer"
                      >
                        {t('Washa')}
                      </button>
                    </Row>
                  )}
                  {!boss && (
                    <Row icon={ShieldCheck} tone="text-emerald-600 bg-emerald-50" title={t('Ruhusa')} desc={t('Sawazisha ruhusa ulizopewa na mmiliki')}>
                      <button type="button" onClick={handleSyncFeatures} disabled={isSyncing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-60 cursor-pointer">
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} /> {t('Sawazisha')}
                      </button>
                    </Row>
                  )}
                </div>
              </Panel>
            </div>
            {/* The shop's own hub: how devices sync when there is no internet. */}
            <HubPairing />
          </div>
        </Section>

        {/* 5. Payment and help */}
        <Section id="malipo" title={boss ? t('Malipo na Msaada') : t('Msaada')} sub={boss ? t('Leseni ya mfumo na jinsi ya kupata msaada') : t('Jinsi ya kupata msaada')}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
            {boss && (
              <Panel
                title={t('Malipo ya Mfumo')}
                sub={t('Usajili na leseni ya matumizi ya mfumo')}
                icon={Wallet}
                testId="zaidi-licence"
                action={<span className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 text-sm font-black">{t('{formatCurrency} / Mwezi', { formatCurrency: formatCurrency(20000, currency) })}</span>}
              >
                <ol className="px-5 py-4 space-y-2 text-sm text-gray-700 list-decimal list-inside">
                  <li>{t('Wasiliana na huduma kwa wateja kupitia namba')} <b>0787979273</b></li>
                  <li>{t('Taja namba ya simu ya akaunti yako:')} <b className="text-blue-700">{user?.phone ? formatTzPhone(user.phone) : (user?.email || t('Akaunti yako'))}</b></li>
                  <li>{t('Utapokea maelekezo ya kufanya malipo na kuwezeshwa leseni yako mara moja.')}</li>
                </ol>
              </Panel>
            )}
            <Panel title={t('Huduma kwa Wateja')} sub={t('Kwa msaada wowote au maoni')} icon={Phone} tone="text-blue-600 bg-blue-50" className={boss ? '' : 'lg:col-span-2'} testId="zaidi-support">
              <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-2xl font-black text-gray-900 tracking-wide">0787 979 273</p>
                  <p className="text-xs text-gray-500 mt-1">{t('Simu au WhatsApp')}</p>
                </div>
                <a href="tel:0787979273" className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
                  <Phone className="w-4 h-4" /> {t('Piga simu')}
                </a>
              </div>
            </Panel>
          </div>
        </Section>

        {/* 6. Danger zone (boss only) */}
        {boss && (
          <Section id="hatari" title={t('Eneo la Hatari')} sub={t('Hatua zisizoweza kurudishwa nyuma')}>
            <div className="bg-white rounded-2xl border border-red-200 shadow-sm flex flex-wrap items-center justify-between gap-4 px-5 py-4" data-testid="zaidi-danger">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-red-50 text-red-600"><Trash2 className="w-5 h-5" /></div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{t('Futa Historia')}</p>
                  <p className="text-xs text-gray-500">{t('Futa historia ya mauzo na matumizi kwa kipindi fulani.')}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowDeleteModal(true)} className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-bold hover:bg-red-100 cursor-pointer">{t('Futa Historia…')}</button>
            </div>
          </Section>
        )}

        <p className="text-center text-xs text-gray-500 pb-6">
          <span className="font-bold text-blue-600">{t('Venics Sales')}</span> · {t('Version 1.0.0')} · {t('Made by Venics Software Company')}
        </p>
      </div>

      {/* Expiry List Modal */}
      {showExpiryList && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-purple-600">
                <Clock className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">{t('Usimamizi wa Expiry')}</h2>
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
                {t('Zilizokwisha ({length})', { length: expiryData.expired.length })}
              </button>
              <button 
                onClick={() => setActiveExpiryTab('near')}
                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${activeExpiryTab === 'near' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}
              >
                {t('Zinazoisha ({length})', { length: expiryData.nearExpiry.length })}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6">
              {loadingExpiry ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 border-4 border-purple-100 border-t-purple-600 rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-500 font-medium">{t('Inapakia data...')}</p>
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
                              showConfirm(t('Ondoa Zote'), t('Je, una uhakika unataka kuondoa bidhaa ZOTE {length} zilizokwisha muda?', { length: expiryData.expired.length }), async () => {
                                for (const item of expiryData.expired) {
                                  await handleRemoveBatch(item.id, item.batch.id, true);
                                }
                                showAlert(t('Imefanikiwa'), t('Bidhaa zote zilizokwisha muda zimeondolewa.'));
                              });
                            }}
                            className="w-full py-3 bg-red-600 text-white rounded-2xl text-sm font-bold flex items-center justify-center mb-4 shadow-md"
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> {t('Ondoa Zote Zilizokwisha')}
                          </button>
                          {expiryData.expired.map((item, idx) => (
                            <div key={`${item.id}-${idx}`} className="p-4 bg-red-50 border border-red-100 rounded-2xl">
                              <div className="flex justify-between items-start mb-3">
                                <div>
                                  <p className="font-bold text-gray-800 text-lg">{item.name}</p>
                                  <p className="text-sm text-red-600 font-medium flex items-center">
                                    <AlertTriangle className="w-4 h-4 mr-1" />
                                    {t('Iliisha: {format}', { format: format(new Date(item.batch.expiry_date), 'dd/MM/yyyy') })}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-gray-400 uppercase font-bold">{t('Stock')}</p>
                                  <p className="text-xl font-bold text-gray-900">{item.batch.stock}</p>
                                </div>
                              </div>
                              <button 
                                onClick={() => handleRemoveBatch(item.id, item.batch.id)}
                                className="w-full py-2.5 bg-white text-red-600 border border-red-200 rounded-xl text-sm font-bold flex items-center justify-center hover:bg-red-100 transition-colors"
                              >
                                <Trash2 className="w-4 h-4 mr-2" /> {t('Ondoa Bidhaa Hii')}
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-green-500" />
                          </div>
                          <p className="text-gray-500 font-medium">{t('Hongera! Hakuna bidhaa zilizokwisha muda.')}</p>
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
                                    {t('Inaisha: {format}', { format: format(new Date(item.batch.expiry_date), 'dd/MM/yyyy') })}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-gray-400 uppercase font-bold">{t('Stock')}</p>
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
                          <p className="text-gray-500 font-medium">{t('Hakuna bidhaa zinazoisha karibuni (ndani ya siku 30).')}</p>
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
              {t('Funga')}
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
                <h2 className="text-xl font-bold">{t('Bidhaa Zisizo na Tarehe')}</h2>
              </div>
              <button onClick={() => setShowUntrackedList(false)} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              {t('Hizi ni bidhaa zenye stoki lakini hazina tarehe ya kuisha. Kama kuna uliyoisahau, weka tarehe yake hapa moja kwa moja.')}
            </p>

            {lastSavedName && (
              <div className="mb-4 p-3 bg-green-50 border border-green-100 rounded-2xl flex items-center text-green-700 text-sm font-bold">
                <CheckCircle className="w-4 h-4 mr-2 shrink-0" />
                {t('Tarehe imewekwa kwa {lastSavedName}', { lastSavedName })}
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3">
              {untrackedProducts.length > 0 ? (
                untrackedProducts.map(p => (
                  <div key={p.id} className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
                    <div className="flex justify-between items-start mb-3">
                      <p className="font-bold text-gray-800 text-base pr-2">{p.name}</p>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-gray-400 uppercase font-bold">{t('Stock')}</p>
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
                        {t('Hifadhi')}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                  <p className="text-gray-500 font-medium">{t('Bidhaa zote zenye stoki zina tarehe ya kuisha.')}</p>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowUntrackedList(false)}
              className="w-full mt-6 py-4 bg-amber-600 text-white font-bold rounded-2xl shadow-lg"
            >
              {t('Funga')}
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
                <h2 className="text-xl font-bold">{t('Futa Historia')}</h2>
              </div>
              <button onClick={() => setShowDeleteModal(false)} className="p-1 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <p className="text-gray-600 mb-6 text-sm">{t('Chagua kipindi unachotaka kufuta. Kitendo hiki hakiwezi kurudishwa.')}</p>
            
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
                {t('Ghairi')}
              </button>
              <button 
                onClick={handleDeleteHistory}
                disabled={!selectedDeletePeriod}
                className="flex-1 py-4 bg-red-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-red-100"
              >
                {t('Futa Sasa')}
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
          title={t('Futa Historia')}
          phrase={deleteHistoryPhrase(selectedDeletePeriod)}
          description={
            <>
              {t('Utafuta')} <b className="text-gray-900">{t('mauzo, matumizi na malipo ya madeni')}</b> {t('ya')}{' '}
              <b className="text-gray-900">{HISTORY_PERIOD_LABELS[selectedDeletePeriod]}</b>{t('. Kitendo hiki')} <b className="text-red-600">{t('hakiwezi kurudishwa')}</b>{t(', na historia itafutwa pia kwenye vifaa vingine vya duka hili.')}
            </>
          }
          confirmLabel={t('Futa Sasa')}
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
                <h2 className="text-xl font-bold">{t('Hariri Mfanyakazi')}</h2>
              </div>
              <button onClick={() => { setShowStaffModal(false); setEditingStaffId(null); }} className="p-1 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">{t('Jina la Mfanyakazi')}</label>
                <input 
                  type="text"
                  value={staffName}
                  onChange={e => setStaffName(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
                  placeholder={t('Jina Kamili')}
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => { setShowStaffModal(false); setEditingStaffId(null); }}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
                >
                  {t('Ghairi')}
                </button>
                <button 
                  onClick={handleUpdateStaff}
                  disabled={isAddingStaff || !staffName.trim()}
                  className="flex-1 py-4 bg-blue-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100"
                >
                  {isAddingStaff ? t('Inahifadhi...') : t('Hifadhi')}
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
                <h2 className="text-xl font-bold">{t('Mwaliko Mpya')}</h2>
              </div>
              <button onClick={() => { setShowInviteModal(false); setStaffPhone(''); }} className="p-1 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">{t('Namba ya Simu ya Mfanyakazi')}</label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={staffPhone}
                  onChange={e => setStaffPhone(e.target.value.replace(/[^\d+\s-]/g, ''))}
                  placeholder={t('mfano 0712 345 678')}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-green-500 outline-none font-bold text-gray-700"
                  autoFocus
                />
              </div>

              <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl text-orange-700 text-[10px] leading-relaxed">
                <b>{t('Kumbuka:')}</b> {t('Mfanyakazi atapokea SMS ya mwaliko. Lazima ajisajili (Register) kwa kutumia namba hii ili kujiunga na biashara yako moja kwa moja.')}
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => { setShowInviteModal(false); setStaffPhone(''); }}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
                >
                  {t('Ghairi')}
                </button>
                <button 
                  onClick={handleInviteStaff}
                  disabled={isAddingStaff || !staffPhone}
                  className="flex-1 py-4 bg-green-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-green-100"
                >
                  {isAddingStaff ? t('Inatuma...') : t('Tuma Mwaliko')}
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
                <h2 className="text-xl font-bold">{t('Hariri Wasifu')}</h2>
              </div>
              <button onClick={() => setShowProfileModal(false)} className="p-1 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">{t('Jina Lako Kamili')}</label>
                <input 
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
                  placeholder={t('Jina Kamili')}
                  autoFocus
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => setShowProfileModal(false)}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
                >
                  {t('Ghairi')}
                </button>
                <button 
                  onClick={handleUpdateProfile}
                  disabled={isAddingStaff || !newName.trim()}
                  className="flex-1 py-4 bg-blue-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100"
                >
                  {isAddingStaff ? t('Inahifadhi...') : t('Hifadhi')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
