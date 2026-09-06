// Handles the "Connect Google Calendar" handshake: send the user to
// Google, then receive them back with a one-time code we trade for
// real tokens.

import { Router } from 'express';
import { createOAuthClient, CALENDAR_SCOPE } from '../lib/googleClient.js';
import { saveTokens } from '../lib/tokenStore.js';

export const authRouter = Router();

// GET /auth/google — the "Connect" button points here. We don't render
// anything ourselves; we just redirect straight to Google's own consent
// screen.
authRouter.get('/google', (req, res) => {
  const oauth2Client = createOAuthClient();

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // "offline" is what makes Google issue a refresh_token, not just a short-lived access_token
    prompt: 'consent', // forces the consent screen (and a fresh refresh_token) every time, which is handy while we're developing
    scope: [CALENDAR_SCOPE],
  });

  res.redirect(url);
});

// GET /auth/google/callback — Google redirects the browser back here
// after you approve (or deny) access, with a `code` query param attached.
authRouter.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    // e.g. you clicked "Cancel" on Google's consent screen
    return res.redirect('/calendar.html?error=' + encodeURIComponent(String(error)));
  }
  if (!code) {
    return res.status(400).send('Missing authorization code from Google.');
  }

  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(String(code));
    await saveTokens(tokens);
    res.redirect('/calendar.html?connected=1');
  } catch (err) {
    console.error('[auth] Google OAuth callback failed:', err.message);
    res.redirect('/calendar.html?error=' + encodeURIComponent(err.message));
  }
});
