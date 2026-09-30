// Who's signed in to Benny. Until Stage 17 there was no answer to that
// question at all — every /api route was open to anyone with the URL.
//
// Sign-in is Supabase Auth's email one-time code / magic link, and the
// session lives in httpOnly cookies (not localStorage) so it rides along
// automatically on every same-origin request — including plain browser
// navigations like /auth/google/michael, which can't carry an
// Authorization header the way a fetch() can.
//
// @supabase/ssr does the cookie bookkeeping: it reads the session out of
// the request's cookies, refreshes it when the access token has expired,
// and hands us any updated cookies to write back on the response.

import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { auditAgentRequest, bearerToken, isAgentRoute, isValidAgentToken } from './agentAuth.js';

// Only these people can sign in, even if someone else somehow gets a
// Supabase user created. Comma-separated in the env var. Unset means
// nobody gets in — failing closed beats accidentally failing open.
export function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email) {
  return Boolean(email) && allowedEmails().includes(String(email).toLowerCase());
}

if (allowedEmails().length === 0) {
  console.warn('[auth] ALLOWED_EMAILS is empty — nobody will be able to sign in until it is set.');
}

// One Supabase client per request, wired to that request's cookies. This
// has to be per-request (unlike the shared clients in supabaseClient.js)
// because the session belongs to whoever sent this particular request.
export function createSessionClient(req, res) {
  return createServerClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    cookieOptions: {
      httpOnly: true, // page JS never needs to see the tokens; only this server does
      secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
      sameSite: 'lax', // still sent on top-level navigations back from Google/Resideo OAuth
      path: '/',
    },
    cookies: {
      getAll() {
        return parseCookieHeader(req.headers.cookie ?? '');
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          res.appendHeader('Set-Cookie', serializeCookieHeader(name, value, options));
        }
      },
    },
  });
}

// Returns the signed-in user's email, or null. getClaims() verifies the
// access token (refreshing it first if it's expired, which is why the
// cookie writer above matters even on a read).
export async function getSignedInEmail(req, res) {
  const supabase = createSessionClient(req, res);
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.email) return null;
  return isAllowedEmail(data.claims.email) ? data.claims.email.toLowerCase() : null;
}

// Express middleware. JSON routes get a 401 (the browser-side
// auth-guard.js turns that into a redirect to /login.html); browser
// navigations like /auth/google/michael get redirected to the login page
// directly, then sent back where they were going.
export function requireUser({ publicPaths = [] } = {}) {
  return async (req, res, next) => {
    if (publicPaths.includes(req.path)) return next();

    // Benny the agent (Stage 18): a bearer token instead of a cookie, and
    // only for the routes on its allowlist. A request carrying a token is
    // judged on that token alone — it never falls back to a cookie.
    const token = req.baseUrl === '/api' ? bearerToken(req) : null;
    if (token) {
      if (!isValidAgentToken(token)) {
        return res.status(401).json({ error: 'Invalid agent token.' });
      }
      auditAgentRequest(req, res); // every agent request is logged, even refused ones
      if (!isAgentRoute(req.method, req.path)) {
        return res.status(403).json({ error: "The agent isn't allowed to use this route." });
      }
      req.user = { email: null, agent: true };
      return next();
    }

    try {
      const email = await getSignedInEmail(req, res);
      if (email) {
        req.user = { email };
        return next();
      }
    } catch (err) {
      console.error('[auth] session check failed:', err.message);
    }

    if (req.baseUrl === '/api') {
      return res.status(401).json({ error: 'Not signed in.' });
    }
    res.redirect('/login.html?next=' + encodeURIComponent(req.originalUrl));
  };
}
