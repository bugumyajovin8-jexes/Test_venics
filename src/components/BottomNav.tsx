import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, ShoppingCart, CreditCard, Menu, Zap } from 'lucide-react';
import { useStore } from '../store';

export default function BottomNav() {
  const user = useStore(state => state.user);
  const cart = useStore(state => state.cart);
  const cartCount = cart.reduce((acc, item) => acc + item.qty, 0);

  const isBoss = user?.role === 'admin' || user?.role === 'boss' || user?.role === 'superadmin';

  const navItems = [
    ...(isBoss ? [{ to: '/executive', icon: Zap, label: 'Mshauri' }] : []),
    { to: isBoss ? '/dashibodi' : '/', icon: LayoutDashboard, label: 'Dashibodi' },
    { to: '/bidhaa', icon: Package, label: 'Bidhaa' },
    { to: '/kikapu', icon: ShoppingCart, label: 'Mauzo', badge: cartCount },
    { to: '/madeni', icon: CreditCard, label: 'Madeni' },
    { to: '/zaidi', icon: Menu, label: 'Zaidi' },
  ];

  return (
    <div className="fixed bottom-0 w-full bg-white border-t border-gray-200 flex md:hidden justify-around items-center h-[calc(4rem+env(safe-area-inset-bottom))] px-2 pb-[env(safe-area-inset-bottom)] z-50">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center w-full h-full space-y-1 ${
              isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
            }`
          }
        >
          <div className="relative">
            <item.icon className="w-6 h-6" />
            {item.badge ? (
              <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {item.badge}
              </span>
            ) : null}
          </div>
          <span className="text-[10px] font-medium">{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}
