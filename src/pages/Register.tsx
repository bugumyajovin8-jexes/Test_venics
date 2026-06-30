import { useState } from 'react';
import { useStore } from '../store';
import { Lock, Mail, Store, Eye, EyeOff, User } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import VenicsLogo from '../components/VenicsLogo';

export default function Register() {
  const setAuth = useStore(state => state.setAuth);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (password !== confirmPassword) {
      setError('Nenosiri halilingani. Tafadhali hakiki tena.');
      setLoading(false);
      return;
    }

    try {
      // 1. Sign up with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          throw new Error('Barua pepe hii tayari imeshasajiliwa. Tafadhali jaribu kuingia (Login).');
        }
        throw authError;
      }
      if (!authData.user) throw new Error('Usajili umeshindikana: Mtumiaji hakuweza kutengenezwa.');

      // Check if session exists (Supabase might require email confirmation)
      if (!authData.session) {
        setSuccess('Hongera! Akaunti imetengenezwa. Tafadhali angalia barua pepe yako (email) na ubonyeze link ya kuthibitisha akaunti yako kabla ya kuingia.');
        setLoading(false);
        return;
      }

      const token = authData.session.access_token;

      // 2. Check for invitations
      const { data: invitation } = await supabase
        .from('shop_invitations')
        .select('*')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      // 3. Create user profile in 'users' table (using upsert to handle trigger race condition)
      const { error: insertError } = await supabase
        .from('users')
        .upsert({
          id: authData.user.id,
          email: authData.user.email || email,
          name: name.trim() || email.split('@')[0],
          role: invitation?.role || null,
          shop_id: invitation?.shop_id || null,
          status: 'active',
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        
      if (insertError && !insertError.message.includes('duplicate key')) {
        console.error('Profile insert error:', insertError);
        throw new Error('Akaunti yako ya siri imetengenezwa, lakini kuna tatizo kuhifadhi wasifu wako. Tafadhali jaribu "Kuingia" (Login) badala ya kusajili tena.');
      }

      // Local user
      const localUser = {
        id: authData.user.id,
        email: authData.user.email || email,
        name: name.trim() || email.split('@')[0],
        role: (invitation?.role || null) as any,
        shop_id: invitation?.shop_id || undefined,
        status: 'active' as const,
        isActive: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 1
      };

      // 4. Delete invitation if it existed
      if (invitation) {
        await supabase.from('shop_invitations').delete().eq('id', invitation.id);
      }

      // Navigate BEFORE setting auth State so that component is mounted
      const isUserBoss = localUser.role === 'admin' || localUser.role === 'boss';
      if (localUser.shop_id) {
          navigate(isUserBoss ? '/executive' : '/', { replace: true });
      } else {
          navigate('/setup-shop', { replace: true });
      }

      setAuth(token, localUser);
      
    } catch (err: any) {
      console.error('Registration error details:', err);
      let errorMessage = err.message || 'Kuna tatizo limetokea wakati wa usajili';
      if (errorMessage.includes('Failed to fetch')) {
        errorMessage = 'Kushindwa kuunganishwa na Supabase. Tafadhali hakikisha Supabase URL na Anon Key zimepangwa kwa usahihi katika mazingira yako (Environment Variables).';
      }
      setError(errorMessage);
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
        <p className="text-gray-500 mb-8 font-medium">Anza sasa! Fungua akaunti yako ya biashara.</p>
        
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="text" 
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Jina Kamili"
              required
            />
          </div>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="email" 
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Barua Pepe (Email)"
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
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
              className="w-full pl-12 pr-12 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Thibitisha Nenosiri"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
            >
              {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
          {success && <p className="text-green-600 text-sm mt-2 bg-green-50 p-3 rounded-xl border border-green-200">{success}</p>}
          
          <button 
            type="submit" 
            disabled={!email || !password || !confirmPassword || loading}
            className="w-full bg-blue-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-md transition-colors mt-4 flex items-center justify-center gap-2"
          >
            {loading && <VenicsLogo size={20} animate="loading" outerGradient={['#ffffff', '#06b6d4']} innerGradient={['#22d3ee', '#ffffff']} />}
            {loading ? 'Inapakia...' : 'Jisajili'}
          </button>
          
          <p className="mt-4 text-xs text-gray-500">
            By signing up you agree to our{' '}
            <a href="https://legal-peach-five.vercel.app" target="_blank" rel="noopener noreferrer" className="text-blue-600">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="https://legal-peach-five.vercel.app" target="_blank" rel="noopener noreferrer" className="text-blue-600">
              Privacy Policy
            </a>
          </p>
        </form>

        <div className="mt-6 text-sm text-gray-600">
          Tayari una akaunti?{' '}
          <Link to="/" className="text-blue-600 font-bold">
            Ingia hapa
          </Link>
        </div>
      </div>
    </div>
  );
}
