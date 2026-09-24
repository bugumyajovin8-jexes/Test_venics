/**
 * "Is this device up to date?" — asked and answered on the screen.
 *
 * A phone that has been failing to sync for a week looks exactly like a healthy
 * one: the sales are all there, on THIS device. Shops that go days without
 * internet live in that state on purpose, so the honest thing is to show how
 * long it has been and how much is waiting, rather than a silent cloud icon.
 *
 * Everything here is local — no request is made to draw it.
 */

import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, CloudOff, Clock, Loader2 } from 'lucide-react';
import { SyncService } from '../services/sync';
import { clockStatus } from '../services/clock';
import { getDeviceLabel } from '../services/deviceId';
import { useStore } from '../store';

function ago(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'sekunde chache zilizopita';
  if (mins < 60) return `dakika ${mins} zilizopita`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `saa ${hours} zilizopita`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'jana' : `siku ${days} zilizopita`;
}

export default function SyncStatusCard() {
  const { showToast } = useStore();
  const [lastSync, setLastSync] = useState<number | null>(SyncService.getLastSyncAt());
  const [pending, setPending] = useState<{ total: number; byTable: Record<string, number> } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = async () => {
    setLastSync(SyncService.getLastSyncAt());
    setPending(await SyncService.getPendingCounts());
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, []);

  const clock = clockStatus();
  const offlineMs = lastSync === null ? null : Date.now() - lastSync;
  const behind = offlineMs === null || offlineMs > 6 * 60 * 60 * 1000;
  const waiting = pending?.total ?? 0;

  const syncNow = async () => {
    setSyncing(true);
    try {
      await SyncService.sync(true, 'full');
      await refresh();
      const stillWaiting = (await SyncService.getPendingCounts()).total;
      showToast(
        stillWaiting > 0
          ? `Bado kuna mabadiliko ${stillWaiting} yanayosubiri. Angalia mtandao.`
          : 'Kila kitu kimesawazishwa.',
        stillWaiting > 0 ? 'error' : 'success',
      );
    } catch {
      showToast('Imeshindwa kusawazisha. Angalia mtandao.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center min-w-0">
          <div className={`p-3 rounded-xl mr-3 shrink-0 ${behind ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {behind ? <CloudOff className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-800">Hali ya Usawazishaji</h2>
            <p className="text-xs text-gray-500 truncate">
              {lastSync === null
                ? 'Kifaa hiki hakijawahi kusawazisha'
                : `Mara ya mwisho: ${ago(Date.now() - lastSync)}`}
            </p>
          </div>
        </div>
        <button
          onClick={syncNow}
          disabled={syncing}
          className="shrink-0 flex items-center gap-1.5 bg-blue-600 text-white text-xs font-bold px-3 py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-60 cursor-pointer"
        >
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {syncing ? 'Inasawazisha…' : 'Sawazisha'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Yanayosubiri kutumwa</div>
          <div className={`text-sm font-extrabold ${waiting > 0 ? 'text-amber-700' : 'text-gray-800'}`}>
            {pending === null ? '—' : waiting === 0 ? 'Hakuna' : `Mabadiliko ${waiting}`}
          </div>
          {waiting > 0 && (
            <div className="text-[10px] text-gray-500 truncate">
              {Object.entries(pending!.byTable).slice(0, 3).map(([t, n]) => `${t}: ${n}`).join(' · ')}
            </div>
          )}
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Kifaa hiki</div>
          <div className="text-sm font-extrabold text-gray-800 truncate">{getDeviceLabel()}</div>
        </div>
      </div>

      {waiting > 0 && (
        <p className="text-[11px] text-gray-500 mt-2 leading-snug">
          Mabadiliko haya yapo salama kwenye kifaa hiki na yatatumwa yenyewe mtandao ukirudi. Vifaa vingine
          havitayaona kabla ya hapo.
        </p>
      )}

      {clock.wrong && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 mt-2 leading-snug">
          <Clock className="w-3.5 h-3.5 mt-px shrink-0" />
          Saa ya kifaa hiki iko nje kwa takriban {Math.round(Math.abs(clock.offsetMs) / 60_000)} dakika. Mfumo
          unatumia saa sahihi ya seva kwenye rekodi, lakini ni vizuri kurekebisha saa ya kifaa.
        </p>
      )}
    </section>
  );
}
