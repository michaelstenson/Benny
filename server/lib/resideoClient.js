// Low-level HTTP calls to Resideo's ("Honeywell Home") thermostat API.
// There's no official SDK like googleapis, so this is plain fetch() calls —
// see server/lib/googleClient.js for the equivalent Google piece.
//
// One real difference from Google worth knowing up front: Google only
// sends a new refresh_token the FIRST time you consent, and silently
// reuses the old one after that. Resideo does the opposite — it returns a
// brand new refresh_token on EVERY exchange/refresh call, and the old one
// stops working once you do. See resideoTokenStore.js, which always saves
// whatever refresh_token just came back rather than falling back to the
// old value the way tokenStore.js does for Google.

const RESIDEO_API_BASE = 'https://api.honeywellhome.com';

function requireCredentials() {
  const clientId = process.env.RESIDEO_CLIENT_ID;
  const clientSecret = process.env.RESIDEO_CLIENT_SECRET;
  const redirectUri = process.env.RESIDEO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'RESIDEO_CLIENT_ID, RESIDEO_CLIENT_SECRET, and RESIDEO_REDIRECT_URI must all be set in .env.'
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// Sends you to Resideo's own consent screen. Unlike Google's flow, there's
// only ever one household account to connect here (no per-owner `state`).
export function buildAuthorizeUrl() {
  const { clientId, redirectUri } = requireCredentials();
  const url = new URL(`${RESIDEO_API_BASE}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
}

// Both the initial code exchange and later refreshes hit the same
// /oauth2/token endpoint, authenticated with HTTP Basic auth (client
// id/secret) rather than a client_secret POST field.
async function requestToken(body) {
  const { clientId, clientSecret } = requireCredentials();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(`${RESIDEO_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Resideo token request failed: ${data.error_description || data.error || response.status}`);
  }
  return data; // { access_token, refresh_token, expires_in, ... }
}

export async function exchangeCodeForTokens(code) {
  const { redirectUri } = requireCredentials();
  return requestToken(
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  );
}

export async function refreshAccessToken(refreshToken) {
  return requestToken(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  );
}

// "Get all Locations and Devices" — one call returns every location on the
// account with its devices embedded, rather than a separate devices call
// per location. Resideo requires the client id as an `apikey` query param
// on every API call, in addition to the Bearer token.
export async function fetchLocations(accessToken) {
  const { clientId } = requireCredentials();
  const url = `${RESIDEO_API_BASE}/v2/locations?apikey=${encodeURIComponent(clientId)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Resideo locations request failed: ${data.message || response.status}`);
  }
  return data; // array of locations, each with a `devices` array
}

// Thermostats are identified by having `changeableValues` — Resideo
// locations can also contain other device types (sensors, etc.) that
// don't have it, so this is how we tell them apart without a dedicated
// per-device-type field to check.
export function extractThermostats(locations) {
  return locations.flatMap((location) =>
    (location.devices || [])
      .filter((device) => device.changeableValues)
      .map((device) => ({
        locationId: location.locationID,
        deviceId: device.deviceID,
        name: device.userDefinedDeviceName || device.name || 'Thermostat',
        units: device.units ?? null, // "Fahrenheit" or "Celsius", when the API includes it
        indoorTemperature: device.indoorTemperature ?? null,
        outdoorTemperature: device.outdoorTemperature ?? null,
        mode: device.changeableValues.mode ?? null,
        heatSetpoint: device.changeableValues.heatSetpoint ?? null,
        coolSetpoint: device.changeableValues.coolSetpoint ?? null,
      }))
  );
}
