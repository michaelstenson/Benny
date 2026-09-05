// An Express "router" is a mini bundle of related routes. Keeping this
// route in its own file (instead of piling everything into index.js)
// is a pattern you'll want as soon as you have more than a couple of
// endpoints — one file per feature area (hello, calendar, chores, ...).

import { Router } from 'express';
import { supabase } from '../lib/supabaseClient.js';

export const helloRouter = Router();

// GET /api/hello
// This is the one endpoint in our hello-world slice. It does two things
// on purpose: (1) proves the frontend can reach the backend at all, and
// (2) proves the backend can reach Supabase, so we know all three layers
// of the stack (browser -> Express -> Supabase) are wired up correctly
// before we build any real features on top of them.
helloRouter.get('/hello', async (req, res) => {
  let supabaseConnected = false;
  let supabaseError = null;

  try {
    // getSession() is a lightweight call that just talks to Supabase's
    // auth API — it works even though we haven't created any database
    // tables yet, so it's a safe way to confirm connectivity this early.
    const { error } = await supabase.auth.getSession();
    supabaseConnected = !error;
    if (error) supabaseError = error.message;
  } catch (err) {
    supabaseError = err.message;
  }

  res.json({
    message: 'Hello from Benny 🐧',
    timestamp: new Date().toISOString(),
    supabaseConnected,
    ...(supabaseError ? { supabaseError } : {}),
  });
});
