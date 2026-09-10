// Runs on a Raspberry Pi (or any always-on machine) on the same home
// network as the PowerView Gen 3 hub. Polls it on an interval and
// upserts shade status into Supabase's `powerview_shades` table — the
// same shape as the RentCast weekly cron, just triggered from home
// instead of Vercel, because the hub's API only answers on the LAN. See
// README.md in this folder for setup, and the root README's "Stage 8"
// section for the full picture.
//
// Usage:
//   node poll.js              run forever, polling every POLL_INTERVAL_SECONDS
//   node poll.js --once       poll a single time, then exit (for testing)
//   node poll.js --discover   dump raw responses from every candidate hub
//                             endpoint, to verify/fix hubClient.js against
//                             your actual gateway

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { discoverHub, fetchShadesRaw, extractShades } from './hubClient.js';

const HUB_HOST = process.env.POWERVIEW_HUB_HOST;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS || 60);

if (!HUB_HOST || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('POWERVIEW_HUB_HOST, SUPABASE_URL, and SUPABASE_ANON_KEY must all be set in .env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function pollOnce() {
  const raw = await fetchShadesRaw(HUB_HOST);
  const shades = extractShades(raw);

  if (shades.length === 0) {
    console.log(`[${new Date().toISOString()}] Hub returned no shades.`);
    return;
  }

  const rows = shades.map((s) => ({
    id: s.id,
    name: s.name,
    room_name: s.roomName,
    primary_position: s.primaryPosition,
    tilt_position: s.tiltPosition,
    battery_status: s.batteryStatus,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('powerview_shades').upsert(rows);
  if (error) throw error;

  console.log(`[${new Date().toISOString()}] Pushed status for ${rows.length} shade(s).`);
}

async function runDiscover() {
  console.log(`Trying candidate endpoints against ${HUB_HOST}...\n`);
  const results = await discoverHub(HUB_HOST);

  for (const r of results) {
    console.log('---', r.url, '---');
    if (r.error) {
      console.log('  error:', r.error);
    } else if (r.json) {
      console.log('  status', r.status, '\n', JSON.stringify(r.json, null, 2).slice(0, 2000));
    } else {
      console.log('  status', r.status, '(non-JSON body)', r.text);
    }
    console.log();
  }

  console.log('Whichever response above looks like real shade data — send it back so hubClient.js can be finalized.');
}

const args = process.argv.slice(2);

if (args.includes('--discover')) {
  await runDiscover();
} else if (args.includes('--once')) {
  await pollOnce().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  console.log(`Polling ${HUB_HOST} every ${POLL_INTERVAL_SECONDS}s. Ctrl+C to stop.`);
  // Poll once immediately rather than waiting a full interval before the
  // first real data shows up.
  await pollOnce().catch((err) => console.error('[poll] failed:', err.message));
  setInterval(() => {
    pollOnce().catch((err) => console.error('[poll] failed:', err.message));
  }, POLL_INTERVAL_SECONDS * 1000);
}
