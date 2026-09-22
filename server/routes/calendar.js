import { Router } from 'express';
import { google } from 'googleapis';
import { createOAuthClient } from '../lib/googleClient.js';
import { loadTokens, saveTokens, clearTokens, OWNERS } from '../lib/tokenStore.js';
import { parseEventText } from '../lib/calendarEventParser.js';

export const calendarRouter = Router();

// The household is in Chicago (see digest.js) — event times typed in as
// "7pm" mean 7pm there, not UTC or wherever the server happens to run.
const HOUSEHOLD_TIMEZONE = 'America/Chicago';

// Builds an OAuth2 client already carrying one owner's stored tokens, with
// the refresh-token-persisting listener wired up — the setup every
// authenticated Google Calendar call needs, whether it's reading events
// or creating one.
function authenticatedClientFor(owner, tokens) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', (newTokens) => {
    saveTokens(owner, newTokens).catch((err) =>
      console.error(`[calendar] failed to persist refreshed tokens for ${owner}:`, err.message)
    );
  });
  return oauth2Client;
}

// "invalid_grant" means the refresh_token itself is dead (revoked, or —
// if the OAuth consent screen is still in "Testing" publishing status in
// Google Cloud Console — expired after 7 days), not just that the access
// token needs refreshing. That's unrecoverable without a real reconnect,
// so this clears the stored tokens rather than leaving a
// permanently-broken row behind — that's what makes the "Connect ___'s
// calendar" button on /calendar.html come back instead of failing the
// same way forever. Returns true if it handled the error (caller should
// treat the request as "not connected"), false if the caller should
// handle/rethrow it as something else.
async function clearIfDeadToken(owner, err) {
  if (!String(err.message).includes('invalid_grant')) return false;
  await clearTokens(owner).catch((clearErr) =>
    console.error(`[calendar] failed to clear dead tokens for ${owner}:`, clearErr.message)
  );
  console.error(`[calendar] ${owner}'s refresh token is dead — cleared, reconnect needed.`);
  return true;
}

// GET /api/calendar/status — lets the frontend ask "who's connected?"
// without triggering an actual Google API call. Returns one boolean per
// owner, e.g. { michael: true, mer: false }.
calendarRouter.get('/calendar/status', async (req, res) => {
  try {
    const entries = await Promise.all(
      OWNERS.map(async (owner) => {
        const tokens = await loadTokens(owner);
        return [owner, Boolean(tokens?.refresh_token)];
      })
    );
    res.json(Object.fromEntries(entries));
  } catch (err) {
    console.error('[calendar] status check failed:', err.message);
    res.status(500).json({ error: 'Could not check calendar connection status.' });
  }
});

// Fetches the next `maxResults` upcoming events for one person and tags
// each with `owner` so a merged list can still tell them apart. Returns
// an empty array — not an error — for someone who hasn't connected yet,
// since "no events from them" and "not connected" both just mean this
// person contributes nothing to the merged list. Exported so digest.js
// can reuse the same fetch instead of duplicating the Google API call.
export async function fetchEventsForOwner(owner, { maxResults = 20 } = {}) {
  const tokens = await loadTokens(owner);
  if (!tokens?.refresh_token) return [];

  const oauth2Client = authenticatedClientFor(owner, tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  let data;
  try {
    ({ data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true, // expands recurring events (e.g. weekly meetings) into individual instances
      orderBy: 'startTime',
    }));
  } catch (err) {
    if (await clearIfDeadToken(owner, err)) return [];
    throw err;
  }

  return (data.items || []).map((event) => ({
    id: `${owner}:${event.id}`,
    owner,
    title: event.summary || '(no title)',
    location: event.location || null,
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
  }));
}

// GET /api/calendar/events — the real feature: merge Michael's and
// Mer's next 20 upcoming events into one read-only, chronologically
// sorted list. Someone who isn't connected simply contributes nothing —
// this only ever 401s if NEITHER person is connected yet.
calendarRouter.get('/calendar/events', async (req, res) => {
  try {
    const perOwner = await Promise.all(OWNERS.map((owner) => fetchEventsForOwner(owner)));
    const anyConnected = await Promise.all(OWNERS.map((owner) => loadTokens(owner)));
    if (!anyConnected.some((tokens) => tokens?.refresh_token)) {
      return res.status(401).json({ error: 'Google Calendar is not connected yet.' });
    }

    const events = perOwner
      .flat()
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 20);

    res.json({ events });
  } catch (err) {
    console.error('[calendar] failed to fetch events:', err.message);
    res.status(500).json({ error: 'Could not load calendar events.' });
  }
});

// Turns a parsed event's { date, start_time, end_time } into the
// start/end objects the Google Calendar API expects. For timed events,
// this hands Google a wall-clock time plus an IANA timeZone name rather
// than computing a UTC offset ourselves — Google resolves DST correctly
// either way, and this sidesteps that math entirely.
function buildEventTimes({ date, start_time, end_time }) {
  if (!start_time) {
    // All-day events: Google's `end.date` is EXCLUSIVE (the day after the
    // event ends), unlike everywhere else date ranges in this app are
    // inclusive — easy to get backwards and end up with a 0-day event.
    const endDate = new Date(`${date}T00:00:00`);
    endDate.setDate(endDate.getDate() + 1);
    return { start: { date }, end: { date: endDate.toISOString().slice(0, 10) } };
  }

  const effectiveEndTime = end_time || addOneHour(start_time);
  return {
    start: { dateTime: `${date}T${start_time}:00`, timeZone: HOUSEHOLD_TIMEZONE },
    end: { dateTime: `${date}T${effectiveEndTime}:00`, timeZone: HOUSEHOLD_TIMEZONE },
  };
}

function addOneHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// POST /api/calendar/events/parse — the natural-language entry point,
// same tool-use pattern as chores/bills. Deliberately side-effect-free:
// this never talks to Google, it just returns Claude's structured read of
// the sentence for the frontend to show as a preview. Body: { text }.
calendarRouter.post('/calendar/events/parse', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing "text" in request body.' });
  }

  try {
    const event = await parseEventText(text.trim());
    res.json({ event });
  } catch (err) {
    console.error('[calendar] failed to parse event text:', err.message);
    res.status(500).json({ error: 'Could not understand that — try rephrasing.' });
  }
});

// POST /api/calendar/events — actually creates the event, once the person
// has reviewed the /parse preview and confirmed it. Body: the already-
// confirmed { owner, title, date, start_time?, end_time? } fields (not
// raw text) — this route never re-parses anything, it only ever writes
// exactly what was shown on screen.
calendarRouter.post('/calendar/events', async (req, res) => {
  const { owner, title, date, start_time, end_time } = req.body || {};

  if (!OWNERS.includes(owner)) {
    return res.status(400).json({ error: `"owner" must be one of: ${OWNERS.join(', ')}.` });
  }
  if (!title || !date) {
    return res.status(400).json({ error: '"title" and "date" are required.' });
  }

  try {
    const tokens = await loadTokens(owner);
    if (!tokens?.refresh_token) {
      return res.status(401).json({ error: `${owner}'s calendar isn't connected yet.` });
    }

    const oauth2Client = authenticatedClientFor(owner, tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const { start, end } = buildEventTimes({ date, start_time, end_time });

    const { data } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: { summary: title, start, end },
    });

    res.status(201).json({ event: { id: data.id, htmlLink: data.htmlLink } });
  } catch (err) {
    if (await clearIfDeadToken(owner, err)) {
      return res.status(401).json({ error: `${owner}'s calendar connection has expired — reconnect it.` });
    }
    console.error('[calendar] failed to create event:', err.message);
    res.status(500).json({ error: 'Could not add that to the calendar.' });
  }
});
