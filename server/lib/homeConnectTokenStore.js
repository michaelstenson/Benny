// Reads and writes the single row in home_connect_tokens. Same shape as
// resideoTokenStore.js — one household row (id = 'household'), not
// per-person, since Home Connect connects once for the whole kitchen.
// Uses supabaseAdmin since this table holds OAuth credentials and has RLS
// enabled with no public policies, same treatment as resideo_tokens.

import { supabaseAdmin } from './supabaseClient.js';

const ROW_ID = 'household';

function requireAdminClient() {
  if (!supabaseAdmin) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set — cannot read or write home_connect_tokens.'
    );
  }
  return supabaseAdmin;
}

export async function loadHomeConnectTokens() {
  const admin = requireAdminClient();
  const { data, error } = await admin
    .from('home_connect_tokens')
    .select('*')
    .eq('id', ROW_ID)
    .maybeSingle();

  if (error) throw error;
  return data; // null if nobody has connected yet
}

// Unlike resideoTokenStore.js, this keeps the previous refresh_token when
// a refresh response doesn't include a new one — Home Connect's docs
// don't document Resideo's "always rotates" behavior, so this defaults to
// the more common OAuth pattern (Google's tokenStore.js does the same).
// Worth confirming empirically once real tokens are flowing: if Home
// Connect turns out to rotate refresh tokens like Resideo does, this
// needs the same "always overwrite" treatment resideoTokenStore.js uses.
export async function saveHomeConnectTokens(tokens) {
  const admin = requireAdminClient();
  const existing = await loadHomeConnectTokens();

  const row = {
    id: ROW_ID,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? existing?.refresh_token,
    expiry_date: Date.now() + tokens.expires_in * 1000,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from('home_connect_tokens').upsert(row);
  if (error) throw error;
}
