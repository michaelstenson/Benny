// How Benny the *agent* (Hermes, talking to us in Discord) gets into
// Benny the *app* — Stage 18. Instead of handing the agent Supabase's
// service_role key (which could also read everyone's Google tokens), it
// gets its own bearer token that only opens a short, explicit list of
// /api routes. Everything it does through that token is written to the
// agent_actions table, so there's always a record of what the agent did.
//
// The agent sends:  Authorization: Bearer <BENNY_AGENT_TOKEN>

import crypto from 'node:crypto';
import { supabaseAdmin } from './supabaseClient.js';

// Every route the agent may call, relative to /api. Anything not listed
// here gets a 403 even with a valid token — new routes are closed to the
// agent by default and have to be opened on purpose. Calendar writes,
// Gmail drafts and smart-home stay off this list for good, per the
// "autonomous at drafting, not at acting" rule: the agent proposes those
// through the proposals inbox (Stage 21) and one of us approves them.
const AGENT_ROUTES = [
  { method: 'GET', path: /^\/me$/ },
  { method: 'GET', path: /^\/digest$/ },
  { method: 'GET', path: /^\/timeline$/ },
  { method: 'GET', path: /^\/chores$/ },
  { method: 'POST', path: /^\/chores$/ },
  { method: 'PATCH', path: /^\/chores\/[0-9a-f-]{36}$/ },
  // Shared lists (Stage 19). Clearing checked items is left off on
  // purpose — it's the one irreversible list action, so it stays app-only.
  { method: 'GET', path: /^\/lists$/ },
  { method: 'GET', path: /^\/lists\/[a-z0-9-]+\/items$/ },
  { method: 'POST', path: /^\/lists\/[a-z0-9-]+\/items$/ },
  { method: 'PATCH', path: /^\/list-items\/[0-9a-f-]{36}$/ },
  // Proposals inbox (Stage 21): propose and check on proposals. Approve
  // and reject are left off on purpose — only a signed-in person can
  // turn a proposal into a real calendar event or Gmail draft.
  { method: 'GET', path: /^\/proposals$/ },
  { method: 'POST', path: /^\/proposals$/ },
  // Projects (Stage 22): the agent can read projects, add and update
  // milestones and decisions, and pull the weekly review. Creating or
  // archiving a project and every delete stay app-only.
  { method: 'GET', path: /^\/projects$/ },
  { method: 'GET', path: /^\/projects\/review$/ },
  { method: 'GET', path: /^\/projects\/[a-z0-9-]+$/ },
  { method: 'POST', path: /^\/projects\/[a-z0-9-]+\/milestones$/ },
  { method: 'PATCH', path: /^\/milestones\/[0-9a-f-]{36}$/ },
  { method: 'POST', path: /^\/projects\/[a-z0-9-]+\/decisions$/ },
  { method: 'PATCH', path: /^\/decisions\/[0-9a-f-]{36}$/ },
];

export function isAgentRoute(method, path) {
  return AGENT_ROUTES.some((route) => route.method === method && route.path.test(path));
}

// Constant-time comparison, so response timing can't leak how much of a
// guessed token was right. Hashing first makes both sides the same
// length, which timingSafeEqual requires.
export function isValidAgentToken(presented) {
  const expected = process.env.BENNY_AGENT_TOKEN;
  if (!expected || !presented) return false; // unset = agent access off entirely
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

// Records one agent request in agent_actions. It hooks res.end so the log
// row is written *before* the response goes out — on Vercel, work left
// running after the response is sent can be frozen mid-flight, so "log
// it afterward" isn't reliable there.
export function auditAgentRequest(req, res) {
  if (!supabaseAdmin) {
    console.warn('[agent] SUPABASE_SERVICE_ROLE_KEY missing — agent request not logged.');
    return;
  }
  const originalEnd = res.end;
  res.end = function (...args) {
    supabaseAdmin
      .from('agent_actions')
      .insert({
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        request_body: req.method === 'GET' ? null : req.body ?? null,
      })
      .then(({ error }) => {
        if (error) console.error('[agent] failed to write audit log:', error.message);
      })
      .finally(() => originalEnd.apply(res, args));
    return res;
  };
}
