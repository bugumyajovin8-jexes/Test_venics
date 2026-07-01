import { Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { useEffect } from 'react';
import { SyncService } from './services/sync';
import { notifications } from './services/notifications';
import BottomNav from './components/BottomNav';
import NotificationCenter from './components/NotificationCenter';
import Dashibodi from './pages/Dashibodi';
import Bidhaa from './pages/Bidhaa';
import Kikapu from './pages/Kikapu';
import Madeni from './pages/Madeni';
import Historia from './pages/Historia';
import Matumizi from './pages/Matumizi';
import Zaidi from './pages/Zaidi';
import AuditLogs from './pages/AuditLogs';
import ExecutiveDashboard from './pages/ExecutiveDashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SetupShop from './pages/SetupShop';
import LicenseGuard from './components/LicenseGuard';
import { supabase } from './supabase';
import { AlertTriangle } from 'lucide-react';
import React from 'react';
import { GlobalModal } from './components/GlobalModal';
import ToastContainer from './components/ToastContainer';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center">
          <AlertTriangle className="w-16 h-16 text-red-600 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Kuna tatizo limetokea</h1>
          <p className="text-gray-600 mb-6 max-w-md">Programu imeshindwa kuendelea. Tafadhali jaribu kupakia upya ukurasa.</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg"
          >
            Pakia Upya
          </button>
          {process.env.NODE_ENV === 'development' && (
            <pre className="mt-8 p-4 bg-white border border-red-100 rounded-xl text-left text-xs overflow-auto max-w-full">
              {this.state.error?.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  useEffect(() => {
    // Hardware back button behavior for Capacitor/APK
    const setupBackButton = async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        
        await CapApp.addListener('backButton', ({ canGoBack }) => {
          const state = useStore.getState();
          
          // 1. Closables: Check if chatbot is open
          if (state.isMshauriOpen) {
            // MshauriChat uses pushState internally, so we go back to trigger popstate closure
            window.history.back();
            return;
          }
          
          // 2. Closables: Check if global modal is open
          if (state.modal.isOpen) {
            state.hideModal();
            return;
          }

          // 3. Navigation: Go back in history if possible
          if (canGoBack) {
            window.history.back();
          } else {
            // 4. No more history, exit app
            CapApp.exitApp();
          }
        });
      } catch (e) {
        // Log silently as this only applies to mobile builds
        console.debug('Capacitor App plugin not available or error in listener:', e);
      }
    };

    if (typeof window !== 'undefined' && (window as any).Capacitor) {
      void setupBackButton();
    }
  }, []);

  // Strategy 1: The version.json Polling & Intelligent Auto-Reload Strategy
  useEffect(() => {
    let baselineVersion: string | null = null;
    let checkTimer: any = null;
    let active = true;

    const fetchVersion = async (): Promise<string | null> => {
      try {
        const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          return data.version || null;
        }
      } catch (err) {
        console.warn('[VersionCheck] Failed to fetch version:', err);
      }
      return null;
    };

    const runCheck = async () => {
      if (!active) return;
      const latest = await fetchVersion();
      if (!latest || !active) return;

      if (!baselineVersion) {
        baselineVersion = latest;
        console.log('[VersionCheck] Baseline frontend version discovered:', baselineVersion);
        return;
      }

      if (latest !== baselineVersion) {
        console.log(`[VersionCheck] Newer frontend version available: ${latest} (active: ${baselineVersion})`);

        const state = useStore.getState();
        const isAtKikapu = window.location.href.includes('/kikapu') || window.location.pathname.includes('/kikapu');
        const hasCartItems = state.cart && state.cart.length > 0;

        if (isAtKikapu && hasCartItems) {
          console.log('[VersionCheck] Active sale in progress inside Kikapu cart. Deferring reload.');
          return;
        }

        console.log('[VersionCheck] Performing programmatic intelligent update reload...');
        window.location.reload();
      }
    };

    const init = async () => {
      const initial = await fetchVersion();
      if (initial && active) {
        baselineVersion = initial;
        console.log('[VersionCheck] Established baseline version:', baselineVersion);
      }

      // Check version on a 5-minute interval
      checkTimer = setInterval(runCheck, 300000);
    };

    void init();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[VersionCheck] Window focused, validating active version...');
        void runCheck();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      if (checkTimer) {
        clearInterval(checkTimer);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const isAuthenticated = useStore(state => state.isAuthenticated);
  const user = useStore(state => state.user);
  const setAuth = useStore(state => state.setAuth);
  const updateUser = useStore(state => state.updateUser);
  const logout = useStore(state => state.logout);
  const settings = useLiveQuery(() => db.settings.get(1));
  const syncStatus = useStore(state => state.syncStatus);

  // Load tables for reactive in-app notifications checks
  const productsResult = useLiveQuery(() => db.products.where('isDeleted').equals(0).toArray());
  const licenseResult = useLiveQuery(() => db.license.get(1));
  const expensesResult = useLiveQuery(() => db.expenses.where('isDeleted').equals(0).toArray());
  const auditLogsResult = useLiveQuery(() => db.auditLogs.where('isDeleted').equals(0).toArray());
  const salesResult = useLiveQuery(() => db.sales.where('isDeleted').equals(0).toArray());
  const usersResult = useLiveQuery(() => db.users.toArray());
  const debtPaymentsResult = useLiveQuery(() => db.debtPayments.where('isDeleted').equals(0).toArray());

  const addNotificationList = useStore(state => state.addNotificationList);

  useEffect(() => {
    if (!isAuthenticated || !user?.shop_id) return;

    let targetNotification: any = null;

    // 1. Check License Expiry (Highest Priority)
    if (licenseResult) {
      const daysLeft = Math.ceil((licenseResult.expiryDate - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 7) {
        targetNotification = {
          id: 'license_expiry_warning',
          title: '🚨 Matumizi ya Mfumo Yanaisha!',
          message: daysLeft > 0 
            ? `Huduma ya mfumo kwenye duka lako inaisha hivi karibuni baada ya siku ${daysLeft}. Rekebisha haraka kuepuka kufungwa.`
            : `Muda wa duka hili kutumia mfumo umekwisha kabisa leo! Tafadhali fanya marekebisho kufungua huduma.`,
          type: 'critical',
          page: 'license',
          chatPrompt: 'Mwelekeo wa malipo na matumizi ya mfumo kwa duka langu?',
          isRead: false,
          timestamp: Date.now()
        };
      }
    }

    // 2. Check Audit log anomaly (Security - 2nd Priority)
    if (!targetNotification && auditLogsResult && auditLogsResult.length > 0) {
      const bossIds = usersResult?.filter(u => u.role === 'boss' || u.role === 'admin').map(u => u.id) || [];
      const recentAnomalies = auditLogsResult
        .filter(log => log.action?.startsWith('anomaly_') || log.action?.includes('delete') || log.action?.includes('update'))
        .filter(log => !bossIds.includes(log.user_id))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (recentAnomalies.length > 0) {
        const anomaly = recentAnomalies[0]; // just pick the most recent
        targetNotification = {
          id: `anomaly_${anomaly.id}`,
          title: '🚨 Mabadiliko yenye Mashaka!',
          message: `Mfanyakazi ${anomaly.details?.employee_name || 'mmoja'} ameripotiwa kufanya mabadiliko: "${anomaly.details?.warning || anomaly.details?.details || anomaly.action}".`,
          type: 'warning',
          page: 'security',
          chatPrompt: `Nimebaini mabadiliko yenye mashaka tarehe ${anomaly.created_at}. Nielemishe undani wa usalama wa duka letu?`,
          isRead: false,
          timestamp: new Date(anomaly.created_at).getTime()
        };
      }
    }

    // 3. Check Expenses Ratio/Spikes (3rd Priority)
    if (!targetNotification && expensesResult && expensesResult.length > 0 && salesResult && salesResult.length > 0) {
      const totalExp = expensesResult.reduce((sum, e) => sum + e.amount, 0);
      const totalSal = salesResult.reduce((sum, s) => sum + s.total_amount, 0);
      const ratio = totalSal > 0 ? (totalExp / totalSal) : 0;
      
      if (ratio > 0.45) { // If expenses eat more than 45% of sales
        targetNotification = {
          id: 'expenses_limit_warning',
          title: '💸 Matumizi ya Juu Sana!',
          message: `Matumizi ya duka letu yamefikia ${(ratio * 100).toFixed(1)}% ya jumla ya mauzo yote. Hii ni asilimia hatari, tafadhali bana gharama.`,
          type: 'warning',
          page: 'expenses',
          chatPrompt: 'Matumizi yetu yamezidi kiwango, tufanye nini kubana matumizi?',
          isRead: false,
          timestamp: Date.now()
        };
      }
    }

    // 4. Check Debts Spike (4th Priority)
    if (!targetNotification) {
      const creditSales = salesResult?.filter(s => s.payment_method === 'credit' && s.status !== 'completed') || [];
      // Subtract partial debt payments so we report the actual outstanding balance,
      // not the original sale totals (matches the Madeni page calculation).
      const debtorAmount = creditSales.reduce((sum, s) => {
        const paid = (debtPaymentsResult || [])
          .filter(p => p.sale_id === s.id)
          .reduce((acc, p) => acc + p.amount, 0);
        return sum + Math.max(0, s.total_amount - paid);
      }, 0);
      if (debtorAmount > 500000) { // Tsh 500k is threshold Swahili-locale
        targetNotification = {
          id: 'outstanding_debts_warning',
          title: '⚠️ Kiwango Kikuu Cha Mikopo Nje!',
          message: `Kuna jumla ya madeni ya kiasi cha Tsh ${debtorAmount.toLocaleString()} ambayo bado hayajalipwa na wateja wa mikopo.`,
          type: 'info',
          page: 'sales',
          chatPrompt: 'Tuna wateja gani wanaotudai mikopo na nifanye nini kupunguza madeni haya?',
          isRead: false,
          timestamp: Date.now()
        };
      }
    }

    // 5. Check Low Stock Products (Lowest Priority)
    if (!targetNotification && productsResult && productsResult.length > 0) {
      const lowStockProducts = productsResult.filter(p => p.stock <= p.min_stock);
      if (lowStockProducts.length > 0) {
        targetNotification = {
          id: 'low_stock_warning',
          title: '⚠️ Bidhaa Zinaisha Stoo!',
          message: `Kuna bidhaa ${lowStockProducts.length} zilizopo chini ya kiwango cha chini salama. Tafadhali hakiki stoo yako sasa.`,
          type: 'warning',
          page: 'stock',
          chatPrompt: 'Bidhaa gani zinaisha (low stock)?',
          isRead: false,
          timestamp: Date.now()
        };
      }
    }

    if (targetNotification) {
      addNotificationList(targetNotification);
    }

  }, [productsResult?.length, licenseResult?.expiryDate, expensesResult?.length, auditLogsResult?.length, salesResult?.length, usersResult?.length, debtPaymentsResult?.length, isAuthenticated, user?.shop_id]);

  useEffect(() => {
    if (isAuthenticated && user?.shopId && !sessionStorage.getItem('app_opened_logged')) {
      SyncService.logAction('app_opened', { platform: 'mobile' });
      sessionStorage.setItem('app_opened_logged', 'true');
    }
  }, [isAuthenticated, user?.shopId]);

  useEffect(() => {
    if (isAuthenticated) {
      notifications.initPushNotifications();
      notifications.startService();
    } else {
      notifications.stopService();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        const hasLocalToken = !!localStorage.getItem('pos_token');
        if (!hasLocalToken) {
          logout();
        } else {
          console.warn('[App] Supabase backend reported SIGNED_OUT, but local credentials exist. Initiating silent session recovery...');
          void SyncService.ensureSessionValid().then(recovered => {
            if (recovered) {
              console.log('[App] Silent session recovery succeeded after SIGNED_OUT notification.');
            } else {
              console.error('[App] Silent session recovery failed. Retaining offline cache.');
            }
          });
        }
      } else if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        const currentUser = useStore.getState().user;
        if (!currentUser && event === 'SIGNED_IN') {
          try {
            const { data: userData } = await supabase
              .from('users')
              .select('id, name, role, shop_id, status, created_at, updated_at')
              .eq('id', session.user.id)
              .single();

            if (userData) {
              const localUser = {
                id: userData.id,
                email: session.user.email || '',
                name: userData.name,
                role: userData.role as any,
                shop_id: userData.shop_id,
                shopId: userData.shop_id,
                status: userData.status,
                isActive: userData.status === 'active',
                created_at: userData.created_at,
                updated_at: userData.updated_at,
                isDeleted: 0,
                synced: 1,
              };
              setAuth(session.access_token, localUser, session.refresh_token);
            }
          } catch (e) {
            console.error('Failed to fetch user profile on auth state change', e);
          }
        } else if (currentUser && event === 'TOKEN_REFRESHED') {
           // Provide the refreshed token to our store so API calls have the latest version.
           setAuth(session.access_token, currentUser, session.refresh_token);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setAuth, logout]);

  useEffect(() => {
    if (user?.shopId) {
      SyncService.checkGhostItems(user.shopId);
    }
  }, [user?.shopId]);

  useEffect(() => {
    const isBoss = user?.role === 'admin' || user?.role === 'boss';
    if (isAuthenticated && isBoss) {
      notifications.requestPermission();
      notifications.startService();
    } else {
      notifications.stopService();
    }
    return () => notifications.stopService();
  }, [isAuthenticated, user?.role]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const checkStatus = async () => {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;

        // Perform proactive silent auth session healing check
        const isSessionOK = await SyncService.ensureSessionValid();
        if (!isSessionOK) {
          console.warn('[App] Silent session verification failed during status check. Sync paused.');
          return;
        }

        const { data: userData, error } = await supabase
          .from('users')
          .select('status, role, shop_id, shop:shops(status)')
          .eq('id', user.id)
          .maybeSingle();

        if (userData && !error) {
          const isUserActive = userData.status === 'active';
          const hasShop = !!userData.shop_id;
          const isShopActive = hasShop ? (userData.shop as any)?.status === 'active' : true;

          if (!isUserActive || (hasShop && !isShopActive)) {
            await supabase.auth.signOut();
            logout('Akaunti Imezuiliwa: Tafadhali wasiliana 0787979273');
            return;
          }

          if (userData.role !== user.role || userData.shop_id !== user.shop_id) {
            updateUser({
              role: userData.role as any,
              shop_id: userData.shop_id,
              shopId: userData.shop_id,
            });
          }

          if (!userData.shop_id && user.email) {
            const { data: invitation } = await supabase
              .from('shop_invitations')
              .select('id, shop_id, role, email')
              .eq('email', user.email.toLowerCase())
              .maybeSingle();

            if (invitation) {
              const { error: updateError } = await supabase
                .from('users')
                .update({
                  shop_id: invitation.shop_id,
                  role: invitation.role,
                })
                .eq('id', user.id);

              if (!updateError) {
                await supabase.from('shop_invitations').delete().eq('id', invitation.id);
                updateUser({
                  shop_id: invitation.shop_id,
                  shopId: invitation.shop_id,
                  role: invitation.role as any,
                });
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to check user status', e);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 180000);
    return () => clearInterval(interval);
  }, [isAuthenticated, user?.id, user?.role, user?.shop_id, user?.email, logout, updateUser]);

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    let lastActiveTime = Date.now();
    let isAppInactive = false;
    let lastVisibilitySyncTime = 0;
    let criticalTimer: ReturnType<typeof setTimeout> | null = null;
    let fullTimer: ReturnType<typeof setTimeout> | null = null;
    let initialTimer: ReturnType<typeof setTimeout> | null = null;

    const checkBroadcasts = async () => {
      try {
        const { data: messages } = await supabase
          .from('broadcast_messages')
          .select('id, title, body, created_at')
          .eq('status', 'sent')
          .or(`target_role.eq.all,target_role.eq.${user?.role},target_ids.cs.{${user?.id}}`)
          .order('created_at', { ascending: false })
          .limit(1);

        if (cancelled) return;

        if (messages && messages.length > 0) {
          const latestMsg = messages[0];
          const lastSeenId = localStorage.getItem('last_broadcast_id');

          if (latestMsg.id !== lastSeenId) {
            useStore.getState().showAlert(latestMsg.title, latestMsg.body);
            localStorage.setItem('last_broadcast_id', latestMsg.id);
          }
        }
      } catch (e) {
        console.error('Failed to check broadcasts', e);
      }
    };

    const scheduleNextCritical = () => {
      if (cancelled) return;
      if (criticalTimer) clearTimeout(criticalTimer);

      const jitterDelay = 45000 + Math.floor(Math.random() * 8000);
      criticalTimer = setTimeout(() => {
        if (cancelled) return;

        if (Date.now() - lastActiveTime > 300000) {
          isAppInactive = true;
          useStore.getState().setSyncStatus('sleep');
          return;
        }

        if (navigator.onLine) {
          void SyncService.sync(false, 'critical');
        }

        scheduleNextCritical();
      }, jitterDelay);
    };

    const scheduleNextFull = () => {
      if (cancelled) return;
      if (fullTimer) clearTimeout(fullTimer);

      const jitterDelay = 300000 + Math.floor(Math.random() * 30000);
      fullTimer = setTimeout(() => {
        if (cancelled) return;

        if (Date.now() - lastActiveTime > 300000) {
          isAppInactive = true;
          useStore.getState().setSyncStatus('sleep');
          return;
        }

        if (navigator.onLine) {
          void SyncService.sync(false, 'full');
          void checkBroadcasts();
        }

        scheduleNextFull();
      }, jitterDelay);
    };

    const updateActivity = () => {
      lastActiveTime = Date.now();
      useStore.getState().setSyncStatus('active');
      if (isAppInactive) {
        isAppInactive = false;
        if (navigator.onLine) {
          void SyncService.sync(false, 'critical');
          void checkBroadcasts();
        }
        scheduleNextCritical();
        scheduleNextFull();
      }
    };

    window.addEventListener('mousemove', updateActivity, { passive: true });
    window.addEventListener('keydown', updateActivity, { passive: true });
    window.addEventListener('scroll', updateActivity, { passive: true });
    window.addEventListener('click', updateActivity, { passive: true });
    window.addEventListener('touchstart', updateActivity, { passive: true });

    const initialJitter = 2000 + Math.floor(Math.random() * 15000);
    initialTimer = setTimeout(() => {
      if (!cancelled && navigator.onLine) {
        void SyncService.sync(false, 'full');
      }
    }, initialJitter);

    void checkBroadcasts();
    scheduleNextCritical();
    scheduleNextFull();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        if (navigator.onLine) {
          lastActiveTime = Date.now();
          isAppInactive = false;
          useStore.getState().setSyncStatus('active');
          
          const isAuthed = await SyncService.ensureSessionValid();
          if (isAuthed) {
            // Force critical sync first to get transactions, then full sync on iOS wake
            void SyncService.sync(false, 'critical').then(() => {
              void SyncService.sync(false, 'full');
            });
            void checkBroadcasts();
          } else {
            console.warn('[App] Proactive session verification failed on focus. Offline sync queue preserved.');
          }
        }
      }
    };

    const handleOnline = async () => {
      lastActiveTime = Date.now();
      isAppInactive = false;
      useStore.getState().setSyncStatus('active');
      
      const isAuthed = await SyncService.ensureSessionValid();
      if (isAuthed) {
        void SyncService.sync(false, 'critical').then(() => {
          void SyncService.sync(false, 'full');
        });
        void checkBroadcasts();
      } else {
        console.warn('[App] Proactive session verification failed on network recovery.');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      if (initialTimer) clearTimeout(initialTimer);
      if (criticalTimer) clearTimeout(criticalTimer);
      if (fullTimer) clearTimeout(fullTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('scroll', updateActivity);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
    };
  }, [isAuthenticated, user?.role, user?.id]);

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  const needsShopSetup = !user?.shop_id;
  const isBoss = user?.role === 'admin' || user?.role === 'boss';

  return (
    <ErrorBoundary>
      <GlobalModal />
      <ToastContainer />
      <LicenseGuard>
        <div className={`flex flex-col h-screen h-[100dvh] bg-gray-50 pt-safe pt-safe-standalone ${settings?.darkMode ? 'dark' : ''}`}>
          <div className="flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))]">
            <Routes>
              {needsShopSetup ? (
                <>
                  <Route path="/setup-shop" element={<SetupShop />} />
                  <Route path="*" element={<Navigate to="/setup-shop" replace />} />
                </>
              ) : (
                <>
                  <Route path="/" element={isBoss ? <Navigate to="/executive" replace /> : <Dashibodi />} />
                  <Route path="/dashibodi" element={<Dashibodi />} />
                  <Route path="/bidhaa" element={<Bidhaa />} />
                  <Route path="/kikapu" element={<Kikapu />} />
                  <Route path="/madeni" element={<Madeni />} />
                  <Route path="/historia" element={<Historia />} />
                  <Route path="/matumizi" element={<Matumizi />} />
                  <Route path="/executive" element={<ExecutiveDashboard />} />
                  <Route path="/audit-logs" element={<AuditLogs />} />
                  <Route path="/zaidi" element={<Zaidi />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </>
              )}
            </Routes>
          </div>
          {!needsShopSetup && syncStatus === 'sleep' && (
            <div id="sync-status-indicator" className="fixed bottom-20 right-4 z-40 transition-all duration-300">
              <div className="flex items-center space-x-1.5 bg-amber-50 border border-amber-200 dark:bg-amber-950/80 dark:border-amber-900/50 px-3 py-1.5 rounded-full shadow-lg text-xs font-bold text-amber-600 dark:text-amber-400 animate-pulse">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span>Sleep</span>
              </div>
            </div>
          )}
          {!needsShopSetup && <NotificationCenter />}
          {!needsShopSetup && <BottomNav />}
        </div>
      </LicenseGuard>
    </ErrorBoundary>
  );
}