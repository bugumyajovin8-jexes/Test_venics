import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  CreditCard, 
  Clock, 
  DollarSign, 
  ShieldCheck, 
  Menu, 
  LogOut, 
  RefreshCw, 
  Zap, 
  User, 
  Store,
  Wifi,
  WifiOff,
  Moon,
  Activity
} from 'lucide-react';
import { useStore } from '../store';
import { useState, useEffect } from 'react';
import { SyncService } from '../services/sync';
import { useBlockHistoria } from '../hooks/useBlockHistoria';

export default function DesktopSidebar() {
  const { user, logout, isBoss, isFeatureEnabled, cart, showAlert, syncStatus, setIsLoggingOut } = useStore();
  const isAppInactive = syncStatus === 'sleep';
  const navigate = useNavigate();
  const location = useLocation();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const cartCount = cart.reduce((acc, item) => acc + item.qty, 0);
  const boss = isBoss();
  const historiaBlocked = useBlockHistoria();

  const handleManualSync = async () => {
    if (!navigator.onLine) {
      showAlert('Kosa', 'Tafadhali unganisha mtandao kwanza!');
      return;
    }
    setIsSyncing(true);
    try {
      await SyncService.sync(true);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await SyncService.logAction('logout', { platform: 'web' });
      await SyncService.flushAuditLogs();
      await SyncService.sync(true, 'full');
    } catch (e) {
      console.error('Failed to log logout', e);
    }
    logout();
  };

  const menuItems = [
    {
      category: 'Kuu',
      items: [
        ...(boss ? [{ to: '/executive', icon: Zap, label: 'Venics Smart', badge: 'V Smart' }] : []),
        { to: boss ? '/dashibodi' : '/dashibodi', icon: LayoutDashboard, label: 'Dashibodi' },
        { to: '/bidhaa', icon: Package, label: 'Bidhaa' },
        { to: '/kikapu', icon: ShoppingCart, label: 'Mauzo', count: cartCount },
        { to: '/madeni', icon: CreditCard, label: 'Madeni' },
      ]
    },
    {
      category: 'Ripoti na Matumizi',
      items: [
        ...(historiaBlocked ? [] : [{ to: '/historia', icon: Clock, label: 'Historia ya Mauzo' }]),
        ...((boss || isFeatureEnabled('staff_expense_management')) ? [
          { to: '/matumizi', icon: DollarSign, label: 'Matumizi' }
        ] : []),
        ...(boss ? [{ to: '/audit-logs', icon: ShieldCheck, label: 'Logi za Ukaguzi' }] : []),
      ]
    },
    {
      category: 'Mipangilio',
      items: [
        { to: '/zaidi', icon: Menu, label: 'Usimamizi na Zaidi' },
      ]
    }
  ];

  return (
    <div className="w-64 h-screen bg-[#0A0F2C] border-r border-white/5 flex flex-col justify-between shrink-0 font-sans sticky top-0 select-none text-slate-100">
      {/* Brand Header */}
      <div className="p-4 border-b border-white/10 flex flex-col space-y-1">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 bg-[#00D1FF] rounded-xl shadow-md shadow-[#00D1FF]/20 flex items-center justify-center shrink-0 w-9 h-9">
            <img src="/logo.png" alt="Venics Logo" className="w-6 h-6 object-contain" referrerPolicy="no-referrer" />
          </div>
          <div>
            <h1 className="font-extrabold text-white text-lg leading-tight tracking-tight">Venics Sales</h1>
            <p className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase">Desktop Workspace</p>
          </div>
        </div>
        
        {/* Connection Status & Sync status */}
        <div className="flex flex-col space-y-2 pt-3 border-t border-white/5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-1.5 font-medium text-slate-400">
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-[11px] text-emerald-400">Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-400 animate-pulse shrink-0" />
                  <span className="text-[11px] text-rose-400">Offline</span>
                </>
              )}
            </div>

            {/* Active/Sleep indicator */}
            <div className="flex items-center">
              {isAppInactive ? (
                <div className="flex items-center space-x-1.5 text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full text-[10px] font-bold select-none border border-sky-500/20">
                  <Moon className="w-2.5 h-2.5 text-sky-400 animate-pulse shrink-0" />
                  <span>Sleep</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[10px] font-bold select-none border border-emerald-500/20">
                  <Activity className="w-2.5 h-2.5 text-emerald-400 animate-pulse shrink-0" />
                  <span>Active</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-slate-500 font-medium tracking-wide">Sell more</span>
            <button 
              type="button"
              onClick={handleManualSync}
              disabled={isSyncing || !isOnline}
              className={`flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                isSyncing 
                  ? 'bg-white/5 text-slate-500 cursor-not-allowed' 
                  : 'text-[#00D1FF] hover:bg-white/5 active:scale-95'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Inasawazisha' : 'Sawazisha'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-hide">
        {menuItems.map((group, idx) => (
          <div key={idx} className="space-y-1.5">
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400/50 mb-2">{group.category}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActiveItem = location.pathname === item.to;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group ${
                        isActive 
                          ? 'bg-[#00D1FF] text-[#0A0F2C] shadow-md shadow-[#00D1FF]/20' 
                          : 'text-slate-300 hover:bg-white/5 hover:text-[#00D1FF]'
                      }`
                    }
                  >
                    <div className="flex items-center space-x-3">
                      <item.icon className="w-4.5 h-4.5 group-hover:scale-105 transition-transform" />
                      <span>{item.label}</span>
                    </div>
                    {item.count !== undefined && item.count > 0 && (
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shadow-sm ${
                        isActiveItem
                          ? 'bg-[#0A0F2C] text-white'
                          : 'bg-rose-500 text-white'
                      }`}>
                        {item.count}
                      </span>
                    )}
                    {item.badge && (
                      <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded tracking-wide uppercase border ${
                        isActiveItem
                          ? 'bg-[#0A0F2C]/10 text-[#0A0F2C] border-[#0A0F2C]/20'
                          : 'bg-[#00D1FF]/10 text-[#00D1FF] border-[#00D1FF]/20'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Profile Section */}
      <div className="p-4 border-t border-white/10 bg-black/20">
        <div className="flex items-center space-x-3 mb-3">
          <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-full flex items-center justify-center text-slate-300 shrink-0">
            <User className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-white truncate">{user?.name}</h4>
            <p className="text-[10px] text-slate-400 truncate uppercase mt-0.5 font-bold tracking-wider">{user?.role || 'User'}</p>
          </div>
        </div>
        <button 
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center space-x-2 py-2.5 text-sm font-bold text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 rounded-xl border border-rose-500/20 transition-all bg-transparent active:scale-95 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Ondoka (Logout)</span>
        </button>
      </div>
    </div>
  );
}
