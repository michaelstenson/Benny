# PowerView bridge

Runs on a Raspberry Pi (or any always-on machine) on your home network,
polling a PowerView Generation 3 hub's local API and pushing shade
status into Supabase. It exists because the hub only answers on the
home LAN — the main Benny app is hosted on Vercel and has no way to
reach it directly, but it can always read whatever this script last
wrote to Supabase. Same shape as the RentCast weekly comps cron, just
triggered from home instead of Vercel. See the root README's "Stage 8"
section for the full picture.

## Status: unverified against real hardware

PowerView's Gen 3 local API isn't officially documented, and this was
written before a real Gen 3 hub was available to test against — the
endpoint list and JSON field names in `hubClient.js` are a best guess
based on community reverse-engineering, not a confirmed spec.
**Run the discovery step below before trusting anything else here.**

## Setup

1. Create the `powerview_shades` table in Supabase — see the root
   README's "Stage 8" section for the SQL.
2. Find your hub's address on the home network (router's
   connected-devices list, or the PowerView app's gateway/hub info
   screen).
3. Get this folder onto the Pi — either `git clone` the whole repo
   there (simplest, and lets `git pull` update it later) or copy just
   this `powerview-bridge/` folder over.
4. Install Node on the Pi if it isn't already (e.g. via
   [NodeSource](https://github.com/nodesource/distributions) or `nvm`),
   then in this folder: `npm install`
5. `cp .env.example .env` and fill in `POWERVIEW_HUB_HOST` and the same
   `SUPABASE_URL` / `SUPABASE_ANON_KEY` the main app uses.
6. **Discover the real API shape first:**
   ```
   npm run discover
   ```
   This hits every candidate endpoint in `hubClient.js` and prints the
   raw response from each. Whichever one returns real shade data,
   update `fetchShadesRaw()` and `extractShades()` in `hubClient.js` to
   match it — paste the output to Claude if you want help finishing it.

   If every `https://` candidate fails with a certificate/TLS error
   (likely, since Gen 3 hubs typically use a self-signed cert), that's
   expected — it means the hub is reachable but Node is refusing the
   cert. That'll need `hubClient.js`'s fetch calls updated to accept it
   for this specific request (e.g. a custom `https.Agent` with
   `rejectUnauthorized: false`), which is fine here since it's a fixed
   IP on your own trusted home network, not a random internet host.
7. Test a single poll: `npm run once` — then check the
   `powerview_shades` table in Supabase filled in correctly.
8. Run for real: `npm start`. To keep it running across Pi reboots,
   set it up as a systemd service (ask Claude for the unit file once
   you're this far) rather than leaving a terminal window open.
