// Gmail status, a read-only recent-messages proof of connection, and
// draft-only compose — see gmailClient.js for why there is no send route
// here, ever, on purpose.
//
// Reuses the exact same per-owner token rows Calendar uses (google_tokens)
// — Gmail's scopes were requested alongside Calendar's in the same
// reconnect (see googleClient.js), so there's no separate Gmail
// connection state to track.

import { Router } from 'express';
import { authenticatedClientFor, clearIfDeadToken } from '../lib/googleClient.js';
import { loadTokens, OWNERS } from '../lib/tokenStore.js';
import { fetchRecentMessages, createDraft } from '../lib/gmailClient.js';

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

// GET /api/gmail/messages?owner=michael — one person's recent inbox
// metadata. Deliberately NOT merged across owners the way calendar
// events are — email is personal in a way a shared household calendar
// isn't, so this always shows exactly one person's inbox, picked
// explicitly, never a combined view.
gmailRouter.get('/gmail/messages', async (req, res) => {
  const { owner } = req.query;
  if (!OWNERS.includes(owner)) {
    return res.status(400).json({ error: `"owner" query param must be one of: ${OWNERS.join(', ')}.` });
  }

  try {
    const tokens = await loadTokens(owner);
    if (!tokens?.refresh_token) {
      return res.status(401).json({ error: `${owner}'s Gmail isn't connected yet.` });
    }

    const oauth2Client = authenticatedClientFor(owner, tokens);
    const messages = await fetchRecentMessages(oauth2Client);
    res.json({ messages });
  } catch (err) {
    if (await clearIfDeadToken(owner, err)) {
      return res.status(401).json({ error: `${owner}'s connection has expired — reconnect it.` });
    }
    if (isInsufficientScope(err)) {
      return res
        .status(403)
        .json({ error: `${owner}'s Google connection doesn't include Gmail access yet — reconnect to add it.` });
    }
    console.error('[gmail] failed to fetch messages:', err.message);
    res.status(500).json({ error: 'Could not load recent messages.' });
  }
});

// POST /api/gmail/drafts — body { owner, to, subject, body }. Creates a
// DRAFT in that owner's Gmail — never sends. This exists right now
// mainly to let you verify that promise with your own eyes: create one,
// go look at it sitting in Drafts, confirm nothing went out.
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
