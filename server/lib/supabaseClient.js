// This file's only job is to create ONE Supabase client and hand it out
// to whichever route needs it. Centralizing it here means every route
// imports the same configured client instead of each one re-reading
// environment variables and reconnecting.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at startup rather than mysteriously later — if these are
  // missing, every Supabase-backed route would otherwise crash on first use.
  console.warn(
    '[supabase] SUPABASE_URL or SUPABASE_ANON_KEY is missing from .env — ' +
      'database-backed routes will not work until those are set.'
  );
}

// The regular client, using the "anon" key. This is the key that's safe
// to eventually ship to a browser, because Supabase's Row Level Security
// (RLS) rules decide what it's allowed to touch.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// The admin client, using the "service_role" key. This key BYPASSES Row
// Level Security completely, so it must only ever be used here in trusted
// server code — never sent to the browser. We use it for tables like
// google_tokens that hold sensitive data and intentionally have RLS
// enabled with no public policies at all, so the anon client above
// literally cannot read or write them.
export const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

if (!supabaseServiceRoleKey) {
  console.warn(
    '[supabase] SUPABASE_SERVICE_ROLE_KEY is missing from .env — ' +
      'admin-only tables (like google_tokens) will not work until it is set.'
  );
}
