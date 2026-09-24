import { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Lock, Eye, EyeOff, CheckCircle, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if we have a session (Supabase handles the redirect token automatically)
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // If no session, they might have accessed this page directly without a link
        // Or the link expired.
        // We can't do much here except redirect them back or show an error.
      }
    };
    checkSession();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (password.length < 6) {
      setError('Nenosiri lazima liwe na angalau herufi 6.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Nenosiri ulizoingiza hazifanani.');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;

      setSuccess(true);
      // Wait 3 seconds then redirect to login
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err: any) {
      console.error('Update password error:', err);
      setError(err.message || 'Kuna tatizo limetokea wakati wa kubadili nenosiri.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-sm text-center">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Lock className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Badili Nenosiri</h1>
        <p className="text-gray-500 mb-8 text-sm">Ingiza nenosiri lako jipya hapa chini.</p>

        {success ? (
          <div className="space-y-6">
            <div className="p-4 bg-green-50 border border-green-100 rounded-2xl text-green-700 text-sm flex items-start text-left">
              <CheckCircle className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
              <p>Nenosiri lako limebadilishwa kwa mafanikio! Unahamishiwa kwenye ukurasa wa kuingia...</p>
            </div>
            <button 
              onClick={() => navigate('/login')}
              className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-md flex items-center justify-center"
            >
              Ingia Sasa <ArrowRight className="w-4 h-4 ml-2" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <div className="relative text-left">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 ml-1">Nenosiri Jipya</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Nenosiri Jipya"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="relative text-left">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 ml-1">Thibitisha Nenosiri</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Thibitisha Nenosiri"
                  required
                />
              </div>
            </div>

            {error && (
              <p className="text-red-500 text-sm mt-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={!password || !confirmPassword || loading}
              className="w-full bg-blue-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-md transition-colors mt-4"
            >
              {loading ? 'Inabadilisha...' : 'Badili Nenosiri'}
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 text-xs text-gray-500 text-center">
        Made by Venics Software Company
      </p>
    </div>
  );
}
