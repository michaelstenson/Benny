// The linear "what's next" view: open chores and project milestones
// (Stage 22) (including anything overdue, with no lower bound — an
// unresolved one stays relevant no matter how late) merged
// chronologically with TIMED calendar events only — never all-day (see /api/calendar/month for those). Distinct
// from /api/digest (Stage 10), which is deliberately today-only; this is
// the fuller scrolling view for "what's coming up," not just today.

import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { OWNERS } from '../lib/tokenStore.js';
import { fetchEventsInRange } from './calendar.js';

export const timelineRouter = Router();

const HOUSEHOLD_TIMEZONE = 'America/Chicago';
const FORWARD_WINDOW_DAYS = 60; // how far ahead this view looks

function localDateString(date) {
  return date.toLocaleDateString('en-CA', { timeZone: HOUSEHOLD_TIMEZONE });
}

timelineRouter.get('/timeline', async (req, res) => {
  try {
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + FORWARD_WINDOW_DAYS * 86_400_000).toISOString();

    // Same graceful-degradation approach as digest.js: a broken Google
    // connection shouldn't hide the chores half of this view.
    const perOwnerEvents = await Promise.all(
      OWNERS.map(async (owner) => {
        try {
          return await fetchEventsInRange(owner, { timeMin, timeMax });
        } catch (err) {
          console.error(`[timeline] could not fetch ${owner}'s events:`, err.message);
          return [];
        }
      })
    );
    const events = perOwnerEvents
      .flat()
      .filter((event) => !event.allDay)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    const today = localDateString(now);
    const cutoff = localDateString(new Date(now.getTime() + FORWARD_WINDOW_DAYS * 86_400_000));

    // due_date <= cutoff naturally excludes chores with no due_date at
    // all (NULL <= anything is never true in Postgres) and includes
    // anything overdue regardless of how far in the past, same logic
    // digest.js already relies on.
    const { data: chores, error } = await supabaseAdmin
      .from('chores')
      .select('*')
      .eq('completed', false)
      .lte('due_date', cutoff)
      .order('due_date', { ascending: true });
    if (error) throw error;

    const choresWithFlag = (chores || []).map((chore) => ({
      ...chore,
      overdue: chore.due_date < today,
    }));

    // Open milestones from active projects (Stage 22), same rule as
    // chores: due on or before the cutoff, overdue ones included, and
    // undated ones left out. `blocked` is only worth showing, not hiding —
    // a milestone waiting on another is still coming up.
    const { data: milestones, error: milestonesError } = await supabaseAdmin
      .from('milestones')
      .select('id, title, owner, due_date, project:projects!inner(slug, name, status)')
      .eq('status', 'open')
      .eq('project.status', 'active')
      .lte('due_date', cutoff)
      .order('due_date', { ascending: true });
    if (milestonesError) throw milestonesError;

    const milestonesWithFlag = (milestones || []).map((m) => ({
      id: m.id,
      title: m.title,
      owner: m.owner,
      due_date: m.due_date,
      project_slug: m.project.slug,
      project_name: m.project.name,
      overdue: m.due_date < today,
    }));

    res.json({ events, chores: choresWithFlag, milestones: milestonesWithFlag });
  } catch (err) {
    console.error('[timeline] failed to build timeline:', err.message);
    res.status(500).json({ error: 'Could not load the timeline.' });
  }
});
