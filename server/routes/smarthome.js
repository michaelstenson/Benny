// Smart home status + control. Stage 8a proved the Resideo connection
// end to end (read-only); Stage 8b added thermostat control. Stage 8c
// added shade status, read from Supabase rather than a live device call —
// see server/routes/smarthome.js's /smarthome/shades handler and the
// powerview-bridge/ folder for why (PowerView's hub is local-network-only,
// so a Raspberry Pi on the home network polls it and pushes status into
// Supabase, the same shape as the RentCast weekly cron, just triggered
// from home instead of Vercel).

import { Router } from 'express';
import {
  refreshAccessToken,
  fetchLocations,
  extractThermostats,
  fetchThermostat,
  submitThermostatControl,
} from '../lib/resideoClient.js';
import { loadResideoTokens, saveResideoTokens } from '../lib/resideoTokenStore.js';
import {
  refreshAccessToken as refreshHomeConnectAccessToken,
  fetchAppliances,
  fetchApplianceStatus,
  summarizeAppliance,
} from '../lib/homeConnectClient.js';
import { loadHomeConnectTokens, saveHomeConnectTokens } from '../lib/homeConnectTokenStore.js';
import { supabase } from '../lib/supabaseClient.js';

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

// PATCH /api/smarthome/thermostats/:deviceId — change mode and/or
// setpoint(s). Body: { locationId, mode?, heatSetpoint?, coolSetpoint? }.
// Reads the device's current changeableValues fresh (not from whatever
// the browser last saw, which could be stale) and merges the requested
// change on top, since Resideo requires the full object on every write.
smarthomeRouter.patch('/smarthome/thermostats/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { locationId, mode, heatSetpoint, coolSetpoint } = req.body || {};

  if (!locationId) {
    return res.status(400).json({ error: 'locationId is required.' });
  }

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return res.status(401).json({ error: 'The thermostat is not connected yet.' });
    }

    const current = await fetchThermostat(accessToken, { locationId, deviceId });
    const changeableValues = {
      ...current.changeableValues,
      ...(mode !== undefined && { mode }),
      ...(heatSetpoint !== undefined && { heatSetpoint }),
      ...(coolSetpoint !== undefined && { coolSetpoint }),
    };

    await submitThermostatControl(accessToken, { locationId, deviceId, changeableValues });
    res.json({ ok: true });
  } catch (err) {
    console.error('[smarthome] failed to update thermostat:', err.message);
    res.status(500).json({ error: err.message || 'Could not update the thermostat.' });
  }
});

// GET /api/smarthome/shades — the latest position/battery status the
// Raspberry Pi bridge (powerview-bridge/) last pushed for each shade.
// This never talks to the PowerView hub directly (it can't — the hub
// only answers on the home LAN) — it just reads whatever Supabase row
// the bridge most recently upserted.
smarthomeRouter.get('/smarthome/shades', async (req, res) => {
  try {
    const { data: shades, error } = await supabase
      .from('powerview_shades')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json({ shades: shades || [] });
  } catch (err) {
    console.error('[smarthome] failed to load shades:', err.message);
    res.status(500).json({ error: 'Could not load shade status.' });
  }
});

// Same refresh-if-needed pattern as getValidAccessToken() above, just
// against the Home Connect token store instead of Resideo's.
async function getValidHomeConnectAccessToken() {
  const stored = await loadHomeConnectTokens();
  if (!stored?.refresh_token) return null;

  const expiresSoon = !stored.expiry_date || Date.now() > stored.expiry_date - 60_000;
  if (!expiresSoon) return stored.access_token;

  const fresh = await refreshHomeConnectAccessToken(stored.refresh_token);
  await saveHomeConnectTokens(fresh);
  return fresh.access_token;
}

// GET /api/smarthome/homeconnect/status — lets the frontend ask "are the
// kitchen appliances connected?" without triggering an actual Home
// Connect API call.
smarthomeRouter.get('/smarthome/homeconnect/status', async (req, res) => {
  try {
    const stored = await loadHomeConnectTokens();
    res.json({ connected: Boolean(stored?.refresh_token) });
  } catch (err) {
    console.error('[smarthome] Home Connect status check failed:', err.message);
    res.status(500).json({ error: 'Could not check Home Connect connection status.' });
  }
});

// GET /api/smarthome/homeconnect/appliances — read-only status for every
// paired appliance (the Thermador hood, the Bosch dishwasher, and
// anything else added to the Home Connect app itself). Control (starting
// a program, changing hood fan speed) is intentionally not built yet —
// see the README for why this first slice stops at status, same as how
// Resideo started read-only in Stage 8a before Stage 8b added control.
smarthomeRouter.get('/smarthome/homeconnect/appliances', async (req, res) => {
  try {
    const accessToken = await getValidHomeConnectAccessToken();
    if (!accessToken) {
      return res.status(401).json({ error: 'Kitchen appliances are not connected yet.' });
    }

    const appliances = await fetchAppliances(accessToken);
    const summaries = await Promise.all(
      appliances.map(async (appliance) => {
        try {
          const status = await fetchApplianceStatus(accessToken, appliance.haId);
          return summarizeAppliance(appliance, status);
        } catch (err) {
          // A disconnected/asleep appliance can fail its own status call
          // without that being a reason to hide it (or fail the whole
          // list) — still show it, just without live status fields.
          console.error(`[smarthome] status failed for ${appliance.haId}:`, err.message);
          return summarizeAppliance(appliance, []);
        }
      })
    );

    res.json({ appliances: summaries });
  } catch (err) {
    console.error('[smarthome] failed to fetch Home Connect appliances:', err.message);
    res.status(500).json({ error: 'Could not load kitchen appliance status.' });
  }
});
