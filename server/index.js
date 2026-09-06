// This is the entry point of the whole backend — the file you run to
// start the server. Everything else (routes, the Supabase client) gets
// wired together here.

import 'dotenv/config'; // loads .env into process.env before anything else runs
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helloRouter } from './routes/hello.js';
import { authRouter } from './routes/auth.js';
import { calendarRouter } from './routes/calendar.js';
import { choresRouter } from './routes/chores.js';

// __dirname doesn't exist in ES modules by default, so we rebuild it —
// this is the standard way to do it in a "type": "module" project.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Serve everything in /public as static files (index.html, app.js, ...).
// This is what makes visiting http://localhost:3000 load our frontend.
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// The Google sign-in handshake lives under /auth instead of /api, since
// it's a browser redirect flow, not a JSON endpoint.
app.use('/auth', authRouter);

app.listen(PORT, () => {
  console.log(`Benny is running at http://localhost:${PORT}`);
});
