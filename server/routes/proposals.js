// The proposals inbox (Stage 21) — "autonomous at drafting, not at
// acting." Benny the agent can't write to a calendar or create a Gmail
// draft itself; it can only *propose* one here. The proposal shows up as
// a "Benny suggests" card on the homepage, and nothing reaches Google
// until Michael or Mer approves it. Approving runs the exact same code
// the app's own calendar and Gmail routes use (createCalendarEvent,
// createTrackedDraft), so there's still only one way each gets written.
//
// The agent may create and list proposals. Approving and dismissing are
// deliberately NOT on its allowlist (see agentAuth.js) — a proposal the
// agent could approve itself would just be a slower way of acting.

import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { OWNERS } from '../lib/tokenStore.js';
import { ActionError } from '../lib/actionError.js';
import { createCalendarEvent } from './calendar.js';
import { createTrackedDraft } from './gmail.js';

export const proposalsRouter = Router();

// A cap on how many can be waiting at once, so a confused agent in a
// loop fills up a short list instead of the whole homepage.
const MAX_PENDING = 20;
const MAX_NOTE_LENGTH = 500;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 10000;

const UUID_PATTERN = /^[0-9a-f-]{36}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// One plain address — no display names, no lists. Deliberately stricter
// than what Gmail would accept: a proposal should say exactly who it's to.
const EMAIL_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

function isRealDate(dateStr) {
  if (!DATE_PATTERN.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function singleLine(value, max) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

// Each validator returns { payload } with only the fields that kind
// uses, cleaned up — or { error }. What's stored is exactly what the card
// shows and exactly what approving writes; nothing is re-parsed later.
function validateCalendarEvent(input) {
  const owner = input.owner;
  const title = singleLine(input.title, MAX_TITLE_LENGTH);
  const { date } = input;
  const start_time = input.start_time || null;
  const end_time = input.end_time || null;

  if (!OWNERS.includes(owner)) return { error: `"owner" must be one of: ${OWNERS.join(', ')}.` };
  if (!title) return { error: '"title" is required.' };
  if (typeof date !== 'string' || !isRealDate(date)) return { error: '"date" must be YYYY-MM-DD.' };
  if (start_time !== null && !TIME_PATTERN.test(start_time)) {
    return { error: '"start_time" must be 24-hour HH:MM.' };
  }
  if (end_time !== null && !TIME_PATTERN.test(end_time)) {
    return { error: '"end_time" must be 24-hour HH:MM.' };
  }
  if (end_time && !start_time) return { error: '"end_time" needs a "start_time".' };
  if (start_time && end_time && end_time <= start_time) {
    return { error: '"end_time" must be after "start_time" on the same day.' };
  }
  // With no end_time, the calendar code adds an hour — which would wrap
  // past midnight and give Google an end before the start.
  if (start_time && !end_time && start_time >= '23:00') {
    return { error: 'A start after 23:00 needs an explicit "end_time" before midnight.' };
  }

  return { payload: { owner, title, date, start_time, end_time } };
}

function validateGmailDraft(input) {
  const owner = input.owner;
  const to = typeof input.to === 'string' ? input.to.trim() : '';
  const subject = typeof input.subject === 'string' ? input.subject : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';

  if (!OWNERS.includes(owner)) return { error: `"owner" must be one of: ${OWNERS.join(', ')}.` };
  if (!EMAIL_PATTERN.test(to)) return { error: '"to" must be one plain email address.' };
  if (/[\r\n]/.test(subject)) return { error: '"subject" must be a single line.' };
  const cleanSubject = singleLine(subject, MAX_TITLE_LENGTH);
  if (!cleanSubject) return { error: '"subject" is required.' };
  if (!body) return { error: '"body" is required.' };
  if (body.length > MAX_BODY_LENGTH) return { error: `"body" can be at most ${MAX_BODY_LENGTH} characters.` };

  return { payload: { owner, to, subject: cleanSubject, body } };
}

// Every kind of proposal: how to check it, and what approving it runs.
// A new kind (a thermostat change, say) is one more entry here — plus
// the database check constraint and a line in the card's describe().
const KINDS = {
  calendar_event: { validate: validateCalendarEvent, run: createCalendarEvent },
  gmail_draft: { validate: validateGmailDraft, run: createTrackedDraft },
};

const COLUMNS =
  'id, kind, payload, note, status, source, created_by, created_at, decided_by, decided_at, result, last_error';

// GET /api/proposals — pending ones, oldest first (the order they came
// in). ?status=all instead gives the 50 most recent of any status, so
// the agent can check what happened to something it proposed.
proposalsRouter.get('/proposals', async (req, res) => {
  let query = supabaseAdmin.from('pending_actions').select(COLUMNS);
  query =
    req.query.status === 'all'
      ? query.order('created_at', { ascending: false }).limit(50)
      : query.eq('status', 'pending').order('created_at', { ascending: true });

  const { data, error } = await query;
  if (error) {
    console.error('[proposals] failed to load:', error.message);
    return res.status(500).json({ error: 'Could not load proposals.' });
  }
  res.json({ proposals: data });
});

// POST /api/proposals — body { kind, payload, note? }. `note` is the
// proposer's one-line "why," shown on the card. Nothing reaches Google
// here; this only stores the proposal.
proposalsRouter.post('/proposals', async (req, res) => {
  const { kind, payload, note } = req.body || {};
  const spec = KINDS[kind];
  if (!spec) {
    return res.status(400).json({ error: `"kind" must be one of: ${Object.keys(KINDS).join(', ')}.` });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: '"payload" must be an object.' });
  }

  const checked = spec.validate(payload);
  if (checked.error) return res.status(400).json({ error: checked.error });

  try {
    const { count, error: countError } = await supabaseAdmin
      .from('pending_actions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (countError) throw countError;
    if (count >= MAX_PENDING) {
      return res.status(429).json({
        error: `There are already ${MAX_PENDING} proposals waiting. Ask Michael or Mer to go through them first.`,
      });
    }

    const isAgent = Boolean(req.user.agent);
    const { data, error } = await supabaseAdmin
      .from('pending_actions')
      .insert({
        kind,
        payload: checked.payload,
        note: singleLine(note, MAX_NOTE_LENGTH) || null,
        source: isAgent ? 'agent' : 'app',
        created_by: isAgent ? 'agent' : req.user.email,
      })
      .select(COLUMNS)
      .single();
    if (error) throw error;

    res.status(201).json({ proposal: data });
  } catch (err) {
    console.error('[proposals] failed to create:', err.message);
    res.status(500).json({ error: 'Could not save that proposal.' });
  }
});

// POST /api/proposals/:id/approve — runs it. The status flips from
// pending to 'approving' in one conditional update first, so two taps
// (or both of us approving at once) can't create the same event twice:
// only the request that wins the flip goes on to run it.
proposalsRouter.post('/proposals/:id/approve', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ error: 'No such proposal.' });
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('pending_actions')
    .update({ status: 'approving' })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select(COLUMNS)
    .maybeSingle();
  if (claimError) {
    console.error('[proposals] failed to claim:', claimError.message);
    return res.status(500).json({ error: 'Could not approve that.' });
  }
  if (!claimed) return res.status(409).json({ error: 'That proposal was already handled.' });

  let result;
  try {
    result = await KINDS[claimed.kind].run(claimed.payload);
  } catch (err) {
    // Didn't happen — put it back as pending with the reason, so it can
    // be approved again after, say, reconnecting Google.
    const message = err instanceof ActionError ? err.message : 'Something went wrong running it.';
    if (!(err instanceof ActionError)) console.error('[proposals] approve failed:', err.message);
    const { error: resetError } = await supabaseAdmin
      .from('pending_actions')
      .update({ status: 'pending', last_error: message })
      .eq('id', claimed.id);
    if (resetError) console.error('[proposals] failed to reset after error:', resetError.message);
    return res.status(err instanceof ActionError ? err.status : 500).json({ error: message });
  }

  const { data, error } = await supabaseAdmin
    .from('pending_actions')
    .update({
      status: 'approved',
      decided_by: req.user.email,
      decided_at: new Date().toISOString(),
      result,
      last_error: null,
    })
    .eq('id', claimed.id)
    .select(COLUMNS)
    .single();
  if (error) {
    // The event/draft exists at this point — say so rather than implying
    // it failed, which would invite approving it again.
    console.error('[proposals] ran but failed to record approval:', error.message);
    return res.json({ proposal: { ...claimed, status: 'approved', result } });
  }
  res.json({ proposal: data });
});

// POST /api/proposals/:id/reject — dismisses it. Kept (not deleted) so
// there's a record of what the agent suggested and what we said no to.
proposalsRouter.post('/proposals/:id/reject', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ error: 'No such proposal.' });
  const { data, error } = await supabaseAdmin
    .from('pending_actions')
    .update({ status: 'rejected', decided_by: req.user.email, decided_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    console.error('[proposals] failed to reject:', error.message);
    return res.status(500).json({ error: 'Could not dismiss that.' });
  }
  if (!data) return res.status(409).json({ error: 'That proposal was already handled.' });
  res.json({ proposal: data });
});
