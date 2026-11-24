import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Store, ArrowRight, Loader2, Users, RefreshCw, Share2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../supabase';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { db } from '../db';
import { nowIso } from '../services/clock';
import { claimShopInvitation } from '../services/authFlow';
import { bossMessage, changeSignupRole, forgetSignupRole, getSignupRole, rememberSignupRole, shareWithBoss, type SignupRole } from '../services/staffJoin';
import { formatTzPhone } from '../utils/phone';


import { t } from '../i18n';
export default function SetupShop() {
  const { user, setAuth, token } = useStore();
  const navigate = useNavigate();
  const [shopName, setShopName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isEmployeeMode, setIsEmployeeMode] = useState(false);
  // What they said at sign-up (services/staffJoin.ts): staff wait for their
  // boss and never see shop setup unless they say they are the owner after all.
  const [intent, setIntent] = useState<SignupRole | null>(null);
  const [confirmBoss, setConfirmBoss] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [joined, setJoined] = useState<{ shopName: string; user: any } | null>(null);
  // Nothing is shown until the answer is read, so staff never glimpse shop setup.
  const [intentKnown, setIntentKnown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSignupRole().then(role => {
      if (cancelled) return;
      setIntent(role);
      if (role === 'employee') setIsEmployeeMode(true);
    }).finally(() => { if (!cancelled) setIntentKnown(true); });
    return () => { cancelled = true; };
  }, []);

  // If the user gets a shop assigned remotely, navigate them to the dashboard
  useEffect(() => {
    if (user?.shop_id) {
      navigate('/');
    }
  }, [user?.shop_id, navigate]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !token) return;
    
    setError('');
    setLoading(true);

    try {
      // 1. The shop. One this account has already created is used again
      //    rather than making another: an earlier attempt that failed at
      //    step 2 left it behind, and the first shop an owner creates holds
      //    their one free trial — a new one would open without it.
      const { data: earlier } = await supabase
        .from('shops')
        .select('id, created_at')
        .eq('created_by', user.id)
        .order('created_at', { ascending: true })
        .limit(1);
      const reuse = earlier?.[0];
      const shopId: string = reuse?.id ?? uuidv4();

      const shopData = {
        id: shopId,
        name: shopName.trim(),
        status: 'active' as 'active',
        owner_name: user.name || user.email?.split('@')[0] || 'Bosi',
        created_by: user.id,
        enable_expiry: false,
        created_at: reuse?.created_at ?? nowIso(),
        updated_at: nowIso(),
        isDeleted: 0,
        synced: 1
      };

      if (reuse) {
        // The name typed this time. Not worth failing the setup over.
        await supabase.from('shops').update({ name: shopData.name, updated_at: shopData.updated_at }).eq('id', shopId);
      } else {
        const { error: shopError } = await supabase
          .from('shops')
          .insert({
            id: shopData.id,
            name: shopData.name,
            status: shopData.status,
            owner_name: shopData.owner_name,
            created_by: shopData.created_by,
            enable_expiry: shopData.enable_expiry,
            created_at: shopData.created_at,
            updated_at: shopData.updated_at
          });

        if (shopError) {
          // 20261117_staff_signup.sql: an account that signed up as staff.
          if ((shopError as any).hint === 'staff_signup') {
            throw new Error(t('Akaunti hii ilisajiliwa kama ya mfanyakazi, kwa hiyo haiwezi kufungua duka. Muombe bosi wako akualike kwa namba yako ya simu.'));
          }
          throw shopError;
        }
      }

      // Save locally too so it's available immediately
      await db.shops.put(shopData);

      // 2. Point the account at the shop — and check the server really did.
      //    A refusal here is silent (no rows change, no error), and believing
      //    it is what sent new accounts round "Jina la duka" again and again
      //    (see supabase/migrations/20261014_first_shop_setup.sql).
      const { data: saved, error: userError } = await supabase
        .from('users')
        .update({
          shop_id: shopId,
          role: 'boss',
          updated_at: nowIso()
        })
        .eq('id', user.id)
        .select('shop_id');

      if (userError) throw userError;
      if (saved?.[0]?.shop_id !== shopId) {
        throw new Error(t('Duka "{name}" limehifadhiwa, lakini halikuweza kuunganishwa na akaunti yako. Jaribu tena baadaye, au piga simu 0787979273 kwa msaada.', { name: shopData.name }));
      }

      // 3. Grant 14-day free trial on the server (idempotent — safe to call multiple times)
      try {
        const { error: licenseError } = await supabase.functions.invoke('init-license');
        if (licenseError) console.warn('[SetupShop] License init warning:', licenseError);
      } catch (licenseErr) {
        console.warn('[SetupShop] License init failed, will retry on next verify:', licenseErr);
      }

      // 4. Update local state
      const updatedUser = {
        ...user,
        shop_id: shopId,
        shopId: shopId,
        role: 'boss' as const,
        isActive: true,
        status: 'active' as const,
        synced: 1
      };

      await db.users.put(updatedUser as any);
      
      // Navigate BEFORE updating auth to prevent unmount from cancelling the navigation
      navigate('/executive', { replace: true });

      forgetSignupRole();
      setAuth(token, updatedUser);

      // 5. Initial sync
      SyncService.sync().catch(console.error);
    } catch (err: any) {
      console.error('Setup shop error:', err);
      setError(err.message || t('Kuna tatizo limetokea wakati wa kuandaa duka lako.'));
    } finally {
      setLoading(false);
    }
  };

  const [isChecking, setIsChecking] = useState(false);
  const checking = useRef(false);

  /**
   * Joins the shop that invited this account's confirmed number, on the
   * server (the licence guard refuses a shop-less account setting its own
   * shop_id from here). `quiet`: the automatic check, which says nothing
   * when there is no invitation yet.
   */
  const tryJoin = async (quiet: boolean) => {
    if (!user || checking.current) return;
    checking.current = true;
    if (!quiet) setIsChecking(true);
    try {
      const result = await claimShopInvitation();

      if (result?.claimed && result.user?.shop_id) {
        const updatedUser = {
          ...user,
          shop_id: result.user.shop_id,
          shopId: result.user.shop_id,
          role: result.user.role as any
        };
        await db.users.put(updatedUser as any);
        // Its name, for "Umeunganishwa na …". Not worth holding them up over.
        let shopName = '';
        try {
          const { data } = await supabase.from('shops').select('name').eq('id', result.user.shop_id).maybeSingle();
          shopName = data?.name ?? '';
        } catch { /* shown without the name */ }
        forgetSignupRole();
        setJoined({ shopName, user: updatedUser });
      } else if (quiet) {
        // Nothing yet: the next check will look again.
      } else if (result) {
        setError(user.phone
          ? t('Mwaliko bado haujapatikana. Hakikisha bosi wako amekualika kwa namba hii ya simu.')
          : t('Mwaliko bado haujapatikana. Ongeza namba yako ya simu kwanza, kisha bosi wako akualike kwa namba hiyo.'));
        setTimeout(() => setError(''), 5000);
      } else {
        setError(t('Imeshindikana kukagua sasa. Hakikisha una mtandao kisha ujaribu tena.'));
        setTimeout(() => setError(''), 5000);
      }
    } catch (err) {
      console.error('Invitation check error:', err);
    } finally {
      checking.current = false;
      if (!quiet) setIsChecking(false);
    }
  };
  const checkInvitationManual = () => tryJoin(false);

  // While waiting, look every 30 seconds — only while this screen is in
  // front and online — so the boss's invitation opens the shop within moments.
  useEffect(() => {
    if (!isEmployeeMode || joined) return;
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void tryJoin(true);
    };
    const interval = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('online', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmployeeMode, joined]);

  const enterShop = () => {
    if (!joined) return;
    navigate('/', { replace: true });
    setAuth(token!, joined.user);
  };

  /** "Mimi ni Mfanyakazi": kept with the account too, so it cannot open a shop by mistake later. */
  const becomeEmployee = () => {
    setError('');
    setIsEmployeeMode(true);
    if (intent !== 'employee') {
      setIntent('employee');
      rememberSignupRole('employee');
      void changeSignupRole('employee').catch(() => { /* offline: the server is told next time it matters */ });
    }
  };

  /** "Nimekosea, mimi ni bosi", after "are you sure". */
  const becomeBoss = async () => {
    setSwitching(true);
    setError('');
    try {
      if (intent === 'employee') await changeSignupRole('boss');
      else rememberSignupRole('boss');
      setIntent('boss');
      setConfirmBoss(false);
      setIsEmployeeMode(false);
    } catch (err: any) {
      setError(err?.message || t('Imeshindikana kubadilisha. Hakikisha una mtandao kisha ujaribu tena.'));
    } finally {
      setSwitching(false);
    }
  };

  const shownPhone = user?.phone ? formatTzPhone(user.phone) : (user?.email || '');

  if (!intentKnown) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (joined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md text-center" data-testid="joined">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">{t('Umeunganishwa!')}</h1>
          <p className="text-gray-600 mb-8 leading-relaxed">
            {joined.shopName
              ? t('Sasa wewe ni mfanyakazi wa "{shop}".', { shop: joined.shopName })
              : t('Sasa wewe ni mfanyakazi wa duka la bosi wako.')}
          </p>
          <button
            onClick={enterShop}
            className="w-full bg-green-600 text-white font-bold py-4 rounded-2xl shadow-lg flex items-center justify-center gap-2"
          >
            {t('Anza Kazi')}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  if (isEmployeeMode) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md text-center" data-testid="waiting">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            {isChecking ? <Loader2 className="w-10 h-10 animate-spin" /> : <Users className="w-10 h-10" />}
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('Unasubiri Mwaliko...')}</h1>
          <p className="text-gray-600 mb-1">{t('Bosi wako akualike kwa namba hii:')}</p>
          <p className="text-2xl font-extrabold text-blue-700 mb-6 tracking-wide" data-testid="waiting-phone">{shownPhone}</p>

          <ol className="text-left text-sm text-gray-700 space-y-2 mb-6 bg-gray-50 rounded-2xl p-4">
            <li className="flex gap-2"><span className="font-bold text-green-700">1.</span>{t('Mtumie bosi wako namba yako (kitufe cha kijani hapa chini).')}</li>
            <li className="flex gap-2"><span className="font-bold text-green-700">2.</span>{t('Bosi wako aende: Zaidi → Wafanyakazi → Ongeza, na aandike namba yako.')}</li>
            <li className="flex gap-2"><span className="font-bold text-green-700">3.</span>{t('Programu itajifungua yenyewe ndani ya sekunde chache.')}</li>
          </ol>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs" role="alert">
              {error}
            </div>
          )}

          <button
            onClick={() => { void shareWithBoss(bossMessage(user?.phone)).catch(() => {}); }}
            className="w-full bg-green-600 text-white font-bold py-4 rounded-2xl shadow-lg flex items-center justify-center gap-2 mb-3"
            data-testid="share-boss"
          >
            <Share2 className="w-5 h-5" />
            {t('Mtumie bosi wako ujumbe')}
          </button>

          <button
            onClick={checkInvitationManual}
            disabled={isChecking}
            className="w-full bg-white border-2 border-blue-600 text-blue-700 disabled:opacity-50 font-bold py-3 rounded-2xl flex items-center justify-center gap-2 mb-6"
          >
            {isChecking ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
            {t('Kagua Mwaliko Sasa')}
          </button>

          {confirmBoss ? (
            <div className="text-left rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="confirm-boss">
              <p className="text-sm font-bold text-amber-900 mb-1">{t('Una uhakika wewe ni mmiliki?')}</p>
              <p className="text-xs text-amber-800 mb-3 leading-relaxed">
                {t('Utafungua biashara mpya yako mwenyewe. Kama wewe ni mfanyakazi, usifanye hivi: subiri bosi wako akualike, na utaingia kwenye duka lake.')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setConfirmBoss(false)} disabled={switching} className="py-3 rounded-xl bg-white border border-amber-200 text-sm font-bold text-gray-700">
                  {t('Hapana, nitasubiri')}
                </button>
                <button onClick={becomeBoss} disabled={switching} className="py-3 rounded-xl bg-amber-600 text-white text-sm font-bold flex items-center justify-center gap-1">
                  {switching && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('Ndiyo, mimi ni bosi')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setConfirmBoss(true); setError(''); }}
              className="text-gray-500 font-medium underline text-sm"
            >
              {t('Nimekosea, mimi ni bosi (nafungua biashara)')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md text-center">
        <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Store className="w-10 h-10" />
        </div>
        
        <h1 className="text-3xl font-bold text-blue-600 mb-2">{t('Venics Sales')}</h1>
        <p className="text-gray-500 mb-8">{t('Karibu! Hebu tuanzishe duka lako la kwanza.')}</p>

        <form onSubmit={handleSetup} className="space-y-6">
          <div className="text-left">
            <label className="block text-sm font-medium text-gray-700 mb-2 ml-1">
              {t('Jina la Duka Lako')}
            </label>
            <div className="relative">
              <Store className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input 
                type="text" 
                value={shopName}
                onChange={e => setShopName(e.target.value)}
                className="w-full pl-12 pr-4 py-4 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                placeholder={t('Mfano: Juma General Store')}
                required
                autoFocus
              />
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={!shopName.trim() || loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2 group"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t('Inapakia...')}
              </>
            ) : (
              <>
                {t('Anza Sasa')}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-100">
          <p className="text-sm text-gray-500 mb-1">{t('Wewe ni mfanyakazi na sio mmiliki wa duka?')}</p>
          <p className="text-xs text-gray-400 mb-3">{t('Mfanyakazi hafungui duka: bosi wake humwalika kwa namba yake ya simu.')}</p>
          <button
            onClick={becomeEmployee}
            className="w-full py-3 bg-green-50 border border-green-200 text-green-800 font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Users className="w-4 h-4" />
            {t('Mimi ni Mfanyakazi')}
          </button>
        </div>
      </div>
    </div>
  );
}
