const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`Missing ${name}. Copy frontend/.env.example to frontend/.env and fill it in.`);
  return value;
};

/** Public configuration only. Secrets (AssemblyAI key, service-role key) never reach the browser. */
export const API_URL = required('VITE_API_URL', import.meta.env.VITE_API_URL).replace(/\/+$/, '');
export const SUPABASE_URL = required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY);
