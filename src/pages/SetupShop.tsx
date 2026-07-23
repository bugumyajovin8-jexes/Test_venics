import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Store, ArrowRight, Loader2, Users, RefreshCw } from 'lucide-react';
import { supabase } from '../supabase';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { db } from '../db';
import VenicsLogo from '../components/VenicsLogo';

export default function SetupShop() {
  const { user, setAuth, token } = useStore();
  const navigate = useNavigate();
  const [shopName, setShopName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isEmployeeMode, setIsEmployeeMode] = useState(false);

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
      const shopId = uuidv4();

      // 1. Create the Shop
      const shopData = {
        id: shopId,
        name: shopName.trim(),
        status: 'active' as 'active',
        owner_name: user.name || user.email.split('@')[0],
        created_by: user.id,
        enable_expiry: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 1
      };

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

      if (shopError) throw shopError;

      // Save locally too so it's available immediately
      await db.shops.put(shopData);

      // 2. Update User Profile with the new shop_id
      const { error: userError } = await supabase
        .from('users')
        .update({
          shop_id: shopId,
          role: 'boss',
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (userError) throw userError;

      // 3. Initialize 14-day free trial via Edge Function (idempotent — safe to retry)
      try {
        const { error: licenseError } = await supabase.functions.invoke('init-license');
        if (licenseError) console.warn('[SetupShop] License init warning:', licenseError);
      } catch (licenseErr) {
        // Non-fatal: LicenseGuard will call init-license again when user hits "Hakiki Huduma"
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

      setAuth(token, updatedUser);

      // 5. Initial sync
      SyncService.sync().catch(console.error);
    } catch (err: any) {
      console.error('Setup shop error:', err);
      setError(err.message || 'Kuna tatizo limetokea wakati wa kuandaa duka lako.');
    } finally {
      setLoading(false);
    }
  };

  const [isChecking, setIsChecking] = useState(false);

  const checkInvitationManual = async () => {
    if (!user?.email || isChecking) return;
    setIsChecking(true);
    try {
      const { data: invitation, error } = await supabase
        .from('shop_invitations')
        .select('*')
        .eq('email', user.email.toLowerCase())
        .maybeSingle();

      if (invitation) {
        // Update user profile
        const { error: updateError } = await supabase
          .from('users')
          .update({
            shop_id: invitation.shop_id,
            role: invitation.role
          })
          .eq('id', user.id);

        if (!updateError) {
          await supabase.from('shop_invitations').delete().eq('id', invitation.id);
          
          const updatedUser = {
            ...user,
            shop_id: invitation.shop_id,
            shopId: invitation.shop_id,
            role: invitation.role as any
          };
          
          await db.users.put(updatedUser as any);
          
          const isUserBoss = updatedUser.role === 'boss';
          navigate(isUserBoss ? '/executive' : '/dashibodi', { replace: true });
          
          setAuth(token!, updatedUser);
        }
      } else {
        setError('Mwaliko bado haujapatikana. Hakikisha bosi wako ametumia email hii kwa usahihi.');
        setTimeout(() => setError(''), 5000);
      }
    } catch (err) {
      console.error('Manual check error:', err);
    } finally {
      setIsChecking(false);
    }
  };

  if (isEmployeeMode) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md text-center">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            {isChecking ? <Loader2 className="w-10 h-10 animate-spin" /> : <Users className="w-10 h-10" />}
          </div>
          
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Unasubiri Mwaliko...</h1>
          <p className="text-gray-600 mb-6 leading-relaxed">
            Muombe bosi wako akuongeze kwenye mfumo kwa kutumia email yako: <br/>
            <span className="font-bold text-blue-600">{user?.email}</span>
          </p>

          <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-700 text-sm mb-6">
            Pindi bosi wako atakapokuongeza, programu itajifungua yenyewe. Unaweza pia kubonyeza kitufe hapa chini kukagua sasa hivi.
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs">
              {error}
            </div>
          )}

          <button 
            onClick={checkInvitationManual}
            disabled={isChecking}
            className="w-full bg-blue-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 mb-6"
          >
            {isChecking ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
            Kagua Mwaliko Sasa
          </button>

          <button 
            onClick={() => { setIsEmployeeMode(false); setError(''); }}
            className="text-gray-500 font-medium underline"
          >
            Rudi Nyuma (Mimi ni Bosi)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <VenicsLogo size={80} animate={loading ? "loading" : "idle"} outerGradient={['#1e3a8a', '#06b6d4']} innerGradient={['#0891b2', '#1e40af']} />
        </div>
        
        <h1 className="text-3xl font-extrabold text-blue-700 tracking-tight mb-2 font-sans">Venics Sales</h1>
        <p className="text-gray-500 mb-8 font-medium">Karibu! Hebu tuanzishe duka lako la kwanza.</p>

        <form onSubmit={handleSetup} className="space-y-6">
          <div className="text-left">
            <label className="block text-sm font-medium text-gray-700 mb-2 ml-1">
              Jina la Duka Lako
            </label>
            <div className="relative">
              <Store className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input 
                type="text" 
                value={shopName}
                onChange={e => setShopName(e.target.value)}
                className="w-full pl-12 pr-4 py-4 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                placeholder="Mfano: Juma General Store"
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
            className="w-full bg-blue-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2 group"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Inapakia...
              </>
            ) : (
              <>
                Anza Sasa
                <ArrowRight className="w-5 h-5 group- transition-transform" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-100">
          <p className="text-sm text-gray-500 mb-3">Wewe ni mfanyakazi na sio mmiliki wa duka?</p>
          <button 
            onClick={() => setIsEmployeeMode(true)}
            className="w-full py-3 bg-gray-100 text-gray-700 font-bold rounded-xl transition-colors"
          >
            Mimi ni Mfanyakazi
          </button>
        </div>
      </div>
    </div>
  );
}
