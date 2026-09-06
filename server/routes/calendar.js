import { Router } from 'express';
import { google } from 'googleapis';
import { createOAuthClient } from '../lib/googleClient.js';
import { loadTokens, saveTokens } from '../lib/tokenStore.js';

export const calendarRouter = Router();

// GET /api/calendar/status — lets the frontend ask "are we connected?"
// without triggering an actual Google API call.
calendarRouter.get('/calendar/status', async (req, res) => {
  try {
    const tokens = await loadTokens();
    res.json({ connected: Boolean(tokens?.refresh_token) });
  } catch (err) {
    console.error('[calendar] status check failed:', err.message);
    res.status(500).json({ error: 'Could not check calendar connection status.' });
  }
});

// GET /api/calendar/events — the real feature: return your next 20
// upcoming events from Google Calendar.
calendarRouter.get('/calendar/events', async (req, res) => {
  try {
    const tokens = await loadTokens();
    if (!tokens?.refresh_token) {
      return res.status(401).json({ error: 'Google Calendar is not connected yet.' });
    }

    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials(tokens);

    // googleapis refreshes the access token automatically behind the
    // scenes when it's expired (using the refresh_token). This event
    // fires whenever that happens, so we can persist the new access
    // token — otherwise you'd be prompted to reconnect roughly every hour.
    oauth2Client.on('tokens', (newTokens) => {
      saveTokens(newTokens).catch((err) =>
        console.error('[calendar] failed to persist refreshed tokens:', err.message)
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

    const events = (data.items || []).map((event) => ({
      id: event.id,
      title: event.summary || '(no title)',
      location: event.location || null,
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      allDay: Boolean(event.start?.date && !event.start?.dateTime),
    }));

    res.json({ events });
  } catch (err) {
    console.error('[calendar] failed to fetch events:', err.message);
    res.status(500).json({ error: 'Could not load calendar events.' });
  }
});
