// Handles the "Connect kitchen appliances" handshake: send the user to
// Home Connect, then receive them back with a one-time code we trade for
// real tokens. Same shape as resideoAuth.js — one household account, no
// per-owner `state` needed.

import { Router } from 'express';
import { buildAuthorizeUrl, exchangeCodeForTokens } from '../lib/homeConnectClient.js';
import { saveHomeConnectTokens } from '../lib/homeConnectTokenStore.js';

export const homeConnectAuthRouter = Router();

// GET /auth/homeconnect — the "Connect kitchen appliances" button points
// here. We don't render anything ourselves; we just redirect straight to
// Home Connect's own consent screen.
homeConnectAuthRouter.get('/homeconnect', (req, res) => {
  try {
    res.redirect(buildAuthorizeUrl());
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// GET /auth/homeconnect/callback — Home Connect redirects the browser
// back here after you approve (or deny) access, with a `code` query
// param attached.
homeConnectAuthRouter.get('/homeconnect/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/smarthome.html?error=' + encodeURIComponent(String(error)));
  }
  if (!code) {
    return res.status(400).send('Missing authorization code from Home Connect.');
  }

  try {
    const tokens = await exchangeCodeForTokens(String(code));
    await saveHomeConnectTokens(tokens);
    res.redirect('/smarthome.html?connected=1');
  } catch (err) {
    console.error('[auth] Home Connect OAuth callback failed:', err.message);
    res.redirect('/smarthome.html?error=' + encodeURIComponent(err.message));
  }
});
