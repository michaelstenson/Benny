// Today's weather for the digest / morning brief (Stage 20), from
// Open-Meteo — free, no API key, no account. Deliberately not the exact
// house: HOME_LATITUDE / HOME_LONGITUDE only need to be neighborhood-close
// for a forecast, and default to downtown Chicago if unset.

const DEFAULT_LATITUDE = 41.88;
const DEFAULT_LONGITUDE = -87.63;

// WMO weather codes (what Open-Meteo returns) → plain words.
// https://open-meteo.com/en/docs — "WMO Weather interpretation codes"
const WEATHER_WORDS = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Heavy rain showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms with hail',
  99: 'Thunderstorms with hail',
};

// Returns { summary, high_f, low_f, precip_chance } for today, or null if
// the forecast can't be fetched — weather is a nice-to-have in the brief,
// never a reason for the rest of it to fail.
export async function fetchTodaysWeather() {
  const latitude = Number(process.env.HOME_LATITUDE) || DEFAULT_LATITUDE;
  const longitude = Number(process.env.HOME_LONGITUDE) || DEFAULT_LONGITUDE;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    timezone: 'America/Chicago',
    forecast_days: '1',
  });

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    const { daily } = await response.json();

    return {
      summary: WEATHER_WORDS[daily.weather_code[0]] ?? 'Mixed',
      high_f: Math.round(daily.temperature_2m_max[0]),
      low_f: Math.round(daily.temperature_2m_min[0]),
      precip_chance: daily.precipitation_probability_max[0] ?? null,
    };
  } catch (err) {
    console.error('[weather] could not fetch forecast:', err.message);
    return null;
  }
}
