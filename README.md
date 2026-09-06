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
├── server/
│   ├── index.js           # Express app entry point — start here
│   ├── lib/
│   │   ├── supabaseClient.js   # two Supabase clients: anon (RLS-limited) and admin (service_role)
│   │   ├── googleClient.js     # builds the Google OAuth2 client
│   │   ├── tokenStore.js       # reads/writes your Google tokens in Supabase
│   │   ├── anthropicClient.js  # one shared Claude client
│   │   └── choreParser.js      # turns free text into {title, assignee, due_date} via Claude tool use
│   └── routes/
│       ├── hello.js       # GET /api/hello — the hello-world endpoint
│       ├── auth.js        # /auth/google + /auth/google/callback — the Google sign-in handshake
│       ├── calendar.js    # /api/calendar/status + /api/calendar/events
│       └── chores.js      # /api/chores (GET/POST) + /api/chores/:id (PATCH)
├── public/
│   ├── index.html         # the page you see at localhost:3000
│   ├── app.js              # browser-side JS that calls /api/hello
│   ├── calendar.html       # the calendar page
│   ├── calendar.js         # browser-side JS that calls /api/calendar/events
│   ├── chores.html         # the chores page
│   └── chores.js           # browser-side JS for adding/listing/completing chores
├── .env.example            # template for required environment variables
├── .env                     # your real values (never committed — see .gitignore)
└── package.json
```

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

## Putting this on GitHub

This folder is not yet a git repository — that's your first set of git reps.
From this folder, run:

```
git init
git add -A
git commit -m "Scaffold Benny: hello-world wired to Supabase"
git branch -M main
```

Then:

1. Create a new, empty repository on GitHub (no README/license — this repo
   already has one). Note the URL it gives you, e.g.
   `https://github.com/<your-username>/benny.git`.
2. Connect and push:
   ```
   git remote add origin https://github.com/<your-username>/benny.git
   git push -u origin main
   ```

`.env` will **not** be pushed — it's listed in `.gitignore` specifically
because it holds credentials that shouldn't end up in a public (or even
private) GitHub repo.

## Roadmap (in order)

1. ✅ Hello world — full stack wired together
2. ✅ Shared calendar that auto-populates from email (Google Calendar connected; Mer's account and richer views come later)
3. ⏳ Natural-language chore list (code delivered; needs your Anthropic API key to test live)
4. Mutual to-do assignment
5. Home energy/bills analyzer
6. Pet vet visit / treatment / food scheduling
7. Smart home awareness (PowerView shades, Resideo/HomeKit, Eero)
