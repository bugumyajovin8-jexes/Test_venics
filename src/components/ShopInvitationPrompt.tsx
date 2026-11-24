import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useStore } from '../store';
import { SUPPORT_PHONE } from '../services/shopSwitch';
import {
  dismiss, findInvitationForMe, isDismissed, joinInvitingShop, keptBecause, looksUnused, type InvitationOffer,
} from '../services/staffJoin';
import { t } from '../i18n';

const RECHECK_MS = 15 * 60_000;

/**
 * Someone who opened a shop by mistake — usually staff who signed up before
 * their boss invited them — and whose boss has now invited their number.
 * The invitation could never reach them on its own (they are already in a
 * shop), so they are asked: "Ulifungua duka kwa makosa?". "Ndiyo" removes the
 * empty shop and joins the boss's shop as staff. Never done without asking.
 *
 * Only asked of a boss whose shop has no sales on this device, and only when
 * online; the server decides whether the shop can really go
 * (supabase/migrations/20261117_staff_signup.sql).
 */
export default function ShopInvitationPrompt() {
  const user = useStore(s => s.user);
  const navigate = useNavigate();
  const [offer, setOffer] = useState<InvitationOffer | null>(null);
  const [step, setStep] = useState<'ask' | 'confirm' | 'done'>('ask');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const owner = user?.role === 'boss' || (user?.role as string) === 'admin';

  useEffect(() => {
    if (!user?.id || !user.shop_id || !owner) return;
    let cancelled = false;
    const check = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (!(await looksUnused())) return;
      const found = await findInvitationForMe();
      if (cancelled || !found || isDismissed(found.invitation_id)) return;
      if (found.own_shop.id !== useStore.getState().user?.shop_id) return;
      setOffer(found);
      setStep('ask');
      setError('');
    };
    // After start-up has settled, then now and again.
    const first = setTimeout(check, 4_000);
    const interval = setInterval(check, RECHECK_MS);
    window.addEventListener('online', check);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(interval);
      window.removeEventListener('online', check);
    };
  }, [user?.id, user?.shop_id, owner]);

  if (!offer) return null;

  const shop = offer.shop_name;
  const own = offer.own_shop.name;
  const c = offer.check;

  const close = () => {
    if (step !== 'done') dismiss(offer.invitation_id);
    setOffer(null);
  };

  const join = async () => {
    setBusy(true);
    setError('');
    try {
      await joinInvitingShop(offer);
      setStep('done');
    } catch (err: any) {
      setError(err?.message || t('Imeshindikana kujiunga kwa sasa. Piga simu {SUPPORT_PHONE} kwa msaada.', { SUPPORT_PHONE }));
    } finally {
      setBusy(false);
    }
  };

  const done = () => {
    setOffer(null);
    navigate('/', { replace: true });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" data-testid="invite-prompt">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {step === 'done' ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">{t('Karibu {shop}!', { shop })}</h2>
            <p className="text-sm text-gray-600 mb-6">{t('Sasa wewe ni mfanyakazi wa "{shop}". Bidhaa na rekodi za duka zinapakuliwa.', { shop })}</p>
            <button onClick={done} className="w-full bg-green-600 text-white font-bold py-4 rounded-2xl">{t('Anza Kazi')}</button>
          </div>
        ) : step === 'confirm' ? (
          <div data-testid="invite-confirm">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-12 h-12 shrink-0 rounded-full bg-red-100 text-red-600 flex items-center justify-center"><AlertTriangle className="w-6 h-6" /></span>
              <h2 className="text-lg font-bold text-gray-900">{t('Thibitisha')}</h2>
            </div>
            <p className="text-sm text-gray-700 mb-2">{t('Duka "{own}" litafutwa kabisa, pamoja na:', { own })}</p>
            <ul className="text-sm text-gray-700 mb-3 list-disc pl-6">
              {c.products > 0 && <li>{t('bidhaa {n}', { n: c.products })}</li>}
              {c.records > 0 && <li>{t('rekodi nyingine {n}', { n: c.records })}</li>}
              {c.products === 0 && c.records === 0 && <li>{t('hakuna bidhaa wala rekodi')}</li>}
            </ul>
            <p className="text-sm text-gray-700 mb-5">{t('Kisha utaingia kwenye "{shop}" kama mfanyakazi, kwa akaunti hii hii na nenosiri lile lile.', { shop })}</p>
            {error && <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm" role="alert">{error}</div>}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setStep('ask'); setError(''); }} disabled={busy} className="py-3 rounded-xl border border-gray-200 font-bold text-gray-700">{t('Rudi')}</button>
              <button onClick={join} disabled={busy} className="py-3 rounded-xl bg-red-600 text-white font-bold flex items-center justify-center gap-2" data-testid="invite-join">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {busy ? t('Inaunganisha...') : t('Futa na ujiunge')}
              </button>
            </div>
          </div>
        ) : (
          <div data-testid="invite-ask">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-12 h-12 shrink-0 rounded-full bg-green-100 text-green-600 flex items-center justify-center"><Users className="w-6 h-6" /></span>
              <h2 className="text-lg font-bold text-gray-900">{t('Umealikwa na {shop}', { shop })}</h2>
            </div>
            <p className="text-sm text-gray-700 mb-3">{t('Biashara ya "{shop}" imekualika ujiunge nayo kama mfanyakazi, kwa namba yako ya simu.', { shop })}</p>
            {c.can_switch ? (
              <>
                <p className="text-sm font-bold text-gray-900 mb-5">{t('Je, ulifungua duka "{own}" kwa makosa?', { own })}</p>
                <button onClick={() => setStep('confirm')} className="w-full bg-green-600 text-white font-bold py-4 rounded-2xl mb-2" data-testid="invite-yes">
                  {t('Ndiyo, jiunge na {shop}', { shop })}
                </button>
                <button onClick={close} className="w-full py-3 rounded-2xl border border-gray-200 font-bold text-gray-700" data-testid="invite-no">
                  {t('Hapana, hili ni duka langu')}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-700 mb-5">
                  {t('Duka lako "{own}" {why}, kwa hiyo haliwezi kufutwa kutoka hapa. Kama ulilifungua kwa makosa, piga simu {SUPPORT_PHONE}.', { own, why: keptBecause(c.reasons), SUPPORT_PHONE })}
                </p>
                <button onClick={close} className="w-full py-3 rounded-2xl bg-gray-900 text-white font-bold">{t('Sawa')}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
