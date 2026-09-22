// Builds the OAuth2 client Google's SDK uses for two different jobs:
// (1) generating the "sign in with Google" URL, and (2) exchanging the
// code Google sends back for real access/refresh tokens. We make a new
// one per request rather than sharing a single instance, since setting
// credentials on it is mutable state we don't want routes accidentally
// sharing.

import { google } from 'googleapis';
import { saveTokens, clearTokens } from './tokenStore.js';

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

// Read-only for the inbox, plus the narrowest possible write scope.
// gmail.drafts.create ("Compose new draft emails") was picked over the
// broader gmail.compose ("Manage drafts and send emails" — which also
// permits read/update/delete of drafts and, per Google's own scope
// description, sending) specifically because gmailClient.js only ever
// calls drafts.create — there was a scope available that matches exactly
// what the code does, so there was no reason to request more than that.
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_DRAFTS_CREATE_SCOPE = 'https://www.googleapis.com/auth/gmail.drafts.create';

// Builds an OAuth2 client already carrying one owner's stored tokens, with
// the refresh-token-persisting listener wired up. Shared by every Google
// API this app calls (Calendar, Gmail, ...) — one household member's
// tokens work the same way regardless of which API is being called,
// since it's all one OAuth client with one combined scope grant.
export function authenticatedClientFor(owner, tokens) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', (newTokens) => {
    saveTokens(owner, newTokens).catch((err) =>
      console.error(`[google] failed to persist refreshed tokens for ${owner}:`, err.message)
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
export async function clearIfDeadToken(owner, err) {
  if (!String(err.message).includes('invalid_grant')) return false;
  await clearTokens(owner).catch((clearErr) =>
    console.error(`[google] failed to clear dead tokens for ${owner}:`, clearErr.message)
  );
  console.error(`[google] ${owner}'s refresh token is dead — cleared, reconnect needed.`);
  return true;
}
