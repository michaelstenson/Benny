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
│   │   └── billParser.js       # turns free text into {category, amount, billing_month} via Claude tool use
│   └── routes/
│       ├── hello.js       # GET /api/hello — the hello-world endpoint
│       ├── auth.js        # /auth/google + /auth/google/callback — the Google sign-in handshake
│       ├── calendar.js    # /api/calendar/status + /api/calendar/events
│       ├── chores.js      # /api/chores (GET/POST) + /api/chores/:id (PATCH)
│       └── bills.js       # /api/bills (GET/POST) — includes the per-category summary
├── public/
│   ├── index.html         # the page you see at localhost:3000
│   ├── app.js              # browser-side JS that calls /api/hello
│   ├── calendar.html       # the calendar page
│   ├── calendar.js         # browser-side JS that calls /api/calendar/events
│   ├── chores.html         # the chores page
│   ├── chores.js           # browser-side JS for adding/listing/completing chores
│   ├── bills.html          # the bills page
│   └── bills.js            # browser-side JS for adding bills and rendering the summary
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
lists your upcoming events. Two setup steps are required beyond `.env.example`
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
   `google_tokens` table (holding your OAuth tokens) has RLS turned on with
   no public policies — the regular anon key literally cannot read or write
   it. Only trusted server code (this app, never a browser) should ever
   hold this key.

Once both are in `.env`, restart the server (`npm run dev` picks up new
env vars on restart, not automatically), open http://localhost:3000/calendar.html,
and click **Connect Google Calendar**. You'll go through Google's real
consent screen, then land back on the calendar page showing your upcoming
events.

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
2. ✅ Shared calendar that auto-populates from email (Google Calendar connected; Mer's account and richer views come later)
3. ✅ Natural-language chore list — confirmed working live
4. ✅ Mutual to-do assignment — covered by the chores feature (every chore has an assignee already)
5. ⏳ Home energy/bills analyzer (code delivered; reuses your existing Anthropic API key)
6. Pet vet visit / treatment / food scheduling
7. Smart home awareness (PowerView shades, Resideo/HomeKit, Eero)
