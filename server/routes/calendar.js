import { Router } from 'express';
import { google } from 'googleapis';
import { authenticatedClientFor, clearIfDeadToken } from '../lib/googleClient.js';
import { loadTokens, OWNERS } from '../lib/tokenStore.js';
import { parseEventText } from '../lib/calendarEventParser.js';

export const calendarRouter = Router();

// The household is in Chicago (see digest.js) — event times typed in as
// "7pm" mean 7pm there, not UTC or wherever the server happens to run.
const HOUSEHOLD_TIMEZONE = 'America/Chicago';

// Pure calendar-day arithmetic on a "YYYY-MM-DD" string, deliberately
// done via Date.UTC rather than the household's real timezone or the
// server's own — this only ever counts whole days, never touches actual
// wall-clock time, so there's no DST or offset to get wrong. Used to
// build the month grid's 42-day window below.
function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}

// Which local calendar day an event belongs on. All-day events' `start`
// is already a plain date string from Google (no time component) — using
// it as-is avoids the exact bug formatDueDate() in chores.js warns about:
// parsing "2026-09-25" as a Date treats it as UTC midnight, which in a
// timezone behind UTC (Chicago) lands on the *previous* local day once
// converted back. Timed events don't have that ambiguity, so those do
// get converted through the household timezone.
function eventLocalDateString(event) {
  if (event.allDay) return event.start;
  return new Date(event.start).toLocaleDateString('en-CA', { timeZone: HOUSEHOLD_TIMEZONE });
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

function mapGoogleEvent(event, owner) {
  return {
    id: `${owner}:${event.id}`,
    owner,
    title: event.summary || '(no title)',
    location: event.location || null,
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
  };
}

// Shared low-level fetch behind both exports below — everything that
// varies between "next N upcoming" and "everything in this date range"
// is just which params get passed to events.list. Returns an empty
// array — not an error — for someone who hasn't connected yet, since
// "no events from them" and "not connected" both just mean this person
// contributes nothing to a merged list.
async function listEvents(owner, params) {
  const tokens = await loadTokens(owner);
  if (!tokens?.refresh_token) return [];

  const oauth2Client = authenticatedClientFor(owner, tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  try {
    const { data } = await calendar.events.list({
      calendarId: 'primary',
      singleEvents: true, // expands recurring events (e.g. weekly meetings) into individual instances
      orderBy: 'startTime',
      ...params,
    });
    return (data.items || []).map((event) => mapGoogleEvent(event, owner));
  } catch (err) {
    if (await clearIfDeadToken(owner, err)) return [];
    throw err;
  }
}

// Fetches the next `maxResults` upcoming events for one person. Exported
// so digest.js can reuse the same fetch instead of duplicating the
// Google API call.
export async function fetchEventsForOwner(owner, { maxResults = 20 } = {}) {
  return listEvents(owner, { timeMin: new Date().toISOString(), maxResults });
}

// Fetches every event for one person within an explicit [timeMin, timeMax)
// window — used by the month grid and the timeline, both of which need a
// bounded date range rather than fetchEventsForOwner's "next N events"
// cap regardless of how far out they'd land.
export async function fetchEventsInRange(owner, { timeMin, timeMax }) {
  return listEvents(owner, { timeMin, timeMax, maxResults: 250 });
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

// GET /api/calendar/month — a rolling 6-week grid: one week before the
// current week, the current week, and four weeks ahead (42 days total,
// Sunday-start). For each day, returns all-day event titles (expanded
// across every day a multi-day all-day event spans, not just its start)
// and which owners have at least one TIMED event that day — a presence
// flag for a dot indicator, not the events themselves. Deliberately
// compact: this view is for "what's the shape of the next month and a
// half," not a substitute for the linear timeline or /calendar.html.
calendarRouter.get('/calendar/month', async (req, res) => {
  try {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: HOUSEHOLD_TIMEZONE });
    const startOfThisWeek = addDaysToDateString(todayStr, -dayOfWeek(todayStr));
    const gridStart = addDaysToDateString(startOfThisWeek, -7);
    const dayStrings = Array.from({ length: 42 }, (_, i) => addDaysToDateString(gridStart, i));
    const gridEndExclusive = dayStrings[41];

    // Padded by a day on each side, then bucketed precisely by
    // eventLocalDateString() below — same "fetch broadly, filter
    // precisely" approach digest.js already uses, rather than trying to
    // get timeMin/timeMax exactly right against a household timezone
    // Google's API doesn't know about.
    const timeMin = `${addDaysToDateString(gridStart, -1)}T00:00:00Z`;
    const timeMax = `${addDaysToDateString(gridEndExclusive, 2)}T00:00:00Z`;

    const perOwnerEvents = await Promise.all(
      OWNERS.map(async (owner) => {
        try {
          return await fetchEventsInRange(owner, { timeMin, timeMax });
        } catch (err) {
          console.error(`[calendar] could not fetch ${owner}'s events for month view:`, err.message);
          return [];
        }
      })
    );

    const daysByDate = Object.fromEntries(
      dayStrings.map((date) => [date, { allDayEvents: [], timedOwners: new Set() }])
    );

    for (const event of perOwnerEvents.flat()) {
      if (event.allDay) {
        // end is EXCLUSIVE for all-day events — expand across every day
        // in [start, end) that falls inside the grid, capped defensively
        // in case of unexpected data (Google always sends a real end).
        let cursor = event.start;
        let guard = 0;
        while (cursor < event.end && guard < 60) {
          daysByDate[cursor]?.allDayEvents.push({ title: event.title, owner: event.owner });
          cursor = addDaysToDateString(cursor, 1);
          guard += 1;
        }
      } else {
        const dateStr = eventLocalDateString(event);
        daysByDate[dateStr]?.timedOwners.add(event.owner);
      }
    }

    const days = dayStrings.map((date) => ({
      date,
      allDayEvents: daysByDate[date].allDayEvents,
      timedOwners: [...daysByDate[date].timedOwners],
    }));

    res.json({ today: todayStr, days });
  } catch (err) {
    console.error('[calendar] failed to build month view:', err.message);
    res.status(500).json({ error: 'Could not load the month view.' });
  }
});
