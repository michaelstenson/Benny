// Builds the OAuth2 client Google's SDK uses for two different jobs:
// (1) generating the "sign in with Google" URL, and (2) exchanging the
// code Google sends back for real access/refresh tokens. We make a new
// one per request rather than sharing a single instance, since setting
// credentials on it is mutable state we don't want routes accidentally
// sharing.

import { google } from 'googleapis';

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// "readonly" was the whole story while Benny only displayed your
// calendar. Now that it can also create events (see calendarEventParser.js
// and the /api/calendar/events routes), it needs calendar.events too —
// requested alongside readonly rather than instead of it, since readonly
// covers things (e.g. listing calendars) that events alone doesn't.
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

// Gmail is NOT requested yet, on purpose — see the README's Home Connect/
// Gmail notes. Adding it means enabling the Gmail API and its scopes on
// the Data Access page in Google Cloud Console first (same place Calendar
// had to be enabled), so it's its own dedicated reconnect later rather
// than bundled into this one — requesting a scope the consent screen
// isn't configured for would just break this reconnect for everyone.
