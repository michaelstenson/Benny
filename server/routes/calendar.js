import { Router } from 'express';
import { google } from 'googleapis';
import { createOAuthClient } from '../lib/googleClient.js';
import { loadTokens, saveTokens, clearTokens, OWNERS } from '../lib/tokenStore.js';

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

// Fetches the next `maxResults` upcoming events for one person and tags
// each with `owner` so a merged list can still tell them apart. Returns
// an empty array — not an error — for someone who hasn't connected yet,
// since "no events from them" and "not connected" both just mean this
// person contributes nothing to the merged list. Exported so digest.js
// can reuse the same fetch instead of duplicating the Google API call.
export async function fetchEventsForOwner(owner, { maxResults = 20 } = {}) {
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
    // "invalid_grant" means the refresh_token itself is dead (revoked, or
    // — if the OAuth consent screen is still in "Testing" publishing
    // status in Google Cloud Console — expired after 7 days), not just
    // that the access token needs refreshing. That case is unrecoverable
    // without a real reconnect, so clear the stored tokens rather than
    // leaving a permanently-broken row behind: that's what makes the
    // "Connect ___'s calendar" button on /calendar.html come back instead
    // of this failing the same way forever.
    if (String(err.message).includes('invalid_grant')) {
      await clearTokens(owner).catch((clearErr) =>
        console.error(`[calendar] failed to clear dead tokens for ${owner}:`, clearErr.message)
      );
      console.error(`[calendar] ${owner}'s refresh token is dead — cleared, reconnect needed.`);
      return [];
    }
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
