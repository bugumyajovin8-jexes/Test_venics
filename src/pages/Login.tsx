import { useState } from 'react';
import { useStore } from '../store';
import { Lock, Mail, Store, Eye, EyeOff } from 'lucide-react';
import { SyncService } from '../services/sync';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import VenicsLogo from '../components/VenicsLogo';

export default function Login() {
  const setAuth = useStore(state => state.setAuth);
  const authError = useStore(state => state.authError);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const displayError = error || authError;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        if (authError.message.includes('Email not confirmed')) {
          throw new Error('Barua pepe yako bado haijathibitishwa. Tafadhali angalia email yako na ubonyeze link ya kuthibitisha kabla ya kuingia.');
        }
        if (authError.message.includes('Invalid login credentials')) {
          throw new Error('Barua pepe au nenosiri si sahihi. Tafadhali jaribu tena.');
        }
        throw authError;
      }
      
      if (!authData.user) throw new Error('Kushindwa kuingia: Mtumiaji hakupatikana.');

      // Fetch user profile
      let { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (userError) {
        console.error('User fetch error:', userError);
        // If it's a technical error (like RLS recursion), we want to be clear
        if (userError.message.includes('recursion') || userError.code === '42P17') {
          throw new Error('Kuna tatizo la kiufundi kwenye database (Recursion). Tafadhali wasiliana na msaada wa kiufundi.');
        }
        throw new Error('Kuna tatizo la kiufundi wakati wa kutafuta akaunti yako. Tafadhali jaribu tena.');
      }

      // SELF-HEALING: If user exists in Auth but not in 'users' table, create the profile now
      if (!userData) {
        console.log('Profile missing, attempting to create one...');
        const { data: newProfile, error: createError } = await supabase
          .from('users')
          .upsert({
            id: authData.user.id,
            email: authData.user.email || email,
            name: email.split('@')[0],
            role: null, // Don't assume boss anymore, let them go to setup-shop if no role
            status: 'active',
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' })
          .select()
          .maybeSingle();
          
        if (createError && !createError.message.includes('duplicate key')) {
          console.error('Failed to self-heal profile:', createError);
          throw new Error('Akaunti yako haijakamilika na imeshindikana kuitengeneza. Tafadhali wasiliana na msimamizi wako.');
        }
        
        if (!newProfile) {
          // If upsert worked but didn't return data (due to conflict), fetch again
          const { data: retryData } = await supabase
            .from('users')
            .select('*')
            .eq('id', authData.user.id)
            .maybeSingle();
          userData = retryData;
        } else {
          userData = newProfile;
        }
      }

      if (!userData) {
        throw new Error('Akaunti yako haijakamilika. Tafadhali wasiliana na msimamizi wako.');
      }

      if (userData.role === 'superadmin')
        throw new Error('Programu hii haifai kwa superadmin. Tumia programu maalum ya usimamizi wa Venics.');

      if (userData.status === 'blocked')
        throw new Error('Akaunti yako imezuiwa (Blocked). Tafadhali wasiliana na msimamizi wako ili kufunguliwa.');

      if (userData.status !== 'active')
        throw new Error('Akaunti yako haijaruhusiwa kutumika. Tafadhali wasiliana na msimamizi wako.');

      const token = authData.session?.access_token || '';
      const refreshToken = authData.session?.refresh_token || '';
      
      const localUser = {
        id: userData.id,
        email: authData.user.email || email,
        name: userData.name,
        role: userData.role,
        shop_id: userData.shop_id,
        shopId: userData.shop_id,
        status: userData.status,
        isActive: true,
        created_at: userData.created_at,
        updated_at: userData.updated_at,
        isDeleted: 0,
        synced: 1
      };
      
      // Navigate BEFORE setting auth State so that component is mounted
      const isUserBoss = localUser.role === 'boss';
      if (localUser.shop_id) {
          navigate(isUserBoss ? '/executive' : '/', { replace: true });
      } else {
          navigate('/setup-shop', { replace: true });
      }

      setAuth(token, localUser, refreshToken);

      if (userData.shop_id) {
        setTimeout(() => {
          SyncService.logAction('login', { method: 'email', platform: 'web' });
        }, 500);
      }

      SyncService.sync().catch(err => console.error('Login sync failed:', err));

    } catch (err: any) {
      console.error('Login error details:', err);
      let errorMessage = err.message || 'Kuna tatizo limetokea wakati wa kuingia';
      if (errorMessage.includes('Failed to fetch')) {
        errorMessage = 'Inaonekana upo Offline.';
      }
      setError(errorMessage);
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">

      <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-sm text-center">
        <div className="mb-6 flex justify-center">
          <VenicsLogo size={80} animate={loading ? "loading" : "idle"} outerGradient={['#1e3a8a', '#06b6d4']} innerGradient={['#0891b2', '#1e40af']} />
        </div>
        <h1 className="text-3xl font-extrabold text-blue-700 tracking-tight mb-2 font-sans">Venics Sales</h1>
        <p className="text-gray-500 mb-8 font-medium">Karibu kwenye mfumo wako wa uuzaji bora na salama.</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Barua pepe (Email)"
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              className="w-full pl-12 pr-12 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Nenosiri (Password)"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          <div className="flex justify-end">
            <Link 
              to="/forgot-password" 
              className="text-xs font-bold text-blue-600"
            >
              Nimesahau nenosiri?
            </Link>
          </div>

          {displayError && <p className="text-red-500 text-sm mt-2">{displayError}</p>}

          <button
            type="submit"
            disabled={!email || !password || loading}
            className="w-full bg-blue-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-md transition-colors mt-4 flex items-center justify-center gap-2"
          >
            {loading && <VenicsLogo size={20} animate="loading" outerGradient={['#ffffff', '#06b6d4']} innerGradient={['#22d3ee', '#ffffff']} />}
            {loading ? 'Inapakia...' : 'Ingia'}
          </button>
        </form>

        <div className="mt-6 text-sm text-gray-600">
          Huna akaunti?{' '}
          <Link to="/register" className="text-blue-600 font-bold">
            Jisajili hapa
          </Link>
        </div>
      </div>

      {/* ✅ ADDED FOOTER TEXT HERE */}
      <p className="mt-6 text-xs text-gray-500 text-center">
        Made by Venics Software Company
      </p>

    </div>
  );
}