// Read-only smart home status — Stage 8a. Just proves the Resideo
// connection end to end (current thermostat mode/temp/setpoint); no
// control, no shades yet, no automation logic. See README "Stage 8" for
// why shades aren't here yet (PowerView's hub is local-network-only,
// which doesn't reach a Vercel-hosted app the way Resideo's cloud API does).

import { Router } from 'express';
import { refreshAccessToken, fetchLocations, extractThermostats } from '../lib/resideoClient.js';
import { loadResideoTokens, saveResideoTokens } from '../lib/resideoTokenStore.js';

export const smarthomeRouter = Router();

// Returns a usable access token, refreshing first if the stored one has
// expired (or is about to, within 60s) — Resideo access tokens are
// short-lived (minutes, not the ~1hr Google gives you), so refreshing on
// every call here is the normal case, not an edge case.
async function getValidAccessToken() {
  const stored = await loadResideoTokens();
  if (!stored?.refresh_token) return null;

  const expiresSoon = !stored.expiry_date || Date.now() > stored.expiry_date - 60_000;
  if (!expiresSoon) return stored.access_token;

  const fresh = await refreshAccessToken(stored.refresh_token);
  await saveResideoTokens(fresh);
  return fresh.access_token;
}

// GET /api/smarthome/status — lets the frontend ask "is the thermostat
// connected?" without triggering an actual Resideo API call.
smarthomeRouter.get('/smarthome/status', async (req, res) => {
  try {
    const stored = await loadResideoTokens();
    res.json({ connected: Boolean(stored?.refresh_token) });
  } catch (err) {
    console.error('[smarthome] status check failed:', err.message);
    res.status(500).json({ error: 'Could not check thermostat connection status.' });
  }
});

// GET /api/smarthome/thermostats — the real feature: current mode, indoor
// temperature, and setpoint for every thermostat on the account.
smarthomeRouter.get('/smarthome/thermostats', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return res.status(401).json({ error: 'The thermostat is not connected yet.' });
    }

    const locations = await fetchLocations(accessToken);
    const thermostats = extractThermostats(locations);
    res.json({ thermostats });
  } catch (err) {
    console.error('[smarthome] failed to fetch thermostats:', err.message);
    res.status(500).json({ error: 'Could not load thermostat status.' });
  }
});
