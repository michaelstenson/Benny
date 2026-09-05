// This file's only job is to create ONE Supabase client and hand it out
// to whichever route needs it. Centralizing it here means every route
// imports the same configured client instead of each one re-reading
// environment variables and reconnecting.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at startup rather than mysteriously later — if these are
  // missing, every Supabase-backed route would otherwise crash on first use.
  console.warn(
    '[supabase] SUPABASE_URL or SUPABASE_ANON_KEY is missing from .env — ' +
      'database-backed routes will not work until those are set.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
