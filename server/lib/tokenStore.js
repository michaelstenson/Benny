// Reads and writes the one row in google_tokens that holds Michael's
// Google OAuth tokens. Uses supabaseAdmin (the service_role client) since
// that table has RLS enabled with no public policies — the regular anon
// client literally cannot see it.

import { supabaseAdmin } from './supabaseClient.js';

// Hardcoded for now since only one account is connected. When Mer's
// calendar gets added later, this becomes a parameter instead of a
// constant, and each person gets their own row.
const OWNER_ID = 'michael';

function requireAdminClient() {
  if (!supabaseAdmin) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set — cannot read or write google_tokens.'
    );
  }
  return supabaseAdmin;
}

export async function loadTokens() {
  const admin = requireAdminClient();
  const { data, error } = await admin
    .from('google_tokens')
    .select('*')
    .eq('id', OWNER_ID)
    .maybeSingle();

  if (error) throw error;
  return data; // null if never connected yet
}

export async function saveTokens(tokens) {
  const admin = requireAdminClient();

  // Google only sends a refresh_token the FIRST time you consent — later,
  // when googleapis silently refreshes your access token, it sends a
  // fresh access_token but no refresh_token at all. If we naively upserted
  // that, we'd overwrite the real refresh_token with nothing and you'd
  // have to reconnect from scratch. So: keep whatever we already had
  // unless a new value actually showed up.
  const existing = await loadTokens();

  const merged = {
    id: OWNER_ID,
    access_token: tokens.access_token ?? existing?.access_token,
    refresh_token: tokens.refresh_token ?? existing?.refresh_token,
    expiry_date: tokens.expiry_date ?? existing?.expiry_date,
    scope: tokens.scope ?? existing?.scope,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from('google_tokens').upsert(merged);
  if (error) throw error;
}
