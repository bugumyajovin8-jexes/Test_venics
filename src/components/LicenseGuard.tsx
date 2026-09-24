import { useEffect, useState } from 'react';
import { LicenseService, LicenseStatus } from '../services/license';
import { AlertTriangle, Wifi, Lock, CalendarX, Phone, RefreshCw, LogOut } from 'lucide-react';
import { useStore } from '../store';

export default function LicenseGuard({ children }: { children: React.ReactNode }) {
  const user = useStore(state => state.user);
  const showToast = useStore(state => state.showToast);
  const logout = useStore(state => state.logout);
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

  const handleForceVerifyLicense = async () => {
    if (!navigator.onLine) {
      showToast('Hakuna mtandao (Offline). Tafadhali washa data au WiFi kwanza.', 'error');
      return;
    }

    setSyncing(true);
    try {
      showToast('Inahakiki huduma...', 'info');

      // verifyOnline confirms with the server and, ONLY for a brand-new shop that has
      // no license row yet, provisions the trial via the idempotent init-license function.
      LicenseService.clearStatusCache();
      const res = await LicenseService.verifyOnline({ forceInit: true });
      setStatus(res.status);
      setDaysRemaining(res.daysRemaining);

      if (res.status === 'VALID') {
        showToast('Mfumo umehakikiwa kikamilifu!', 'success');
        window.location.reload();
      } else {
        showToast('Mfumo haujahuishwa bado au muda wake umekwisha.', 'error');
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Imeshindwa kuhakiki leseni kwa sasa. Tafadhali jaribu tena.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    // Cap the license verification so a stalled connection (wifi that reports "online"
    // but passes no traffic) can never trap the app on the "Inapakia..." screen. Race the
    // network verifyOnline against a timeout; if it doesn't answer, fall back to the LOCAL,
    // HMAC-signed status (which already enforces a 30-day offline grace), then render
    // regardless. The mount watchdog can't help here — React is already mounted.
    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

    const runCheck = async () => {
      let res: { status: LicenseStatus; daysRemaining: number } | null = null;
      try {
        // Confirm with the server (and auto-provision a brand-new shop's trial) BEFORE we
        // ever decide to block the user. Loading stays true only on the first mount.
        res = await withTimeout(LicenseService.verifyOnline(), 6000);
      } catch (e) {
        console.error('License check failed:', e);
      }
      if (!res) {
        // verifyOnline hung, timed out, or threw — fall back to the fast local status.
        try { res = await withTimeout(LicenseService.checkStatus(), 3000); } catch { /* ignore */ }
      }
      if (cancelled) return;
      if (res) {
        setStatus(res.status);
        setDaysRemaining(res.daysRemaining);
      }
      setLoading(false);
    };

    runCheck();

    const interval = setInterval(runCheck, 5 * 60 * 1000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') runCheck();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user?.id, user?.shopId]);

  if (loading) return <div className="h-screen bg-gray-50 flex items-center justify-center">Inapakia...</div>;

  if (status !== 'VALID') {
    let icon = <Lock className="w-16 h-16 text-red-500 mb-4" />;
    let title = 'Hakiki sasa';
    let message = 'Hakikisha kompyuta yako ina mtandao, kisha bonyeza "Hakiki Leseni Sasa" hapo chini ili kuunganisha duka lako na mfumo wetu.';

    if (status === 'EXPIRED') {
      icon = <CalendarX className="w-16 h-16 text-red-500 mb-4" />;
      title = 'Leseni Imeisha';
      message = 'Muda wa matumizi ya mfumo kwenye duka lako umekwisha. Tafadhali washa mtandao, kisha bonyeza "Hakiki Leseni Sasa" hapo chini ili kusawazisha malipo yako mapya, au piga simu kupata msaada.';
    } else if (status === 'NO_LICENSE') {
      icon = <Lock className="w-16 h-16 text-gray-500 mb-4" />;
      title = 'Usajili wa Duka Unasubiriwa';
      message = 'Duka lako bado halijapewa utambulisho wa huduma kikamilifu. Bonyeza kitufe cha bluu hapo chini ili kusajili duka, au piga simu sasa kupata msaada wa haraka.';
    } else if (status === 'SYNC_REQUIRED') {
      icon = <Wifi className="w-16 h-16 text-orange-500 mb-4" />;
      title = 'Unganisha Mtandao';
      message = 'Mfumo unahitaji mtandao kuhakiki leseni. Tafadhali washa data au WiFi, kisha bonyeza kitufe cha bluu hapo chini.';
    } else if (status === 'DATE_MANIPULATED') {
      icon = <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />;
      title = 'Tarehe Sio Sahihi';
      message = 'Tafadhali rekebisha tarehe na saa ya kompyuta yako iwe sahihi kulingana na saa ya sasa ili mfumo uweze kukuhudumia.';
    } else if (status === 'TAMPERED') {
      icon = <AlertTriangle className="w-16 h-16 text-red-600 mb-4" />;
      title = 'Hitilafu ya Usalama';
      message = 'Mfumo umegundua mabadiliko yasiyo halali kwenye faili za leseni. Washa mtandao na bonyeza kitufe cha bluu hapo chini kuhakiki utambulisho upya.';
    }

    return (
      <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        {icon}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600 mb-6 leading-relaxed max-w-md">{message}</p>

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
            className="bg-green-500 hover:bg-green-600 shadow-xl shadow-green-500/30 text-white px-8 py-3 rounded-xl font-bold transition-all mb-4 flex items-center justify-center gap-2 active:scale-95 w-full max-w-sm"
          >
            <Phone className="w-5 h-5" />
            Bonyeza hapa kupiga simu kulipia au kupata msaada
          </a>
        )}

        <button
          onClick={handleForceVerifyLicense}
          disabled={syncing}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 mb-4 active:scale-[0.98] w-full max-w-sm justify-center shadow-lg shadow-blue-600/20 cursor-pointer disabled:opacity-50"
        >
          {syncing ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Wifi className="w-5 h-5" />
          )}
          {syncing ? 'Inahakiki...' : '👉 Hakiki Leseni Sasa 👈'}
        </button>

        <button
          onClick={() => logout()}
          className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 mb-8 active:scale-[0.98] w-full max-w-sm justify-center cursor-pointer shadow-sm"
        >
          <LogOut className="w-5 h-5" />
          Toka Kwenye Mfumo (Logout)
        </button>
      </div>
    );
  }

  return (
    <>
      {daysRemaining <= 5 && daysRemaining > 0 && (
        <div className="bg-orange-500 text-white text-xs font-bold py-2 px-4 z-50 relative shadow-sm flex items-center justify-between">
          <span>Siku {daysRemaining} zimebaki kabla ya leseni kuisha.</span>
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
