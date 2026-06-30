import { createClient } from '@supabase/supabase-js';

// The Supabase URL + ANON key are public by design: in a static client build
// (PWA / Capacitor APK) there is no server to hold them at runtime, so they are
// always baked into the bundle. The real security boundary is Row Level Security
// in Supabase — NOT secrecy of the anon key. The hardcoded fallbacks below keep
// the app working if a build runs without a .env (otherwise the APK white-screens).
// NEVER put the service_role key (or any private secret) here.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rdprkqfxznajegttfsbg.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkcHJrcWZ4em5hamVndHRmc2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjkzOTYsImV4cCI6MjA5MDQ0NTM5Nn0.yX-vvx3WDNYCNDTx1GGecxYAs2IVZ_5_aLEMdfjLpYE';

if (import.meta.env.DEV && (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY)) {
  console.warn('Supabase credentials missing from environment. Using hardcoded fallbacks.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
