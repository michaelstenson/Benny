// Talks to a PowerView Generation 3 gateway over the home LAN. This API
// is NOT officially documented by Hunter Douglas/Somfy — everything here
// is reconstructed from community reverse-engineering (the same work
// Home Assistant's PowerView integration is built on), and Gen 3's local
// API is newer and less mapped-out than Gen 2's. Treat the endpoint list
// and field names below as a best guess, not a guarantee.
//
// Before relying on this for real, run `npm run discover` once the hub
// is reachable — it hits every candidate endpoint below and prints
// whichever ones respond with real JSON, so extractShades() can be
// corrected against the actual shape your gateway returns.

const CANDIDATE_ENDPOINTS = [
  // Gen 3 gateways are reported to serve local HTTPS with a self-signed
  // cert, unlike Gen 2's plain HTTP on port 80 — trying both since which
  // one your firmware actually uses isn't confirmed here.
  (host) => `https://${host}/home/shades`,
  (host) => `https://${host}/home/shades/positions`,
  (host) => `http://${host}/home/shades`,
  (host) => `http://${host}/api/shades`, // Gen 2's path, in case the hub answers both
];

async function tryEndpoint(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON — leave json null, text stays available below
    }
    return { url, ok: response.ok, status: response.status, json, text: json ? null : text.slice(0, 500) };
  } catch (err) {
    // Most likely causes: wrong host, hub unreachable from this network,
    // or (for https candidates) a self-signed cert Node's fetch refuses
    // by default — if every https candidate fails with a TLS/cert error,
    // see the README note about NODE_TLS_REJECT_UNAUTHORIZED.
    return { url, ok: false, error: err.message };
  }
}

export async function discoverHub(host) {
  const results = [];
  for (const buildUrl of CANDIDATE_ENDPOINTS) {
    results.push(await tryEndpoint(buildUrl(host)));
  }
  return results;
}

// Best-guess fetch of current shade data — once `discoverHub` confirms
// which candidate actually works, update this to use it directly.
export async function fetchShadesRaw(host) {
  const url = CANDIDATE_ENDPOINTS[0](host);
  const result = await tryEndpoint(url);
  if (!result.ok || !result.json) {
    throw new Error(
      `Could not fetch shades from ${url} (status ${result.status ?? 'n/a'}, ${result.error ?? 'no JSON body'}). ` +
        `Run "npm run discover" to find the right endpoint for your hub, then update fetchShadesRaw() to match.`
    );
  }
  return result.json;
}

// Normalizes whatever the hub returned into a flat list of
// { id, name, roomName, primaryPosition, tiltPosition, batteryStatus }.
// This is the part most likely to need hand-fixing once real data is
// available — the shape below is a best guess (shade positions as 0-100
// percentages, nested under a "positions" object), not a confirmed spec.
export function extractShades(raw) {
  const shades = raw.shadeData || raw.shades || raw;
  if (!Array.isArray(shades)) {
    throw new Error(
      'extractShades(): unexpected response shape — run "npm run discover" and update this function to match the real JSON.'
    );
  }

  return shades.map((shade) => ({
    id: String(shade.id ?? shade.shadeId ?? shade.serialNumber),
    name: shade.name ?? shade.shadeName ?? `Shade ${shade.id ?? shade.shadeId ?? ''}`.trim(),
    roomName: shade.roomName ?? null,
    primaryPosition: shade.positions?.primary ?? shade.positions?.posKind1 ?? null,
    tiltPosition: shade.positions?.tilt ?? null,
    batteryStatus: shade.batteryStatus ?? shade.battery?.status ?? null,
  }));
}
