/**
 * "Kituo cha Duka" — joining the shop's hub, and seeing whether it is there.
 *
 * Deliberately two fields and one button. The person setting this up is a shop
 * owner standing at the till reading two lines off its screen, not an
 * administrator: an address, a six-digit code, done.
 */

import { useEffect, useRef, useState } from 'react';
import { Radio, Check, Loader2, Unplug, AlertTriangle, Smartphone, Monitor } from 'lucide-react';
import { useStore } from '../store';
import {
  getHubConfig, pairWithHub, unpairHub, hubHello, normalizeHubUrl, describeHubFailure, listHubDevices,
  type HubConfig, type HubDevice, type HubDeviceList,
} from '../services/hub';
import { hubTransportKind } from '../services/hubTransport';
import { SyncService } from '../services/sync';

/**
 * A device that synced this recently is in use now. An open app syncs with the
 * hub every fifteen seconds, so three minutes allows for a phone that was put
 * down or briefly lost the wifi.
 */
const ACTIVE_MS = 3 * 60_000;

function lastSeenText(device: HubDevice, hubNow: string): { active: boolean; text: string } {
  // Measured from the device's last actual SYNC — a phone that can see the hub
  // but whose sync is stuck must not look fine. Both times are the hub's own,
  // so no device's clock can make a phone look online for ever, or gone.
  if (!device.lastSyncAt) return { active: false, text: 'Bado hakijasawazisha' };
  const ago = Date.parse(hubNow) - Date.parse(device.lastSyncAt);
  if (!Number.isFinite(ago)) return { active: false, text: '' };
  if (ago < ACTIVE_MS) return { active: true, text: 'Yupo sasa' };
  const minutes = Math.round(ago / 60_000);
  if (minutes < 60) return { active: false, text: `Alionekana dakika ${minutes} zilizopita` };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { active: false, text: `Alionekana saa ${hours} zilizopita` };
  const days = Math.round(hours / 24);
  return { active: false, text: days === 1 ? 'Alionekana jana' : `Alionekana siku ${days} zilizopita` };
}

/**
 * Everyone joined to the hub, shown on the shop's main computer — the one the
 * hub runs on. The hub decides which that is, from the connection itself.
 */
function ConnectedDevices({ list }: { list: HubDeviceList }) {
  const rows = list.devices
    .map(d => ({ device: d, seen: lastSeenText(d, list.now) }))
    .sort((a, b) =>
      Number(b.device.you) - Number(a.device.you)
      || Number(b.seen.active) - Number(a.seen.active)
      || Date.parse(b.device.lastSyncAt ?? b.device.pairedAt) - Date.parse(a.device.lastSyncAt ?? a.device.pairedAt));
  const activeCount = rows.filter(r => r.seen.active).length;

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <h3 className="text-sm font-semibold text-gray-800">Vifaa vilivyounganishwa ({rows.length})</h3>
        <span className="text-[11px] text-gray-500">{activeCount} vipo sasa</span>
      </div>
      <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
        {rows.map(({ device, seen }) => {
          const Icon = /^kompyuta/i.test(device.label) ? Monitor : Smartphone;
          const role = device.role === 'boss' ? 'Bosi' : device.role ? 'Mfanyakazi' : '';
          return (
            <li key={device.deviceId} className="flex items-center gap-3 px-3 py-2.5 bg-white">
              <div className="p-2 rounded-lg bg-gray-50 text-gray-500 shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800 truncate">
                  {device.userName || device.label}
                  {device.you && <span className="ml-1.5 text-[10px] font-semibold text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 align-middle">Kifaa hiki</span>}
                </p>
                <p className="text-[11px] text-gray-500 truncate">
                  {[device.userName ? device.label : '', role].filter(Boolean).join(' · ') || 'Kifaa'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-right">
                <span className={`w-2 h-2 rounded-full ${seen.active ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden="true" />
                <span className={seen.active ? 'text-emerald-700 font-medium' : 'text-gray-500'}>{seen.text}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function HubPairing() {
  const { showToast, showConfirm, isBoss } = useStore();
  const [config, setConfig] = useState<HubConfig | null>(getHubConfig());
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [reach, setReach] = useState<'checking' | 'yes' | 'no'>('checking');
  // Why it is unreachable. In a browser the usual cause is a refused
  // local-network permission, which only the shop can undo.
  const [why, setWhy] = useState('');
  const inBrowser = hubTransportKind() === 'web';
  // Filled only while the hub is reachable; shown only on the main computer.
  const [list, setList] = useState<HubDeviceList | null>(null);
  // Once the hub says this is not the main computer, stop asking.
  const notMain = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const cfg = getHubConfig();
      if (!cfg) { setReach('no'); return; }
      try {
        const hello = await hubHello(cfg.url);
        if (cancelled) return;
        const same = hello.hubId === cfg.hubId;
        setReach(same ? 'yes' : 'no');
        setWhy(same ? '' : 'Anwani hii sasa ni ya kituo kingine. Ondoa kituo, kisha unganisha upya.');
        if (!same) { setList(null); return; }
        if (notMain.current) return;
        try {
          const devices = await listHubDevices();
          if (devices && !devices.local) notMain.current = true;
          if (!cancelled) setList(devices);
        } catch {
          // The list is a courtesy; the hub being reachable is what matters.
          if (!cancelled) setList(null);
        }
      } catch (err) {
        if (cancelled) return;
        setReach('no');
        setList(null);
        setWhy(await describeHubFailure(cfg.url, err));
      }
    };
    void probe();
    const timer = setInterval(probe, 20_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [config?.hubId]);

  const join = async () => {
    setBusy(true);
    try {
      const cfg = await pairWithHub(url, code);
      setConfig(cfg);
      setUrl('');
      setCode('');
      showToast(`Umeunganishwa na ${cfg.name}.`, 'success');
      void SyncService.sync(true, 'full');
    } catch (err: any) {
      showToast(err?.message || 'Imeshindwa kuunganisha na kituo.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    showConfirm(
      'Ondoa kituo',
      'Kifaa hiki kitaacha kusawazisha na kituo cha duka. Taarifa zilizopo zitabaki, na zitaendelea kwenda kwenye mtandao mkuu kama kawaida.',
      () => {
        void unpairHub().then(() => {
          setConfig(null);
          setList(null);
          showToast('Kituo kimeondolewa.', 'success');
        });
      },
    );
  };

  return (
    <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
      <div className="flex items-center mb-3">
        <div className={`p-3 rounded-xl mr-3 ${config && reach === 'yes' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
          <Radio className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-800">Kituo cha Duka</h2>
          <p className="text-xs text-gray-500">
            {config
              ? reach === 'yes'
                ? `${config.name} — kinapatikana`
                : reach === 'checking' ? `${config.name} — inaangalia…` : `${config.name} — hakipatikani sasa`
              : 'Sawazisha na vifaa vingine hata bila intaneti'}
          </p>
        </div>
      </div>

      {config ? (
        <>
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-xs text-gray-600 space-y-1">
            <div className="flex justify-between gap-2"><span className="text-gray-400">Anwani</span><span className="font-mono truncate">{config.url}</span></div>
            <div className="flex justify-between gap-2"><span className="text-gray-400">Iliunganishwa</span><span>{new Date(config.pairedAt).toLocaleDateString('en-GB')}</span></div>
          </div>
          {reach !== 'yes' && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-700 mt-2 leading-snug">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
              {why || 'Hakipatikani kwa sasa. Hakikisha kifaa hiki kipo kwenye wifi ya duka na kituo kimewashwa.'}
            </p>
          )}
          {reach === 'yes' && list?.local && <ConnectedDevices list={list} />}
          {isBoss() && (
            <button
              onClick={leave}
              className="mt-3 w-full flex items-center justify-center gap-1.5 bg-white border border-red-200 text-red-600 text-xs font-bold px-3 py-2.5 rounded-xl active:scale-95 transition-all cursor-pointer"
            >
              <Unplug className="w-4 h-4" />
              Ondoa kituo
            </button>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 leading-snug">
            Washa kituo kwenye kompyuta ya duka, kisha weka anwani na namba inayoonekana kwenye skrini yake.
          </p>
          {inBrowser && (
            // Chrome asks once before a website may reach anything on the
            // shop's network. A shopkeeper who has not been told to expect
            // that prompt tends to dismiss it, and then nothing works.
            <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-lg p-2 leading-snug">
              Chrome itakuuliza ruhusa ya kuwasiliana na vifaa vya mtandao wa duka — bonyeza <b>Allow</b>.
              Kwenye kompyuta yenye kituo chenyewe, tumia anwani <span className="font-mono">localhost:8787</span>.
            </p>
          )}
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="192.168.1.20:8787"
            inputMode="url"
            autoCapitalize="none"
            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono"
          />
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Namba ya kuunganisha (tarakimu 6)"
            inputMode="numeric"
            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm tracking-widest"
          />
          <button
            onClick={join}
            disabled={busy || !url.trim() || code.length < 6}
            className="w-full flex items-center justify-center gap-1.5 bg-blue-600 text-white text-sm font-bold px-3 py-3 rounded-xl active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {busy ? 'Inaunganisha…' : 'Unganisha'}
          </button>
          {url.trim() && <p className="text-[10px] text-gray-400 font-mono">{normalizeHubUrl(url)}</p>}
        </div>
      )}
    </section>
  );
}
