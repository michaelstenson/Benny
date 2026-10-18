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
│   │   ├── todoParser.js       # turns free text into {title, assignee, due_date} via Claude tool use (was choreParser.js)
│   │   ├── todos.js            # To-Do rules: what a change may do, when a repeating to-do comes due again
│   │   ├── people.js           # which of us an email is (PERSON_EMAILS), for To-Do's "✓ Mer" (Oct 2026)
│   │   ├── billParser.js       # turns free text into {category, amount, billing_month} via Claude tool use
│   │   ├── rentcastClient.js   # calls RentCast's AVM endpoint for a home value + comps
│   │   ├── compsSummary.js     # turns that data into a short plain-language paragraph via Claude
│   │   ├── resideoClient.js    # talks to Resideo's thermostat API directly (no SDK)
│   │   ├── resideoTokenStore.js # reads/writes the one Resideo token row in Supabase
│   │   ├── authSession.js      # cookie-based Supabase Auth session + requireUser middleware (Stage 17)
│   │   ├── agentAuth.js        # agent bearer token, route allowlist, agent_actions audit log (Stage 18)
│   │   ├── actionError.js      # an Error that carries its HTTP status, for shared write paths (Stage 21)
│   │   ├── recurringBills.js   # next-due-date math for recurring bills, in Chicago time (Stage 20)
│   │   ├── moveTasks.js        # move tracker rules: repeats, the Summit agenda, decision warnings (Stage 22)
│   │   ├── petCare.js          # pet care rules: record fields, Pets-list reminders, the EU travel checklist (Stage 23)
│   │   └── weatherClient.js    # today's forecast from Open-Meteo, no API key (Stage 20)
│   └── routes/
│       ├── hello.js       # GET /api/hello — the hello-world endpoint
│       ├── auth.js        # /auth/google + /auth/google/callback — the Google sign-in handshake
│       ├── calendar.js    # /api/calendar/status + /api/calendar/events
│       ├── todos.js       # /api/todos + /api/lists — To-Do: chores, groceries and any other list (Oct 2026)
│       ├── bills.js       # /api/bills (GET/POST) — includes the per-category summary
│       ├── comps.js       # /api/comps (GET) + /api/comps/refresh (GET, cron-only)
│       ├── resideoAuth.js # /auth/resideo + /auth/resideo/callback — the Resideo sign-in handshake
│       ├── smarthome.js   # /api/smarthome/status, /thermostats (GET+PATCH), /shades
│       ├── session.js     # /auth/login, /verify, /confirm, /logout — signing in to Benny itself (Stage 17)
│       ├── recurringBills.js # /api/recurring-bills — what's due when (Stage 20)
│       ├── proposals.js   # /api/proposals — "Benny suggests," approve or dismiss (Stage 21)
│       ├── projects.js    # /api/projects, /tasks, /decisions, /key-dates, /log — the move tracker (Stage 22)
│       └── pets.js        # /api/pets + their vaccinations, visits, medications (Stage 23)
├── public/
│   ├── index.html         # the page you see at localhost:3000
│   ├── app.js              # browser-side JS that calls /api/hello
│   ├── calendar.html       # the calendar page
│   ├── calendar.js         # browser-side JS that calls /api/calendar/events
│   ├── todo.html / todo.js # To-Do: My Day, Important, Planned, Michael/Mer, and every list (Oct 2026)
│   ├── chores.html / lists.html # redirects to todo.html, for old bookmarks and home-screen icons
│   ├── bills.html          # the bills page
│   ├── bills.js            # browser-side JS for adding bills and rendering the summary
│   ├── comps.html          # the home comps page
│   ├── comps.js            # browser-side JS that renders the estimate + comps table
│   ├── smarthome.html      # the smart home page
│   ├── smarthome.js        # browser-side JS: thermostat status/control + shade status
│   ├── login.html / login.js # sign-in page: email → code (Stage 17)
│   ├── move.html / move.js # the Netherlands move plan + Penguin Summit agenda (Stage 22)
│   ├── move-shared.js      # date labels + the Everyone/Michael/Mer filter, shared with the homepage card
│   ├── log.html / log.js   # the decision log (Stage 22)
│   ├── pets.html / pets.js # pet records, reminders and the EU travel checklist (Stage 23)
│   ├── auth-guard.js       # loaded on every signed-in page; bounces to /login.html on 401
│   └── escape.js           # escapeHtml() for titles that came from outside (Stage 18)
├── agent/benny-plugin/      # Hermes plugin: Benny the agent's tools for this app's API
├── agent/scripts/           # scripts Hermes runs on the Pi (the morning brief)
├── scripts/                 # one-time setup: the Stage 22, To-Do (two) and Stage 23 migrations + the roadmap importer
├── tests/                   # `npm test`: node:test checks of the pet care and To-Do rules
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

> **Replaced by To-Do (Oct 2026).** Chores is now a list in To-Do, and
> `choreParser.js` became `todoParser.js`. See "To-Do: chores and lists in
> one place" below. This section is kept as the history of how it started.

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

> **Superseded (Oct 2026):** Home Assistant on the Pi talks to the
> PowerView hub now, and agent Benny controls the shades through it. See
> "Smart home through Home Assistant". The bridge below was never
> deployed.

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

## Stage 17: Sign-in (magic link / email code)

Until this stage, Benny had no login at all: every `/api` route was open
to anyone who knew the Vercel URL — adding chores, creating real Google
Calendar events, creating Gmail drafts, spending Claude credits. It's
also the prerequisite for the agent bridge (Stage 18): there's no point
giving agent Benny a scoped token while the front door is unlocked.

**How it works:**
- **Supabase Auth, passwordless.** `/login.html` asks for an email, and
  `POST /auth/login` has Supabase send a one-time code plus a link.
  Typing the code (`POST /auth/verify`) or tapping the link
  (`GET /auth/confirm`) finishes sign-in. The code matters on phones:
  the home-screen app keeps its own cookies, separate from the phone's
  browser, so a tapped link would sign in the browser, not the app.
- **The session is an httpOnly cookie**, managed by `@supabase/ssr`
  (`server/lib/authSession.js`). Cookies, not a bearer token, because
  "Connect Michael's calendar" and the other OAuth buttons are plain
  browser navigations, which can't carry an Authorization header. The
  cookie rides along on those as well as on every `fetch('/api/...')`.
- **`requireUser` middleware** guards every `/api` route and every
  `/auth` route except sign-in itself. Signed-out API calls get a 401;
  signed-out navigations (e.g. `/auth/google/michael`) redirect to the
  login page and come back afterward. The one public API route is
  `/api/comps/refresh`, which Vercel's cron calls with no session and
  which checks `CRON_SECRET` itself.
- **`ALLOWED_EMAILS`** (comma-separated) is the list of who may sign in,
  checked both before an email is sent and after sign-in. If it's unset,
  nobody gets in: it fails closed, not open.
- **`PERSON_EMAILS`** (Oct 2026, `michael:…,mer:…`) says which of us each
  of those emails is. To-Do uses it to name who ticked a to-do off and
  who added it (`server/lib/people.js`); without it, it names nobody.
- **Pages stay static.** Vercel's CDN serves `public/*.html` directly, so
  the server can't gate the HTML itself, but nothing sensitive lives in
  it. `public/auth-guard.js` (loaded first on every page except login and
  privacy) calls `/api/me` on load and sends you to `/login.html` on any
  401. The homepage has a **Sign out** button.
- **401 means only "not signed in to Benny."** Because the guard bounces
  on any `/api` 401, "this integration isn't connected yet" (calendar,
  Gmail, thermostat, kitchen appliances) is a **424** instead, and the
  pages check for 424 to show their connect state.

**One-time setup (only you can do these, in the Supabase dashboard):**
1. **Authentication → Sign In / Providers:** Email enabled, and turn
   **off** "Allow new users to sign up." Benny also passes
   `shouldCreateUser: false`, so this is a second lock.
2. **Authentication → Users → Add user:** add Michael and Mer by email.
3. **Authentication → URL Configuration:** Site URL
   `https://benny-penguin-palace.vercel.app`. Add these redirect URLs:
   `https://benny-penguin-palace.vercel.app/auth/confirm` and
   `http://localhost:3000/auth/confirm`. If the redirect isn't listed,
   Supabase quietly swaps in the Site URL and the email's link breaks.
4. **Authentication → Emails → Magic Link** template: replace it with
   something like the following, so the email has both the code and a
   link that works in any browser:
   ```html
   <h2>Sign in to Benny 🐧</h2>
   <p>Your code: <strong>{{ .Token }}</strong></p>
   <p>Or <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">tap here to sign in</a>.</p>
   ```
5. **Vercel → Settings → Environment Variables:** add `ALLOWED_EMAILS`
   (both emails, comma-separated). Add it to your local `.env` too.
   Do this **before** deploying Stage 17, or nobody can sign in.

**Gotchas:**
- Supabase's built-in email sender is heavily rate-limited (a few emails
  an hour for the whole project). That's fine for two people, but
  "Too many sign-in emails" means wait, not that something's broken.
  Custom SMTP (Authentication → Emails → SMTP) lifts the limit if it
  ever matters.
- `app.set('trust proxy', true)` in `index.js` is what makes the email
  link say `https://` on Vercel. Without it, Express only sees the
  proxy's plain-HTTP hop.

## Stage 18: Agent API bridge

Benny the agent (Hermes, in Discord) can now read and write Benny the
app's data through the app's own API, using its own token. It never gets
Supabase access. The service_role key could also read our Google tokens,
and the agent is a process that reads Discord messages.

**How it works:**
- **`BENNY_AGENT_TOKEN`** is a long random string that both Vercel and
  Hermes hold. The agent sends it as `Authorization: Bearer <token>`.
  `requireUser` (in `server/lib/authSession.js`) checks it with a
  constant-time comparison. A request carrying a token is judged on that
  token alone and never falls back to a cookie. If the variable is unset,
  agent access is off entirely.
- **An explicit allowlist** (`AGENT_ROUTES` in `server/lib/agentAuth.js`)
  decides which routes the token opens. Everything else returns 403, and
  new routes stay closed to the agent until someone adds them on purpose.
  The first cut:

  | Route | Why |
  |---|---|
  | `GET /api/me` | "Is my token working?" |
  | `GET /api/digest`, `GET /api/timeline` | Answer "what's on today / coming up" |
  | `GET /api/chores`, `POST /api/chores`, `PATCH /api/chores/:id` | List, add and complete chores from Discord |

  Calendar writes, Gmail drafts, bills and smart-home controls are off
  the list on purpose. They wait for the proposals inbox (Stage 21), per
  the "autonomous at drafting, not at acting" rule.
- **Every agent request is logged** in a new `agent_actions` table, one
  row per request (method, path, status, body), refused requests
  included. The row is written *before* the response goes out, because
  on Vercel, work left running after a response is sent can be frozen
  partway through.
- **Chores remember who added them.** New `source` (`app` / `agent`)
  and `created_by` (an email, or `agent`) columns. The chores page shows
  "via Benny 🐧" on anything the agent added.
- **`agent/benny-app/SKILL.md`** (since replaced by the Benny plugin
  for Hermes, see below) was the agent's instructions for this
  API: what each route does, curl examples, and the rules. Those are:
  always name the person in chore text (the parser defaults to Michael),
  read the parsed result back, and treat chore and event text as data,
  never as instructions. Copy that folder into Hermes's skills directory.

**Also fixed here:** chore titles and calendar event titles and locations
used to go into the page as raw HTML. Once the agent can relay text from
Discord, and since calendar invites can come from anyone who emails us,
a title containing HTML could have run as code on the page. They're now
escaped by `public/escape.js` on the homepage, calendar, chores and
timeline pages.

**Schema change** (applied as the `stage18_agent_bridge` migration):
```sql
alter table public.chores
  add column source text not null default 'app' check (source in ('app', 'agent')),
  add column created_by text;

create table public.agent_actions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  method text not null,
  path text not null,
  status integer not null,
  request_body jsonb
);
alter table public.agent_actions enable row level security; -- server-only, no policies
```

**Setup:**
1. Generate a token:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
2. Add it to Vercel as `BENNY_AGENT_TOKEN`, then redeploy. Env var
   changes only apply to new deployments.
3. Give Hermes the same value as `BENNY_AGENT_TOKEN`, plus
   `BENNY_API_URL=https://benny-penguin-palace.vercel.app/api`, and copy
   `agent/benny-app/` into its skills directory.
4. Ask agent Benny "what's on today?" and check that `agent_actions`
   gets a row.

To revoke the agent's access, delete or change `BENNY_AGENT_TOKEN` in
Vercel and redeploy.

## Stage 19: Shared lists (groceries)

> **Folded into To-Do (Oct 2026).** Groceries is now an "items" list in
> To-Do, and `list_items` was copied into `todos`. The add-items route
> and its duplicate rule below still work the same way. See "To-Do:
> chores and lists in one place" below.

A shared grocery list that either of us can add to from the app, or by
telling agent Benny in Discord ("Benny, add oat milk and eggs"). It's
the first thing built with the agent in mind. It's low stakes and used
every day, so it's where talking to Benny is most useful.

**How it works:**
- **Two tables, any number of lists.** `lists` (a `slug` like
  `groceries`, and a display name) and `list_items` (text, checked,
  `checked_at`, plus the same `source` / `created_by` as chores).
  Groceries is the only list for now. Adding another is one row in
  `lists`, and the page shows tabs as soon as there's more than one.
- **No Claude parsing**, unlike chores and bills. "Oat milk" is already
  exactly what goes on the list, so items are stored as typed. The API
  takes an explicit array (`{"items": ["oat milk", "eggs"]}`). The app
  splits what you type on commas, and the agent sends one entry per
  item, so the server never guesses where one item ends.
- **Duplicates are skipped, not doubled.** If "milk" is already open on
  the list, adding "Milk" again is skipped (ignoring case). The response
  says which items were skipped, and both the page and the agent tell
  you.
- **Checked items sink to the bottom** instead of disappearing, so a
  mis-tap is easy to undo mid-shop. **Clear checked items** removes them
  for good. That's the one irreversible action here, so it's app-only
  and not on the agent's allowlist.
- **The page refreshes when you come back to it**
  (`visibilitychange`), so switching back to Benny mid-shop picks up
  whatever the other person or the agent added. It isn't live-updating
  beyond that.

**Routes** (`server/routes/lists.js`):

| Route | Agent? |
|---|---|
| `GET /api/lists`: every list, with its open-item count | ✅ |
| `GET /api/lists/:slug/items` | ✅ |
| `POST /api/lists/:slug/items`: body `{ items: [...] }` | ✅ |
| `PATCH /api/list-items/:id`: body `{ checked }` | ✅ |
| `DELETE /api/lists/:slug/items/checked` | ❌ app only |

`agent/benny-app/SKILL.md` has a new "Shared lists" section for Hermes:
one array entry per item, report skipped duplicates, default to
groceries, and read items back before a bulk "got everything"
check-off. Re-copy it into Hermes's skills folder whenever it changes.

**Schema change** (applied as the `stage19_shared_lists` migration):
```sql
create table public.lists (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  created_at timestamptz not null default now()
);
create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  text text not null check (length(trim(text)) > 0),
  checked boolean not null default false,
  checked_at timestamptz,
  source text not null default 'app' check (source in ('app', 'agent')),
  created_by text,
  created_at timestamptz not null default now()
);
create index list_items_list_id_idx on public.list_items (list_id);
alter table public.lists enable row level security;      -- server-only, no policies
alter table public.list_items enable row level security; -- server-only, no policies
insert into public.lists (slug, name) values ('groceries', 'Groceries');
```

## Stage 20: Morning brief (weather + bills due, posted by the agent)

Every morning, agent Benny posts a short summary to our Discord home
channel. It covers weather, today's events for both of us, chores due or
overdue, and bills coming due. The app assembles the data and the agent
writes the message, so the app stays the data layer and the agent does
the talking.

**What changed in the app:**
- **`GET /api/digest` gained two fields.** `weather` has today's
  summary, high/low in °F, and chance of precipitation. `bills_due` has
  active recurring bills due in the next 7 days, today included. Both
  are fetched alongside the calendar, and a failure just leaves that
  piece out (`null` / `[]`), the same way a broken Google connection
  already worked. The homepage Today card shows both.
- **Weather** comes from Open-Meteo (`server/lib/weatherClient.js`),
  which is free and needs no key or account. It uses `HOME_LATITUDE` /
  `HOME_LONGITUDE` if set, otherwise downtown Chicago. These only need
  to be neighborhood-close, not the house itself.
- **Recurring bills** are a new `recurring_bills` table: name, amount
  (blank for bills that vary), day of month due, autopay, and
  active/paused. They're managed in a new "Recurring — what's due when"
  section on the Bills page (`/api/recurring-bills`, app-only, not on the
  agent's allowlist). This is separate from the existing bills log, which
  records what each bill *was* for the analyzer. This records what comes
  due *when*.
- **Due-date math** is in `server/lib/recurringBills.js`. A bill due on
  the 31st lands on the last day of shorter months, so it's never
  skipped. Everything is computed from "today" in Chicago, using plain
  date strings, so Vercel's UTC clock can't shift a due date by a day.

**The schedule lives in Hermes, not Vercel.** It's a Hermes cron job (see
setup below) that fires at 7:00 Central and runs agent Benny with the
`benny-app` skill. The skill's "morning brief" section says how to write
the message: weather first, bills not on autopay that are due soon made
impossible to miss, no filler. Hermes ran on the laptop, and the brief
never once posted at 7:00: every run was a catch-up hours later, when
the laptop woke. Hermes moved to the Raspberry Pi on Oct 9, 2026, and
the app took over writing the brief (see Stage 20b).

**Schema change** (applied as the `stage20_recurring_bills` migration):
```sql
create table public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  amount numeric(10, 2) check (amount is null or amount >= 0),
  due_day integer not null check (due_day between 1 and 31),
  autopay boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.recurring_bills enable row level security; -- server-only, no policies
```

**Setup:**
1. Add your regular bills in the Bills page's Recurring section.
2. Optionally, set `HOME_LATITUDE` / `HOME_LONGITUDE` in Vercel for a
   closer forecast.
3. Create the Hermes job:
   ```
   hermes cron create "0 7 * * *" "Post the Penguin Palace morning brief: use the benny-app skill, call GET /digest, and write it up following the skill's morning brief section." --name "Morning brief" --skill benny-app --deliver discord
   ```
   Stage 20b replaces this with a job that runs no model.

## Stage 20b: The app writes the morning brief

Agent Benny used to write the brief: a full Sonnet run every morning,
about $0.10 each, mostly spent loading the agent's ~17K-token setup just
to reword JSON the app had already assembled. Now the app writes the
brief and Hermes only delivers it, so it costs nothing and comes out
the same way every day.

**How it works:**
- **`GET /api/digest/brief`** returns the brief as finished Discord text
  (`server/lib/morningBrief.js`), built from the same data as
  `/api/digest`. It follows the rules the agent did: a bill that isn't
  on autopay and is due today or tomorrow goes at the very top, then
  weather (an umbrella only at 50%+), today's events by time, chores
  with overdue ones first, then the rest of the week's bills. Empty
  sections are left out. At most 8 chores are listed, with "…and N more
  in Benny" after that. It's on the agent's allowlist.
- **Text from the calendar and chores is defanged before posting.** An
  invite from anyone lands on the calendar on its own, so titles are
  kept to one line, Markdown and masked links show as plain text, and
  `@everyone` / `<@id>` mentions are broken so a title can't ping the
  server.
- **Hermes runs it as a no-agent job.** `agent/scripts/morning-brief.sh`
  fetches the brief and Hermes posts whatever it prints, with no model
  involved. If the fetch fails, the script exits non-zero and Hermes
  posts a failure notice rather than a blank brief.
- **Also fixed: all-day events showed up a day early.** The digest
  turned an all-day event's date into a `Date`, which is UTC midnight,
  and that's still the previous day in Chicago. All-day events now
  compare as plain dates and show on every day they cover. This also
  fixes the homepage's Today card.

The skill's "morning brief" section now just says to pass
`/digest/brief` along as-is when someone asks for today's rundown.

**Setup (on the Pi):**
1. Copy the script:
   ```
   ssh pi 'mkdir -p ~/.hermes/scripts'
   scp agent/scripts/morning-brief.sh pi:~/.hermes/scripts/morning-brief.sh
   ```
2. Switch the existing job (`6c657c92b7a2`) to the script, with no model:
   ```
   ssh pi 'chmod +x ~/.hermes/scripts/morning-brief.sh && ~/.local/bin/hermes cron edit 6c657c92b7a2 --script morning-brief.sh --no-agent --clear-skills'
   ```
3. Check it with `hermes cron run 6c657c92b7a2`, which posts it on the
   next scheduler tick (or wait for 7:00).

## Stage 21: Proposals inbox ("Benny suggests")

Agent Benny can now ask for things that reach outside the app, like a
calendar event or an email draft, without being able to do them itself.
It *proposes* one, a "Benny suggests" card shows up at the top of the
homepage, and nothing reaches Google until Michael or Mer taps Approve.
This is the "autonomous at drafting, not at acting" rule from the agent
plan, made real.

**How it works:**
- **The agent can propose, but not approve.** `POST /api/proposals` and
  `GET /api/proposals` are on the agent's allowlist. Approve and reject
  aren't, so only a signed-in person can turn a proposal into a real
  event or draft. A proposal the agent could approve itself would just
  be a slower way of acting.
- **Approving runs the same code the app already uses.** The calendar
  write and the Gmail draft were pulled out of their routes into
  `createCalendarEvent()` (`calendar.js`) and `createTrackedDraft()`
  (`gmail.js`). The app's own routes and approving a proposal both call
  those, so each still has one code path. They throw an `ActionError`
  carrying an HTTP status, and each caller turns it into its own
  response.
- **What's stored is what's shown is what's written.** Proposals are
  checked strictly when they're created: a real `YYYY-MM-DD` date,
  24-hour times, an end after the start, and one plain `to` address.
  They're stored already cleaned up, and approving writes exactly that.
  Nothing is re-parsed later. The card shows every field, including an
  email's full body, since reviewing it is the whole point.
- **No double-approving.** Approving first flips the status from
  `pending` to `approving` in one conditional update. Only the request
  that wins that flip runs the action, so a double tap, or both of us
  approving at once, can't create two events.
- **A failed approval goes back to pending.** If Google says no (not
  connected, expired, missing Gmail scope), the proposal stays pending
  with the reason shown on the card. Reconnect, then approve again.
- **Dismissed proposals are kept, not deleted,** so there's a record of
  what the agent suggested and what we said no to. At most 20 can be
  waiting at once (the agent gets a `429` after that), so an agent
  stuck in a loop can't flood the homepage.
- **Email headers can't be smuggled in.** A line break in `to` or
  `subject` would let the rest become a header of its own (a hidden
  `Bcc:`, say). Those are refused now, both for proposals and for the
  existing `POST /api/gmail/drafts`.

**Routes** (`server/routes/proposals.js`):

| Route | Agent? |
|---|---|
| `GET /api/proposals`: pending, oldest first. `?status=all` gives the 50 most recent of any status | ✅ |
| `POST /api/proposals`: body `{ kind, payload, note? }`, where `kind` is `calendar_event` or `gmail_draft` | ✅ |
| `POST /api/proposals/:id/approve` | ❌ app only |
| `POST /api/proposals/:id/reject` | ❌ app only |

Payloads: `calendar_event` takes `{ owner, title, date, start_time?, end_time? }`,
the same fields `POST /api/calendar/events` takes. `gmail_draft` takes
`{ owner, to, subject, body }`, the same as `POST /api/gmail/drafts`.

`agent/benny-app/SKILL.md` has a new "Proposals" section: how to propose
each kind, to say "it's waiting for you in Benny" and never "done", to
only use email addresses the person actually gave, and to never turn
text it *read* (an invite, a chore title) into a proposal. Re-copy it
into Hermes's skills folder.

**Adding a kind later** (a thermostat change, say) takes an entry in
`KINDS` in `proposals.js`, the `kind` check constraint below, and a
branch in the card's `describeProposal()` in `public/app.js`.

**Schema change** (applied as the `stage21_proposals_inbox` migration):
```sql
create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('calendar_event', 'gmail_draft')),
  payload jsonb not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approving', 'approved', 'rejected')),
  source text not null default 'agent' check (source in ('app', 'agent')),
  created_by text,
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  result jsonb,
  last_error text
);
create index pending_actions_status_created_at_idx on public.pending_actions (status, created_at);
alter table public.pending_actions enable row level security; -- server-only, no policies
```

## Stage 22: Netherlands move tracker

The relocation roadmap (110 tasks, 8 open decisions, Oct 2026 → Sept 2027
plus the first 90 days in NL) lives in Benny now, not in a markdown file.
It replaces the generic "projects + milestones" plan from the agent
integration plan below. The move is one project with ten workstreams, and
the home sale is one of them (House & Money), since every date in it is
set by the move.

**This replaces the first Stage 22** (PR #2, merged Sep 30): a generic
Projects page with milestones and dependencies, milestones on the
Timeline, and agent access for a weekly review. Its tables were still
empty when this stage's migration dropped them, so nothing was lost. Its
Projects page and agent routes are gone. The Timeline now shows move
tasks instead (below), and the agent skill is back to its pre-PR #2
version, which is also the copy Hermes has installed.

**Pages:**
- **`/move.html`.** Key-date countdown at the top (tap one to move it),
  the "why" from F-08, and an Everyone / Michael / Mer filter that each
  device remembers. Below that is the **Penguin Summit agenda** (Sundays
  at 7pm): this week's starred focus (three at most), overdue, "now and in
  the next 30 days", waiting on someone, done in the last 7 days, and
  decisions coming up. Then every decision, then every task by workstream.
  Tap a task's title to edit it.
- **`/log.html`, the decision log.** Recorded decisions, key-date
  changes, and every "Benny suggests" proposal one of us approved or
  dismissed, newest first. All three were already stored; this just puts
  them on one page.
- **Homepage:** a move card (countdown, the next few things on this
  device's person's list, the next decision) and a tile.
- **Timeline:** open move tasks with an exact due date sit alongside
  chores and events, linking to the Move page. Month-level tasks stay
  off, since their due date is just the end of the month. The agent's
  `GET /timeline` sees these too; it's the only move data it can read.

**How it works:**
- **Owner and lead.** A task belongs to Michael, Mer or both. A "both"
  task also has a lead, and it shows on the lead's list. A "both" task
  with no lead shows on both lists. Each workstream has a default lead.
  Changing it moves the workstream's leaderless shared tasks (and those that
  followed the old lead) over to the new one.
- **Date ranges.** Tasks have a start and a due date, shown as months
  ("Nov – Jan 2027") until someone sets exact days. "Now and in the next
  30 days" means started *or* due within 30 days. That keeps a "Q1" task
  visible from January rather than hiding until it's due on Mar 31.
- **Repeating tasks** (crate training, decluttering, the monthly goodbye,
  the quarterly check-in, ...). Ticking one off moves it to its next due
  date and counts it. Weekly ones fall on Sundays, Summit day. Each stops
  after its "until" date.
- **Key dates and pinned tasks.** Listing (Jun 1), Michael's last day
  (Jun 30) and Departure (Sep 20) start out "proposed". 27 tasks are
  pinned to one of them: the health certificates, packing, the first 90
  days, the notice period and so on. Moving a key date moves its open
  pinned tasks by the same number of days, after a preview of what moves.
  The move happens in one database function (`move_key_date`) and is
  logged.
- **Decisions.** Each has a decide-by date, a list of options (name,
  cost, link, notes; handy for comparing quotes), and the tasks it needs
  first. If one of those tasks is due after the decide-by date, the
  decision shows a ⚠. Recording D2, D3 or D5 asks for the date it sets,
  moves the key date if that changed, and marks it confirmed.
- **Waiting on someone.** Setting a task to "waiting" records who and
  since when. After 7 days it turns red.

**Where decisions get recorded (decided Oct 2, 2026).** The household's
decisions and approvals go in the app (`/log.html`). They're already rows
in the database, both of us can see them, and recording one doesn't need a
code change. This README keeps decisions about how the app is built, like
the agent rules below.

**Agent rules for the move (agreed Oct 2, 2026).** These take effect when
the agent gets access to the move data:
- If one of us asks for something in Discord, the agent writes it
  directly, the same as chores: mark a task done, set it to waiting, add a
  note or a task.
- If the agent wants to suggest something on its own initiative, it
  sends a proposal for one of us to approve.
- The agent never records a decision, moves a key date, or drops a task.

For now these routes are **app-only**: none are on the agent's allowlist.
Agent calls are billed per use and the app does the job, so the agent
waits until there's a reason.

**Changes made to the roadmap when importing it** (all listed in
`scripts/import-roadmap.js`):
- P-09 (pet health certificates) moved from "Aug" to Sep 10–18. The EU
  certificate has to be issued within 10 days before arrival.
- G-08 (book flights) moved from Aug to Apr, right after D3. Airlines cap
  pets per flight.
- H-16 (runway number) moved from Q2 to Dec–Jan and repeats monthly. It's
  an input to D2, which is due Jan 31.
- W-09 is now "plan notice for the last day set in D2" (Feb–Mar), since
  D2 itself decides Mer's last day.
- V-02 (intro calls) is due Nov 15, before D1's Nov 20 decide-by date.
- A-01 to A-09 (first 90 days) got owners and dates, pinned to departure.
- Leads: Michael leads Visa & Legal and House & Money. Mer leads Pets and
  Logistics, plus H-05 (decluttering). The rest get a lead at a Summit.
- F-03 is in progress (Sundays at 7pm picked; the monthly review is still
  to pick).
- A new task, G-11, "Move Benny too": America/Chicago is hard-coded in 5
  server files, and the Pi the agent is moving to lives in the house being
  sold.

**Setup (once):**
1. Run `scripts/stage22_move_tracker.sql` as the migration
   `stage22_move_tracker`, using the Supabase SQL editor or `apply_migration`.
   It replaces the unused tables from the first `stage22_projects_module`
   migration and removes the separate `home-sale` project row.
2. Import the roadmap. Do a dry run first:
   ```bash
   node scripts/import-roadmap.js path/to/netherlands-move-roadmap.md --dry-run
   node scripts/import-roadmap.js path/to/netherlands-move-roadmap.md
   ```
   Re-running it is safe: it skips anything that already exists and never
   overwrites edits made in the app.

**Routes** (`server/routes/projects.js`, all app-only):

| Route | Does |
|---|---|
| `GET /api/projects/:slug` | Everything, plus the Summit agenda as lists of ids |
| `GET /api/projects/:slug/summary` | Countdown, focus, overdue, next 30 days, decisions due (the homepage card) |
| `PATCH /api/projects/:slug` | `{ why }` |
| `POST /api/projects/:slug/tasks` | `{ workstream, title, owner?, lead?, start_date?, due_date?, ... }`. Gets the workstream's next code, e.g. `L-07` |
| `PATCH /api/tasks/:id` | Any task field. Marking a repeating task done rolls it forward (`rolled: true`) |
| `PATCH /api/workstreams/:id` | `{ lead }` |
| `PATCH /api/key-dates/:id` | `{ date, dry_run? }`. The dry run lists what would move |
| `PATCH /api/decisions/:id` | Record (`status: 'decided'`, `outcome`, `decided_by`, `key_date?`), reopen, or edit `options` / `notes` / `decide_by` |
| `GET /api/log` | The decision log |

**Schema:** `scripts/stage22_move_tracker.sql`. It adds `workstreams`,
`tasks`, `key_dates`, `decision_inputs` and `key_date_changes`, adds
`code`, `decide_by`, `options`, `notes` and `key_date_id` to `decisions`,
adds `why` to `projects`, and creates the `move_key_date()` function
(service role only). Every new table has RLS on with no policies, so it's
server-only like the rest.

**Not built yet:** agent access (see the rules above), a documents
tracker (apostilles start in December), a Summit-prep post in Discord,
and exporting the plan as a Mermaid Gantt chart.

## Benny plugin for Hermes (replaces the benny-app skill)

Agent Benny used to reach the app by reading the `benny-app` skill and
writing `curl` commands in the Pi's terminal. Now a Hermes plugin
(`agent/benny-plugin/`) gives it typed tools instead, and the
terminal is off Discord and Telegram entirely.

**Why:**
- **Nobody in chat can run commands on the Pi.** Before, a chore title
  or calendar invite (which anyone can send us) carrying instructions
  could have got Benny to run a shell command on the machine that holds
  its Discord, Anthropic and app tokens and runs Home Assistant. That's
  also what had to be fixed before Benny could read email.
- **Benny never sees the app token.** The plugin reads it from the Pi's
  `.env`; it isn't in any command Benny writes, so it can't end up in a
  reply.
- **The rules are code now.** Each tool checks its input before anything
  is sent (ids must be real ids, dates `YYYY-MM-DD`, times `HH:MM`), and
  results come back trimmed to the fields Benny needs, with a short
  reminder where there's a rule ("read it back", "it's waiting for
  approval, not done").
- **Cheaper and faster.** No skill to load and no shell round trip: a
  simple question went from three model calls to two, and from about
  $0.09 to $0.03. The tool definitions (14 then, 16 with the smart
  home) are under 2K tokens, less than the terminal tool alone.

**Who's asking.** Hermes's session knows which Discord or Telegram
account sent the message. The plugin maps it to Michael or Mer with
`BENNY_PEOPLE` in the Pi's `.env` (kept out of this repo, which is
public), e.g. `discord:<id>=michael,discord:<id>=mer,telegram:<id>=michael`.
The model can't change it, so:
- **Email drafts only ever go in the asker's own Gmail.** There's no
  owner parameter at all.
- **To-dos and calendar proposals default to the asker**, instead of
  the app's old default of Michael. Naming the other person still works.
- **If the sender is unknown** (a cron run, the CLI, an account not in
  `BENNY_PEOPLE`, or a Hermes update that moves the session module),
  anything tied to one person is refused rather than guessed.

**Tools** (all in the `benny` toolset): `benny_today` (the brief, or the
digest as data), `benny_upcoming`, `benny_todos`, `benny_add_todo`,
`benny_add_to_list`, `benny_set_todo_done` (these four replaced the five
chore and list tools in Oct 2026, see "To-Do"), `benny_search_email`, `benny_read_email`,
`benny_read_attachment` (see below), `benny_pets`, `benny_log_pet` (see "Stage 23: Pet care"), `benny_home`, `benny_home_control`
(see "Smart home through Home Assistant" below),
`benny_propose_event`, `benny_propose_email_draft`,
`benny_proposals`. Apart from the email and smart-home tools, they call
the same allowlisted routes as before, so the app needed no changes for
them, and everything is still in `agent_actions`. The smart-home tools go
to Home Assistant on the Pi instead of the app.

**Tests:** `python -m unittest discover -s agent/benny-plugin/tests -v`
runs them against a fake app on localhost (standard library only).

**Setup on the Pi** (done Oct 9, 2026):
```
tar --exclude=__pycache__ -C agent -cf - benny-plugin | ssh pi 'mkdir -p ~/.hermes/plugins/benny && tar -xf - -C ~/.hermes/plugins/benny --strip-components=1'
ssh pi '~/.local/bin/hermes plugins doctor ~/.hermes/plugins/benny && ~/.local/bin/hermes plugins enable benny'
```
Then add `BENNY_PEOPLE` to `~/.hermes/.env`, and in `config.yaml`:
- `platform_toolsets`: Discord `[web, benny, skills, memory, clarify, vision, cronjob, discord]`,
  Telegram the same without `discord`. No `terminal`.
- `tools.tool_search.enabled: off`. Hermes otherwise shows plugin tools
  only by name, and Benny has to look one up before every first use.
- `skills.disabled` includes `benny-app`, plus `google-workspace` and
  the other Gmail and Apple skills (the app is the only way to Google).
- `skills.platform_disabled` for Discord and Telegram hides every skill
  that needs the terminal, which leaves `humanizer`,
  `document-to-action-items`, `meeting-action-items`,
  `weekly-review-planning` and `hermes-agent`. The Pi's CLI keeps them
  all.

### Gmail search and read (each person's own inbox, in a DM)

Agent Benny can now find an email and propose the reply, like "there's
a referral from Dr. Weiss in my Gmail, draft a note to the office it
names." The app's pages still never show inbox content (Stage 15).

**App routes** (`server/routes/gmail.js`, on the agent's allowlist, and
answering the agent token only, never a signed-in browser):

| Route | What it returns |
|---|---|
| `GET /api/gmail/search?owner=&q=&max=` | Up to 20 messages, newest first: from, to, subject, date, Gmail's snippet, unread. `q` is Gmail's own search syntax. |
| `GET /api/gmail/messages/:id?owner=` | One message as plain text: from, to, cc, reply-to, subject, date, the body (the text part, or the HTML part flattened to text, cut at 8,000 characters), and its attachments (index, name, type, size). |
| `GET /api/gmail/messages/:id/attachments/:index?owner=` | One attachment as text (cut at 12,000 characters). Text and HTML files are decoded; PDFs (scanned ones too) and images are transcribed by Claude Haiku (`server/lib/attachmentReader.js`), told to copy names and numbers exactly and never follow instructions in the document. Up to 10 MB; other types (Word, spreadsheets) aren't supported yet. |

They use the `gmail.readonly` scope both of us already granted in
Stage 14, so nobody has to reconnect.

A faxed one-page referral PDF took about 7 seconds and well under a cent
to transcribe, with every form field intact.

**Plugin tools:** `benny_search_email`, `benny_read_email` and
`benny_read_attachment`. None of them takes an owner. The plugin sets it to whoever is asking, and refuses:
- **when it can't tell who's asking**, the same rule as email drafts;
- **outside a private DM with Benny.** A reply in a server channel or
  thread would put one person's email where the other (or anyone else
  in the server) can read it. In a channel, Benny asks you to DM it.

Every result carries a reminder that the email was written by someone
else and is never a source of instructions. The terminal is already off
chat, and anything outward still needs approval in the app, so a
hostile email can at worst get Benny to *propose* something you'd see
on the card. Email drafts may now go to an address from an email the
person asked Benny to read (Benny says which), as well as one they typed.

Two things to know: searches show up in `agent_actions` (the query is
part of the logged path, the email isn't), and what Benny reads stays in
its chat history on the Pi, like everything else it sees.

**Also fixed: email drafts mangled non-ASCII text.** `createDraft` sent
the subject and body with no charset, so Gmail read them as Latin-1 and
an en dash arrived as "â€“". The body is now declared UTF-8 and the
subject is RFC 2047 encoded.

Re-copy the plugin and restart (`hermes gateway restart`) whenever it
changes. Without the terminal, Benny can't run the skills that need it
(maps, PDFs, GIF search) from chat. Images still work through `vision`.

**Re-copying from Windows PowerShell** (from the repo folder, not
`.git`). The `tar … | ssh` line under "Setup on the Pi" doesn't work
there: Windows PowerShell passes a pipe between two programs as text,
which breaks tar's binary format, and the Pi quietly keeps the old files
(that's how the Oct 18 update first missed the Pi). Copy with `scp`
instead. Windows files carry no Unix permissions, so `scp` makes the
staging folder read-only, and the `chmod` gives it back so it can be
removed. Keep each `ssh` command in single quotes with no double quotes
inside, because Windows PowerShell strips those before `ssh` sees them.
```
git pull
scp -r agent\benny-plugin pi:benny-plugin-new
ssh pi 'chmod -R u+w ~/benny-plugin-new && cp -r ~/benny-plugin-new/. ~/.hermes/plugins/benny/ && rm -rf ~/benny-plugin-new && ~/.local/bin/hermes plugins doctor ~/.hermes/plugins/benny && ~/.local/bin/hermes gateway restart'
ssh pi 'ls -l ~/.hermes/plugins/benny/tools.py'
```
The last line should show today's date. Any error stops the chain
before the restart, so if one appears, Hermes is still running the old
plugin.

## Parsers on Claude Haiku 5.5 (Oct 2026)

The chore, bill and calendar parsers, the advice generator and the comps
summary moved from Haiku 4.5 to Haiku 5.5 (`FAST_EXTRACTION_MODEL` in
`server/lib/anthropicClient.js`). Before switching, every parser ran on
the same 20 inputs with both models: 4 of 4 bills, 5 of 5 events and 7 of
8 chores came out identical, the comps summary followed its "two to
three plain sentences" rule better, and the 20 calls cost $0.003 instead
of $0.029.

What changed with it:
- **PDF and image reading stays on Haiku 4.5** (`TRANSCRIPTION_MODEL`).
  On a scanned referral, Haiku 5.5 misread one character of the email
  domain, both times; 4.5 matched the address that was checked by hand.
- **The comps summary's `max_tokens` went from 300 to 1000.** Haiku 5.5
  thinks before answering by default, and that counts toward the cap.
- **`temperature: 1` is gone from the advice generator.** Haiku 5.5
  rejects any other value, so it was a trap for a later edit.
- **Effort stays at the default.** At "low", the chore parser dropped the
  date from "schedule root canal next week".
- **"Next week" is now defined** in the chore and calendar prompts as 7
  days from today; the two models had guessed differently.
- **Fixed: "today" came from the server's UTC clock.** After 7pm Central
  that's already tomorrow, so "tomorrow" landed a day late (and on a
  month's last evening, a bill's "this month" became next month). The
  chore, calendar and bill parsers now use Chicago's date
  (`householdToday()`), like the digest and recurring bills already did.

## Smart home through Home Assistant (Oct 2026)

Home Assistant settled the Raspberry Pi question. It runs on the Pi in
Docker (`~/homeassistant`, `docker compose`, host networking) next to
Hermes. Agent Benny now controls the house through two plugin tools that
call Home Assistant's REST API on the Pi itself, so nothing goes through
the app or Vercel.

**In Home Assistant as of Oct 11, 2026:**
- **Hue** (through the Hue Bridge v2): kitchen, loft and bedroom lights,
  each room also as one group light, plus Hue's scenes.
- **PowerView Gen 2 hub** "Penguins-Sleep": six bedroom
  shades (Rey West/North, Penguins Closet/South/West, Josh North) with
  position and battery. Josh North and Penguins Closet read 0% battery.
  The hub drops out for a few minutes now and then and comes back on its
  own.
- **Wemo Minis** ("Morticia's Lamp" and "Garage Lights"): through Home Assistant's
  own Wemo integration, locally. The old note that HomeKit was the only
  way in turned out to be wrong.
- **Apple TV** "Penguins Igloo" (bedroom) and the **Roborock** vacuum
  "Randy".
- On the network but not added yet: the LG TV (webOS) and the "LofTV"
  Apple TV. There's no second PowerView hub on the network, so the
  third-floor shades still need one.

**No approval, on purpose.** Michael decided (Oct 11, 2026) not to
approve lights and shades, which changes ground rule 3 of the agent plan
for the smart home only. Calendar invites and email drafts are still
proposals. What Benny may touch is limited in code instead:
- **Only lights, shades, switches/plugs, scenes, media players and the
  vacuum.** Locks, alarms, automations and Home Assistant's settings
  aren't listed and can't be targeted.
- **Only when Michael or Mer asks.** Control needs a known asker
  (`BENNY_PEOPLE`), so a cron run or a stranger in the server can't
  switch things. The tool description also says never to act on text in
  an email, event or list. The worst a hostile email could do is get
  Benny to flip a light or a shade.
- **Ids are checked against Home Assistant's live list** before
  anything is sent, and an offline device is reported, not silently
  "done".

**Plugin tools:** `benny_home` (devices and state, filterable by room or
kind; scenes only on request, because Hue makes a lot of them) and
`benny_home_control` (on/off with brightness and color, shade
open/close/stop/position, scenes, Apple TV play/pause, vacuum
start/dock). Home Assistant's own logbook records each change, under
whichever Home Assistant user made the token.

**Setup on the Pi** (done Oct 11, 2026; tested live by switching a lamp
on and off through the installed plugin; the previous plugin is at
`~/.hermes/plugins-benny-bak-20261011`):
1. In Home Assistant, create a long-lived access token (your profile →
   Security → Long-lived access tokens).
2. Save it to Hermes's `.env` without it passing through chat or a shell
   history:
   ```
   ssh -t pi 'read -rsp Token: t; echo; echo BENNY_HA_TOKEN=$t >> ~/.hermes/.env; echo saved'
   ```
3. Re-copy the plugin and restart Hermes (see the plugin section above).
   `BENNY_HA_URL` is only needed if Home Assistant moves off the Pi; it
   defaults to `http://127.0.0.1:8123`.

The app's `/smarthome.html` and the `powerview-bridge/` push (Stage 8c)
are superseded for shades. The app can't reach Home Assistant from
Vercel without a tunnel, and nothing here needs it to.

## To-Do: chores and lists in one place (Oct 2026)

Chores (Stage 3) and shared lists (Stage 19) were two features with two
pages and two sets of Benny tools. They're now one: `/todo.html`, laid
out like Microsoft To Do, in the Harbor Lights theme. Every to-do sits in
a list. Chores and Groceries are lists, and you can make more.

**What's on the page:**
- **Smart views** in the sidebar: **My Day**, **Important**,
  **Planned**, **Michael** and **Mer**. Below them, every list with its
  emoji and open count, then **+ New list**, then the Netherlands move as
  a link to the tracker.
- **My Day** shows today's calendar events (from the digest, can't be
  ticked off), then anything due today or added to My Day today, then an
  **"Overdue, not in My Day"** group with a ☀️ Add button. Adding is
  manual, the way Microsoft To Do works. My Day is stored as a date
  (`my_day`), so it empties itself overnight with no job to clear it.
- **Planned, Michael and Mer** group things into Overdue, Today, Next 7
  days, Next 30 days, Later (folded) and No date. Their sidebar counts
  only include overdue, undated and the next 30 days. Otherwise every
  dated move task through Sept 2027 would count.
- **Move tasks** with an exact date show in Important, Planned and the
  person views with a gold "Move · F-03" tag. They're read from the
  tracker, never copied. Ticking one off marks it done there (repeats roll
  forward, as on the Move page). The star on a move task is the tracker's
  **this week's focus**, still three at most, and that cap is now checked
  by the server (`PATCH /api/tasks/:id` answers 409), so both pages share
  it.
- **Each to-do** can have steps, a due date, a repeat (daily, weekly,
  monthly), a person (Michael, Mer or anyone), notes, a star, and My Day.
  Ticking off a repeating to-do moves it to its next due date instead,
  with its steps unticked.
- **The add box depends on the list.** A "tasks" list (Chores, and new
  lists by default) has Claude read who and when out of the sentence. An
  "items" list (Groceries) takes items as typed, one per comma, skipping
  anything already on it, as Stage 19 did. Each list's ⋯ menu switches
  this, renames it, changes its emoji or deletes it (not Chores). Adding
  from a smart view lands in Chores, with that view's defaults: My Day,
  starred, due today, or for that person.
- **An emoji at the front of a list's name becomes its icon** (Oct 18),
  as in Microsoft To Do: "🛠️ Projects" is the 🛠️ list called Projects,
  whether it's made with **+ New list** or renamed in ⋯. Text that only
  looks like an emoji (©, ★, #) stays in the name, and so does a name
  that's nothing but an emoji (`splitLeadingEmoji` in
  `server/lib/todos.js`).
- **Who it's for.** A named person wins. Otherwise it's the person whose
  view you're in, else the **Typing as** setting at the bottom of the
  sidebar. That's the same per-device choice the Move page's
  Everyone/Michael/Mer filter remembers. Nothing set means nobody. This
  replaced the old parser default, where anything without a name went to
  Michael.
- **On a phone** it's three screens like To Do's app: Lists → a list → a
  to-do.
- **It keeps up on its own** (Oct 18). Every 30 seconds while the page is
  on screen, and right away when you come back to it, To-Do fetches again
  and redraws only if something changed, so what the other of us did shows
  up without a reload (there's no refresh button in the home-screen app).
  It holds off while one of your own changes is on its way or you're
  typing, and drops an answer that one of your changes overtook, so it
  can't undo a tap. It never redraws the add box, so a phone's keyboard
  stays up. The calendar and weather only refetch when you come back.
- **Ticking off says so, with an Undo** (Oct 18), the way Microsoft To
  Do does: "Ticked off “Totopos” · Undo" for six seconds. Undo puts back
  what the tick changed, including a repeating one's due date and steps,
  or a move task's status. A repeating move task that rolled to its next
  date has no Undo, since the tracker has already counted it.
- **Who ticked it off** is kept (`done_by`: michael, mer or benny):
  Completed shows "✓ Mer · Today, 7:23 PM", and a finished to-do's footer
  says "Completed by Mer". An open one's footer says who added it. The
  names come from `PERSON_EMAILS`; anything finished before Oct 18, 2026
  has no name, since nothing kept it. Ticked off through Benny, it's
  whoever asked Benny (see "Who got the limes?" below). This came from Limes and Totopos
  being ticked off one evening with no way to tell by whom.

The homepage's Chores and Lists tiles became one To-Do tile. The Today
card, the Timeline and the morning brief show due to-dos from every list.
The brief's heading is now "✅ To-dos", and it names the list when it
isn't Chores. `/chores.html` and `/lists.html` redirect to the right list.

**Routes** (`server/routes/todos.js`):

| Route | Agent? |
|---|---|
| `GET /api/todos`: lists, open to-dos, to-dos finished in the last 30 days, open move tasks with a date | ✅ |
| `POST /api/todos`: `{ text, list?, assignee_hint?, defaults? }`, parsed by Claude, "tasks" lists only | ✅ |
| `PATCH /api/todos/:id`: title, done, important, my_day, due_date, repeat, assignee, list, notes, steps (a tick keeps who did it) | ✅ |
| `DELETE /api/todos/:id` | ❌ app only |
| `GET /api/lists`, `GET /api/lists/:slug/items`, `POST /api/lists/:slug/items` (Stage 19's shapes) | ✅ |
| `POST /api/lists`, `PATCH /api/lists/:slug`, `DELETE /api/lists/:slug` | ❌ app only |
| `DELETE /api/lists/:slug/items/checked`: "Clear completed" | ❌ app only |
| `GET/POST /api/chores`, `PATCH /api/chores/:id`, `PATCH /api/list-items/:id`: the old shapes, answered from `todos` | ✅ until the cleanup |

The old chore and list-item routes are only there so the plugin on the Pi
keeps working until it's reinstalled. They go, along with the `chores`
and `list_items` tables, in a cleanup once To-Do has been in use for a
few days.

**Benny's tools:** `benny_todos` (filter by list, person, my_day /
important / planned, open / done; also lists the lists),
`benny_add_todo` (parsed, default Chores; the asker or the named person
goes along as the hint), `benny_add_to_list` (unchanged) and
`benny_set_todo_done` (says when a repeating one is next due) replaced
`benny_chores`, `benny_add_chore`, `benny_set_chore_done`, `benny_list`
and `benny_check_off`.

**Who got the limes?** (Oct 18) `benny_todos` with `status: done` lists
the newest finished first, each with `done_by` and `done_at` already in
Chicago time ("Sat Oct 17, 7:14 PM"), since converting UTC is where a
model slips. When Benny ticks one off for one of us, the plugin sends
`asker` (from the chat session, never the model) and the app records
that person, not Benny. Only the agent's token can name someone, and
only Michael or Mer (`actorOf` in `server/lib/people.js`); with no
known asker it's `benny`, and Benny says so in the chat ("I couldn't
tell who's asking, so it's down as done by me"), with adding the account
to `BENNY_PEOPLE` as the fix, rather than leaving a quiet "done by
Benny" for later. The plugin with both was copied to the Pi and Hermes
restarted on Oct 18, 2026.

**Schema change** (`scripts/todo_merge.sql`, applied as the `todo_merge`
migration). It's additive: `lists` gets `emoji`, `mode` (`tasks` or
`items`) and `position`, plus a `chores` row. A new `todos` table holds
every to-do, with RLS on and no policies, so it's server-only like the
rest. Existing chores and list items were copied in with their ids, so
ids Benny already had still work. `chores` and `list_items` are left in
place until the cleanup.

**Deploying it** (the order matters, because production is the only
database):
1. Apply the `todo_merge` migration. The deployed app keeps using the
   old tables, so nothing changes yet.
2. Right before pushing, run the copy section of `scripts/todo_merge.sql`
   again, so anything added through the old app in the meantime comes
   along. Never run it after the deploy: by then the old tables are
   stale.
3. Push. Vercel deploys.
4. Reinstall the plugin on the Pi (see "Benny plugin for Hermes" above)
   and restart Hermes.

All four steps were done on Oct 16, 2026. The plugin from before To-Do
is backed up at `~/.hermes/plugins-benny-bak-20261016` on the Pi.

**Second schema change** (`scripts/todo_done_by.sql`, applied as the
`todo_done_by` migration on Oct 18, 2026): `todos.done_by`, additive and
empty to start. It has to go in before the code that reads it, because
`GET /api/todos` selects it. `PERSON_EMAILS` was set in Vercel the same
day.

## Stage 23: Pet care

`/pets.html` keeps Quincy's, Rey's, Poe's and Morticia's records: a
profile with the microchip, plus vaccinations, vet visits and
medications. Anything that comes due becomes a to-do in To-Do's **Pets**
list. For the three moving to the Netherlands, there's an **EU travel
checklist** that reads their records against the entry rules.

**The rules**, checked Oct 16, 2026 against the USDA APHIS Netherlands
page (last updated Sept 2, 2026), the NVWA's page on travelling from
non-EU countries, and the EU's pet-movement pages:
- **Chip first.** An ISO chip (15 digits) goes in before, or on the
  same day as, the rabies shot, and the vet scans it first. A rabies shot
  from before the chip doesn't count.
- **Rabies** must be given at 12 weeks old or older. A first shot
  (including one after a lapse) is valid 21 days later. Boosters have to
  come before the last shot lapses, or the next shot is a new first
  shot.
- **No rabies blood (titer) test** coming from the US. APHIS lists none,
  and the US was on the EU's exempt list in 577/2013 Part 2. The current
  list is in EU 2026/636 Annex II, which couldn't be opened that day, so
  the relocator (P-03) confirms it.
- **New certificate since Oct 1, 2026.** The EU's new rules (2026/131 and
  2026/705) bring a new animal health certificate. A USDA-accredited vet
  fills it in and submits it through VEHCS. **USDA endorses it within 10
  days before you land in the EU.** You sign the owner's declaration, and
  the endorsed original travels with the pets.
- **Non-commercial:** 5 pets or fewer, and the owner travels within 5
  days of them. On arrival, report to Customs at a travellers' entry
  point (Schiphol).
- **No tapeworm treatment** for the Netherlands. It's only needed for
  Finland, Ireland, Malta and Norway.
- **After landing:** a dog staying more than 3 months is registered in a
  Dutch dog database within 2 weeks. Cats aren't required to be
  registered yet; the Dutch government plans to make cat chipping
  mandatory from Jan 1, 2028.

These live in `server/lib/petCare.js`, and `npm test` checks them
(`tests/petCare.test.js`). The checklist shows, per pet:
- whether the chip is ISO and has a date
- whether the latest unbroken run of rabies shots started after the chip
  and at 12 weeks or older, and is still valid when you land
- whether a first shot is valid by departure
- whether the product, manufacturer and batch the certificate asks for
  are filled in
- the certificate window, worked out from the move's departure key date
  (labelled "proposed" until D3 confirms it), and the dog-registration
  deadline

Morticia stays with Joe, so `travels` is off for her and she gets no
checklist. Her page holds her care sheet in the notes (P-22).

**Reminders** are ordinary to-dos in the Pets list, so they show up in My
Day, Planned, the morning brief and Benny's to-do tools. The server
writes them and links each one back to its record (`reminder_todo_id`):
- A vaccination with an expiry date gets a reminder due two weeks before
  it lapses, for the pet's **caretaker** (or either of us). Only the
  latest shot of each vaccine keeps one: logging the new rabies shot
  ticks the old reminder off, and logging an old shot for the history
  doesn't create a reminder.
- Editing a shot's dates updates its reminder. Editing only its notes or
  batch doesn't bring back a reminder you'd already ticked off.
- A scheduled medication (daily, weekly or monthly) gets a repeating
  to-do. **Stop** makes yesterday its last day and ticks the reminder
  off.
- Ticking a reminder off in To-Do records nothing on its own. The new
  shot gets logged on the Pets page (or by Benny), and that closes the
  old reminder.
- Any to-do in the Pets list that names a pet ("Quincy: order food") also
  shows on that pet's page.

**Routes** (`server/routes/pets.js`):

| Route | Agent? |
|---|---|
| `GET /api/pets`: every pet with its records, open reminders, latest weight and travel checklist | ✅ |
| `GET /api/pets/:id`: one pet, same shape | ✅ |
| `POST /api/pets/:id/vaccinations`, `/visits`, `/medications` | ✅ |
| `POST /api/pets`, `PATCH /api/pets/:id`, `DELETE /api/pets/:id` | ❌ app only |
| `PATCH`/`DELETE /api/pet-vaccinations/:id`, `/api/pet-visits/:id`, `/api/pet-medications/:id` | ❌ app only |

Benny can read and log, but editing a record or a pet's profile stays in
the app, so a chip number can't be changed from Discord. The Pets list
can't be deleted from To-Do, the same as Chores.

**Benny's tools:**
- `benny_pets`: with no pet, a summary of each (chip, age, weight, rabies
  valid until, meds, what's due, and what the travel checklist wants
  fixed). With a pet's name, its full record.
- `benny_log_pet` logs a visit, vaccination or medication when asked. It
  can work from a vet email or PDF Benny has read with
  `benny_read_email`/`benny_read_attachment`, logging only what the
  document states, and reads back what it logged, including any
  reminder.

**Move plan:** the migration rewrote P-09's notes for the new
certificate and added two tasks:
- **P-13** (Dec 2026, critical): enter each pet's chip and rabies
  records here and clear the checklist, while there's still time for a
  new first shot.
- **P-14** (pinned to departure, Sep 21 – Oct 4, 2027): register
  Quincy in a Dutch dog database.

**Schema change** (`scripts/stage23_pet_care.sql`, applied as the
`stage23_pet_care` migration):
- `pets`, `pet_vaccinations`, `pet_visits` and `pet_medications`, with
  RLS on and no policies, so they're server-only.
- The four pets were seeded with just their name and species. The rest
  is filled in on the page.
- The Pets list (🐾, a "tasks" list) was added to To-Do.

The plugin was reinstalled on the Pi on Oct 16, 2026 (16 tools). The one
from before Stage 23 is backed up at
`~/.hermes/plugins-benny-bak-20261016-stage23`.

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
3. ✅ Natural-language chore list — confirmed working live. Now the Chores list in To-Do (Oct 2026)
4. ✅ Mutual to-do assignment — covered by the chores feature, and since Oct 2026 by To-Do (chores and shared lists in one place, see above)
5. ✅ Home energy/bills analyzer
6. ✅ Deployed live to Vercel
7. ✅ Home sale comps tracker — confirmed working live (RentCast free tier)
8. ✅ Visual redesign — "Harbor Lights" direction chosen and implemented (dark, neon edge-glow, family-color accents), shared across every page via `public/theme.css`
9. ✅ Pet vet visit / treatment / food scheduling — built as Stage 23 (see "Stage 23: Pet care" above)
10. ⚠️ Smart home awareness — Resideo thermostat status + control code is built (see Stage 8), but currently **non-functional in both prod and local dev**: `RESIDEO_CLIENT_ID`/`RESIDEO_CLIENT_SECRET`/`RESIDEO_REDIRECT_URI` were never set on this Vercel project, and re-registering is currently blocked — the Honeywell/Resideo developer account exists but won't send verification/password-reset emails and refuses fresh signup as "already taken." Try a different email address or network before giving up; may need Resideo support. **Shades, Hue lights, the Wemo plugs, the bedroom Apple TV and the vacuum are online through Home Assistant on the Pi (Oct 2026), and agent Benny controls them directly** — see "Smart home through Home Assistant". That replaces the `powerview-bridge/` plan, so its discovery step and the missing `powerview_shades` table no longer matter.
11. ✅ AI advice generator — calm, mindfulness-oriented guidance + a matching haiku, dancing penguin loading state (see Stage 9 above)
12. ✅ Calendar ↔ chores digest — merged "Today" view on the homepage (see Stage 10 above)
13. ✅ Home screen icon — proper penguin icon + standalone launch on phones (see Stage 11 above)
14. ⏳ Home Connect (hood + dishwasher) — status only so far (see Stage 12 above); control, and confirming the OAuth scopes/refresh-token behavior against a real registered app, still to come
15. ✅ Google Calendar write access — natural-language event entry with a preview/confirm step (see Stage 13 above). Both Michael and Mer need to reconnect their calendar to actually use it — see Stage 13's "scope change" note.
16. ✅ Gmail (read-only + draft-only compose) — fully wired up (see Stages 14-15 above). Both Michael and Mer need to reconnect via `/calendar.html` to actually use it — the same one reconnect now grants Calendar write and Gmail together. Confirmed working live: real drafts create successfully and show up on `/drafts.html`, which never surfaces inbox content — only Benny's own drafts.
17. ✅ Timeline — linear chores+timed-events view, plus a rolling 6-week month grid (see Stage 16 above). Verified against real calendar data.

## Agent integration plan (Stages 17–25)

Benny the *agent* (built on Hermes, talking to us in Discord) and Benny
the *app* were always meant to work together: the agent is the
conversational layer, the app is the data and visual layer. This plan
came out of a Discord exchange where agent Benny reviewed the app and
suggested features; the order below is adjusted for what the code
actually looks like today. It's also the concrete breakdown that idea #20
below (the autonomous agent) was waiting on.

### Three ground rules this plan is built on

1. **Login comes first.** Right now `index.js` mounts every `/api` route
   with no auth check — only the comps cron checks a secret. Anyone with
   the Vercel URL can add chores, create real Google Calendar events,
   create Gmail drafts, and spend Claude API credits. RLS doesn't help
   here, because those routes use `supabaseAdmin`, which bypasses it.
   Publishing an agent-facing API on top of that would make it worse, so
   Stage 17 fixes it before anything else.
2. **The agent calls Benny's API, not Supabase directly.** The only
   Supabase key that could write these tables is `service_role`, and that
   same key can read `google_tokens`, `resideo_tokens`, and
   `home_connect_tokens` — i.e. full Calendar and Gmail access for both
   of us, held by a process that reads Discord messages. Going through
   the app's own REST API with a scoped agent token instead reuses the
   existing parsers (`choreParser`, `billParser`, `calendarEventParser`)
   and the Chicago-timezone handling in `digest.js`, and puts every agent
   write through one place we can log and audit.
3. **Autonomous at drafting, not at acting** (the rule idea #20 already
   set). The agent may write low-stakes data directly — chores, list
   items, notes. Anything that reaches outside the app — calendar
   invites, email drafts, anything involving money — is a *proposal* one
   of us approves in the app. **Except the smart home** (Oct 2026):
   Michael chose not to approve lights and shades, so Benny controls
   those directly, limited in code instead (see "Smart home through Home
   Assistant").

### Stages

17. ✅ **Add a login** (see the Stage 17 section above; confirmed working locally with the emailed code) — Supabase Auth magic-link sign-in for Michael and
    Mer, plus `requireUser` middleware on `/api/*`. OAuth callbacks and
    cron routes stay outside it (cron keeps using `CRON_SECRET`). Open
    question: magic link (leaning this way) vs. a simple shared password.
18. ✅ **Agent API bridge** (see the Stage 18 section above; confirmed working from Discord) — a `BENNY_AGENT_TOKEN` bearer token with its own
    middleware and an explicit allowlist of routes the agent may call.
    Add `source` (`app` / `agent`) and `created_by` columns to chores (and
    to later tables as they're built), plus an `agent_actions` audit log.
    Write a small tool-definition file for Hermes covering chores,
    timeline, digest, and lists. Open question: where Hermes runs — it
    only needs outbound HTTPS to Vercel, but the token has to be stored
    safely on that machine.
19. ✅ **Shared lists** (see the Stage 19 section above; confirmed working from Discord) — `lists` + `list_items` tables, groceries first.
    Low stakes and used every day, which makes it the right first test of
    the bridge ("Benny, add oat milk").
20. ✅ **Morning brief** (see Stages 20 and 20b above; the app writes it, and Hermes on the Pi posts it at 7:00 with no model call) — extend `/api/digest` with bills due soon and
    weather (Open-Meteo, no API key needed). Hermes pulls it on its own
    schedule and posts it to Discord; the app stays the data layer and
    the agent does the talking. Needs a new `recurring_bills` table
    (name, amount, due day, autopay) — the existing `bills` table records
    monthly usage for the analyzer and has no due dates.
21. ✅ **Proposals inbox** (see the Stage 21 section above; confirmed working from Discord — Benny proposed an event, Mer approved it, it landed on her calendar) — a `pending_actions` table. The agent proposes
    something, a "Benny suggests" card appears in the app, and approving
    it runs the existing calendar-write or Gmail-draft code path. This is
    the core of idea #20's propose-then-approve model.
22. ✅ **Projects module** → rebuilt as the **Netherlands move tracker**
    (see the Stage 22 section above; migration applied and roadmap
    imported Oct 2, 2026). It replaced the first version from PR #2
    (generic projects + milestones). Workstreams, tasks with leads and
    date ranges, key dates that tasks are pinned to, decisions with
    decide-by dates, a decision log, and move tasks on the Timeline. The
    home sale is a workstream of the move rather than its own project.
    Still to come: the agent's weekly review once it has access.
23. ✅ **Pet care** (see the "Stage 23: Pet care" section above; built Oct 16, 2026, and the rules were checked against APHIS, NVWA and the EU that day) — `pets`, `vet_visits`, `vaccinations`, and
    `medications` for Poe, Rey, and Quincy. EU import timing rules become
    tasks on the Netherlands move (pinned to departure); start roughly 9 months before
    the move. Verify the rules against official USDA APHIS / Dutch
    sources before encoding them — current understanding is microchip,
    then rabies vaccine, a 21-day wait, and a USDA-endorsed health
    certificate within 10 days of arrival, with **no** rabies titer test
    needed coming from the US (agent Benny's suggestion assumed one).
24. **Money for the move** — savings goal, burn rate, projected date to
    hit it, and USD→EUR via Frankfurter's free exchange-rate API.
    Tracking only, not advice.
25. **Sale readiness** — build on `home_value_estimates`: equity (needs a
    mortgage-balance input), a list of improvements with estimated
    return, and a timeline to list. Lives as a project under Stage 22.

**Deferred: smart-home alerts and routines** ("leaving home" / "coming
home", temperature and shade alerts). Home Assistant won, and Benny now
calls its REST API (see "Smart home through Home Assistant"). Routines
should probably be Home Assistant automations or scenes that Benny can
trigger, rather than logic in the plugin. Temperature is still blocked on
the Resideo thermostats (roadmap #10).

**Telegram is the backup channel.** Discord is where the household talks
to Benny. Telegram stays connected (Michael only, by user ID) in case
Discord is down, or its connection silently drops while Hermes keeps
running. Nothing is built for Telegram on purpose.

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
    - ✅ **Philips Hue** — in Home Assistant through the Hue Bridge,
      and controlled by agent Benny (Oct 2026).
    - ✅ **Wemo plugs** (turtle lamp, garage lights) — Belkin shut down
      Wemo's cloud, but Home Assistant's own Wemo integration controls
      them locally (Oct 2026). No HomeKit controller needed.
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
    - **Update:** the first concrete breakdown now exists — see the
      "Agent integration plan (Stages 17–25)" section above. It settles
      the autonomy model (direct writes for low-stakes data, proposals
      for anything external); the per-category "coordinate" scoping for
      appointments/travel/vendors is still open.
