import { useEffect, useState } from 'react';
import { LicenseService, LicenseStatus } from '../services/license';
import { AlertTriangle, Wifi, Lock, CalendarX, Phone, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../supabase';

export default function LicenseGuard({ children }: { children: React.ReactNode }) {
  const user = useStore(state => state.user);
  const showToast = useStore(state => state.showToast);
  const [status, setStatus] = useState<LicenseStatus>('VALID');
  const [daysRemaining, setDaysRemaining] = useState<number>(14);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);

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

  const handleVerify = async () => {
    if (!navigator.onLine) {
      showToast('Hakuna mtandao (Offline). Tafadhali washa data au WiFi kwanza.', 'error');
      return;
    }

    setSyncing(true);
    try {
      showToast('Inahakiki huduma...', 'info');

      // Ensure trial exists on server (idempotent — won't duplicate if already present).
      // Handles the case where the init-license call during setup-shop failed.
      await supabase.functions.invoke('init-license').catch(console.warn);

      LicenseService.clearStatusCache();
      await LicenseService.syncLicense(true);
      LicenseService.clearStatusCache();
      const res = await LicenseService.checkStatus();
      setStatus(res.status);
      setDaysRemaining(res.daysRemaining);
      
      if (res.status === 'VALID') {
        showToast('Mfumo umehakikiwa kikamilifu!', 'success');
      } else {
        showToast('Mfumo haujahuishwa bado au muda wake umekwisha.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Hitilafu ya mtandao imetokea', 'error');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const check = async () => {
      try {
        const res = await LicenseService.checkStatus();
        setStatus(res.status);
        setDaysRemaining(res.daysRemaining);
        setLoading(false);
        
        if (navigator.onLine) {
          // Try to sync in background
          await LicenseService.syncLicense();
          
          // Re-check after sync
          const afterSync = await LicenseService.checkStatus();
          setStatus(afterSync.status);
          setDaysRemaining(afterSync.daysRemaining);
        }
      } catch (e) {
        console.error('License check failed:', e);
        setLoading(false);
      }
    };
    
    check();
    
    // Check every 5 minutes
    const interval = setInterval(check, 5 * 60 * 1000);
    
    // Check when app becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user]);

  if (loading) return <div className="h-screen bg-gray-50 flex items-center justify-center">Inapakia...</div>;

  if (status !== 'VALID') {
    let icon = <Lock className="w-16 h-16 text-red-500 mb-4" />;
    let title = 'Akaunti Imefungwa';
    let message = 'Tafadhali wasiliana na msimamizi wako. 0787979273';

    if (status === 'EXPIRED') {
      icon = <CalendarX className="w-16 h-16 text-red-500 mb-4" />;
      title = 'Mfumo Umeishiwa Muda';
      message = 'Muda wa kutumia Mfumo kwenye duka lako umekwisha. Tafadhali wasiliana na msimamizi wetu ili kuendelea kutoa huduma.';
    } else if (status === 'NO_LICENSE') {
      icon = <Lock className="w-16 h-16 text-gray-500 mb-4" />;
      title = 'Duka Halijasajiliwa';
      message = 'Duka lako bado halijapewa ruhusa ya kutumia mfumo huu. Tafadhali wasiliana na msimamizi wetu ili kusajiliwa.';
    } else if (status === 'SYNC_REQUIRED') {
      icon = <Wifi className="w-16 h-16 text-orange-500 mb-4" />;
      title = 'Uhakiki wa Mtandao Unahitajika';
      message = 'Mfumo unahitaji mtandao kuhakiki hali ya huduma. Tafadhali washa data au WiFi, kisha bonyeza "Hakiki Huduma Sasa".';
    } else if (status === 'DATE_MANIPULATED') {
      icon = <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />;
      title = 'Tarehe Sio Sahihi';
      message = 'Tafadhali rekebisha tarehe na saa ya simu yako iwe sahihi.';
    } else if (status === 'TAMPERED') {
      icon = <AlertTriangle className="w-16 h-16 text-red-600 mb-4" />;
      title = 'Hitilafu ya Usalama';
      message = 'Mfumo umegundua hitilafu kwenye utambulisho wa duka. Tafadhali wasiliana na msimamizi wetu.';
    }

    return (
      <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        {icon}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600 mb-6 leading-relaxed">{message}</p>
        
        {/* Network Status Badge */}
        <div className="mb-6 flex items-center justify-center select-none">
          {isOnline ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-green-50 text-green-700 border border-green-200">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              Uko Mtandaoni (Online)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-red-50 text-red-600 border border-red-200">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              Huna Mtandao (Offline)
            </span>
          )}
        </div>

        {status === 'EXPIRED' && user?.email && (
          <div className="bg-gray-100 px-4 py-2 rounded-lg mb-6">
            <p className="text-sm text-gray-500">Akaunti yako:</p>
            <p className="font-bold text-gray-800">{user.email}</p>
          </div>
        )}

        {(status === 'EXPIRED' || status === 'BLOCKED' || status === 'NO_LICENSE') && (
           <a 
             href="tel:0787979273"
             className="bg-green-500 shadow-xl shadow-green-500/30 text-white px-8 py-3 rounded-xl font-bold transition-all mb-4 flex items-center justify-center gap-2 active:scale-95 w-full max-w-sm"
           >
             <Phone className="w-5 h-5" />
             Bonyeza hapa kupiga simu kulipia
           </a>
        )}

        <button 
          onClick={handleVerify}
          disabled={syncing}
          className="bg-blue-600 disabled:bg-blue-400 text-white px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 mb-8 active:scale-[0.98] w-full max-w-sm justify-center shadow-lg shadow-blue-600/20"
        >
          {syncing ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Wifi className="w-5 h-5" />
          )}
          {syncing ? 'Inahakiki...' : 'Hakiki Huduma Sasa'}
        </button>
      </div>
    );
  }

  return (
    <>
      {daysRemaining <= 5 && (
        <div className="bg-orange-500 text-white text-xs font-bold py-2 px-4 z-50 relative shadow-sm flex items-center justify-between">
          <span>Siku {daysRemaining} zimebaki kabla ya muda wa Mfumo kuisha.</span>
          <a href="tel:0787979273" className="flex items-center gap-1 bg-white text-orange-600 px-3 py-1.5 rounded-full whitespace-nowrap active:scale-95 transition-all shadow-sm">
            <Phone className="w-3.5 h-3.5" />
            Bonyeza hapa kupiga simu kulipia
          </a>
        </div>
      )}
      {children}
    </>
  );
}
