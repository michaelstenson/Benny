// Handles the "Connect thermostat" handshake: send the user to Resideo,
// then receive them back with a one-time code we trade for real tokens.
// Simpler than auth.js's Google flow since there's only one household
// account to connect — no per-owner `state` needed.

import { Router } from 'express';
import { buildAuthorizeUrl, exchangeCodeForTokens } from '../lib/resideoClient.js';
import { saveResideoTokens } from '../lib/resideoTokenStore.js';

export const resideoAuthRouter = Router();

// GET /auth/resideo — the "Connect thermostat" button points here. We
// don't render anything ourselves; we just redirect straight to Resideo's
// own consent screen.
resideoAuthRouter.get('/resideo', (req, res) => {
  try {
    res.redirect(buildAuthorizeUrl());
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// GET /auth/resideo/callback — Resideo redirects the browser back here
// after you approve (or deny) access, with a `code` query param attached.
resideoAuthRouter.get('/resideo/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/smarthome.html?error=' + encodeURIComponent(String(error)));
  }
  if (!code) {
    return res.status(400).send('Missing authorization code from Resideo.');
  }

  try {
    const tokens = await exchangeCodeForTokens(String(code));
    await saveResideoTokens(tokens);
    res.redirect('/smarthome.html?connected=1');
  } catch (err) {
    console.error('[auth] Resideo OAuth callback failed:', err.message);
    res.redirect('/smarthome.html?error=' + encodeURIComponent(err.message));
  }
});
