// Reads and writes the single row in resideo_tokens. Unlike google_tokens,
// there's only ever one row here (id = 'household') — Resideo connects
// once for the whole house, not per-person, since there's one thermostat
// account either Michael or Mer sets up. Uses supabaseAdmin since this
// table holds OAuth credentials and has RLS enabled with no public
// policies, same treatment as google_tokens.

import { supabaseAdmin } from './supabaseClient.js';

const ROW_ID = 'household';

function requireAdminClient() {
  if (!supabaseAdmin) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set — cannot read or write resideo_tokens.'
    );
  }
  return supabaseAdmin;
}

export async function loadResideoTokens() {
  const admin = requireAdminClient();
  const { data, error } = await admin
    .from('resideo_tokens')
    .select('*')
    .eq('id', ROW_ID)
    .maybeSingle();

  if (error) throw error;
  return data; // null if nobody has connected yet
}

// `tokens` is whatever the Resideo API just returned from an exchange or
// refresh call: { access_token, refresh_token, expires_in }. Resideo
// ALWAYS returns a fresh refresh_token (unlike Google, which only sends
// one the first time) — so this always overwrites it, rather than
// merging with whatever was there before. See the comment atop
// resideoClient.js for why that distinction matters.
export async function saveResideoTokens(tokens) {
  const admin = requireAdminClient();

  const row = {
    id: ROW_ID,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: Date.now() + tokens.expires_in * 1000,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from('resideo_tokens').upsert(row);
  if (error) throw error;
}
