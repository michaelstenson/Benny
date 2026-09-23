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

**Update (Stage 8, security pass):** `chores` originally shipped without
Row Level Security, on the reasoning that it doesn't hold credentials and
only our own server touches it anyway. That reasoning was true of the
*code*, but not enforced at the *database* level — RLS off means the
`anon` key (the one this app was already using for these tables) can
read and write the table directly against Supabase, completely bypassing
the app. Supabase's own security advisor flagged this, so `chores`,
`bills`, `home_value_estimates`, and `home_comps` all now have RLS
enabled with no public policies — same treatment as `google_tokens` and
`resideo_tokens` — and their routes (`chores.js`, `bills.js`, `comps.js`)
were switched from the anon `supabase` client to `supabaseAdmin`
(service_role), which bypasses RLS for trusted server code. Net effect:
zero behavior change for the app itself, but the anon key can no longer
touch any of these tables directly.

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

## Stage 9: AI advice generator

Adds an `/advice.html` page: ask Benny any question and it answers with
two things — calm, grounded **guidance** for approaching the question
mindfully (not a direct answer or solution), plus a themed **haiku** with
the same reflective tone.

This feature has been through two shapes already. It originally returned
three playful asides at once on every answer (a magic-eight-ball verdict,
a haiku, and an absurd Great British Bake Off "egg wash" non sequitur) —
that got noisy fast, so a second revision cut it to one random playful
aside plus genuine guidance. After using it for real, the verdict and
egg-wash bits didn't add much, and what people actually wanted was the
guidance itself, refocused specifically on **mindfulness and stress
reduction** rather than generic "how to think about this." So: gone are
the verdict and egg-wash formats; the haiku stays, now always included
rather than one-in-three, and now shares the same calm tone as the
guidance instead of being "silly, wistful, or dramatic, whatever fits."

**How it works:** `server/lib/adviceGenerator.js` uses the same Claude
tool-use pattern as `choreParser.js`/`billParser.js` — a strict schema
(`{ guidance, haiku }`) rather than one blob of text to parse. The
`guidance` field's instructions explicitly ask for real mindfulness/
stress-reduction technique (present-moment awareness, breath, self-
compassion, letting go of urgency) *where it genuinely fits the
question* — deliberately not forcing a breathing exercise onto something
that's really just a logistics question — and to help the person find
some peace with the question before problem-solving it, not hand them an
answer. The same medical/legal/financial/safety guardrail from the
original version carries over unchanged: for anything serious, gently
point toward a real professional while still helping the person feel
grounded about it. Unlike the extraction-style prompts in
`choreParser.js`/`billParser.js`, this one asks for creative output, so
`temperature` stays turned up to `1` for variety between asks. Same model
as everywhere else in the app (`FAST_EXTRACTION_MODEL`, Haiku) — no
reason to pay for a bigger model for this. `server/routes/advice.js` is a
single `POST /api/advice` route that just passes the `{ guidance, haiku }`
shape through unchanged.

**No new setup needed** — this reuses the existing `ANTHROPIC_API_KEY`
from Stage 3. No new Supabase table either: answers aren't persisted,
this is meant to be a fun one-shot, not a record to keep.

**The loading state:** while Claude is thinking, three small penguins (in
the family colors) do a CSS keyframe waddle instead of a generic spinner
— `.hl-penguin`/`.hl-waddle` in `public/theme.css`.

**Scoped out of v1, on purpose:**
- **No history/"hall of fame" of past answers** — would need a new table;
  worth adding later if this gets used a lot.
- **No topic filtering beyond the system prompt** — the prompt tells
  Claude to keep serious topics (health/financial/legal/safety) gently
  redirected toward a real professional rather than actually answering
  them, but there's no hard keyword block list. Fine for a 2-person
  household app; would need revisiting if this were ever public-facing.

## Stage 10: Calendar ↔ chores digest

Adds a "Today" section to the homepage: a merged, at-a-glance view of
today's calendar events (both owners) and today's due-or-overdue open
chores — so the two lists that used to live on separate pages (`/calendar.html`,
`/chores.html`) finally answer "what's actually on my plate today" as one
glance instead of two page visits.

**How it works:** `GET /api/digest` (`server/routes/digest.js`) does pure
data-joining, no Claude involved — unlike chores/bills/advice, there's
nothing here for a language model to extract or generate. It reuses
`fetchEventsForOwner()` from `calendar.js` (now exported, and given a
`maxResults` option) rather than duplicating the Google Calendar call,
and a plain Supabase query — `completed = false AND due_date <= today` —
for chores, which naturally also picks up anything overdue (and just as
naturally excludes chores with no due date at all, since `NULL <= anything`
is never true in Postgres).

**A real gotcha:** the household is in Chicago, but Vercel runs
serverless functions in UTC — computing "today" from the server's own
clock would flip the digest over to tomorrow several hours before it
actually is locally. `localDateString()` in `digest.js` pins "today" to
`America/Chicago` explicitly (`Intl`/`toLocaleDateString`, no date
library needed) rather than trusting the server's own timezone.

**Another one, found while testing this locally:** a broken or expired
Google connection (an `invalid_grant` from a stale refresh token, in this
case) used to take down the *entire* digest, chores included, even
though chores have nothing to do with Google. Fixed by catching each
owner's calendar fetch independently inside `digest.js` and treating a
failed fetch the same way `fetchEventsForOwner()` already treats "not
connected yet" — contributes zero events, doesn't block the chores half.
This is specifically about the digest's own resilience; it does not fix
whatever is actually wrong with the stored Google token (see `/calendar.html`
if that page is also showing a calendar error — reconnecting there is the
real fix).

**No new setup, no new table** — reads from the two things Benny can
already see (`google_tokens` indirectly, via the existing calendar code
path, and `chores`).

**Scoped out of v1, on purpose:**
- **Chores/events beyond today** — no "this week" view yet; today-only
  keeps this a glance, not a second calendar page.
- **No notifications** — this is a widget you see when you open Benny,
  not a ping that reaches you elsewhere. An email/push digest was
  considered but deferred until it's clear the homepage widget alone
  isn't enough.

## Stage 11: Home screen icon

Adds a real "Add to Home Screen" experience on phones: a proper penguin
icon instead of a generic globe/browser icon, and — when launched from
the home screen — a standalone window (no browser address bar) themed to
match Harbor Lights, instead of just a bookmark that reopens Chrome/Safari.

**What was added:**
- `public/icons/icon-{180,192,512}.png` — the existing penguin mark,
  rasterized onto a solid `#211f2b` square (Harbor Lights' `--hl-bg-elev`)
  with generous padding, so Android's circular/squircle mask and iOS's
  own rounded-corner mask don't clip it. Deliberately *not* pre-rounded —
  the OS applies its own shape, and a doubly-rounded icon looks wrong.
- `public/manifest.json` — name, icons, `display: "standalone"`, and
  `background_color`/`theme_color` matching the app's dark theme.
- Every page's `<head>` now links the manifest and icons and sets
  `apple-mobile-web-app-*` meta tags. This has to be on *every* page, not
  just the homepage — iOS reads these from whichever page is open at the
  moment someone taps "Add to Home Screen," not from `index.html`
  specifically, so a page missing them would launch as a plain browser
  bookmark instead of a themed standalone app.

**How the icons were generated:** the project has no image-processing
dependency (and didn't need one for this) — the penguin SVG was rendered
onto an in-browser `<canvas>` at each size and posted to a one-off, since-
removed dev route that wrote the PNG bytes straight to disk. Avoids both
adding a native image dependency for a one-time task and hand-copying
large base64 strings through chat (error-prone at that length).

**Setup:** none — no new environment variables, no new Supabase table.

## Stage 12: Home Connect (kitchen appliances, status only)

Adds a "Kitchen appliances" section to the Smart Home page: connection
status for the Thermador range hood and the Bosch dishwasher. Both run
through **Home Connect**, BSH's shared platform for Bosch/Siemens/
Gaggenau/Thermador appliances — one integration covers both, the same
way one Resideo connection already covers thermostats.

**How it works:** `server/lib/homeConnectClient.js` mirrors
`resideoClient.js`'s shape closely (no SDK, plain `fetch()`), with two
real differences from Resideo worth knowing:
- Home Connect authenticates token requests with `client_id`/
  `client_secret` as regular POST body fields, not HTTP Basic auth like
  Resideo.
- Every API call needs an `Accept: application/vnd.bsh.sdk.v1+json`
  header — a plain `application/json` Accept header gets rejected, and
  nothing about the OAuth flow itself hints that this is needed.

`server/lib/homeConnectTokenStore.js` and `server/routes/homeConnectAuth.js`
follow `resideoTokenStore.js`/`resideoAuth.js` exactly — one household
row (`id = 'household'`), no per-person `state`. New Supabase table,
`home_connect_tokens`, same RLS-on/no-public-policies treatment as
`resideo_tokens`.

**This slice deliberately stops at status, not control** — same
progression as Stage 8a before Stage 8b added thermostat control. Two
things aren't nailed down yet and are worth confirming before building
control on top of them:
- **OAuth scopes** — `homeConnectClient.js` requests
  `IdentifyAppliance Hood-Control Hood-Settings Dishwasher-Control
  Dishwasher-Settings Dishwasher-Monitor`, based on Home Connect's public
  docs, not verified against a real registered app yet. The authorize
  call only ever grants whatever subset was selected when the OAuth
  client was registered at developer.home-connect.com, so this needs a
  real connection to confirm.
- **Refresh token rotation** — `homeConnectTokenStore.js` currently
  assumes Home Connect behaves like Google (keeps the same refresh token
  across refreshes) rather than like Resideo (issues a new one every
  time, invalidating the old one). Worth confirming empirically once
  tokens are actually flowing — get this wrong in the Resideo direction
  and the stored refresh token would silently go stale.

**A real advantage over Resideo:** Home Connect runs a full simulator at
`https://simulator.home-connect.com` — set `HOMECONNECT_API_BASE` to it
to prove the whole OAuth + status flow works *before* testing against
the real hood and dishwasher. Resideo has no equivalent; this was the
first slice of "smart home awareness" that could be dry-run without
real hardware on the line.

**Setup:**
```
HOMECONNECT_CLIENT_ID=...
HOMECONNECT_CLIENT_SECRET=...
HOMECONNECT_REDIRECT_URI=http://localhost:3000/auth/homeconnect/callback
```
Register an app at [developer.home-connect.com](https://developer.home-connect.com)
to get the client id/secret — same shape as the Resideo registration in
Stage 8a. Both the hood and dishwasher need to already be paired in the
Home Connect app itself first; this API only reads appliances that are
already set up there, it doesn't pair new ones.

**Found while building this, unrelated to Home Connect:** the
`powerview_shades` table documented in Stage 8c as already created
doesn't actually exist in Supabase — `/api/smarthome/shades` fails with
"Could not find the table." The PowerView bridge code and README both
assume it's there; it needs to actually be created before that part of
Stage 8c can work. Tracked as an open item, not fixed here.

## Stage 13: Google Calendar write access

Adds a "New event" box to `/calendar.html`: type something like "dinner
with the Hansens Friday at 7," review a plain-language preview of what
Benny understood, then confirm before it actually lands on a real
calendar. Benny can now create events, not just display them.

**Why the preview/confirm step, when chores don't have one:** a chore
that's slightly wrong is easy to fix or ignore. A wrong event lands on a
calendar you and Mer both see, possibly with the wrong date, time, or
person's calendar — a worse class of mistake, so this feature gets a
review step chores never needed. `POST /api/calendar/events/parse` only
ever reads the sentence (via the same Claude tool-use pattern as
`choreParser.js`) and returns a draft — nothing touches Google until a
separate `POST /api/calendar/events` call, sent only after the person
clicks "Add to calendar" on the exact preview they saw.

**Scope change, so everyone needs to reconnect:** Benny requested
`calendar.readonly` only until now. Creating events needs
`calendar.events` too (requested alongside readonly, not instead of it —
see `server/lib/googleClient.js`). Existing connections don't
automatically gain the new permission; both Michael and Mer need to
click "Connect ___'s calendar" again on `/calendar.html` to re-consent.
Confirmed locally: an event created against an old, readonly-only
connection fails cleanly with "Insufficient Permission" rather than
silently doing nothing or crashing — reconnecting is what fixes it.

**A real gotcha, sidestepped rather than solved:** getting a wall-clock
time like "7pm" onto the right UTC instant normally means computing a
timezone offset, including DST. Google's Calendar API accepts a
timezone-naive `dateTime` plus a separate IANA `timeZone` field (e.g.
`America/Chicago`) instead of a full offset — Benny hands over the local
time exactly as typed and lets Google resolve it, sidestepping the DST
math entirely rather than getting it wrong in a subtle way once a year.

**Setup:** none beyond reconnecting — same `GOOGLE_CLIENT_ID`/
`GOOGLE_CLIENT_SECRET` as Stage 2, no new environment variables.

**Scoped out of v1, on purpose:**
- **Editing or deleting events** — only creation. Google's own Calendar
  app remains the tool for changing/canceling something already on the
  calendar.
- **Gmail access** — deliberately not requested in this same reconnect,
  even though it's the same Google OAuth client. Gmail needs its own API
  enabled and its own scopes configured on the Data Access page in
  Google Cloud Console first; bundling an unconfigured scope into this
  authorize call would have broken calendar reconnecting for everyone,
  not just added Gmail. Its own dedicated stage, later.

## Stage 14: Gmail (read-only + draft-only compose)

Adds `/gmail.html`: a per-owner (not merged — email is personal in a way
a shared household calendar isn't) view of recent inbox messages, plus a
"create a test draft" form. The decision behind this stage: Benny gets
full read access, but is only ever allowed to *create drafts*, never
send. That's enforced in the code, not just as a scope choice —
`server/lib/gmailClient.js` has no function that calls Gmail's send
endpoint at all, only `drafts.create`. There is no path from Benny to a
sent email; a person always opens the draft in Gmail and sends it
themselves.

**Reuses Calendar's connection** — Gmail's scopes are requested
alongside `calendar.readonly`/`calendar.events` in the same Google OAuth
client, so there's no separate "Connect Gmail" flow or token table; it's
the same `google_tokens` rows Calendar already uses, just with a wider
scope grant once reconnected.

**Refactored while building this:** `authenticatedClientFor()` and
`clearIfDeadToken()` (the self-healing dead-token logic from the
calendar/chores digest work) moved from `calendar.js` into
`googleClient.js`, since both are generic to "any Google API call using
a household member's stored tokens" — Gmail needed the exact same
plumbing Calendar already had, so this avoided a second copy of it.

**Status: fully wired up, waiting on Michael and Mer to reconnect.**
Verified locally against the real Gmail API (before the scopes existed)
that both the read and draft-create paths work correctly end to end,
failing cleanly with "Insufficient Permission" against the existing
calendar-only-scoped tokens — exactly the expected state before the
scope is actually granted. What it took to get here:
1. Turn on 2-Step Verification on the Google account behind `benny-app`
   — Google began enforcing this platform-wide on September 21, 2026,
   for *any* new API enablement, not something specific to this project.
2. Enable the Gmail API in Google Cloud Console.
3. Add scopes on the OAuth consent screen's Data Access page — see
   below for which ones, and why not `gmail.compose`.
4. Add those scopes to `auth.js`'s authorize call alongside Calendar's,
   so one reconnect grants everything (done — see `googleClient.js`).

**The scope actually used is narrower than originally planned.**
`gmail.compose` ("Manage drafts and send emails," per Google's own
description) was the obvious choice, but Google Cloud Console's scope
picker surfaced `gmail.drafts.create` ("Compose new draft emails") —
exactly, and only, what `gmailClient.js` actually does. Used that
instead: `GMAIL_DRAFTS_CREATE_SCOPE` in `googleClient.js`, not
`GMAIL_COMPOSE_SCOPE`. Requesting the exact scope the code exercises,
when one exists, beats requesting a broader one "to be safe" — the
draft-only guarantee doesn't depend on Benny's own restraint alone
anymore, since the OAuth grant itself no longer includes send/delete
either way.

**One thing worth knowing for later:** Google Cloud Console classifies
`gmail.readonly` as a **restricted** scope (its highest sensitivity
tier — "highly sensitive user data"), one step above the "sensitive"
tier Calendar's scopes and `gmail.drafts.create` sit in. This doesn't
block anything while the app stays in "Testing" publishing status with
just the two of you as test users, but the "move to In production"
plan discussed for fixing Calendar's 7-day-refresh-token issue (see the
roadmap) may need a closer look at what restricted scopes require for
that transition — possibly more than the sensitive-scope-only
assumption that plan was based on.

**Setup:** none beyond the reconnect above — same `GOOGLE_CLIENT_ID`/
`GOOGLE_CLIENT_SECRET` as Calendar, no new environment variables, no new
Supabase table.

**Scoped out of v1, on purpose:**
- **No real feature built on top yet** — this stage proves the
  connection (read + draft-only write) the same way Stage 8a proved
  Resideo read-only before Stage 8b added control. What Benny actually
  *does* with Gmail access (drafting a reply to a vendor, surfacing an
  appointment confirmation) depends on the autonomous agent, which isn't
  scoped yet either — see the roadmap.
- **No inbox content surfaced anywhere in the UI** — see Stage 15, which
  walked this back on purpose after first shipping a "recent messages"
  list.

## Stage 15: Gmail — stop displaying the inbox, only Benny's own drafts

Stage 14 originally included a "recent messages" list on the Gmail page,
reading straight from `fetchRecentMessages()`. Michael clarified after
using it: the ask was for Benny to *have* Gmail access for future
automation, not to display any inbox content in the app. This stage
walks that back.

**What changed:**
- The page (renamed `/drafts.html`, was `/gmail.html`) no longer calls
  `fetchRecentMessages()` at all. That function and the underlying
  `gmail.readonly` scope are still there — kept specifically for future
  server-side automation (an agent reading a vendor's reply, say) — but
  nothing in the UI reads or displays inbox content anymore.
- The only Gmail content a person ever sees is a list of drafts **Benny
  itself created**, and it's sourced from a new Supabase table
  (`gmail_drafts` — RLS on, no public policies, same treatment as
  `chores`/`bills`) rather than a live Gmail API call. `POST
  /api/gmail/drafts` records `{ id, owner, to_address, subject,
  created_at }` there right after Gmail confirms the draft was created.
  This is a deliberately stronger guarantee than "the UI just doesn't
  call that endpoint" — even if something in a future feature *did* list
  every draft in the mailbox, this page still only shows what's in
  Benny's own table, never anything a person drafted themselves.
- An "Open in Gmail →" link points at the Drafts folder generally
  (`mail.google.com/mail/u/0/#drafts`) rather than deep-linking a
  specific draft — Gmail doesn't have a documented, stable URL format
  for that, so this doesn't try to be clever about it.
- The homepage tile is now "Drafts," not "Gmail" — the label matches
  what the page actually shows.

**Setup:** none beyond what Stage 14 already required.

## Stage 16: Timeline — a linear chores+events view, and a 6-week month grid

Adds `/timeline.html` with two toggled views, replacing the idea of one
"calendar+chores" view with two purpose-built ones — a scrolling
chronological list for "what's coming up," and a compact grid for "what
does the next month and a half look like."

**Timeline view:** open chores (including anything overdue, no matter
how late — an unresolved chore doesn't age out) merged chronologically
with **timed** calendar events only. All-day events are deliberately
excluded here — they don't have a specific time to sort by, and mixing
them into a time-ordered list would misrepresent them as happening at a
particular moment. New route: `GET /api/timeline`, distinct from
`/api/digest` (Stage 10) — the digest stays today-only for the homepage
glance; this is the fuller 60-day-ahead view for its own page.

**Month view:** a rolling 6-week grid — one week before the current
week, the current week, and four weeks ahead (42 days, Sunday-start).
Each day shows all-day event titles as text (expanded across every day
a multi-day event spans, not just its start date) and a small colored
dot per owner who has at least one *timed* event that day — presence
only, not details, matching how compact this view is meant to be. New
route: `GET /api/calendar/month`.

**Shared plumbing:** `calendar.js`'s event-fetching was refactored —
`fetchEventsForOwner()` (next N upcoming, used by `/calendar.html` and
the homepage digest) and the new `fetchEventsInRange()` (everything in
an explicit date window, used by both new views here) now share one
`listEvents()` call underneath instead of duplicating the Google API
call and event-shaping logic.

**A real gotcha, caught before it shipped:** converting an all-day
event's date (e.g. `"2026-09-25"`, no time component) through
`new Date(...)` and a timezone-aware formatter is exactly the bug
`chores.js`'s `formatDueDate()` already has a comment warning about —
UTC midnight on that date, converted to Chicago time, lands on the
*previous* calendar day. The month grid avoids this entirely for
all-day events by using Google's date string directly rather than
round-tripping it through `Date`; only timed events (which carry a real
instant, not just a date) go through the timezone conversion.

**Verified against real calendar data:** cross-checked the month grid's
placement of a yearly-recurring event against the already-proven
`/api/calendar/events` endpoint to confirm no off-by-one day error, and
confirmed the timeline correctly excludes all 4 of the household's
current all-day events (two birthdays, an anniversary, a multi-day
vacation) while including all of its timed ones. Checked at mobile
width (375px) too — dense but legible, matching how real calendar apps
handle the same 7-column tradeoff.

**Setup:** none — no new environment variables, no new Supabase table,
reads from the same Google connection and `chores` table everything
else already uses.

**Scoped out of v1, on purpose:**
- **No navigation in the month view** — it's always "1 week back, 4
  weeks ahead of today," recalculated fresh each time you open it.
  Paging to an arbitrary past/future month wasn't asked for and would
  be a different, bigger feature.
- **No chores in the month view** — only Michael's spec for this view
  (all-day titles + timed-event dots) made it in; chores stay a
  Timeline-view-only concept for now.

## Deploying to Vercel

Benny is deployed at **https://benny-penguin-palace.vercel.app** — Vercel is
connected directly to this GitHub repo, so every `git push` to `main`
automatically triggers a new deployment. No separate "deploy" step needed.

> **A URL correction, found the hard way:** this README used to point at
> `benny-quincy5.vercel.app`. That domain isn't actually connected to this
> repo or this Vercel account at all — it's a separate, orphaned deployment
> (frozen on a very old build) that just happened to still be reachable.
> Every real push has always gone to the Vercel project behind
> `benny-xi.vercel.app` / `benny-penguin-palace.vercel.app` (same project,
> multiple aliases) instead. If a link to the old domain turns up anywhere
> else (bookmarks, Google Cloud Console's authorized domains, texts to each
> other), it needs updating too — it will not reflect new pushes.

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
10. ⚠️ Smart home awareness — Resideo thermostat status + control code is built (see Stage 8), but currently **non-functional in both prod and local dev**: `RESIDEO_CLIENT_ID`/`RESIDEO_CLIENT_SECRET`/`RESIDEO_REDIRECT_URI` were never set on this Vercel project, and re-registering is currently blocked — the Honeywell/Resideo developer account exists but won't send verification/password-reset emails and refuses fresh signup as "already taken." Try a different email address or network before giving up; may need Resideo support. PowerView shades bridge (Raspberry Pi + `powerview-bridge/`) also still needs the `npm run discover` verification step once the Pi is set up — and separately, the `powerview_shades` table it writes to doesn't actually exist in Supabase yet (see Stage 12's note).
11. ✅ AI advice generator — calm, mindfulness-oriented guidance + a matching haiku, dancing penguin loading state (see Stage 9 above)
12. ✅ Calendar ↔ chores digest — merged "Today" view on the homepage (see Stage 10 above)
13. ✅ Home screen icon — proper penguin icon + standalone launch on phones (see Stage 11 above)
14. ⏳ Home Connect (hood + dishwasher) — status only so far (see Stage 12 above); control, and confirming the OAuth scopes/refresh-token behavior against a real registered app, still to come
15. ✅ Google Calendar write access — natural-language event entry with a preview/confirm step (see Stage 13 above). Both Michael and Mer need to reconnect their calendar to actually use it — see Stage 13's "scope change" note.
16. ✅ Gmail (read-only + draft-only compose) — fully wired up (see Stages 14-15 above). Both Michael and Mer need to reconnect via `/calendar.html` to actually use it — the same one reconnect now grants Calendar write and Gmail together. Confirmed working live: real drafts create successfully and show up on `/drafts.html`, which never surfaces inbox content — only Benny's own drafts.
17. ✅ Timeline — linear chores+timed-events view, plus a rolling 6-week month grid (see Stage 16 above). Verified against real calendar data.

## Future feature ideas (unscheduled)

Not sequenced yet — captured here so they don't get lost. See conversation
notes for a fuller breakdown of steps/UX for each.

18. 💡 Chores ↔ calendar, *data* tie-in (as opposed to just a shared
    view) — Stage 16's Timeline gave chores and calendar events a real
    merged view, which covers what was actually asked for. Still not
    done, and still an open design call: whether a chore with a due date
    should also create/sync an actual calendar event. Leaning toward
    *not* doing this by default — it would double up anything already
    both a chore and an event, and quietly duplicate data across
    `chores` and Google Calendar that could drift out of sync. Worth
    revisiting once the Timeline view has been lived with for a while.
19. 💡 Smart home controls, expanded — device inventory done (see
    conversation notes), broken down by integration path:
    - **Litter-Robot 4** — Whisker cloud API (community-proven via
      `pylitterbot`), same difficulty tier as Resideo/Home Connect.
    - **Philips Hue** — a physical Hue Bridge exists, so this goes
      through Hue's local Bridge API rather than HomeKit.
    - **Wemo plugs** (turtle lamp, garage lights) — Wemo's own cloud/app
      was discontinued by Belkin; the only remaining path is a
      HomeKit-controller component (new pattern, not built yet), since
      these are only still working today via local HomeKit control.
    - **PowerView, 3rd floor (Gen 2 shades)** — blocked on hardware, not
      software: no hub currently owned for these at all. A Gen 2 Hub is
      still purchasable new; nothing here is buildable until one's
      bought, and two separate hubs (Gen 2 + Gen 3) will always be
      needed for the mixed-generation setup.
    - **LG ThinQ (laundry)** — no public API, unofficial community
      libraries only; treat as lower-priority status display, not core.
    - **Chamberlain myQ (garage door)** — likely blocked; Chamberlain has
      a long history of actively cutting off third-party access.
    - **Lutron Caséta bridge** (living room ceiling lights) — parked,
      it's physically unplugged and was unreliable before that.
20. 💡 An autonomous agent — coordinating doctor appointments, work
    travel, pet appointments, and contractor/vendor scheduling day to
    day, eventually extending to the Netherlands relocation timeline
    (~Sept 2027): Dutch language study, professional networking in NL,
    and the broader move logistics. Depends on #15 (calendar write) and
    #16 (Gmail) — both now fully built. Two things this needs to settle
    before real building starts:
    - **Autonomy model** — "autonomous" should mean autonomous at
      *drafting*, not at *acting*. The Gmail decision above already
      settled this for email (draft-only, human sends); the same
      question needs an answer for calendar events and anything else
      this agent might do on its own initiative — propose-then-approve
      by default is the working assumption, not yet confirmed for every
      action type.
    - **What "coordinate" means per category** — doctor/pet appointments,
      travel, and vendor scheduling are three different shapes of problem
      (a form to fill out vs. an email thread to manage vs. comparing
      quotes), not one generic "book stuff" feature. Needs breaking into
      concrete per-category scope before it's buildable, the same way the
      smart home inventory turned "expand smart home controls" into a
      real per-device plan above.
