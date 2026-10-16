import { create } from 'zustand';
import { Product, User, clearAllLocalData, db } from './db';
import { supabase } from './supabase';
import { saveWebSession, clearWebSession, purgeLocalAuth } from './utils/webSession';

interface CartItem extends Product {
  qty: number;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'alert' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface PosState {
  cart: CartItem[];
  cartDeletionCount: number;
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  updateCartItemPrice: (productId: string, price: number) => void;
  clearCart: () => void;
  resetCartDeletionCount: () => void;
  cartTotal: () => number;
  cartProfit: () => number;
  
  // Auth
  isAuthenticated: boolean;
  token: string | null;
  user: User | null;
  authError: string | null;
  features: Record<string, boolean>;
  setAuth: (token: string | null, user: User | null, refreshToken?: string | null) => void;
  updateUser: (userUpdates: Partial<User>) => void;
  logout: (error?: string) => void;
  setAuthError: (error: string | null) => void;
  setFeatures: (features: Record<string, boolean>) => void;
  isFeatureEnabled: (key: string) => boolean;
  isBoss: () => boolean;
  
  // Modal
  modal: ModalConfig;
  showAlert: (title: string, message: string) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => void;
  hideModal: () => void;

  // Toast
  toasts: { id: string; message: string; type: 'success' | 'error' | 'info' }[];
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;

  // Sync Status Indicator
  syncStatus: 'active' | 'sleep';
  setSyncStatus: (status: 'active' | 'sleep') => void;
  syncHealth: 'healthy' | 'error';
  setSyncHealth: (health: 'healthy' | 'error') => void;

  // Logout transition
  isLoggingOut: boolean;
  setIsLoggingOut: (isLoggingOut: boolean) => void;

  // Chatbot State control
  isMshauriOpen: boolean;
  mshauriTriggerQuery: string | null;
  setMshauriOpen: (open: boolean, query?: string | null) => void;

  // In-app Notifications
  notificationsList: {
    id: string;
    title: string;
    message: string;
    type: 'warning' | 'info' | 'critical' | 'milestone';
    page: 'stock' | 'sales' | 'expenses' | 'security' | 'license';
    chatPrompt: string;
    isRead: boolean;
    timestamp: number;
  }[];
  addNotificationList: (notification: {
    id: string;
    title: string;
    message: string;
    type: 'warning' | 'info' | 'critical' | 'milestone';
    page: 'stock' | 'sales' | 'expenses' | 'security' | 'license';
    chatPrompt: string;
    isRead: boolean;
    timestamp: number;
  }) => void;
  markNotificationRead: (id: string) => void;
  clearNotificationList: () => void;
}

export const useStore = create<PosState>((set, get) => ({
  cart: [],
  cartDeletionCount: 0,
  addToCart: (product) => set((state) => {
    const isStockTracked = product.track_stock !== false;
    const existing = state.cart.find(item => item.id === product.id);
    if (existing) {
      if (isStockTracked && existing.qty >= product.stock) {
        return state;
      }
      return {
        cart: state.cart.map(item => 
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        )
      };
    }
    if (isStockTracked && product.stock <= 0) return state;
    return { cart: [...state.cart, { ...product, qty: 1 }] };
  }),
  removeFromCart: (productId) => set((state) => {
    // Increment cart Deletion Count
    const newCount = state.cartDeletionCount + 1;
    return {
      cart: state.cart.filter(item => item.id !== productId),
      cartDeletionCount: newCount
    };
  }),
  updateQty: (productId, qty) => set((state) => {
    const item = state.cart.find(i => i.id === productId);
    const isStockTracked = item?.track_stock !== false;
    if (item && isStockTracked && qty > item.stock) {
      return state;
    }
    return {
      cart: state.cart.map(item => 
        item.id === productId ? { ...item, qty } : item
      )
    };
  }),
  updateCartItemPrice: (productId, price) => set((state) => ({
    cart: state.cart.map(item => 
      item.id === productId ? { ...item, sell_price: price } : item
    )
  })),
  clearCart: () => set({ cart: [], cartDeletionCount: 0 }),
  resetCartDeletionCount: () => set({ cartDeletionCount: 0 }),
  cartTotal: () => get().cart.reduce((total, item) => total + (item.sell_price * item.qty), 0),
  cartProfit: () => get().cart.reduce((total, item) => total + ((item.sell_price - item.buy_price) * item.qty), 0),
  
  isAuthenticated: false,
  token: localStorage.getItem('pos_token') || null,
  user: JSON.parse(localStorage.getItem('pos_user') || 'null'),
  authError: (() => {
    const cachedError = localStorage.getItem('pos_auth_error');
    if (cachedError) {
      localStorage.removeItem('pos_auth_error');
      return cachedError;
    }
    return null;
  })(),
  features: {},
  setAuth: (token, user, refreshToken) => {
    if (token && user) {
      const prevShopId = localStorage.getItem('pos_last_shop_id');
      const prevUserId = localStorage.getItem('pos_last_user_id');
      const prevUserRole = localStorage.getItem('pos_last_user_role');
      
      const currentShopId = user.shopId || user.shop_id || '';
      const currentUserId = user.id || '';
      const currentUserRole = user.role || '';
      const currentUserIsBoss = currentUserRole === 'admin' || currentUserRole === 'superadmin' || currentUserRole === 'boss';
      const prevUserIsBoss = prevUserRole === 'admin' || prevUserRole === 'superadmin' || prevUserRole === 'boss';

      localStorage.setItem('pos_token', token);
      if (refreshToken) localStorage.setItem('pos_refresh_token', refreshToken);
      localStorage.setItem('pos_user', JSON.stringify(user));

      // Mirror the refresh token into an HttpOnly cookie so an installed PWA
      // (esp. macOS/iOS Safari) can restore the session after the browser evicts
      // localStorage. No-op on the native build.
      if (refreshToken) void saveWebSession(refreshToken);

      localStorage.setItem('pos_last_shop_id', currentShopId);
      localStorage.setItem('pos_last_user_id', currentUserId);
      localStorage.setItem('pos_last_user_role', currentUserRole);

      // 1. Physical Shop Changed Security Check
      if (prevShopId && prevShopId !== currentShopId) {
        console.log(`[Store] Shop changed from ${prevShopId} to ${currentShopId}. Performing force full IndexedDB wipe...`);
        clearAllLocalData({ forceAll: true }).catch(err => {
          console.error('[Store] Fail to perform full clear on shop change:', err);
        });
        
        // Reset all sync cursors in settings
        db.settings.get(1).then(settings => {
          if (settings) {
            const patch: Record<string, any> = {};
            Object.keys(settings).forEach(key => {
              if (key.startsWith('syncCursor_')) {
                patch[key] = null;
              }
            });
            db.settings.update(1, patch);
          }
        });
      }
      // 2. Same Shop but User/Cashier Handover Check
      else if (prevUserId && prevUserId !== currentUserId) {
        console.log(`[Store] Multi-user shift handover detected inside same shop. Clearing shift transactions while preserving products cache...`);
        clearAllLocalData().catch(err => {
          console.error('[Store] Fail to perform selective transaction clear on user switch:', err);
        });

        // 3. Boss privilege sync recovery check
        if (currentUserIsBoss && !prevUserIsBoss) {
          console.log(`[Store] Boss logged in after employee. Resetting transactional cursors to sync complete historical ledger...`);
          db.settings.get(1).then(settings => {
            if (settings) {
              const patch: Record<string, any> = {};
              const transactionalTables = ['sales', 'sale_items', 'expenses', 'debt_payments', 'audit_logs'];
              transactionalTables.forEach(tableName => {
                patch[`syncCursor_${tableName}`] = null;
              });
              db.settings.update(1, patch);
            }
          });
        }
      }

      set({ isAuthenticated: true, token, user, authError: null });
    } else {
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_refresh_token');
      localStorage.removeItem('pos_user');
      set({ isAuthenticated: false, token: null, user: null });
    }
  },
  updateUser: (userUpdates) => set((state) => {
    if (!state.user) return state;
    const updatedUser = { ...state.user, ...userUpdates };
    localStorage.setItem('pos_user', JSON.stringify(updatedUser));
    return { user: updatedUser };
  }),
  logout: async (error) => {
    set({ isLoggingOut: true });

    // Mark this as an EXPLICIT logout. The durable-session restore on the next load reads
    // this flag and skips the cookie exchange, so an explicit logout ALWAYS lands on Login
    // and can never silently resurrect this (or the previous) user's session — critical on
    // shared devices where employees switch accounts all day.
    try { sessionStorage.setItem('pos_explicit_logout', '1'); } catch { /* ignore */ }
    // Durable (survives a force-close) marker that a logout is in progress. If the app is
    // killed before teardown finishes, the next boot sees this and completes the cleanup,
    // so a half-done logout can't resurrect this user or wedge the next login.
    try { localStorage.setItem('pos_pending_logout', '1'); } catch { /* ignore */ }

    purgeLocalAuth();
    sessionStorage.removeItem('app_opened_logged');

    if (error) {
      localStorage.setItem('pos_auth_error', error);
    }

    // Bound every teardown step. clearWebSession() and supabase.signOut() are network calls
    // (cold serverless / flaky shop wifi) and clearAllLocalData() touches IndexedDB (can be
    // locked by another window). Without a cap, any one can hang and the app freezes on the
    // "Unatoka Kwenye Mfumo" screen because the reload below never runs.
    const withTimeout = (p: Promise<any>, ms: number) =>
      Promise.race([Promise.resolve(p).catch(() => {}), new Promise(res => setTimeout(res, ms))]);

    // Clear the durable HttpOnly cookie so a PWA can't restore the session post-logout.
    const cookieCleared = await withTimeout(clearWebSession(), 3000);

    // Clear the previous shift's transaction tables (products/shops/users/features are
    // shop-shared and kept, to avoid a slow full re-sync on every shift change).
    await withTimeout(clearAllLocalData(), 3000);

    // Sign out from Supabase to prevent stale sessions across multiple users.
    await withTimeout(supabase.auth.signOut(), 3000);

    // Teardown finished cleanly — drop the durable marker. If the cookie clear did NOT
    // confirm (timeout/offline), keep it so the next boot retries and still lands on Login.
    if (cookieCleared === true) { try { localStorage.removeItem('pos_pending_logout'); } catch { /* ignore */ } }

    // Soft update state just in case, then trigger a hard reload.
    set({ isAuthenticated: false, token: null, user: null, cart: [], isLoggingOut: false });

    // Clean, hard page reload to close all IndexedDB connections, drop memory leaks,
    // cancel subscriptions, and render a fresh, responsive Login screen.
    window.location.reload();
  },
  setAuthError: (error) => set({ authError: error }),
  setFeatures: (features) => set({ features }),
  isFeatureEnabled: (key) => {
    const value = get().features[key];
    return value === true;
  },
  isBoss: () => {
    const user = get().user;
    return user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss';
  },
  
  modal: {
    isOpen: false,
    type: 'alert',
    title: '',
    message: ''
  },
  showAlert: (title, message) => set({
    modal: { isOpen: true, type: 'alert', title, message }
  }),
  showConfirm: (title, message, onConfirm, onCancel) => set({
    modal: { isOpen: true, type: 'confirm', title, message, onConfirm, onCancel }
  }),
  hideModal: () => set((state) => ({
    modal: { ...state.modal, isOpen: false }
  })),

  toasts: [],
  showToast: (message, type = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }]
    }));
    setTimeout(() => {
      get().removeToast(id);
    }, 3000);
  },
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id)
  })),
  syncStatus: 'active',
  setSyncStatus: (status) => set({ syncStatus: status }),
  syncHealth: 'healthy',
  setSyncHealth: (health) => set({ syncHealth: health }),

  // Logout transition
  isLoggingOut: false,
  setIsLoggingOut: (isLoggingOut) => set({ isLoggingOut }),

  // Chatbot State implementation
  isMshauriOpen: false,
  mshauriTriggerQuery: null,
  setMshauriOpen: (open, query = null) => set({ isMshauriOpen: open, mshauriTriggerQuery: query }),

  // In-app Notifications implementation
  notificationsList: (() => {
    try {
      return JSON.parse(localStorage.getItem('pos_inapp_notifications') || '[]');
    } catch {
      return [];
    }
  })(),
  addNotificationList: (notification) => set((state) => {
    // Avoid duplicates of same notification id
    if (state.notificationsList.some(n => n.id === notification.id)) {
      return state;
    }
    const updated = [notification, ...state.notificationsList];
    localStorage.setItem('pos_inapp_notifications', JSON.stringify(updated));
    return { notificationsList: updated };
  }),
  markNotificationRead: (id) => set((state) => {
    const updated = state.notificationsList.map(n => n.id === id ? { ...n, isRead: true } : n);
    localStorage.setItem('pos_inapp_notifications', JSON.stringify(updated));
    return { notificationsList: updated };
  }),
  clearNotificationList: () => set(() => {
    localStorage.setItem('pos_inapp_notifications', '[]');
    return { notificationsList: [] };
  })
}));

// Initialize auth state if token exists
const initialToken = localStorage.getItem('pos_token');
if (initialToken) {
  useStore.setState({ isAuthenticated: true });
}
