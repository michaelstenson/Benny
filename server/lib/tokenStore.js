// Reads and writes rows in google_tokens — one row per person, keyed by
// ownerId ('michael' or 'mer'), each holding that person's own Google
// OAuth tokens. Uses supabaseAdmin (the service_role client) since that
// table has RLS enabled with no public policies — the regular anon
// client literally cannot see it.

import { supabaseAdmin } from './supabaseClient.js';

// The only two people who can have a row here. Exported so routes can
// validate an owner value before it ever reaches a query.
export const OWNERS = ['michael', 'mer'];

function requireAdminClient() {
  if (!supabaseAdmin) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set — cannot read or write google_tokens.'
    );
  }
  return supabaseAdmin;
}

function requireValidOwner(ownerId) {
  if (!OWNERS.includes(ownerId)) {
    throw new Error(`Unknown token owner "${ownerId}" — expected one of: ${OWNERS.join(', ')}`);
  }
}

export async function loadTokens(ownerId) {
  requireValidOwner(ownerId);
  const admin = requireAdminClient();
  const { data, error } = await admin
    .from('google_tokens')
    .select('*')
    .eq('id', ownerId)
    .maybeSingle();

  if (error) throw error;
  return data; // null if this person hasn't connected yet
}

export async function saveTokens(ownerId, tokens) {
  requireValidOwner(ownerId);
  const admin = requireAdminClient();

  // Google only sends a refresh_token the FIRST time you consent — later,
  // when googleapis silently refreshes your access token, it sends a
  // fresh access_token but no refresh_token at all. If we naively upserted
  // that, we'd overwrite the real refresh_token with nothing and you'd
  // have to reconnect from scratch. So: keep whatever we already had
  // unless a new value actually showed up.
  const existing = await loadTokens(ownerId);

  const merged = {
    id: ownerId,
    access_token: tokens.access_token ?? existing?.access_token,
    refresh_token: tokens.refresh_token ?? existing?.refresh_token,
    expiry_date: tokens.expiry_date ?? existing?.expiry_date,
    scope: tokens.scope ?? existing?.scope,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from('google_tokens').upsert(merged);
  if (error) throw error;
}
