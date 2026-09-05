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
│   │   └── supabaseClient.js   # one shared Supabase client
│   └── routes/
│       └── hello.js       # GET /api/hello — the hello-world endpoint
├── public/
│   ├── index.html         # the page you see at localhost:3000
│   └── app.js             # browser-side JS that calls /api/hello
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
2. Shared calendar that auto-populates from email
3. Natural-language chore list
4. Mutual to-do assignment
5. Home energy/bills analyzer
6. Pet vet visit / treatment / food scheduling
7. Smart home awareness (PowerView shades, Resideo/HomeKit, Eero)
