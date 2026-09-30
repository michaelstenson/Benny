// Signing in and out of Benny itself (as opposed to auth.js /
// resideoAuth.js / homeConnectAuth.js, which connect *outside* accounts
// once you're already in). Mounted under /auth, and deliberately the only
// /auth routes that don't require a session — you can't need to be
// signed in to sign in.
//
// Two ways to finish signing in, both from the same email:
//   1. Type the 6-digit code into /login.html → POST /auth/verify.
//      This is the one that works from the home-screen app on a phone,
//      which keeps its own cookies separate from the phone's browser —
//      tapping an email link would sign in the browser, not the app.
//   2. Tap the link in the email → GET /auth/confirm. Handy on a laptop.

import { Router } from 'express';
import { createSessionClient, isAllowedEmail } from '../lib/authSession.js';

export const sessionRouter = Router();

// Only ever redirect back to a path on this site — never to a full URL
// someone could smuggle in via ?next=.
function safeNext(next) {
  const value = typeof next === 'string' ? next : '';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

// POST /auth/login — body: { email }. Emails a sign-in code + link.
sessionRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Enter your email.' });

  // Checked here too (not just after sign-in) so a stranger can't use
  // Benny to send sign-in emails to arbitrary addresses.
  if (!isAllowedEmail(email)) {
    return res.status(403).json({ error: "That email isn't on Benny's list." });
  }

  const supabase = createSessionClient(req, res);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false, // Michael and Mer are added in the Supabase dashboard; nobody signs up
      emailRedirectTo: `${req.protocol}://${req.get('host')}/auth/confirm`,
    },
  });

  if (error) {
    console.error('[session] signInWithOtp failed:', error.message);
    // Allowlisted, but no matching user in Supabase Auth yet — see the
    // Stage 17 README section for adding Michael and Mer.
    if (error.code === 'otp_disabled') {
      return res.status(403).json({ error: "You're on the list but not set up in Supabase yet." });
    }
    return res.status(error.status === 429 ? 429 : 500).json({
      error:
        error.status === 429
          ? 'Too many sign-in emails just now — wait a minute and try again.'
          : 'Could not send the sign-in email.',
    });
  }

  res.json({ sent: true });
});

// POST /auth/verify — body: { email, code }. Finishes sign-in with the
// 6-digit code from the email.
sessionRouter.post('/verify', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  if (!email || !code) return res.status(400).json({ error: 'Enter the code from the email.' });
  if (!isAllowedEmail(email)) return res.status(403).json({ error: "That email isn't on Benny's list." });

  const supabase = createSessionClient(req, res);
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) {
    return res.status(400).json({ error: 'That code didn\'t work — it may have expired. Send a new one.' });
  }

  res.json({ signedIn: true });
});

// GET /auth/confirm — where the email's link lands. Supports both the
// token_hash link (from Benny's custom email template — see the README)
// and Supabase's default ?code= link, which only works in the same
// browser that asked for the email.
sessionRouter.get('/confirm', async (req, res) => {
  const { token_hash, type, code } = req.query;
  const supabase = createSessionClient(req, res);

  let result;
  if (token_hash && type) {
    result = await supabase.auth.verifyOtp({ token_hash: String(token_hash), type: String(type) });
  } else if (code) {
    result = await supabase.auth.exchangeCodeForSession(String(code));
  } else {
    return res.redirect('/login.html?error=missing');
  }

  const email = result.data?.user?.email;
  if (result.error || !isAllowedEmail(email)) {
    if (!result.error) await supabase.auth.signOut();
    return res.redirect('/login.html?error=link');
  }

  res.redirect(safeNext(req.query.next));
});

// POST /auth/logout
sessionRouter.post('/logout', async (req, res) => {
  const supabase = createSessionClient(req, res);
  await supabase.auth.signOut();
  res.json({ signedOut: true });
});
