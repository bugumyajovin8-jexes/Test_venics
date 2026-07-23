import { useNavigate, useLocation } from 'react-router-dom';
import { useRef, useCallback } from 'react';
import { LayoutDashboard, Package, ShoppingCart, CreditCard, Menu, Zap } from 'lucide-react';
import { useStore } from '../store';
import VenicsLogo from './VenicsLogo';

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastNav = useRef(0);

  const user = useStore(state => state.user);
  const cart = useStore(state => state.cart);
  const cartCount = cart.reduce((acc, item) => acc + item.qty, 0);

  const isBoss = user?.role === 'boss';

  const navItems = [
    ...(isBoss ? [{ to: '/executive', icon: Zap, label: 'V Smart' }] : []),
    { to: isBoss ? '/dashibodi' : '/', icon: LayoutDashboard, label: 'Dashibodi' },
    { to: '/bidhaa', icon: Package, label: 'Bidhaa' },
    { to: '/kikapu', icon: ShoppingCart, label: 'Mauzo', badge: cartCount },
    { to: '/madeni', icon: CreditCard, label: 'Madeni' },
    { to: '/zaidi', icon: Menu, label: 'Zaidi' },
  ];

  /* iOS Safari sometimes fails to synthesize click events after touchend,
     causing buttons to need a double-tap. Using pointerup bypasses WebKit's
     click-synthesis pipeline entirely — it fires directly from the native
     touch without going through the synthesized-click path that can fail.
     The 300ms debounce prevents the subsequent (sometimes synthesized) click
     event from triggering a second navigation. */
  const safeNavigate = useCallback((to: string) => {
    const now = Date.now();
    if (now - lastNav.current > 300) {
      lastNav.current = now;
      navigate(to);
    }
  }, [navigate]);

  return (
    <div
      className="fixed bottom-0 w-full bg-white border-t border-gray-200 flex justify-around items-center h-[calc(4rem+env(safe-area-inset-bottom))] px-2 pb-[env(safe-area-inset-bottom)] z-50"
      style={{ touchAction: 'manipulation' }}
    >
      {navItems.map((item) => {
        const isActive = location.pathname === item.to;

        return (
          <button
            key={item.to}
            onPointerUp={() => safeNavigate(item.to)}
            onClick={() => safeNavigate(item.to)}
            className={`flex flex-col items-center justify-center w-full h-full space-y-1
              cursor-pointer touch-manipulation select-none
              ${isActive ? 'text-blue-600' : 'text-gray-500'}`}
            style={{
              WebkitTapHighlightColor: 'transparent',
              WebkitTouchCallout: 'none',
              touchAction: 'manipulation',
            }}
          >
            <div className="relative w-6 h-6 flex items-center justify-center">
              {item.to === '/executive' ? (
                <VenicsLogo size={24} animate="none" />
              ) : (
                <item.icon className="w-6 h-6 shrink-0" />
              )}
              {item.badge ? (
                <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {item.badge}
                </span>
              ) : null}
            </div>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
