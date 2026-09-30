// This is the entry point of the whole backend — the file you run to
// start the server. Everything else (routes, the Supabase client) gets
// wired together here.
//
// Why this file lives at the project root instead of inside server/:
// Vercel's zero-config Express support only looks for an entry file named
// index/app/server (.js/.ts/etc) at the project root or under src/ — see
// the "Deploying to Vercel" section in the README. server/index.js (where
// this used to live) doesn't match that convention, so Vercel silently
// deployed nothing runnable. Everything else (routes, lib) still lives
// under server/ — only the entry point had to move.

import 'dotenv/config'; // loads .env into process.env before anything else runs
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helloRouter } from './server/routes/hello.js';
import { authRouter } from './server/routes/auth.js';
import { calendarRouter } from './server/routes/calendar.js';
import { choresRouter } from './server/routes/chores.js';
import { billsRouter } from './server/routes/bills.js';
import { compsRouter } from './server/routes/comps.js';
import { resideoAuthRouter } from './server/routes/resideoAuth.js';
import { homeConnectAuthRouter } from './server/routes/homeConnectAuth.js';
import { smarthomeRouter } from './server/routes/smarthome.js';
import { adviceRouter } from './server/routes/advice.js';
import { digestRouter } from './server/routes/digest.js';
import { gmailRouter } from './server/routes/gmail.js';
import { timelineRouter } from './server/routes/timeline.js';
import { listsRouter } from './server/routes/lists.js';
import { recurringBillsRouter } from './server/routes/recurringBills.js';
import { sessionRouter } from './server/routes/session.js';
import { requireUser } from './server/lib/authSession.js';

// __dirname doesn't exist in ES modules by default, so we rebuild it —
// this is the standard way to do it in a "type": "module" project.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel sits in front of this app as a proxy, so the real protocol
// (https) arrives in X-Forwarded-Proto. Trusting it is what makes
// req.protocol say "https" — which the sign-in email's link depends on.
app.set('trust proxy', true);

// Serve everything in /public as static files (index.html, app.js, ...).
// This is what makes visiting http://localhost:3000 load our frontend.
// (On Vercel itself, express.static() is ignored — Vercel's CDN serves
// public/** directly instead — but this line is still what makes it work
// for local dev with `npm run dev`.)
app.use(express.static(path.join(__dirname, 'public')));

// Without this, req.body would be undefined on POST/PATCH requests —
// this middleware reads the raw request and parses it as JSON for us.
// hello.js and calendar.js never needed it since they're GET-only.
app.use(express.json());

// Signing in to Benny itself (Stage 17). Mounted before everything else
// because these are the only routes that must work while signed out.
app.use('/auth', sessionRouter);

// Every /api route and every remaining /auth route (connecting Google,
// Resideo, Home Connect) needs a signed-in Michael or Mer. The one
// exception is the weekly comps cron: Vercel calls it with no browser
// session, and it checks CRON_SECRET on its own instead.
app.use('/api', requireUser({ publicPaths: ['/comps/refresh'] }));
app.use('/auth', requireUser());

// Mount our API routes under /api — so hello.js's "/hello" becomes
// the real path "/api/hello", calendar.js's "/calendar/events" becomes
// "/api/calendar/events", and chores.js's "/chores" becomes "/api/chores".
app.use('/api', helloRouter);
app.use('/api', calendarRouter);
app.use('/api', choresRouter);
app.use('/api', billsRouter);
app.use('/api', compsRouter);
app.use('/api', smarthomeRouter);
app.use('/api', adviceRouter);
app.use('/api', digestRouter);
app.use('/api', gmailRouter);
app.use('/api', timelineRouter);
app.use('/api', listsRouter);
app.use('/api', recurringBillsRouter);

// GET /api/me — who's signed in. auth-guard.js calls this on every page
// load; for Benny the agent it's a cheap "is my token working?" check.
app.get('/api/me', (req, res) =>
  res.json({ email: req.user.email, agent: Boolean(req.user.agent) })
);

// The Google/Resideo sign-in handshakes live under /auth instead of /api,
// since they're browser redirect flows, not JSON endpoints.
app.use('/auth', authRouter);
app.use('/auth', resideoAuthRouter);
app.use('/auth', homeConnectAuthRouter);

// Only actually start listening on a port when this file is run directly
// (`node index.js` / `npm run dev`, which is how local dev works). When
// Vercel imports this file to wrap it as a serverless function, it does
// NOT run it directly — it just reads the exported `app` below — so this
// check keeps us from trying to open a port inside a serverless function,
// which isn't how Vercel runs things.
if (process.argv[1] === __filename) {
  app.listen(PORT, () => {
    console.log(`Benny is running at http://localhost:${PORT}`);
  });
}

// Vercel wraps this exported Express app as a single serverless function —
// this line is what makes that possible.
export default app;
