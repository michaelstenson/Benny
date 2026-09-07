// Handles the "Connect Google Calendar" handshake: send the user to
// Google, then receive them back with a one-time code we trade for
// real tokens.
//
// Two people can connect their own calendar (Michael and Mer), so the
// route needs to know who's signing in. We can't just remember "who
// clicked the button" server-side — the redirect round-trips through
// Google and our server is stateless between requests — so we stash the
// owner in OAuth's `state` parameter, which Google echoes back verbatim
// on the callback.

import { Router } from 'express';
import { createOAuthClient, CALENDAR_SCOPE } from '../lib/googleClient.js';
import { saveTokens, OWNERS } from '../lib/tokenStore.js';

export const authRouter = Router();

// GET /auth/google/callback — Google redirects the browser back here
// after you approve (or deny) access, with `code` and `state` query
// params attached. This has to be registered BEFORE /google/:owner
// below, or Express would match "callback" as if it were an owner name.
authRouter.get('/google/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    // e.g. you clicked "Cancel" on Google's consent screen
    return res.redirect('/calendar.html?error=' + encodeURIComponent(String(error)));
  }
  if (!code) {
    return res.status(400).send('Missing authorization code from Google.');
  }

  const owner = OWNERS.includes(state) ? state : null;
  if (!owner) {
    return res
      .status(400)
      .send('Missing or unrecognized "state" — Benny couldn\'t tell who this sign-in was for.');
  }

  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(String(code));
    await saveTokens(owner, tokens);
    res.redirect(`/calendar.html?connected=${owner}`);
  } catch (err) {
    console.error('[auth] Google OAuth callback failed:', err.message);
    res.redirect('/calendar.html?error=' + encodeURIComponent(err.message));
  }
});

// GET /auth/google/:owner — the "Connect Michael's calendar" /
// "Connect Mer's calendar" buttons point here (/auth/google/michael,
// /auth/google/mer). We don't render anything ourselves; we just
// redirect straight to Google's own consent screen, with `owner`
// tucked into `state` so the callback above knows whose tokens these are.
authRouter.get('/google/:owner', (req, res) => {
  const { owner } = req.params;
  if (!OWNERS.includes(owner)) {
    return res.status(400).send(`Unknown calendar owner "${owner}".`);
  }

  const oauth2Client = createOAuthClient();

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // "offline" is what makes Google issue a refresh_token, not just a short-lived access_token
    prompt: 'consent', // forces the consent screen (and a fresh refresh_token) every time, which is handy while we're developing
    scope: [CALENDAR_SCOPE],
    state: owner,
  });

  res.redirect(url);
});
