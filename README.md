# Benny 🐧

Benny is the Penguin Palace assistant — a shared app for Mer and Michael to run
their household: calendar, chores, mutual to-dos, bills, and pet care.

This repo is also Michael's hands-on build for the Overclock Accelerator
10-week AI program, so it's deliberately built in small, explained steps
rather than generated all at once.

## Stack

- **Backend:** Node.js + Express
- **Frontend:** static HTML/JS + Tailwind (via CDN, no build step yet)
- **Database:** Supabase (Postgres)
- **Assistant logic:** Claude API (added once we get past hello-world)
- **Hosting:** Vercel (added once local dev is solid)
- **Version control:** GitHub

## Project structure

```
benny/
├── index.js                # Express app entry point — start here
├── server/
│   ├── lib/
│   │   ├── supabaseClient.js   # two Supabase clients: anon (RLS-limited) and admin (service_role)
│   │   ├── googleClient.js     # builds the Google OAuth2 client
│   │   ├── tokenStore.js       # reads/writes your Google tokens in Supabase
│   │   ├── anthropicClient.js  # one shared Claude client
│   │   ├── choreParser.js      # turns free text into {title, assignee, due_date} via Claude tool use
│   │   ├── billParser.js       # turns free text into {category, amount, billing_month} via Claude tool use
│   │   ├── rentcastClient.js   # calls RentCast's AVM endpoint for a home value + comps
│   │   ├── compsSummary.js     # turns that data into a short plain-language paragraph via Claude
│   │   ├── resideoClient.js    # talks to Resideo's thermostat API directly (no SDK)
│   │   └── resideoTokenStore.js # reads/writes the one Resideo token row in Supabase
│   └── routes/
│       ├── hello.js       # GET /api/hello — the hello-world endpoint
│       ├── auth.js        # /auth/google + /auth/google/callback — the Google sign-in handshake
│       ├── calendar.js    # /api/calendar/status + /api/calendar/events
│       ├── chores.js      # /api/chores (GET/POST) + /api/chores/:id (PATCH)
│       ├── bills.js       # /api/bills (GET/POST) — includes the per-category summary
│       ├── comps.js       # /api/comps (GET) + /api/comps/refresh (GET, cron-only)
│       ├── resideoAuth.js # /auth/resideo + /auth/resideo/callback — the Resideo sign-in handshake
│       └── smarthome.js   # /api/smarthome/status, /thermostats (GET+PATCH), /shades
├── public/
│   ├── index.html         # the page you see at localhost:3000
│   ├── app.js              # browser-side JS that calls /api/hello
│   ├── calendar.html       # the calendar page
│   ├── calendar.js         # browser-side JS that calls /api/calendar/events
│   ├── chores.html         # the chores page
│   ├── chores.js           # browser-side JS for adding/listing/completing chores
│   ├── bills.html          # the bills page
│   ├── bills.js            # browser-side JS for adding bills and rendering the summary
│   ├── comps.html          # the home comps page
│   ├── comps.js            # browser-side JS that renders the estimate + comps table
│   ├── smarthome.html      # the smart home page
│   └── smarthome.js        # browser-side JS: thermostat status/control + shade status
├── powerview-bridge/        # standalone script that runs on a Raspberry Pi at home,
│                             # not part of the Vercel app — see its own README.md
├── .env.example            # template for required environment variables
├── .env                     # your real values (never committed — see .gitignore)
├── vercel.json              # tells Vercel explicitly how to build/route the app
└── package.json
```

> Note: `index.js` used to live at `server/index.js`. It moved to the
> project root in the "Deploying to Vercel" stage below — see that section
> for why.

## Running it locally

1. Install dependencies:
   ```
   npm install
   ```
2. Confirm `.env` has real values (it already does in this delivery — the
   Supabase URL and anon key are filled in). If you ever need to recreate it,
   copy `.env.example` to `.env` and fill it in.
3. Start the server:
   ```
   npm run dev
   ```
4. Open http://localhost:3000 in your browser. You should see the Benny
   card, and a status line that says "Hello from Benny 🐧" plus whether
   Supabase connected successfully.

`npm run dev` uses `nodemon`, which restarts the server automatically
whenever you edit a file — useful while we're actively building.

## What "hello world" proves

Three layers, one round trip:

1. Your **browser** loads `index.html` and runs `app.js`.
2. `app.js` calls `/api/hello` on the **Express** server.
3. The server calls **Supabase** (just a lightweight session check — no
   tables exist yet) and reports back whether that connection worked.

Once you can load the page and see "✅ Supabase is connected", every piece
of the stack is proven end to end and we're ready to build real features
on top of it — starting with the shared calendar.

## Stage 2: Google Calendar

This adds a "Connect Google Calendar" flow and a `/calendar.html` page that
lists upcoming events. Two setup steps are required beyond `.env.example`
that only you can do (they involve logging into your own accounts):

1. **Google OAuth credentials** — from a project in
   [console.cloud.google.com](https://console.cloud.google.com) with the
   Calendar API enabled. Add to `.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
   ```
2. **Supabase service_role key** — from your Supabase project's
   **Settings → API** page (it's below the anon/publishable key, labeled
   `service_role` — click "reveal"). Add to `.env`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
   This key bypasses Row Level Security entirely, which is exactly why the
   `google_tokens` table (holding OAuth tokens) has RLS turned on with
   no public policies — the regular anon key literally cannot read or write
   it. Only trusted server code (this app, never a browser) should ever
   hold this key.

Once both are in `.env`, restart the server (`npm run dev` picks up new
env vars on restart, not automatically), open http://localhost:3000/calendar.html,
and click **Connect Michael's calendar** (or Mer's — see below).

### Two people, one app: how "who's connecting" works

Michael and Mer each connect their own Google account separately, and
Benny merges both calendars into one read-only, chronologically sorted
list (each event tagged with an `owner` so the UI can show a colored dot
per person). There's exactly one Google Cloud project and one OAuth app —
you don't create separate credentials per person — but two rows in
`google_tokens` (`id = 'michael'`, `id = 'mer'`), one per connected
account.

The mechanism: `/auth/google/:owner` (`michael` or `mer`) redirects to
Google with that owner stashed in OAuth's `state` parameter; Google
echoes `state` back verbatim to `/auth/google/callback`, which is how a
single shared callback route knows whose tokens it just received. This
only works because the redirect URI is identical for both people — it's
registered once in Google Cloud Console and never changes.

**One Google Cloud Console step this needs**: if the OAuth consent
screen is still in **Testing** mode (the default until you submit for
verification), only email addresses explicitly added as **test users**
can complete sign-in — so add Mer's Google account email under
**APIs & Services → OAuth consent screen → Test users** before she tries
to connect, or her attempt will fail at Google's consent screen before
it ever reaches Benny.

Do **not** create a Gmail API connector or grant any Gmail scope for
this. Calendar and Gmail are separate Google APIs with separate
permissions — Benny only ever requests
`https://www.googleapis.com/auth/calendar.readonly` (see
`server/lib/googleClient.js`), which covers reading calendar events and
nothing about email. Reading email, or writing new events instead of
just displaying them, would each need their own, broader scope granted
deliberately later — neither is needed for read-only calendar display.

## Stage 3: Natural-language chores

Adds a `/chores.html` page: type something like "remind Mer to water the
plants Thursday", and Benny turns it into a real chore with a title,
an assignee, and a due date — this is the first feature where the app
itself calls Claude, not just Supabase or Google.

**How it works:** `server/lib/choreParser.js` sends your sentence to Claude
using a feature called *tool use* (function calling). Instead of asking
Claude to reply with some JSON and hoping it's formatted correctly, we hand
it a strict schema — `{ title, assignee, due_date }`, with `assignee`
restricted to exactly `"michael"` or `"mer"` — and Claude is forced to fill
in those exact fields. We also tell it today's date in the prompt, so it
can resolve "Thursday" or "tomorrow" into a real calendar date.

**Setup:** add your Anthropic API key to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Get one from [console.anthropic.com](https://console.anthropic.com) →
**API Keys** → **Create Key**. Note this is a *separate* account/product
from your regular Claude.ai chat login — the API bills per use (pay-as-you-go),
not through a Claude subscription. You'll likely need to add a small amount
of credit/billing there before requests succeed.

A design choice worth noting: unlike `google_tokens`, the `chores` table
does **not** have Row Level Security enabled. It doesn't hold credentials —
just household task text — and only our own server ever touches it, so the
extra lockdown wasn't worth the complexity here. `google_tokens` earns RLS
because a leaked OAuth token is a real problem; a leaked "water the plants"
is not.

Worth noting: since every chore already has an `assignee` (Michael or Mer),
this single feature effectively covers "mutual to-do assignment" from the
original feature list too — there isn't a separate to-do system.

## Stage 4: Home energy/bills analyzer

Adds a `/bills.html` page: type something like "electric bill was $142.50
for August", and Benny logs it, then shows a per-category summary (latest
amount, plus how it compares to the previous bill in that category) above
a full chronological history.

**How it works:** `server/lib/billParser.js` uses the same Claude tool-use
pattern as chores, extracting `{ category, amount, billing_month }`. Unlike
`chores.assignee`, `category` is deliberately **not** restricted to a fixed
list — households have all kinds of bills, so Claude is instructed to
normalize synonyms into a consistent lowercase label (e.g. "power" or
"ComEd" → "electric") rather than being locked to a preset menu. The
"analyzer" part is `summarizeByCategory()` in `server/routes/bills.js`,
which groups entries by category and computes the percent change between
the two most recent bills in each one.

No new setup is needed for this stage — it reuses the same `ANTHROPIC_API_KEY`
from Stage 3.

## Stage 7: Home sale comps tracker

Michael and Mer are planning a move abroad, with the condo likely going up for sale around
June/July 2027. This stage adds a `/comps.html` page that watches comparable home sales/listings
in Logan Square, so they can casually track the market well ahead of listing — a real once-a-week
"how's the neighborhood doing" glance, not something to obsess over daily.

**Why not just use Zillow or Redfin directly?** Neither has a public API anymore, and both
explicitly prohibit automated collection of their listing data in their terms of service — that
restriction is about the site, not about which tool does the fetching, so there's no compliant
way to have Benny pull data from them automatically.

**What Benny uses instead:** [RentCast](https://www.rentcast.io/api)'s free developer tier (50
requests/month, $0/mo) — specifically their `/v1/avm/value` endpoint. One call returns both an
estimated home value *and* the actual comparable properties RentCast used to calculate it
(address, price, sqft, beds/baths, status, days on market, distance, and a similarity score) —
this is effectively an automated realtor CMA (comparative market analysis) in a single request.

**How it works:**
- `server/lib/rentcastClient.js` calls RentCast with your house's own details — address, property
  type, bedrooms/bathrooms, square footage — all read from `.env`, not hardcoded, so remeasuring
  the place or fixing a typo is a config edit, not a code change. `HOME_ADDRESS` never appears in
  the repo, this README, or anywhere else — same treatment as your other secrets.
- `server/lib/compsSummary.js` turns that data into a short plain-language paragraph via Claude.
  This is a different pattern than `choreParser.js`/`billParser.js`: those force a strict schema
  with tool use because we needed reliable structured fields out of messy sentences. Here it's the
  opposite — the data's already clean and structured, and we want Claude to do what it's naturally
  good at: turning numbers into a couple of readable sentences. No `tool_choice` needed.
- `server/routes/comps.js` has two routes: `GET /api/comps` (read-only — what the page calls,
  reads the latest pull from Supabase, never talks to RentCast directly) and
  `GET /api/comps/refresh` (does the actual RentCast pull, only meant to be triggered by the
  weekly cron job below).
- Two new Supabase tables: `home_value_estimates` (one row per pull — this is the "trend over
  time" series) and `home_comps` (one row per comparable property, linked to the pull it came
  from). Same RLS-off treatment as `chores`/`bills` — no credentials in here.

**The weekly job:** `vercel.json` now includes a `crons` entry that hits `/api/comps/refresh`
every Monday. Vercel Cron Jobs always invoke via `GET` (not `POST`), which is why refresh is a GET
route even though it changes data. It's protected by a `CRON_SECRET` environment variable — set
that one variable in Vercel, and Vercel *automatically* sends it back as an
`Authorization: Bearer <CRON_SECRET>` header whenever it triggers the job, so the route can verify
the request actually came from Vercel's scheduler and not a stranger poking the URL. No manual
pairing needed beyond setting the variable. (Cron jobs only run against your *production*
deployment, and — on Vercel's free Hobby plan — at most once a day, which weekly is well within.)

**Why weekly, and when that should change:** RentCast's free tier is 50 requests/month; weekly
pulls use about 4-5 of those, leaving plenty of headroom. The data itself doesn't really reward
checking more often than that this far from listing. Worth increasing to 2-3x/week once you're
within a couple months of actually listing (around Q1-Q2 2027), to catch newly-listed competing
homes faster while deciding on price and timing.

**Comp matching:** a ~0.4 mile radius (`HOME_COMP_RADIUS_MILES`) — the same "neighborhood-standard"
range a real appraiser or listing agent uses for a CMA — and 10 comps per pull
(`HOME_COMP_COUNT`). The condo is registered as `HOME_PROPERTY_TYPE=Condo` (not `Townhouse`) even
though it looks and lives like a rowhouse — it's legally a condominium (HOA, shared entry hallway),
and Chicago prices true townhouses differently, so getting this field right matters for comp
accuracy.

**Setup:**
```
RENTCAST_API_KEY=...       # from app.rentcast.io — free tier, no credit card needed
HOME_ADDRESS=...           # your full street address
CRON_SECRET=...            # any random 16+ character string you generate yourself
```
`HOME_PROPERTY_TYPE`, `HOME_BEDROOMS`, `HOME_BATHROOMS`, `HOME_SQUARE_FOOTAGE`,
`HOME_COMP_RADIUS_MILES`, and `HOME_COMP_COUNT` all have sensible defaults already set in
`.env.example` — only override them if something changes. Once deployed with these set in Vercel's
Production environment, the first pull happens automatically on the next Monday, or you can
trigger one immediately by visiting `/api/comps/refresh` with the right `Authorization` header
(or just temporarily unset `CRON_SECRET` in `.env` for one local test run).

**Scoped out of v1, on purpose:** Cook County's official property sale records were considered as
a free way to cross-check RentCast's numbers against actual recorded closings, but their open data
doesn't support searching by address/radius directly — it would mean joining PIN numbers across
three separate datasets (sales, property characteristics, address lookup). That's a lot of added
complexity for what the single RentCast call already covers well. Worth revisiting later.

## Stage 8: Smart home awareness

Adds a `/smarthome.html` page showing live thermostat status and
control (Resideo), plus shade status pushed in from a Raspberry Pi on
the home network (PowerView). Built in three slices — 8a proved the
Resideo connection read-only, 8b added control, 8c added shades.

### 8a: Thermostat status (read-only)

Shows each thermostat's current indoor temperature, mode
(heat/cool/auto), and setpoint, pulled live from your Resideo
(Honeywell Home) account. The first slice of "smart home awareness" —
just proving the connection, the same spirit as Stage 1's hello-world.

**How it works:** `server/lib/resideoClient.js` talks to Resideo's REST
API directly with `fetch()` (there's no SDK like `googleapis` for this
one). `server/routes/resideoAuth.js` handles the "Connect thermostat"
OAuth handshake — simpler than the Google flow since there's only ever
one household thermostat account to connect, not two people's separate
accounts, so there's no `state`-based owner routing needed.
`server/routes/smarthome.js` exposes `/api/smarthome/status` (connected
or not) and `/api/smarthome/thermostats` (the live data), refreshing the
access token first if it's expired or about to be.

**A real gotcha that shaped `resideoTokenStore.js`:** Google only issues
a new `refresh_token` the first time you consent, and quietly reuses the
old one after that (see `tokenStore.js`'s merge logic). Resideo does the
opposite — every single exchange or refresh call returns a brand new
`refresh_token`, and the previous one stops working immediately. So
`resideoTokenStore.js` always overwrites the stored refresh token rather
than falling back to the old value. Getting this backwards would work
fine for the first ~few minutes (until the access token expires) and
then silently break the connection.

**Data model:** one new Supabase table, `resideo_tokens` — a single row
(`id = 'household'`) rather than one-per-person like `google_tokens`,
since Resideo connects once for the whole house. Same RLS-on,
no-public-policies treatment as `google_tokens`, since it holds
credentials.

**Setup:**
```
RESIDEO_CLIENT_ID=...
RESIDEO_CLIENT_SECRET=...
RESIDEO_REDIRECT_URI=http://localhost:3000/auth/resideo/callback
```
Register an app at [developer.honeywellhome.com](https://developer.honeywellhome.com/api-methods)
to get the client id/secret. There's no sandbox or simulator — this only
works against a real Resideo thermostat already on your account. Like
Google, the production `RESIDEO_REDIRECT_URI` needs to point at the live
domain once deployed, added as an environment variable in Vercel.

### 8b: Thermostat control

Adds mode (Off/Heat/Cool/Auto) and setpoint control to the same page —
`PATCH /api/smarthome/thermostats/:deviceId`, body
`{ locationId, mode?, heatSetpoint?, coolSetpoint? }`.

**A real gotcha:** Resideo's control endpoint takes a full
`changeableValues` object on every write and replaces it wholesale —
sending just `{ heatSetpoint: 70 }` risks the API rejecting the request
or dropping fields you didn't mean to touch (`autoChangeoverActive`,
etc.). So the route does a read-modify-write: `fetchThermostat()` pulls
the device's current `changeableValues` fresh (not whatever the browser
last saw, which could be stale), merges in only the field(s) actually
changing, then submits the merged object. Auto mode needs both
`heatSetpoint` and `coolSetpoint` together, which is why the frontend
shows two setpoint fields only when Auto is selected.

### 8c: PowerView shades, via a Raspberry Pi bridge

Adds a "Shades" section to the same page, showing each shade's position,
tilt (if applicable), and battery status. Unlike the thermostat, this
page never talks to the shade hub directly — Hunter Douglas's PowerView
hub only exposes its API on the home's local network, which a
Vercel-hosted app has no way to reach (unlike Resideo, which is a real
cloud API). Instead, a small Node script in `powerview-bridge/` runs on
a Raspberry Pi on the home network, polls the hub, and pushes shade
status into a new Supabase table, `powerview_shades` — the exact same
shape as the RentCast weekly comps cron, just triggered from a device at
home instead of a Vercel cron job. `GET /api/smarthome/shades` just
reads whatever the Pi last wrote.

**Status:** the Pi bridge's hub client was written before a real Gen 3
hub was available to test against — PowerView's Gen 3 local API isn't
officially documented, so the endpoint paths and response shape in
`powerview-bridge/hubClient.js` are a best guess from community
reverse-engineering, not confirmed. `powerview-bridge/README.md` has a
`npm run discover` step specifically for verifying (and fixing, if
needed) that guess against the real hub once it's reachable.

**Data model:**
```sql
create table powerview_shades (
  id text primary key,
  name text not null,
  room_name text,
  primary_position integer,
  tilt_position integer,
  battery_status text,
  updated_at timestamptz not null default now()
);
```
No RLS — same as `chores`/`home_value_estimates`/`home_comps`: it's
device status, not credentials, and only this app's own server and the
Pi bridge (both holding the key privately) ever touch it.

**Setup:** see `powerview-bridge/README.md` for the full walkthrough
(finding the hub's address, installing Node on the Pi, the discovery
step, and running it long-term via systemd).

**Scoped out, on purpose:**
- **Shade control** (moving a shade from the app) — the Pi → Supabase
  → app path above is one-way (status only). Controlling a shade would
  need a command channel back to the Pi (e.g. a small command queue
  table it polls), which is meaningfully more infrastructure and isn't
  built yet.
- **Any automation/decision-making** — this stage doesn't reason about
  anything; it just displays current state.

## Deploying to Vercel

Benny is deployed at **https://benny-quincy5.vercel.app** — Vercel is
connected directly to this GitHub repo, so every `git push` to `main`
automatically triggers a new deployment. No separate "deploy" step needed.

**What had to change to make this work:** the first two deploy attempts
"succeeded" in well under a second each and produced a site with nothing
running behind it — hitting `/api/hello` returned a 404, meaning Express
never actually ran; Vercel had just quietly deployed a static site instead.
Two separate things needed fixing:

1. **Entry file location.** Vercel's zero-config support for Express apps
   looks for an entry file named `index`, `app`, or `server` (`.js`/`.ts`/etc.)
   **at the project root or under `src/`**. Our entry point was
   `server/index.js` — one folder off from where Vercel looks. Fixed by
   moving it to `index.js` at the project root (and updating `package.json`'s
   `main`/`start`/`dev` to match). Everything else — routes, lib, public —
   stayed exactly where it was; only the one entry file had to move.
2. **Explicit build config.** Even after the file moved, Vercel's automatic
   detection still wasn't picking it up reliably. Rather than keep guessing
   at undocumented detection behavior, we added a `vercel.json` that spells
   out explicitly how to build and route the app: run `index.js` as a
   Node.js serverless function (`@vercel/node`), send anything starting
   with `/api/` or `/auth/` to it, and let Vercel's filesystem serving handle
   everything else (which is what serves `public/**` automatically). This is
   the older, more battle-tested way to deploy an Express app on Vercel, and
   it doesn't depend on newer auto-detection working correctly.
   `index.js` also now only calls `app.listen()` when run directly (i.e.
   locally) — Vercel imports the file and uses its exported `app` instead of
   ever calling `.listen()` itself, since a serverless function doesn't keep
   a port open the way a normal server does.

This is also why the `public/` folder lives at the project root rather than
inside `server/`: on Vercel, `express.static()` is ignored entirely and
Vercel's own CDN serves `public/**` directly instead. Locally, `npm run dev`
still uses `express.static()` like always — the difference only matters in
production.

**Environment variables:** none of the `.env` values travel with `git push` —
`.env` is intentionally never committed. Each variable from `.env.example`
needs to be added separately in the Vercel dashboard under
**Project → Settings → Environment Variables** (Production environment).
One of them needs a production-specific value: `GOOGLE_REDIRECT_URI` must
point at the live domain's `/auth/google/callback`, not `localhost` — and
that live URL also needs to be added as an additional **Authorized redirect
URI** on the Google Cloud Console OAuth client (alongside the localhost one,
not replacing it), or Google will reject sign-in with a
`redirect_uri_mismatch` error.

**Access:** by default, Vercel puts new projects behind a login wall
(Vercel Authentication / SSO protection) — anyone without access to the
Vercel team gets bounced to a Vercel login page instead of the app. That's
been turned off for this project so the live URL above is publicly viewable
(useful for a sprint demo video, or for Mer to open it on her phone).

## Keeping GitHub up to date

This repo already lives at https://github.com/michaelstenson/Benny. Each
time a new stage lands (like this one), commit and push it from this folder:

```
git add -A
git commit -m "<short description of what changed>"
git push
```

`.env` never gets pushed — it's listed in `.gitignore` specifically because
it holds credentials that shouldn't end up in a public (or even private)
GitHub repo.

## Roadmap (in order)

1. ✅ Hello world — full stack wired together
2. ✅ Shared calendar that auto-populates from email (Google Calendar connected for both Michael and Mer, merged into one read-only list)
3. ✅ Natural-language chore list — confirmed working live
4. ✅ Mutual to-do assignment — covered by the chores feature (every chore has an assignee already)
5. ✅ Home energy/bills analyzer
6. ✅ Deployed live to Vercel
7. ✅ Home sale comps tracker — confirmed working live (RentCast free tier)
8. ✅ Visual redesign — "Harbor Lights" direction chosen and implemented (dark, neon edge-glow, family-color accents), shared across every page via `public/theme.css`
9. Pet vet visit / treatment / food scheduling
10. ⏳ Smart home awareness — Resideo thermostat status + control done; PowerView shades bridge (Raspberry Pi + `powerview-bridge/`) built but unverified against real Gen 3 hardware — needs the `npm run discover` step once the Pi is set up (see Stage 8 above)
