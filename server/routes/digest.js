import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { OWNERS } from '../lib/tokenStore.js';
import { fetchEventsForOwner } from './calendar.js';
import { withNextDue } from '../lib/recurringBills.js';
import { fetchTodaysWeather } from '../lib/weatherClient.js';

export const digestRouter = Router();

// How far ahead the digest looks for recurring bills (Stage 20) — far
// enough that the morning brief warns before a bill is due, not on the day.
const BILLS_LOOKAHEAD_DAYS = 7;

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
// today's due-or-overdue open chores into one at-a-glance view. Since
// Stage 20 it also carries today's weather and recurring bills due in
// the next week, since it's what agent Benny's morning brief is built from. Pure
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
    //
    // Weather and bills get the same treatment: each is fetched alongside
    // the calendar, and a failure just leaves that piece out (null / []).
    const [perOwnerEvents, weather, billsDue] = await Promise.all([
      Promise.all(
        OWNERS.map(async (owner) => {
          try {
            return await fetchEventsForOwner(owner, { maxResults: 30 });
          } catch (err) {
            console.error(`[digest] could not fetch ${owner}'s events:`, err.message);
            return [];
          }
        })
      ),
      fetchTodaysWeather(),
      fetchBillsDue(today),
    ]);
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

    res.json({ date: today, weather, events, chores: choresWithFlag, bills_due: billsDue });
  } catch (err) {
    console.error('[digest] failed to build digest:', err.message);
    res.status(500).json({ error: 'Could not load today\'s digest.' });
  }
});

// Active recurring bills whose next due date is within
// BILLS_LOOKAHEAD_DAYS (today included), soonest first.
async function fetchBillsDue(today) {
  const { data, error } = await supabaseAdmin
    .from('recurring_bills')
    .select('id, name, amount, due_day, autopay')
    .eq('active', true);
  if (error) {
    console.error('[digest] could not load recurring bills:', error.message);
    return [];
  }
  return data
    .map((bill) => withNextDue(bill, today))
    .filter((bill) => bill.days_until <= BILLS_LOOKAHEAD_DAYS)
    .sort((a, b) => a.days_until - b.days_until);
}
