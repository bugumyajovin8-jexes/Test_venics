import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { useEffect, useRef, useState } from 'react';
import { SyncService } from './services/sync';
import { restoreWebSession, clearWebSession, purgeLocalAuth } from './utils/webSession';
import { notifications } from './services/notifications';
import { useBlockHistoria } from './hooks/useBlockHistoria';
import DesktopSidebar from './components/DesktopSidebar';
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
import { Loader2 } from 'lucide-react';
import React from 'react';
import { GlobalModal } from './components/GlobalModal';
import ToastContainer from './components/ToastContainer';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const user = useStore(state => state.user);
  const setAuth = useStore(state => state.setAuth);
  const updateUser = useStore(state => state.updateUser);
  const logout = useStore(state => state.logout);
  const settings = useLiveQuery(() => db.settings.get(1));
  const syncStatus = useStore(state => state.syncStatus);
  const isLoggingOut = useStore(state => state.isLoggingOut);
  const location = useLocation();
  // Device-local, boss-set: shuts staff out of Historia on this computer.
  // Read up here so the hook runs unconditionally, above the early returns.
  const historiaBlocked = useBlockHistoria();

  // --- Durable session restore (web/PWA) ---------------------------------------
  // If the browser evicted localStorage (Safari ITP after ~7 days, or storage
  // pressure), the in-memory session is gone but the HttpOnly refresh cookie
  // survives. On startup we exchange it for a fresh session before showing Login,
  // so the user stays logged in like a native app. Start true only when we're not
  // already authenticated, so logged-in users never see the loader.
  const [restoringSession, setRestoringSession] = useState(
    () => !useStore.getState().isAuthenticated
  );

  // Guards against stale Supabase auth events (INITIAL_SESSION / TOKEN_REFRESHED / SIGNED_OUT)
  // firing while we clean up an interrupted logout on boot — see the recovery block below.
  const suppressAuthRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let gateTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    // An EXPLICIT logout (flagged in store.logout) must land on Login — never auto-restore
    // from the cookie. This stops the previous employee's session resurrecting on a shared
    // device if the cookie clear didn't fully complete before the reload.
    let explicitLogout = false;
    try {
      explicitLogout = sessionStorage.getItem('pos_explicit_logout') === '1';
      if (explicitLogout) sessionStorage.removeItem('pos_explicit_logout');
    } catch { /* ignore */ }

    // A logout that was interrupted by a force-close leaves this durable marker in
    // localStorage. Finish the teardown here so the next user starts clean: purge stale local
    // tokens now, then clear the cookie in the background — and NEVER restore the old session.
    // suppressAuthRef silences the stale auth events the SDK replays from the leftover
    // in-memory session so they can't resurrect the previous user.
    let pendingLogout = false;
    try { pendingLogout = localStorage.getItem('pos_pending_logout') === '1'; } catch { /* ignore */ }
    if (pendingLogout) {
      suppressAuthRef.current = true;
      purgeLocalAuth();
      setRestoringSession(false); // reveal Login immediately; don't block on the network
      (async () => {
        try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
        // In-memory session is now cleared — safe to process real auth events (e.g. the next
        // user's login) again. The cookie clear below is network-bound and emits no auth
        // events, so it must NOT keep the guard raised (a cold serverless call could hang).
        suppressAuthRef.current = false;
        let cleared = false;
        try { cleared = await clearWebSession(); } catch { /* ignore */ }
        if (cleared) { try { localStorage.removeItem('pos_pending_logout'); } catch { /* ignore */ } }
      })();
      return;
    }

    if (useStore.getState().isAuthenticated || explicitLogout) {
      setRestoringSession(false);
      return;
    }

    // Cap how long Login stays hidden behind the cookie-restore probe. A cold
    // /api/session/restore can hang; after this budget we reveal Login regardless. The
    // probe keeps running in the background — a real session still flips isAuthenticated.
    gateTimer = setTimeout(() => { if (!cancelled) setRestoringSession(false); }, 2000);

    (async () => {
      try {
        const session = await restoreWebSession();
        if (cancelled) return;
        if (session) {
          // supabase.auth.onAuthStateChange (below) picks this up, fetches the profile and
          // flips isAuthenticated → the second effect clears the gate.
          await supabase.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
          if (cancelled) return;
          // Recovered a session: cancel the short reveal timer and let the isAuthenticated
          // flip drop the gate (no login flash), with a longer safety net.
          if (gateTimer) clearTimeout(gateTimer);
          fallbackTimer = setTimeout(() => { if (!cancelled) setRestoringSession(false); }, 8000);
          return;
        }
      } catch { /* offline / no cookie — fall through to reveal Login */ }
      if (!cancelled) {
        if (gateTimer) clearTimeout(gateTimer);
        setRestoringSession(false);
      }
    })();

    return () => {
      cancelled = true;
      if (gateTimer) clearTimeout(gateTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) setRestoringSession(false);
  }, [isAuthenticated]);

  // Hydrate feature flags from the LOCAL cache immediately on open, so settings like stock
  // tracking (stock_tracking_enabled) are correct from the first render — and, crucially, work
  // OFFLINE for employees who never sync the shops table. Without this the features map stays
  // empty until a successful online sync reaches its tail, so an offline employee would default
  // to "tracked" regardless of the boss's setting.
  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      try {
        // Scope to the active shop. The map is keyed by featureKey alone, so an unscoped read let a
        // previously logged-in shop's row overwrite this shop's flag (last one wins).
        const activeUser = useStore.getState().user;
        const activeShopId = activeUser?.shopId || activeUser?.shop_id;
        if (!activeShopId) return;
        const cached = await db.features.filter(f => f.shop_id === activeShopId).toArray();
        if (cached.length) {
          const map: Record<string, boolean> = {};
          cached.forEach((f) => { map[f.featureKey] = f.isEnabled; });
          useStore.getState().setFeatures(map);
        }
      } catch (e) {
        console.warn('[features] cache hydrate failed', e);
      }
    })();
  }, [isAuthenticated]);

  // Version.json auto-polling update strategy
  const currentVersionRef = useRef<string | null>(null);

  useEffect(() => {
    // 1. Fetch initial version on mount
    const fetchInitialVersion = async () => {
      try {
        const response = await fetch('/version.json?t=' + Date.now());
        if (response.ok) {
          const data = await response.json();
          if (data && data.version) {
            currentVersionRef.current = data.version;
            console.log('[Version Polling] Initial app version:', currentVersionRef.current);
          }
        }
      } catch (e) {
        console.error('[Version Polling] Failed to fetch initial version:', e);
      }
    };
    fetchInitialVersion();
  }, []);

  useEffect(() => {
    let intervalId: any;

    const checkVersion = async () => {
      if (!currentVersionRef.current) return;
      try {
        const response = await fetch('/version.json?t=' + Date.now());
        if (response.ok) {
          const data = await response.json();
          if (data && data.version && data.version !== currentVersionRef.current) {
            console.log(`[Version Polling] New version detected: ${data.version}. Current: ${currentVersionRef.current}`);
            
            // Check if we can safely auto-update/reload
            const currentCart = useStore.getState().cart;
            const currentPath = window.location.pathname;
            const isKikapuSelling = currentPath === '/kikapu' && currentCart.length > 0;
            
            if (!isKikapuSelling) {
              console.log('[Version Polling] New version detected. Triggering SW update...');
              // Ask the SW to re-fetch its script and start the update cycle.
              // With autoUpdate the SW will: download new precache → complete install
              // → skipWaiting → fire controllerchange → registerSW auto-reloads.
              // This guarantees the reload only happens AFTER all new assets are cached,
              // preventing the blank-screen race condition of a direct location.reload().
              let reloaded = false;
              const safeReload = () => { if (!reloaded) { reloaded = true; window.location.reload(); } };

              if ('serviceWorker' in navigator) {
                // Reload as soon as the new SW takes control
                navigator.serviceWorker.addEventListener('controllerchange', safeReload, { once: true });
                navigator.serviceWorker.getRegistration()
                  .then(reg => reg?.update())
                  .catch(() => {});
              }

              // Fallback: if controllerchange never fires (SW already current, or no SW),
              // reload directly after 15 s so the user still gets the update.
              setTimeout(safeReload, 15_000);
            } else {
              console.log('[Version Polling] New version available, deferred — user is actively selling in kikapu.');
            }
          }
        }
      } catch (e) {
        console.error('[Version Polling] Error during checking version:', e);
      }
    };

    // Poll every 5 minutes (300,000 milliseconds)
    intervalId = setInterval(checkVersion, 5 * 60 * 1000);

    // Check version on tab focus/visibility change
    const handleVisibilityChangeForVersion = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChangeForVersion);

    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChangeForVersion);
    };
  }, []);

  // Load tables for reactive in-app notifications checks.
  // These are ALWAYS mounted (root component) and re-run on every DB write, so they
  // must never load the full history — a 2-year shop has hundreds of thousands of
  // sales, and scanning + decrypting all of them on every sale froze the UI and could
  // stall the PWA window on launch. Scope to the shop and cap with .limit(); the
  // notification checks only need recent/aggregate signals, not the whole ledger.
  const productsResult = useLiveQuery(
    () => user?.shop_id ? db.products.where('[shop_id+isDeleted]').equals([user.shop_id, 0]).toArray() : Promise.resolve([]),
    [user?.shop_id]
  );
  const licenseResult = useLiveQuery(() => db.license.get(1));
  const expensesResult = useLiveQuery(
    () => user?.shop_id ? db.expenses.where('[shop_id+isDeleted]').equals([user.shop_id, 0]).limit(5000).toArray() : Promise.resolve([]),
    [user?.shop_id]
  );
  const auditLogsResult = useLiveQuery(
    () => user?.shop_id ? db.auditLogs.where('[shop_id+isDeleted]').equals([user.shop_id, 0]).reverse().limit(200).toArray() : Promise.resolve([]),
    [user?.shop_id]
  );
  const salesResult = useLiveQuery(
    () => user?.shop_id ? db.sales.where('[shop_id+isDeleted]').equals([user.shop_id, 0]).limit(5000).toArray() : Promise.resolve([]),
    [user?.shop_id]
  );
  const usersResult = useLiveQuery(
    () => user?.shop_id ? db.users.where('shop_id').equals(user.shop_id).toArray() : Promise.resolve([]),
    [user?.shop_id]
  );
  const debtPaymentsResult = useLiveQuery(
    () => user?.shop_id ? db.debtPayments.where('shop_id').equals(user.shop_id).filter(p => p.isDeleted === 0).limit(5000).toArray() : Promise.resolve([]),
    [user?.shop_id]
  );

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
          title: '🚨 Leseni ya Programu Inaisha!',
          message: daysLeft > 0
            ? `Leseni ya duka lako inaisha hivi karibuni baada ya siku ${daysLeft}. Lipia haraka kuepuka kufungwa.`
            : `Muda wa leseni ya duka hili umekwisha kabisa leo! Tafadhali fanya malipo kufungua huduma.`,
          type: 'critical',
          page: 'license',
          chatPrompt: 'Mwelekeo wa leseni na malipo ya duka langu?',
          isRead: false,
          timestamp: Date.now(),
        };
      }
    }

    // 2. Check Audit log anomaly (Security - 2nd Priority)
    if (!targetNotification && auditLogsResult && auditLogsResult.length > 0) {
      const bossIds = usersResult?.filter(u => u.role === 'boss' || u.role === 'admin' || u.role === 'superadmin').map(u => u.id) || [];
      // Sort by created_at descending to get the most recent anomaly
      const recentAnomalies = auditLogsResult
        .filter(log => log.action?.startsWith('anomaly_') || log.action?.includes('delete') || log.action?.includes('update'))
        .filter(log => !bossIds.includes(log.user_id))
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (recentAnomalies.length > 0) {
        const anomaly = recentAnomalies[0];
        targetNotification = {
          // Stable ID — same anomaly record always produces the same ID
          id: `anomaly_${anomaly.id}`,
          title: '🚨 Tendo la Shaka/Ufutaji wa Data!',
          message: `Mfanyakazi ${anomaly.details?.employee_name || 'mmoja'} amefanya tendo la shaka au kufuta rekodi: "${anomaly.details?.warning || anomaly.details?.details || anomaly.action}".`,
          type: 'warning',
          page: 'security',
          chatPrompt: `Nimeona tendo la shaka mnamo ${anomaly.created_at}. Niambie undani wa tabia za wafanyikazi wetu?`,
          isRead: false,
          timestamp: new Date(anomaly.created_at).getTime(),
        };
      }
    }

    // 3. Check Expenses Ratio/Spikes (3rd Priority)
    if (!targetNotification && expensesResult && expensesResult.length > 0 && salesResult && salesResult.length > 0) {
      const totalExp = expensesResult.reduce((sum, e) => sum + e.amount, 0);
      const totalSal = salesResult.reduce((sum, s) => sum + s.total_amount, 0);
      const ratio = totalSal > 0 ? (totalExp / totalSal) : 0;

      if (ratio > 0.45) {
        targetNotification = {
          id: 'expenses_limit_warning',
          title: '💸 Matumizi ya Juu Sana!',
          message: `Matumizi ya duka letu yamefikia ${(ratio * 100).toFixed(1)}% ya jumla ya mauzo yote. Hii ni asilimia hatari, tafadhali bana gharama.`,
          type: 'warning',
          page: 'expenses',
          chatPrompt: 'Matumizi yetu yamezidi kiwango, tufanye nini kubana matumizi?',
          isRead: false,
          timestamp: Date.now(),
        };
      }
    }

    // 4. Check Debts Spike (4th Priority)
    if (!targetNotification) {
      const creditSales = salesResult?.filter(s => s.payment_method === 'credit' && s.status !== 'completed') || [];
      const debtorAmount = creditSales.reduce((sum, s) => {
        const paid = (debtPaymentsResult || [])
          .filter(p => p.sale_id === s.id)
          .reduce((acc, p) => acc + p.amount, 0);
        return sum + Math.max(0, s.total_amount - paid);
      }, 0);
      if (debtorAmount > 500000) {
        targetNotification = {
          id: 'outstanding_debts_warning',
          title: '⚠️ Kiwango Kikuu Cha Mikopo Nje!',
          message: `Kuna jumla ya madeni ya kiasi cha Tsh ${debtorAmount.toLocaleString()} ambayo bado hayajalipwa na wateja wa mikopo.`,
          type: 'info',
          page: 'sales',
          chatPrompt: 'Tuna wateja gani wanaotudai mikopo na nifanye nini kupunguza madeni haya?',
          isRead: false,
          timestamp: Date.now(),
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
          timestamp: Date.now(),
        };
      }
    }

    if (targetNotification) {
      addNotificationList(targetNotification);
    }

  // addNotificationList is a stable Zustand action — safe to include in the dep array.
  // All other deps are primitives so the effect only re-runs when actual data changes.
  }, [productsResult?.length, licenseResult?.expiryDate, expensesResult?.length, auditLogsResult?.length, salesResult?.length, usersResult?.length, debtPaymentsResult?.length, isAuthenticated, user?.shop_id, addNotificationList]);

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
      // While recovering an interrupted logout, ignore the stale events the SDK replays from
      // the leftover in-memory session — otherwise they could resurrect the previous user.
      if (suppressAuthRef.current) return;
      if (event === 'SIGNED_OUT') {
        const storedToken = localStorage.getItem('pos_token');
        if (!storedToken) {
          logout();
        } else {
          // Only ignore if the access token itself is still unexpired.
          // A spurious SIGNED_OUT fires when a background refresh rotation fails
          // (the old token is rejected by Supabase). In that case the local access
          // token is still valid for up to 1 hour — do NOT sign the user out.
          // If the token IS expired, the session is truly dead → sign out.
          try {
            const b64 = storedToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(b64));
            if (!payload.exp || payload.exp * 1000 <= Date.now()) {
              logout();
            } else {
              console.warn('[Auth] Ignoring spurious SIGNED_OUT — local access token still valid until', new Date(payload.exp * 1000).toLocaleTimeString());
            }
          } catch {
            logout();
          }
        }
      } else if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        // A real session is established — any prior interrupted-logout marker is now moot.
        try { localStorage.removeItem('pos_pending_logout'); } catch { /* ignore */ }
        const currentUser = useStore.getState().user;
        // On a cookie-based restore, localStorage was evicted so currentUser is null
        // and setSession may emit TOKEN_REFRESHED rather than SIGNED_IN — fetch the
        // profile in both cases so the user is re-authenticated either way.
        if (!currentUser && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
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
    const isBoss = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss';
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
    const interval = setInterval(checkStatus, 600000); // 10 min — saves ~320 API calls/day vs 3 min
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

    // Broadcasts are announcements from the Venics team — minutes-fresh is
    // plenty. This ran on every app resume with no limit, and a phone comes
    // back to the foreground dozens of times a day (a WhatsApp reply, a
    // shared receipt, the camera for a scan), each one a request.
    let lastBroadcastCheck = 0;
    const checkBroadcasts = async () => {
      if (Date.now() - lastBroadcastCheck < 5 * 60 * 1000) return;
      lastBroadcastCheck = Date.now();
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
          
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
              await supabase.auth.refreshSession();
            }
          } catch (e) {
            console.warn('Proactive session refresh failed:', e);
          }
          
          // Force critical sync first to get transactions, then full sync on iOS wake
          void SyncService.sync(false, 'critical').then(() => {
            void SyncService.sync(false, 'full');
          });
          void checkBroadcasts();
        }
      }
    };

    const handleOnline = () => {
      lastActiveTime = Date.now();
      isAppInactive = false;
      useStore.getState().setSyncStatus('active');
      void SyncService.sync(false, 'critical').then(() => {
        void SyncService.sync(false, 'full');
      });
      void checkBroadcasts();
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

  if (isLoggingOut) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-900 text-center text-white">
        <div className="flex flex-col items-center max-w-md">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full w-20 h-20 -left-6 -top-6 animate-pulse"></div>
            <Loader2 className="w-12 h-12 text-blue-400 animate-spin relative" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Unatoka Kwenye Mfumo</h1>
          <p className="text-slate-300 text-sm leading-relaxed">
            Tafadhali subiri wakati tunasawazisha na kuhifadhi data zako zote kwa usalama kabla ya kutoka.
          </p>
          <div className="mt-6 flex items-center gap-2 bg-slate-800/60 border border-slate-700/50 px-4 py-2 rounded-full text-xs text-slate-400 font-medium">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></div>
            Usawazishaji wa mwisho unaendelea...
          </div>
        </div>
      </div>
    );
  }

  if (restoringSession && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

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
  const isBoss = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss';
  const isKikapu = location.pathname === '/kikapu';

  return (
    <ErrorBoundary>
      <GlobalModal />
      <ToastContainer />
      <LicenseGuard>
        <div className={`flex md:flex-row flex-col h-screen h-[100dvh] bg-gray-50 pt-[env(safe-area-inset-top)] ${settings?.darkMode ? 'dark' : ''} overflow-hidden`}>
          
          {/* Desktop Navigation Sidebar */}
          {!needsShopSetup && !isKikapu && (
            <div className="md:block hidden shrink-0">
              <DesktopSidebar />
            </div>
          )}

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
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
                    {/* Guarded at the ROUTE, not only in the navigation. The
                        sidebar and dashboard links are hidden when this is on,
                        but Mshauri also navigates here from its report
                        shortcuts and the address bar is always available — a
                        hidden button blocks nobody. */}
                    <Route
                      path="/historia"
                      element={historiaBlocked ? <Navigate to="/dashibodi" replace /> : <Historia />}
                    />
                    <Route path="/matumizi" element={<Matumizi />} />
                    <Route path="/executive" element={<ExecutiveDashboard />} />
                    <Route path="/audit-logs" element={<AuditLogs />} />
                    <Route path="/zaidi" element={<Zaidi />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </>
                )}
              </Routes>
            </div>

            {/* Mobile Bottom Navigation */}
            {!needsShopSetup && (
              <div className="md:hidden block shrink-0">
                <BottomNav />
              </div>
            )}
          </div>

          {!needsShopSetup && syncStatus === 'sleep' && (
            <div id="sync-status-indicator" className="fixed bottom-20 md:bottom-6 right-4 z-40 transition-all duration-300">
              <div className="flex items-center space-x-1.5 bg-amber-50 border border-amber-200 dark:bg-amber-950/80 dark:border-amber-900/50 px-3 py-1.5 rounded-full shadow-lg text-xs font-bold text-amber-600 dark:text-amber-400 animate-pulse">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span>Sleep</span>
              </div>
            </div>
          )}
          {!needsShopSetup && <NotificationCenter />}
        </div>
      </LicenseGuard>
    </ErrorBoundary>
  );
}
