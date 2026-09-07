// Talks to RentCast's Automated Valuation Model (AVM) endpoint. One call
// returns both an estimated home value AND the actual comparable properties
// RentCast used to calculate it — which is effectively an automated realtor
// CMA (comparative market analysis), so we don't need a separate "search for
// comps" step.
//
// Docs: https://developers.rentcast.io/reference/value-estimate

const RENTCAST_BASE_URL = 'https://api.rentcast.io/v1';

if (!process.env.RENTCAST_API_KEY) {
  console.warn(
    '[rentcast] RENTCAST_API_KEY is missing from .env — the home comps tracker will not work until it is set.'
  );
}
if (!process.env.HOME_ADDRESS) {
  console.warn(
    '[rentcast] HOME_ADDRESS is missing from .env — the home comps tracker will not work until it is set.'
  );
}

// Your house's own details, read from .env rather than hardcoded — so if
// you ever remeasure the square footage or the property type changes, it's
// a config edit, not a code change. HOME_ADDRESS in particular never leaves
// your own machine/server: it's not in the repo, README, or any chat.
function getHomeProfile() {
  return {
    address: process.env.HOME_ADDRESS,
    propertyType: process.env.HOME_PROPERTY_TYPE || 'Condo',
    bedrooms: Number(process.env.HOME_BEDROOMS || 3),
    bathrooms: Number(process.env.HOME_BATHROOMS || 2.5),
    squareFootage: Number(process.env.HOME_SQUARE_FOOTAGE || 2000),
    // ~0.4 miles is the "neighborhood-standard" CMA radius Michael chose —
    // roughly what a real appraiser or listing agent uses.
    maxRadius: Number(process.env.HOME_COMP_RADIUS_MILES || 0.4),
    compCount: Number(process.env.HOME_COMP_COUNT || 10),
  };
}

// Fetches a fresh value estimate + comps from RentCast for your house.
// Throws if HOME_ADDRESS or RENTCAST_API_KEY are missing/invalid, or if
// RentCast's API itself returns an error — the caller (the refresh route)
// is responsible for deciding what to do with that.
export async function fetchHomeValueEstimate() {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    throw new Error('RENTCAST_API_KEY is not set in .env');
  }

  const profile = getHomeProfile();
  if (!profile.address) {
    throw new Error('HOME_ADDRESS is not set in .env');
  }

  const params = new URLSearchParams({
    address: profile.address,
    propertyType: profile.propertyType,
    bedrooms: String(profile.bedrooms),
    bathrooms: String(profile.bathrooms),
    squareFootage: String(profile.squareFootage),
    maxRadius: String(profile.maxRadius),
    compCount: String(profile.compCount),
  });

  const response = await fetch(`${RENTCAST_BASE_URL}/avm/value?${params}`, {
    headers: {
      Accept: 'application/json',
      'X-Api-Key': apiKey,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`RentCast API error (${response.status}): ${body}`);
  }

  return response.json();
}
