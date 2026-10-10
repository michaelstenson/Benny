// Gmail status and draft-only compose — see gmailClient.js for why there
// is no send route here, ever, on purpose.
//
// Reuses the exact same per-owner token rows Calendar uses (google_tokens)
// — Gmail's scopes were requested alongside Calendar's in the same
// reconnect (see googleClient.js), so there's no separate Gmail
// connection state to track.
//
// Deliberately does NOT surface inbox content anywhere in this app's
// pages. The only Gmail content ever shown on a page is a local record of
// drafts Benny itself created (gmail_drafts table) — never a fetch of the
// mailbox.
//
// Agent Benny can search and read mail (GET /gmail/search and
// /gmail/messages/:id below), so it can find a referral and propose the
// reply. Those routes answer the agent token only, never a signed-in
// browser, and each request names one owner. The Hermes plugin is what
// limits that to whoever is asking: it takes the owner from Hermes's
// session (the Discord or Telegram account that sent the message), never
// from the model, so Michael can't get Benny to read Mer's mail or the
// other way around.

import { Router } from 'express';
import { authenticatedClientFor, clearIfDeadToken } from '../lib/googleClient.js';
import { loadTokens, OWNERS } from '../lib/tokenStore.js';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { createDraft, fetchAttachment, readMessage, searchMessages } from '../lib/gmailClient.js';
import { readAttachmentText } from '../lib/attachmentReader.js';
import { ActionError } from '../lib/actionError.js';

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

// Creates a DRAFT in one person's Gmail — never sends — and records it
// in gmail_drafts so it shows up on the Drafts page. Shared by POST
// /api/gmail/drafts below and by approving a "Benny suggests" proposal
// (proposals.js, Stage 21). Throws ActionError for the cases a person
// can fix (reconnect, missing scope, bad header text).
export async function createTrackedDraft({ owner, to, subject, body }) {
  // A line break in a header field would let the text after it become a
  // header of its own (a sneaked-in "Bcc:", say). Nothing legitimate
  // needs one, and once the agent can propose drafts, these fields can
  // come from text someone else wrote.
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    throw new ActionError(400, '"to" and "subject" must be a single line.');
  }

  return withGmail(owner, async (oauth2Client) => {
    const draft = await createDraft(oauth2Client, { to, subject, body });

    const { error } = await supabaseAdmin
      .from('gmail_drafts')
      .insert({ id: draft.id, owner, to_address: to, subject });
    if (error) throw error;

    return { id: draft.id };
  });
}

// Runs fn with an authenticated Gmail client for owner, turning the
// failures a person can fix (not connected, expired, missing Gmail
// scope) into ActionErrors.
async function withGmail(owner, fn) {
  const tokens = await loadTokens(owner);
  if (!tokens?.refresh_token) {
    throw new ActionError(424, `${owner}'s Gmail isn't connected yet.`);
  }

  try {
    return await fn(authenticatedClientFor(owner, tokens));
  } catch (err) {
    if (await clearIfDeadToken(owner, err)) {
      throw new ActionError(424, `${owner}'s connection has expired — reconnect it.`);
    }
    if (isInsufficientScope(err)) {
      throw new ActionError(
        403,
        `${owner}'s Google connection doesn't include Gmail access yet — reconnect to add it.`
      );
    }
    throw err;
  }
}

// Search and read answer only the agent token. The app's own pages never
// show inbox content (Stage 15), and that stays true.
function agentOnly(req, res, next) {
  if (req.user?.agent) return next();
  res.status(403).json({ error: 'Only agent Benny reads email, for whoever asked it to.' });
}

function ownerFrom(req, res) {
  const { owner } = req.query;
  if (OWNERS.includes(owner)) return owner;
  res.status(400).json({ error: `"owner" must be one of: ${OWNERS.join(', ')}.` });
  return null;
}

const MAX_SEARCH_RESULTS = 20;

// GET /api/gmail/search?owner=mer&q=from:weiss&max=10 — newest first,
// metadata and Gmail's snippet only.
gmailRouter.get('/gmail/search', agentOnly, async (req, res) => {
  const owner = ownerFrom(req, res);
  if (!owner) return;
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query || query.length > 500 || /[\r\n]/.test(query)) {
    return res.status(400).json({ error: '"q" must be a Gmail search of up to 500 characters on one line.' });
  }
  const max = Math.min(Math.max(Number.parseInt(req.query.max, 10) || 10, 1), MAX_SEARCH_RESULTS);

  try {
    const messages = await withGmail(owner, (client) => searchMessages(client, { query, maxResults: max }));
    res.json({ owner, messages });
  } catch (err) {
    if (err instanceof ActionError) return res.status(err.status).json({ error: err.message });
    console.error('[gmail] search failed:', err.message);
    res.status(500).json({ error: 'Could not search Gmail.' });
  }
});

// GET /api/gmail/messages/:id?owner=mer — one message as plain text.
gmailRouter.get('/gmail/messages/:id', agentOnly, async (req, res) => {
  const owner = ownerFrom(req, res);
  if (!owner) return;
  if (!/^[0-9a-f]{8,32}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'That isn\'t a Gmail message id.' });
  }

  try {
    const message = await withGmail(owner, (client) => readMessage(client, req.params.id));
    res.json({ owner, message });
  } catch (err) {
    if (err instanceof ActionError) return res.status(err.status).json({ error: err.message });
    if (err.code === 404 || err.code === 400) {
      return res.status(404).json({ error: `No email with that id in ${owner}'s Gmail.` });
    }
    console.error('[gmail] read failed:', err.message);
    res.status(500).json({ error: 'Could not read that email.' });
  }
});

// GET /api/gmail/messages/:id/attachments/:index?owner=mer — one
// attachment as text, picked by its index in the message's attachments
// list. PDFs and images are transcribed by Claude (attachmentReader.js).
gmailRouter.get('/gmail/messages/:id/attachments/:index', agentOnly, async (req, res) => {
  const owner = ownerFrom(req, res);
  if (!owner) return;
  const index = Number(req.params.index);
  if (!/^[0-9a-f]{8,32}$/.test(req.params.id) || !Number.isInteger(index) || index < 0 || index > 99) {
    return res.status(400).json({ error: 'Need a Gmail message id and an attachment index.' });
  }

  try {
    const attachment = await withGmail(owner, (client) => fetchAttachment(client, req.params.id, index));
    if (!attachment) {
      return res.status(404).json({ error: `That email has no attachment at index ${index}.` });
    }
    res.json({ owner, attachment: await readAttachmentText(attachment) });
  } catch (err) {
    if (err instanceof ActionError) return res.status(err.status).json({ error: err.message });
    if (err.code === 404 || err.code === 400) {
      return res.status(404).json({ error: `No email with that id in ${owner}'s Gmail.` });
    }
    console.error('[gmail] attachment read failed:', err.message);
    res.status(500).json({ error: 'Could not read that attachment.' });
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
    const draft = await createTrackedDraft({ owner, to, subject, body });
    res.status(201).json({ draft });
  } catch (err) {
    if (err instanceof ActionError) return res.status(err.status).json({ error: err.message });
    console.error('[gmail] failed to create draft:', err.message);
    res.status(500).json({ error: 'Could not create that draft.' });
  }
});
