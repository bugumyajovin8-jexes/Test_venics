import { useEffect, useState, useSyncExternalStore } from 'react';
import { LicenseService, LicenseStatus, type LicenseCheck } from '../services/license';
import { AlertTriangle, Lock, Phone, RefreshCw, Wifi } from 'lucide-react';
import { useStore } from '../store';
import {
  SUPPORT_PHONE,
  getReadOnlyState,
  publishLicenseCheck,
  subscribeReadOnly,
} from '../services/readOnly';

// Race a promise against a timeout; resolves to the value, or null if it doesn't settle
// within `ms`. Used so a stalled license network call can never spin the UI forever.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/**
 * BLOCKED is the one status that still bars the door. It is set by hand in the
 * superadmin app — a deliberate ban for fraud or a payment dispute — so it must
 * stay absolute. Every other failure is a lapsed or unverified licence, and for
 * those the shop keeps full read access to its own books.
 */
function isHardBlock(status: LicenseStatus): boolean {
  return status === 'BLOCKED';
}

/** Time left in the end-of-day tail, phrased for the banner. */
function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `masaa ${hours} dakika ${minutes}`;
  return `dakika ${minutes}`;
}

export default function LicenseGuard({ children }: { children: React.ReactNode }) {
  const user = useStore(state => state.user);
  const showToast = useStore(state => state.showToast);
  // Rendered from the shared licence store rather than local state, so a
  // refresh triggered ANYWHERE — the Dashibodi sync button, a manual re-check,
  // a background tick — updates this banner and the write gate together. When
  // these were separate, renewing left the day count updated and the buttons
  // dead until a poll caught up.
  const licence = useSyncExternalStore(subscribeReadOnly, getReadOnlyState);
  const { status, daysRemaining, graceEndsAt, expiresAt } = licence;

  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(Date.now());

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

  // Ticks the tail countdown. Only mounted while the tail is actually running.
  useEffect(() => {
    if (!graceEndsAt) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [graceEndsAt]);

  // Lock at exactly 23:59, not whenever the next 5-minute poll happens to land.
  // Only armed once expiry is close, because a setTimeout days out is both
  // unreliable and pointless — the poll re-arms it as the moment approaches.
  useEffect(() => {
    if (status !== 'VALID' || !expiresAt) return;
    const delay = expiresAt - Date.now();
    if (delay <= 0 || delay > 6 * 60 * 60 * 1000) return;
    const id = setTimeout(() => { void LicenseService.checkStatus(); }, delay + 1000);
    return () => clearTimeout(id);
  }, [status, expiresAt]);

  // checkStatus already publishes to the store; this only refreshes the local
  // countdown clock.
  const applyResult = (_res: LicenseCheck) => {
    setNow(Date.now());
  };

  const handleVerify = async () => {
    if (!navigator.onLine) {
      showToast('Hakuna mtandao (Offline). Tafadhali washa data au WiFi kwanza.', 'error');
      return;
    }

    setSyncing(true);
    try {
      showToast('Inahakiki huduma...', 'info');

      // verifyOnline confirms with the server and, ONLY for a brand-new shop that has
      // no license row yet, provisions the trial via the idempotent init-license function.
      // Capped so a slow/dead connection can't spin the button forever.
      LicenseService.clearStatusCache();
      const res = await withTimeout(LicenseService.verifyOnline({ forceInit: true }), 10000);
      if (!res) {
        showToast('Imeshindwa kufikia seva kwa wakati. Angalia mtandao kisha jaribu tena.', 'error');
        return;
      }
      applyResult(res);

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
    let cancelled = false;

    // A different account just signed in, so the previous shop's verdict must not
    // carry over. Resets to writable — the same fail-open direction as a cold
    // start — and the check below applies the new shop's real status a moment
    // later. Only fires on an actual user change, so a lapsed shop is never
    // briefly unlocked by a re-render.
    LicenseService.clearStatusCache();
    publishLicenseCheck({ status: 'VALID', daysRemaining: 14 });

    // Cap the license verification so a stalled connection (mobile data that shows
    // "online" but passes no traffic) can never trap the app on the "Inapakia..." screen.
    // Race the network verifyOnline against a timeout; if it doesn't answer, fall back to
    // the LOCAL, HMAC-signed status (which enforces a 30-day offline grace), then render.
    const check = async () => {
      let res: LicenseCheck | null = null;
      try {
        res = await withTimeout(LicenseService.verifyOnline(), 6000);
      } catch (e) {
        console.error('License check failed:', e);
      }
      if (!res) {
        try { res = await withTimeout(LicenseService.checkStatus(), 3000); } catch { /* ignore */ }
      }
      if (cancelled) return;
      if (res) applyResult(res);
      setLoading(false);
    };

    check();

    // Check every 5 minutes
    const interval = setInterval(check, 5 * 60 * 1000);

    // Check when app becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user]);

  if (loading) return <div className="h-screen bg-gray-50 flex items-center justify-center">Inapakia...</div>;

  // --- The one remaining wall ------------------------------------------------
  if (isHardBlock(status)) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <AlertTriangle className="w-16 h-16 text-red-600 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Duka Limesimamishwa</h1>
        <p className="text-gray-600 mb-6 leading-relaxed max-w-md">
          Huduma kwa duka lako imesimamishwa. Tafadhali piga simu kwa msaada ili kurejesha huduma.
        </p>

        {user?.email && (
          <div className="bg-gray-100 px-4 py-2 rounded-lg mb-6">
            <p className="text-sm text-gray-500">Akaunti yako:</p>
            <p className="font-bold text-gray-800">{user.email}</p>
          </div>
        )}

        <a
          href={`tel:${SUPPORT_PHONE}`}
          className="bg-green-500 shadow-xl shadow-green-500/30 text-white px-8 py-3 rounded-xl font-bold transition-all mb-4 flex items-center justify-center gap-2 active:scale-95 w-full max-w-sm"
        >
          <Phone className="w-5 h-5" />
          Piga Simu
        </a>

        <button
          onClick={handleVerify}
          onPointerUp={handleVerify}
          disabled={syncing}
          className="bg-blue-600 disabled:bg-blue-400 text-white px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 active:scale-[0.98] w-full max-w-sm justify-center shadow-lg shadow-blue-600/20 cursor-pointer"
        >
          {syncing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Wifi className="w-5 h-5" />}
          {syncing ? 'Inahakiki...' : 'Hakiki huduma sasa'}
        </button>
      </div>
    );
  }

  // --- Read-only: the shop keeps its books, loses the register ---------------
  const locked = status !== 'VALID';
  const selfFixable = status === 'SYNC_REQUIRED' || status === 'DATE_MANIPULATED';

  return (
    <>
      {locked && (
        <div className="bg-blue-600 text-white text-xs font-bold py-2 px-4 z-50 relative shadow-sm flex items-center justify-between gap-2">
          {/* States the EFFECT, not just the cause. A boss who only reads
              reports never touches a locked button, so "your package expired"
              alone leaves them wondering what actually changed. */}
          <span className="flex items-center gap-1.5 min-w-0">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {selfFixable
                ? 'Hakiki kifurushi chako — huwezi kuuza kwa sasa'
                : status === 'NO_LICENSE'
                  ? 'Duka linahitaji kifurushi — huwezi kuuza'
                  : 'Kifurushi kimeisha — unasoma tu, huwezi kuuza'}
            </span>
          </span>
          {selfFixable ? (
            <button
              onClick={handleVerify}
              onPointerUp={handleVerify}
              disabled={syncing}
              className="flex items-center gap-1 bg-white text-blue-700 px-3 py-1.5 rounded-full whitespace-nowrap active:scale-95 transition-all shadow-sm cursor-pointer disabled:opacity-60"
            >
              {syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
              {syncing ? 'Inahakiki...' : 'Hakiki sasa'}
            </button>
          ) : (
            <a
              href={`tel:${SUPPORT_PHONE}`}
              className="flex items-center gap-1 bg-white text-blue-700 px-3 py-1.5 rounded-full whitespace-nowrap active:scale-95 transition-all shadow-sm"
            >
              <Phone className="w-3.5 h-3.5" />
              Piga Simu
            </a>
          )}
        </div>
      )}

      {/* End-of-day tail: the licence moment has passed, the trading day has not. */}
      {!locked && graceEndsAt && (
        <div className="bg-red-500 text-white text-xs font-bold py-2 px-4 z-50 relative shadow-sm flex items-center justify-between gap-2">
          <span className="truncate">
            Kifurushi kimeisha — unaendelea hadi usiku wa manane. Zimebaki {formatRemaining(graceEndsAt - now)}.
          </span>
          <a
            href={`tel:${SUPPORT_PHONE}`}
            className="flex items-center gap-1 bg-white text-red-600 px-3 py-1.5 rounded-full whitespace-nowrap active:scale-95 transition-all shadow-sm"
          >
            <Phone className="w-3.5 h-3.5" />
            Piga Simu
          </a>
        </div>
      )}

      {!locked && !graceEndsAt && daysRemaining <= 5 && (
        <div className="bg-orange-500 text-white text-xs font-bold py-2 px-4 z-50 relative shadow-sm flex items-center justify-between">
          <span>Siku {daysRemaining} zimebaki kabla ya muda wa Mfumo kuisha.</span>
          <a href={`tel:${SUPPORT_PHONE}`} className="flex items-center gap-1 bg-white text-orange-600 px-3 py-1.5 rounded-full whitespace-nowrap active:scale-95 transition-all shadow-sm">
            <Phone className="w-3.5 h-3.5" />
            Bonyeza hapa kupiga simu kulipia
          </a>
        </div>
      )}

      {!isOnline && locked && !selfFixable && (
        <div className="bg-gray-800 text-white text-[11px] font-semibold py-1.5 px-4 text-center">
          Huna mtandao — ukishalipia, washa data kisha fungua app tena.
        </div>
      )}

      {children}
    </>
  );
}
