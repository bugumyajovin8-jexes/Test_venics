import { create } from 'zustand';
import { Product, User } from './db';

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
  syncHealth: 'healthy' | 'error';
  setSyncStatus: (status: 'active' | 'sleep') => void;
  setSyncHealth: (health: 'healthy' | 'error') => void;

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
    isHidden?: boolean;
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
    isHidden?: boolean;
    timestamp: number;
  }) => void;
  dismissNotification: (id: string) => void;
  clearNotificationList: () => void;
}

export const useStore = create<PosState>((set, get) => ({
  cart: [],
  cartDeletionCount: 0,
  addToCart: (product) => set((state) => {
    const existing = state.cart.find(item => item.id === product.id);
    if (existing) {
      if (existing.qty >= product.stock) {
        return state;
      }
      return {
        cart: state.cart.map(item => 
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        )
      };
    }
    if (product.stock <= 0) return state;
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
    if (item && qty > item.stock) {
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
  authError: null,
  features: {},
  setAuth: (token, user, refreshToken) => {
    if (token && user) {
      localStorage.setItem('pos_token', token);
      if (refreshToken) localStorage.setItem('pos_refresh_token', refreshToken);
      localStorage.setItem('pos_user', JSON.stringify(user));
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
  logout: (error) => {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_refresh_token');
    localStorage.removeItem('pos_user');
    sessionStorage.removeItem('app_opened_logged');
    set({ isAuthenticated: false, token: null, user: null, cart: [], authError: error || null });
  },
  setAuthError: (error) => set({ authError: error }),
  setFeatures: (features) => set({ features }),
  isFeatureEnabled: (key) => {
    const value = get().features[key];
    return value === true;
  },
  isBoss: () => {
    const user = get().user;
    return user?.role === 'boss';
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
  syncHealth: 'healthy',
  setSyncStatus: (status) => set({ syncStatus: status }),
  setSyncHealth: (health) => set({ syncHealth: health }),

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
    // Avoid duplicates of same notification id, but update content if it changed
    const existingIndex = state.notificationsList.findIndex(n => n.id === notification.id);
    let updated;
    
    if (existingIndex >= 0) {
      const existing = state.notificationsList[existingIndex];
      // Only update if something meaningful changed
      if (existing.message === notification.message && existing.title === notification.title) {
        return state;
      }
      updated = [...state.notificationsList];
      // Keep isRead status so it doesn't keep popping as unread during continuous syncs unless we want to,
      // but if the amount increased, we probably still want to show the latest text.
      // We set isRead back to false since it's a new alert text basically, but to avoid flash during initial sync
      // we only change the text and preserve isRead if the user already saw it. Let's just reset isRead to false 
      // so they know it changed, BUT during rapid sync it changes fast, so they haven't read it anyway.
      updated[existingIndex] = { ...notification, isRead: existing.isRead, isHidden: existing.isHidden };
    } else {
      updated = [notification, ...state.notificationsList];
    }
    
    localStorage.setItem('pos_inapp_notifications', JSON.stringify(updated));
    return { notificationsList: updated };
  }),
  dismissNotification: (id) => set((state) => {
    const updated = state.notificationsList.map(n => 
      n.id === id ? { ...n, isRead: true, isHidden: true } : n
    );
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
