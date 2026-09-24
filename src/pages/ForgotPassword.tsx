import { useState } from 'react';
import { supabase } from '../supabase';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: 'Tumekutumia barua pepe yenye maelekezo ya kubadili nenosiri lako. Tafadhali angalia email yako.'
      });
    } catch (err: any) {
      console.error('Reset password error:', err);
      setMessage({
        type: 'error',
        text: err.message || 'Kuna tatizo limetokea. Tafadhali jaribu tena.'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-sm text-center">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Mail className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Nimesahau Nenosiri</h1>
        <p className="text-gray-500 mb-8 text-sm">Ingiza barua pepe yako ili kupokea link ya kubadili nenosiri.</p>

        {message?.type === 'success' ? (
          <div className="space-y-6">
            <div className="p-4 bg-green-50 border border-green-100 rounded-2xl text-green-700 text-sm flex items-start text-left">
              <CheckCircle className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
              <p>{message.text}</p>
            </div>
            <Link 
              to="/login" 
              className="block w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-md"
            >
              Rudi Kwenye Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleResetRequest} className="space-y-4">
            <div className="relative text-left">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 ml-1">Barua Pepe</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="mfano@email.com"
                  required
                />
              </div>
            </div>

            {message?.type === 'error' && (
              <p className="text-red-500 text-sm mt-2">{message.text}</p>
            )}

            <button
              type="submit"
              disabled={!email || loading}
              className="w-full bg-blue-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-md transition-colors mt-4"
            >
              {loading ? 'Inatuma...' : 'Tuma Link'}
            </button>

            <Link 
              to="/login" 
              className="flex items-center justify-center text-sm text-gray-500 font-bold hover:text-blue-600 mt-6"
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Rudi Kwenye Login
            </Link>
          </form>
        )}
      </div>
      <p className="mt-6 text-xs text-gray-500 text-center">
        Made by Venics Software Company
      </p>
    </div>
  );
}
