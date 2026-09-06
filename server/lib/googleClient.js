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

// "readonly" is intentional — Benny only needs to display your calendar
// right now, not create or edit events, so we ask for the narrowest
// permission that does the job.
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
