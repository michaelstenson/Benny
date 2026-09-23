// Gmail status and draft-only compose — see gmailClient.js for why there
// is no send route here, ever, on purpose.
//
// Reuses the exact same per-owner token rows Calendar uses (google_tokens)
// — Gmail's scopes were requested alongside Calendar's in the same
// reconnect (see googleClient.js), so there's no separate Gmail
// connection state to track.
//
// Deliberately does NOT surface inbox content anywhere in this app. Benny
// has gmail.readonly (fetchRecentMessages in gmailClient.js still works
// and is kept for future automation to use server-side — e.g. an agent
// reading a vendor's reply), but nothing in this file's routes calls it,
// and nothing in the UI displays a live inbox. The only Gmail content
// ever shown to a person is a local record of drafts Benny itself
// created (gmail_drafts table) — never a fetch of the mailbox.

import { Router } from 'express';
import { authenticatedClientFor, clearIfDeadToken } from '../lib/googleClient.js';
import { loadTokens, OWNERS } from '../lib/tokenStore.js';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { createDraft } from '../lib/gmailClient.js';

export const gmailRouter = Router();

// Someone who connected before Gmail's scopes existed (or before they
// reconnect after any future scope change) has a perfectly valid token —
// just not one covering Gmail. Google's API returns "Insufficient
// Permission" for that, a completely different situation from a dead
// token (clearIfDeadToken's invalid_grant case): the token doesn't need
// clearing, the person just needs to reconnect to add the missing scope.
// Surfaced as its own status code so the frontend can point at
// "reconnect," not just show a bare error.
function isInsufficientScope(err) {
  return String(err.message).includes('Insufficient Permission');
}

// GET /api/gmail/status — same shape as /api/calendar/status, kept as
// its own endpoint (even though it reads the same underlying connection)
// for the same reason every other integration in this app has its own
// status route: each page asks about the thing it actually cares about.
gmailRouter.get('/gmail/status', async (req, res) => {
  try {
    const entries = await Promise.all(
      OWNERS.map(async (owner) => {
        const tokens = await loadTokens(owner);
        return [owner, Boolean(tokens?.refresh_token)];
      })
    );
    res.json(Object.fromEntries(entries));
  } catch (err) {
    console.error('[gmail] status check failed:', err.message);
    res.status(500).json({ error: 'Could not check Gmail connection status.' });
  }
});

// GET /api/gmail/drafts?owner=michael — lists drafts Benny itself has
// created, read from our own Supabase record rather than Gmail's API.
// This is a deliberate design choice, not just a convenience: it means
// this page can never surface a draft (or anything else) that Benny
// didn't create, even though the Gmail scope granted would technically
// allow listing every draft in the mailbox.
gmailRouter.get('/gmail/drafts', async (req, res) => {
  const { owner } = req.query;
  if (!OWNERS.includes(owner)) {
    return res.status(400).json({ error: `"owner" query param must be one of: ${OWNERS.join(', ')}.` });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('gmail_drafts')
      .select('*')
      .eq('owner', owner)
      .order('created_at', { ascending: false });
    if (error) throw error;

    res.json({ drafts: data || [] });
  } catch (err) {
    console.error('[gmail] failed to list tracked drafts:', err.message);
    res.status(500).json({ error: 'Could not load drafts.' });
  }
});

// POST /api/gmail/drafts — body { owner, to, subject, body }. Creates a
// DRAFT in that owner's Gmail — never sends — and records it in
// gmail_drafts so it shows up in the list above. This exists right now
// mainly to let you verify the draft-only promise with your own eyes:
// create one, go look at it sitting in Drafts, confirm nothing went out.
gmailRouter.post('/gmail/drafts', async (req, res) => {
  const { owner, to, subject, body } = req.body || {};

  if (!OWNERS.includes(owner)) {
    return res.status(400).json({ error: `"owner" must be one of: ${OWNERS.join(', ')}.` });
  }
  if (!to || !subject || !body) {
    return res.status(400).json({ error: '"to", "subject", and "body" are all required.' });
  }

  try {
    const tokens = await loadTokens(owner);
    if (!tokens?.refresh_token) {
      return res.status(401).json({ error: `${owner}'s Gmail isn't connected yet.` });
    }

    const oauth2Client = authenticatedClientFor(owner, tokens);
    const draft = await createDraft(oauth2Client, { to, subject, body });

    const { error } = await supabaseAdmin
      .from('gmail_drafts')
      .insert({ id: draft.id, owner, to_address: to, subject });
    if (error) throw error;

    res.status(201).json({ draft: { id: draft.id } });
  } catch (err) {
    if (await clearIfDeadToken(owner, err)) {
      return res.status(401).json({ error: `${owner}'s connection has expired — reconnect it.` });
    }
    if (isInsufficientScope(err)) {
      return res
        .status(403)
        .json({ error: `${owner}'s Google connection doesn't include Gmail access yet — reconnect to add it.` });
    }
    console.error('[gmail] failed to create draft:', err.message);
    res.status(500).json({ error: 'Could not create that draft.' });
  }
});
