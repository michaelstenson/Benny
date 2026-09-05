// This is the entry point of the whole backend — the file you run to
// start the server. Everything else (routes, the Supabase client) gets
// wired together here.

import 'dotenv/config'; // loads .env into process.env before anything else runs
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helloRouter } from './routes/hello.js';

// __dirname doesn't exist in ES modules by default, so we rebuild it —
// this is the standard way to do it in a "type": "module" project.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Serve everything in /public as static files (index.html, app.js, ...).
// This is what makes visiting http://localhost:3000 load our frontend.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount our API routes under /api — so hello.js's "/hello" becomes
// the real path "/api/hello".
app.use('/api', helloRouter);

app.listen(PORT, () => {
  console.log(`Benny is running at http://localhost:${PORT}`);
});
