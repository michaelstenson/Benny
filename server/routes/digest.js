import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { OWNERS } from '../lib/tokenStore.js';
import { fetchEventsForOwner } from './calendar.js';

export const digestRouter = Router();

// The household lives in Chicago (see the Home Comps stage) — "today"
// needs to mean today in that timezone, not the server's (Vercel runs
// serverless functions in UTC), or the digest would flip over to
// "tomorrow" hours before it actually is locally.
const HOUSEHOLD_TIMEZONE = 'America/Chicago';

function localDateString(date) {
  // en-CA gives YYYY-MM-DD directly, which both sorts correctly as a
  // string and matches Supabase's date column format — no date library
  // needed for just this.
  return date.toLocaleDateString('en-CA', { timeZone: HOUSEHOLD_TIMEZONE });
}

// GET /api/digest — merges today's calendar events (both owners) with
// today's due-or-overdue open chores into one at-a-glance view. Pure
// data-joining, no Claude involved — unlike chores/bills/advice, there's
// nothing here for a language model to extract or generate.
digestRouter.get('/digest', async (req, res) => {
  try {
    const today = localDateString(new Date());

    // A broken/expired Google connection shouldn't take down the whole
    // digest — chores are unrelated to Google and should still show up.
    // fetchEventsForOwner already treats "not connected" as "no events";
    // this treats "connected but the token call failed" the same way,
    // just logging it instead of surfacing an error for something that's
    // meant to be a low-stakes glance, not a page you'd rely on.
    const perOwnerEvents = await Promise.all(
      OWNERS.map(async (owner) => {
        try {
          return await fetchEventsForOwner(owner, { maxResults: 30 });
        } catch (err) {
          console.error(`[digest] could not fetch ${owner}'s events:`, err.message);
          return [];
        }
      })
    );
    const events = perOwnerEvents
      .flat()
      .filter((event) => localDateString(new Date(event.start)) === today)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    // due_date <= today, so this also naturally picks up anything
    // overdue — chores with no due_date are excluded (NULL <= anything
    // is never true in Postgres), which is what we want: an open-ended
    // chore isn't "due" today just because it exists.
    const { data: chores, error } = await supabaseAdmin
      .from('chores')
      .select('*')
      .eq('completed', false)
      .lte('due_date', today)
      .order('due_date', { ascending: true });
    if (error) throw error;

    const choresWithFlag = (chores || []).map((chore) => ({
      ...chore,
      overdue: chore.due_date < today,
    }));

    res.json({ date: today, events, chores: choresWithFlag });
  } catch (err) {
    console.error('[digest] failed to build digest:', err.message);
    res.status(500).json({ error: 'Could not load today\'s digest.' });
  }
});
