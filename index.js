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

// __dirname doesn't exist in ES modules by default, so we rebuild it —
// this is the standard way to do it in a "type": "module" project.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

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

// Mount our API routes under /api — so hello.js's "/hello" becomes
// the real path "/api/hello", calendar.js's "/calendar/events" becomes
// "/api/calendar/events", and chores.js's "/chores" becomes "/api/chores".
app.use('/api', helloRouter);
app.use('/api', calendarRouter);
app.use('/api', choresRouter);
app.use('/api', billsRouter);

// The Google sign-in handshake lives under /auth instead of /api, since
// it's a browser redirect flow, not a JSON endpoint.
app.use('/auth', authRouter);

app.listen(PORT, () => {
  console.log(`Benny is running at http://localhost:${PORT}`);
});
