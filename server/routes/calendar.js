import { Router } from 'express';
import { google } from 'googleapis';
import { createOAuthClient } from '../lib/googleClient.js';
import { loadTokens, saveTokens, OWNERS } from '../lib/tokenStore.js';

export const calendarRouter = Router();

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

// Fetches the next 20 upcoming events for one person and tags each with
// `owner` so the merged list (below) can still tell them apart. Returns
// an empty array — not an error — for someone who hasn't connected yet,
// since "no events from them" and "not connected" both just mean this
// person contributes nothing to the merged list.
async function fetchEventsForOwner(owner) {
  const tokens = await loadTokens(owner);
  if (!tokens?.refresh_token) return [];

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);

  // googleapis refreshes the access token automatically behind the
  // scenes when it's expired (using the refresh_token). This event
  // fires whenever that happens, so we can persist the new access
  // token — otherwise you'd be prompted to reconnect roughly every hour.
  oauth2Client.on('tokens', (newTokens) => {
    saveTokens(owner, newTokens).catch((err) =>
      console.error(`[calendar] failed to persist refreshed tokens for ${owner}:`, err.message)
    );
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const { data } = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults: 20,
    singleEvents: true, // expands recurring events (e.g. weekly meetings) into individual instances
    orderBy: 'startTime',
  });

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
    const perOwner = await Promise.all(OWNERS.map(fetchEventsForOwner));
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
