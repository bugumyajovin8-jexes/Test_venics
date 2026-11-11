/**
 * The shop hub on this computer, shown and worked from the app.
 *
 * Everything the hub's black console window used to show is here instead:
 * whether it is running, the address each phone types, the pairing code,
 * where the shop's data is kept, and each device as it joins. The boss
 * switches it on and off here.
 *
 * A web page cannot run a server, so the hub is Venics Kituo cha Duka, a
 * small program with no window: this card offers it for download, finds it
 * once it is installed, and from then on shows and works it. See kituoHost.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Power, Loader2, AlertTriangle, FolderOpen, Link2, RotateCcw, Download, Search, ExternalLink } from 'lucide-react';
import { useStore } from '../store';
import {
  kituo, onWindows, waitForKituo, latestKituo, newerVersion, kituoSeenHere, markKituoSeen,
  KituoError, KITUO_CONTROL, KITUO_OPEN_LINK, type KituoEvent, type KituoStatus,
} from '../services/kituoHost';
import { localNetworkPermission } from '../services/hubTransport';
import { pairWithHub, shownLabel, type HubConfig } from '../services/hub';
import { t } from '../i18n';

export type HubPresence =
  /** Not Windows: no hub to offer on this computer. */
  | 'none'
  | 'checking'
  /** The program answers. */
  | 'here'
  /** The program does not answer: not installed, or closed. */
  | 'absent'
  /** Chrome would ask the shop's permission first: wait for a click. */
  | 'not_asked'
  /** Chrome was told not to let this page reach the program. */
  | 'blocked'
  /** Chrome asked, and was not allowed (the question was closed or ignored). */
  | 'refused'
  /** A program made for another website. */
  | 'other_site';

export interface HostedHubState {
  status: KituoStatus | null;
  presence: HubPresence;
  /** Looking for the program now: a short search, or waiting while it is installed. */
  finding: 'no' | 'searching' | 'installing';
  /** Chrome is holding the card's request: its permission question is on screen. */
  chromeAsking: boolean;
  /** The last search ended without finding the program. */
  notFound: boolean;
  /** 'search': look for a few seconds. 'install': keep looking while it is installed. */
  lookFor: (mode?: 'search' | 'install') => void;
}

/** A search, then a plain "not found" — never a spinner that goes on for ever. */
const SEARCH_FOR_MS = 12_000;
/** Downloading, opening and installing the program takes a few minutes at most. */
const INSTALL_FOR_MS = 10 * 60_000;
/** Asked with rev 0, a running program answers at once: open longer, it is Chrome asking. */
const ASKING_AFTER_MS = 2_000;
const LOOK_EAGER_MS = 3_000;
const LOOK_IDLE_MS = 10_000;

/** The hub on this computer, kept up to date. */
export function useHostedHub(): HostedHubState {
  const [status, setStatus] = useState<KituoStatus | null>(null);
  const [presence, setPresence] = useState<HubPresence>(() => (onWindows() ? 'checking' : 'none'));
  const [looking, setLooking] = useState(false);
  const [finding, setFindingState] = useState<'no' | 'searching' | 'installing'>('no');
  const [chromeAsking, setChromeAsking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const findingNow = useRef<'no' | 'searching' | 'installing'>('no');
  const findUntil = useRef(0);
  const wake = useRef<(() => void) | null>(null);
  const setFinding = (f: 'no' | 'searching' | 'installing') => { findingNow.current = f; setFindingState(f); };

  // Chrome asks the shop once before a website may reach a program on the
  // computer. Unasked, that question would appear the moment Zaidi opens, on
  // every computer — so the card looks by itself only where it was allowed
  // before (or the program was seen here), and otherwise waits for a click.
  useEffect(() => {
    if (!onWindows()) return;
    let alive = true;
    void localNetworkPermission(KITUO_CONTROL).then(p => {
      if (!alive) return;
      if (p === 'denied') setPresence('blocked');
      else if (p === 'prompt' && !kituoSeenHere()) setPresence('not_asked');
      else {
        findUntil.current = Date.now() + SEARCH_FOR_MS;
        setLooking(true);
      }
    });
    return () => { alive = false; };
  }, []);

  // Watching the program: its status, then again whenever it changes.
  useEffect(() => {
    if (!looking) return;
    const controller = new AbortController();
    const { signal } = controller;
    // Until `ms` have passed, or the next click on the card (no `ms`: only that).
    const pause = (ms?: number) => new Promise<void>(resolve => {
      const timer = ms === undefined ? undefined : setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        if (wake.current === done) wake.current = null;
        resolve();
      }
      wake.current = done;
      signal.addEventListener('abort', done);
    });
    void (async () => {
      let rev = 0;
      while (!signal.aborted) {
        const sent = Date.now();
        const asking = rev ? undefined : setTimeout(() => setChromeAsking(true), ASKING_AFTER_MS);
        let found: KituoStatus | null = null;
        let failure: unknown = null;
        try {
          found = await waitForKituo(rev, signal);
        } catch (err) {
          failure = err;
        } finally {
          clearTimeout(asking);
          setChromeAsking(false);
        }
        if (signal.aborted) return;

        if (found) {
          rev = found.rev ?? 0;
          markKituoSeen();
          setStatus(found);
          setPresence('here');
          setFinding('no');
          setNotFound(false);
          continue;
        }

        const code = failure instanceof KituoError ? failure.code : 'unreachable';
        const held = !rev && Date.now() - sent >= ASKING_AFTER_MS;
        rev = 0;
        setStatus(null);
        const permission = await localNetworkPermission(KITUO_CONTROL);
        if (signal.aborted) return;
        const next: HubPresence = code === 'other_site' ? 'other_site'
          : permission === 'denied' ? 'blocked'
          // Held, then refused: Chrome's question was closed or went unanswered.
          : held ? 'refused'
          : 'absent';
        setPresence(next);

        if (next !== 'absent') {
          // Only a click asks again. Asking unbidden, over and over, is how
          // Chrome comes to stop asking altogether.
          setFinding('no');
          await pause();
          continue;
        }
        if (Date.now() < findUntil.current) {
          await pause(LOOK_EAGER_MS);
          continue;
        }
        if (findingNow.current !== 'no') {
          setFinding('no');
          setNotFound(true);
        }
        // From here on it looks again by itself only where Chrome has nothing
        // to ask (a program started later is found); otherwise on a click.
        await pause(permission === 'granted' || permission === 'unknown' ? LOOK_IDLE_MS : undefined);
      }
    })();
    return () => controller.abort();
  }, [looking]);

  const lookFor = useCallback((mode: 'search' | 'install' = 'search') => {
    findUntil.current = Date.now() + (mode === 'install' ? INSTALL_FOR_MS : SEARCH_FOR_MS);
    setFinding(mode === 'install' ? 'installing' : 'searching');
    setNotFound(false);
    setLooking(true);
    wake.current?.();
  }, []);

  return { status, presence, finding, chromeAsking, notFound, lookFor };
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function eventText(e: KituoEvent): string {
  if (e.kind === 'paired') {
    const label = shownLabel(e.label ?? t('Kifaa'));
    return t('Kifaa kimeunganishwa: {label}', { label }) + (e.userName ? ` — ${e.userName}` : '');
  }
  if (e.kind === 'started') return t('Kituo kimewashwa');
  if (e.kind === 'stopped') return t('Kituo kimezimwa');
  return t('Kituo kimeshindwa kuanza');
}

function errorText(s: KituoStatus): string {
  const program = s.blocker?.exePath ? s.blocker.exePath.split(/[\\/]/).pop() : '';
  switch (s.error) {
    case 'old_hub_running':
      return t('Kituo cha zamani (VenicsHub.exe) bado kinaendelea kwenye kompyuta hii, kwenye dirisha lake jeusi. Kifunge, ili Kituo cha Duka kipya kiendelee mahali pake.');
    case 'port_busy':
      return program
        ? t('Port {port} inatumiwa na programu nyingine kwenye kompyuta hii ({program}). Funga programu hiyo, kisha jaribu tena.', { port: s.port, program })
        : t('Port {port} inatumiwa na programu nyingine kwenye kompyuta hii. Funga programu hiyo, kisha jaribu tena.', { port: s.port });
    case 'data_denied':
      return t('Kituo hakiwezi kuhifadhi taarifa kwenye: {dir}', { dir: s.errorDetail ?? '' });
    default:
      return t('Kituo kimeshindwa kuanza: {detail}', { detail: s.errorDetail ?? '' });
  }
}

const megabytes = (bytes: number) => Math.max(1, Math.round(bytes / 1e6));

interface Props {
  hub: HostedHubState;
  /** This device's pairing, if any. */
  config: HubConfig | null;
  onPaired: (cfg: HubConfig) => void;
}

export default function HostedHub({ hub, config, onPaired }: Props) {
  const { status, presence } = hub;
  const { showToast, showConfirm, isBoss, user } = useStore();
  const boss = isBoss();
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState(false);
  // What the website offers for download: undefined while asking, null when
  // it could not say (no internet) — then there is nothing to download.
  const [latest, setLatest] = useState<{ version: string; bytes: number; url: string } | null | undefined>(undefined);
  const [askAgain, setAskAgain] = useState(0);
  // Downloaded just now: the steps that follow are worth showing again.
  const [downloaded, setDownloaded] = useState(false);
  // Installing the hub here, opening it, or the boss switching it on, is
  // also asking for this computer to join it. Only then does it join without
  // a click.
  const pairWhenRunning = useRef(false);

  const pairedHere = !!config && !!status?.hubId && config.hubId === status.hubId;
  // A hub no device has joined yet becomes the shop of whoever joins first:
  // anyone signed in here, boss or employee, joins it to their own shop.
  const ourShop = !!user?.shopId && (status?.shopId ? status.shopId === user.shopId : true);

  // The newest program on offer: its size for the download button, and
  // whether the one installed is out of date.
  useEffect(() => {
    if (presence === 'none' || presence === 'checking') return;
    let alive = true;
    void latestKituo().then(l => { if (alive) setLatest(l); });
    return () => { alive = false; };
  }, [presence, askAgain]);

  const pairThisComputer = async () => {
    if (!status?.pairingCode) return;
    setPairing(true);
    try {
      onPaired(await pairWithHub(status.localUrl, status.pairingCode));
    } catch (err: any) {
      showToast(err?.message || t('Imeshindwa kuunganisha na kituo.'), 'error');
    } finally {
      setPairing(false);
    }
  };

  useEffect(() => {
    if (status?.state !== 'running' || !pairWhenRunning.current) return;
    pairWhenRunning.current = false;
    if (!pairedHere && ourShop) void pairThisComputer();
    // Only the moment it comes up after someone here asked.
  }, [status?.state]);

  if (presence === 'none') return null;

  if (presence === 'checking') {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 mb-3 flex items-center gap-2 text-sm text-gray-600">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('Inatafuta Kituo cha Duka kwenye kompyuta hii…')}
      </div>
    );
  }

  if (presence !== 'here' || !status) {
    // Installed here before, but not answering now: it was closed, so the
    // first thing to offer is opening it, not installing it again.
    const closed = kituoSeenHere() && presence === 'absent';
    const opened = () => { pairWhenRunning.current = true; hub.lookFor('install'); };
    const download = () => { setDownloaded(true); opened(); };
    const tried = hub.notFound || presence === 'refused' || presence === 'blocked' || presence === 'other_site';
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 mb-3">
        <p className="text-sm font-semibold text-gray-800">{t('Kompyuta hii kama kituo')}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-snug">
          {closed
            ? t('Kituo cha Duka kimewekwa kwenye kompyuta hii, lakini hakiendelei sasa. Kifungue, ili simu na kompyuta nyingine ziendelee kusawazisha nacho.')
            : t('Weka Kituo cha Duka kwenye kompyuta hii, na simu na kompyuta nyingine za duka zitasawazisha nayo kupitia wifi — hata bila intaneti. Ni programu ndogo isiyo na dirisha: kila kitu chake kinaonekana hapa.')}
        </p>

        {presence === 'blocked' && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2 leading-snug">
            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
            {t('Chrome imezuia ukurasa huu kuwasiliana na Kituo cha Duka kwenye kompyuta hii. Bonyeza alama iliyo kushoto ya anwani ya tovuti (juu kabisa), fungua "Site settings", ruhusu "Local network access", kisha jaribu tena.')}
          </p>
        )}
        {presence === 'other_site' && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2 leading-snug">
            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
            {t('Kituo cha Duka kilichowekwa kwenye kompyuta hii ni cha tovuti nyingine ya Venics Sales. Pakua na uweke cha tovuti hii.')}
          </p>
        )}

        {closed && (
          <a
            href={KITUO_OPEN_LINK}
            onClick={opened}
            className="mt-3 w-full flex items-center justify-center gap-1.5 bg-emerald-600 text-white text-sm font-bold px-3 py-3 rounded-xl active:scale-95 transition-all cursor-pointer"
          >
            <ExternalLink className="w-4 h-4" />
            {t('Fungua Kituo cha Duka')}
          </a>
        )}
        {latest ? (
          <a
            href={latest.url}
            download
            onClick={download}
            data-testid="kituo-download"
            className={`mt-3 w-full flex items-center justify-center gap-1.5 text-sm font-bold px-3 py-3 rounded-xl active:scale-95 transition-all cursor-pointer ${closed ? 'bg-white border border-gray-200 text-gray-700' : 'bg-emerald-600 text-white'}`}
          >
            <Download className="w-4 h-4" />
            {t('Pakua Kituo cha Duka')}
            {latest.bytes ? <span className="font-normal opacity-80">{t('(MB {mb})', { mb: megabytes(latest.bytes) })}</span> : null}
          </a>
        ) : latest === null ? (
          <p className="mt-3 flex items-center justify-between gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 leading-snug">
            <span>{t('Haikuwezekana kupata Kituo cha Duka cha kupakua sasa. Hakikisha kuna intaneti, kisha jaribu tena.')}</span>
            <button onClick={() => { setLatest(undefined); setAskAgain(n => n + 1); }} className="shrink-0 font-bold underline cursor-pointer">
              {t('Jaribu tena')}
            </button>
          </p>
        ) : (
          <div className="mt-3 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
        )}
        {(!closed || downloaded) && <ol className="mt-3 space-y-1 text-[11px] text-gray-600 leading-snug list-decimal pl-4">
          <li>{t('Fungua faili lililopakuliwa: Chrome inalionyesha juu, upande wa kulia.')}</li>
          <li>{t('Windows ikisema "Windows protected your PC", bonyeza "More info", kisha "Run anyway". Chrome ikiuliza kama ubaki na faili, chagua "Keep".')}</li>
          <li>{t('Chrome ikiuliza ruhusa ya kuwasiliana na programu za kompyuta hii, bonyeza "Allow".')}</li>
          <li>{t('Rudi hapa: kituo kitaonekana chenyewe.')}</li>
        </ol>}

        {/* What the card is doing to find it, and what came of it. */}
        {hub.chromeAsking ? (
          <p data-testid="kituo-chrome-asking" className="mt-3 flex items-start gap-1.5 text-xs font-semibold text-blue-900 bg-blue-50 border border-blue-300 rounded-lg p-2.5 leading-snug">
            <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
            {t('Chrome inauliza ruhusa sasa: angalia kisanduku cha Chrome juu ya dirisha hili, karibu na anwani ya tovuti, kisha bonyeza "Allow".')}
          </p>
        ) : hub.finding !== 'no' ? (
          <div className="mt-3 text-xs text-gray-600">
            <p className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {hub.finding === 'installing' ? t('Inasubiri Kituo cha Duka kianze…') : t('Inatafuta Kituo cha Duka kwenye kompyuta hii…')}
            </p>
            {hub.finding === 'installing' && (
              <p className="text-[11px] text-gray-500 mt-1 leading-snug">{t('Ukishafungua faili lililopakuliwa na kukiweka, kitaonekana hapa chenyewe.')}</p>
            )}
          </div>
        ) : (
          <>
            {presence === 'refused' && (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 leading-snug">
                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                {t('Chrome iliuliza ruhusa ya kuwasiliana na Kituo cha Duka, lakini haikuruhusiwa. Bonyeza "Tafuta tena", na Chrome ikiuliza, bonyeza "Allow".')}
              </p>
            )}
            {hub.notFound && presence === 'absent' && (
              <div data-testid="kituo-not-found" className="mt-3 text-[11px] text-gray-700 bg-white border border-gray-200 rounded-lg p-2.5 leading-snug">
                <p className="font-semibold text-gray-800">{t('Kituo cha Duka hakijapatikana kwenye kompyuta hii.')}</p>
                <ul className="mt-1 space-y-0.5 list-disc pl-4">
                  <li>{t('Kama hakijawekwa: kipakue hapo juu, kisha ukiweke.')}</li>
                  <li>{t('Kama kimewekwa: kifungue — Start, kisha "Venics Kituo cha Duka".')}</li>
                  <li>{t('Chrome ikiuliza ruhusa ya kuwasiliana na programu za kompyuta hii, bonyeza "Allow".')}</li>
                </ul>
              </div>
            )}
            <button
              onClick={() => hub.lookFor('search')}
              data-testid="kituo-look"
              className="mt-3 w-full flex items-center justify-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-bold px-3 py-2.5 rounded-xl active:scale-95 transition-all cursor-pointer"
            >
              <Search className="w-4 h-4" />
              {tried ? t('Tafuta tena') : t('Tafuta Kituo cha Duka')}
            </button>
            {presence === 'not_asked' && (
              <p className="text-[11px] text-blue-700 mt-2 leading-snug">{t('Chrome itauliza ruhusa ya kuwasiliana na programu za kompyuta hii — bonyeza "Allow".')}</p>
            )}
          </>
        )}
      </div>
    );
  }

  const run = async (action: () => Promise<KituoStatus>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      showToast(t('Kituo kimeshindwa kuanza'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const start = () => { pairWhenRunning.current = true; void run(kituo.start); };
  const replaceOld = () => { pairWhenRunning.current = true; void run(kituo.replaceOld); };
  const stop = () => showConfirm(
    t('Zima kituo'),
    t('Simu na kompyuta nyingine hazitaweza kusawazisha kupitia kompyuta hii mpaka ukiwashe tena. Taarifa zake zinabaki.'),
    () => void run(kituo.stop),
  );
  const update = boss && latest && status.appVersion && newerVersion(latest.version, status.appVersion) ? latest : null;
  const updateNote = update && (
    <p className="text-[11px] text-blue-800 bg-blue-50 border border-blue-100 rounded-lg p-2 mb-3 leading-snug flex items-center justify-between gap-2">
      <span>{t('Toleo jipya la Kituo cha Duka lipo ({version}).', { version: update.version })}</span>
      <a href={update.url} download className="shrink-0 flex items-center gap-1 font-bold text-blue-700 underline">
        <Download className="w-3.5 h-3.5" />
        {t('Pakua')}
      </a>
    </p>
  );

  if (status.state === 'off') {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 mb-3">
        {updateNote}
        <p className="text-sm font-semibold text-gray-800">{t('Kompyuta hii kama kituo')}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-snug">
          {t('Washa kituo hapa, na simu na kompyuta nyingine za duka zitasawazisha na kompyuta hii kupitia wifi — hata bila intaneti.')}
        </p>
        {boss ? (
          <button
            onClick={start}
            disabled={busy}
            className="mt-3 w-full flex items-center justify-center gap-1.5 bg-emerald-600 text-white text-sm font-bold px-3 py-3 rounded-xl active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
            {t('Washa kituo kwenye kompyuta hii')}
          </button>
        ) : (
          <p className="text-[11px] text-gray-500 mt-2">{t('Bosi akiingia anaweza kuwasha kituo hapa.')}</p>
        )}
      </div>
    );
  }

  if (status.state === 'starting') {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 mb-3 flex items-center gap-2 text-sm text-gray-600">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('Kituo kinawashwa…')}
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3">
        <p className="flex items-start gap-1.5 text-xs text-amber-800 leading-snug">
          <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
          <span>{errorText(status)}</span>
        </p>
        {status.error === 'old_hub_running' && status.blocker?.exePath && (
          <p className="text-[11px] text-amber-700 font-mono mt-1 break-all">{status.blocker.exePath}</p>
        )}
        {boss && (
          <div className="mt-3 flex flex-col gap-2">
            {status.error === 'old_hub_running' && status.blocker?.isVenicsHub && (
              <button
                onClick={replaceOld}
                disabled={busy}
                className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 text-white text-sm font-bold px-3 py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                {t('Funga kituo cha zamani, uendelee hapa')}
              </button>
            )}
            <button
              onClick={start}
              disabled={busy}
              className="w-full flex items-center justify-center gap-1.5 bg-white border border-amber-300 text-amber-800 text-xs font-bold px-3 py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              {t('Jaribu tena')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Running.
  const addresses = status.urls.length ? status.urls : [status.localUrl];
  const recent = status.events.slice(-8).reverse();
  return (
    <div className="mb-3 space-y-2">
      {updateNote}
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <p className="text-sm font-semibold text-emerald-800 flex-1">{t('Kituo kinaendelea kwenye kompyuta hii')}</p>
          <span className="text-[10px] text-emerald-700">{t('toleo {hubVersion}', { hubVersion: status.appVersion ?? status.hubVersion })}</span>
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-gray-500">{t('Namba ya kuunganisha')}</p>
            <p className="font-mono text-3xl font-bold tracking-[0.2em] text-emerald-700" data-testid="hub-pairing-code">{status.pairingCode}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500">{t('Anwani ya kuweka kwenye simu')}</p>
            {addresses.map(url => (
              <p key={url} className="font-mono text-sm text-gray-800 break-all">{url.replace(/^http:\/\//, '')}</p>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-700 mt-3 leading-snug">{t('Kwenye kila simu: Zaidi → Kituo cha Duka → weka anwani na namba hii.')}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">{t('Namba hii inafanya kazi mradi kituo hiki kikiwa kimewashwa.')}</p>
      </div>

      {status.adoptedFrom && (
        <p className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-2 leading-snug">
          {t('Inatumia taarifa za kituo cha zamani kutoka {folder} — simu zilizounganishwa nacho zinaendelea bila kuunganishwa upya.', { folder: status.adoptedFrom })}
        </p>
      )}

      <div className="text-[11px] text-blue-800 bg-blue-50 border border-blue-100 rounded-lg p-2 leading-snug space-y-1">
        <p>{t('Windows ikiuliza ruhusa ya mtandao, chagua "Private networks" kisha Allow.')}</p>
        <p>{t('Kituo kinaendelea hata ukifunga Venics Sales, ili simu ziendelee kusawazisha.')}</p>
      </div>

      {!pairedHere && ourShop && (
        <button
          onClick={() => void pairThisComputer()}
          disabled={pairing}
          className="w-full flex items-center justify-center gap-1.5 bg-blue-600 text-white text-sm font-bold px-3 py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
        >
          {pairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {t('Unganisha kompyuta hii na kituo')}
        </button>
      )}
      {status.shopId && user?.shopId && status.shopId !== user.shopId && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          {t('Kituo kwenye kompyuta hii ni cha duka lingine, kwa hiyo akaunti hii haiwezi kukitumia.')}
        </p>
      )}

      <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-xs text-gray-600 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-gray-400">{t('Taarifa zinahifadhiwa')}</p>
            <p className="font-mono break-all">{status.dataDir}</p>
          </div>
          <button
            onClick={() => void kituo.openDataFolder().catch(() => {})}
            className="shrink-0 flex items-center gap-1 bg-white border border-gray-200 text-gray-700 font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t('Fungua folda')}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="leading-snug">{t('Washa kituo kila Windows ikiwashwa')}</p>
          <button
            role="switch"
            aria-checked={status.autostart}
            disabled={!boss}
            onClick={() => void kituo.setAutostart(!status.autostart).catch(() => {})}
            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-60 ${status.autostart ? 'bg-emerald-600' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${status.autostart ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-1">{t('Shughuli za kituo')}</h3>
          <ul className="border border-gray-100 rounded-xl divide-y divide-gray-100 overflow-hidden">
            {recent.map((e, i) => (
              <li key={`${e.at}-${i}`} className="px-3 py-2 text-[11px] text-gray-600 bg-white">
                <span className="font-mono text-gray-400 mr-1.5">{clock(e.at)}</span>
                {eventText(e)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {boss && (
        <button
          onClick={stop}
          disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-bold px-3 py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
        >
          <Power className="w-4 h-4" />
          {t('Zima kituo')}
        </button>
      )}
    </div>
  );
}
