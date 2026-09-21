// Low-level HTTP calls to BSH's Home Connect API — the platform behind
// Bosch, Siemens, Gaggenau, and (in North America) Thermador appliances.
// Same shape as resideoClient.js: no official SDK, plain fetch() calls.
//
// Two real differences from Resideo worth knowing:
// 1. Home Connect authenticates token requests with client_id/client_secret
//    as regular POST body fields, not HTTP Basic auth.
// 2. Every Home Connect API call needs an
//    `Accept: application/vnd.bsh.sdk.v1+json` header — a generic
//    `application/json` Accept header gets rejected. Easy to miss since
//    nothing in the OAuth flow itself hints at it.
//
// HOMECONNECT_API_BASE defaults to the real API, but Home Connect also
// runs a full simulator at https://simulator.home-connect.com that
// behaves identically without needing real hardware paired — genuinely
// useful for proving this connection locally before testing against the
// actual hood/dishwasher, unlike Resideo (no sandbox at all).

const DEFAULT_API_BASE = 'https://api.home-connect.com';
const SDK_ACCEPT_HEADER = 'application/vnd.bsh.sdk.v1+json';

// NOT independently verified against a real Home Connect developer app
// yet — this is the scope set Home Connect's docs describe for reading
// appliance status/settings and controlling a hood + dishwasher. The
// authorize call will only actually grant whatever subset was selected
// when the app was registered at developer.home-connect.com, so treat
// this as a starting point to confirm once real credentials exist, not
// a guarantee.
const DEFAULT_SCOPES = [
  'IdentifyAppliance',
  'Hood-Control',
  'Hood-Settings',
  'Dishwasher-Control',
  'Dishwasher-Settings',
  'Dishwasher-Monitor',
];

function apiBase() {
  return process.env.HOMECONNECT_API_BASE || DEFAULT_API_BASE;
}

function requireCredentials() {
  const clientId = process.env.HOMECONNECT_CLIENT_ID;
  const clientSecret = process.env.HOMECONNECT_CLIENT_SECRET;
  const redirectUri = process.env.HOMECONNECT_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'HOMECONNECT_CLIENT_ID, HOMECONNECT_CLIENT_SECRET, and HOMECONNECT_REDIRECT_URI must all be set in .env.'
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// Sends you to Home Connect's own consent screen. Like Resideo, there's
// only one household account to connect — no per-owner `state` needed.
export function buildAuthorizeUrl() {
  const { clientId, redirectUri } = requireCredentials();
  const url = new URL(`${apiBase()}/security/oauth/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', DEFAULT_SCOPES.join(' '));
  return url.toString();
}

async function requestToken(body) {
  const { clientId, clientSecret } = requireCredentials();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);

  const response = await fetch(`${apiBase()}/security/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `Home Connect token request failed: ${data.error_description || data.error || response.status}`
    );
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
  return requestToken(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }));
}

async function homeConnectGet(path, accessToken) {
  const response = await fetch(`${apiBase()}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: SDK_ACCEPT_HEADER,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Home Connect request failed: ${data.error?.description || response.status}`);
  }
  return data;
}

// GET /api/homeappliances — every appliance registered on the account
// (the hood and dishwasher, once both are paired in the Home Connect app
// itself — this API only sees appliances already set up there, it can't
// pair new ones).
export async function fetchAppliances(accessToken) {
  const data = await homeConnectGet('/api/homeappliances', accessToken);
  return data.data?.homeappliances || [];
}

// GET /api/homeappliances/{haId}/status — an array of { key, value, unit? }
// status entries (door open/closed, remaining program time, etc.) — which
// keys actually show up depends on the appliance type and what it's doing.
export async function fetchApplianceStatus(accessToken, haId) {
  const data = await homeConnectGet(`/api/homeappliances/${encodeURIComponent(haId)}/status`, accessToken);
  return data.data?.status || [];
}

// Shapes the raw appliance + status responses into something simple
// enough for the frontend to render without knowing Home Connect's own
// key naming (e.g. "BSH.Common.Status.DoorState").
export function summarizeAppliance(appliance, statusEntries) {
  const statusByKey = Object.fromEntries(statusEntries.map((s) => [s.key, s.value]));
  return {
    haId: appliance.haId,
    name: appliance.name,
    type: appliance.type, // e.g. "Hood", "Dishwasher"
    brand: appliance.brand,
    connected: Boolean(appliance.connected),
    doorState: statusByKey['BSH.Common.Status.DoorState'] ?? null,
    operationState: statusByKey['BSH.Common.Status.OperationState'] ?? null,
  };
}
