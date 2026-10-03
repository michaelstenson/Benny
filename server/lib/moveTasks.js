// The rules behind the move tracker (Stage 22): what a task change is
// allowed to do, when a repeating task comes due again, and what goes on
// the weekly Penguin Summit agenda. Pure functions over plain rows, so the
// route, the roadmap importer and the tests all share one copy.
//
// Dates are YYYY-MM-DD strings in the household's time zone, same as
// recurringBills.js, and the math runs in UTC so daylight saving can't
// shift a day.

import { householdToday, daysBetween } from './recurringBills.js';

export const PEOPLE = ['michael', 'mer'];
export const OWNERS = [...PEOPLE, 'both'];
export const STATUSES = ['todo', 'doing', 'waiting', 'done', 'dropped'];
export const OPEN_STATUSES = ['todo', 'doing', 'waiting'];
export const REPEATS = ['weekly', 'monthly', 'quarterly'];
export const PRECISIONS = ['day', 'month'];

const NEXT_30_DAYS = 30;
const DECISIONS_LOOKAHEAD_DAYS = 60; // decisions need lead time, so they surface earlier
const DONE_RECENTLY_DAYS = 7;
export const WAITING_NUDGE_DAYS = 7;

export function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Last day of the month `date` falls in, `monthsAhead` months later.
export function endOfMonth(date, monthsAhead = 0) {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month + monthsAhead, 0)).toISOString().slice(0, 10);
}

export function endOfQuarter(date) {
  const month = Number(date.slice(5, 7));
  return endOfMonth(date, (3 - (month % 3)) % 3);
}

// Weekly repeats fall on Sundays, the Penguin Summit day.
export function sundayOnOrAfter(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, (7 - weekday) % 7);
}

// The first due date of a repeating task that starts on `from`.
export function firstOccurrence(repeat, from) {
  if (repeat === 'weekly') return sundayOnOrAfter(from);
  if (repeat === 'monthly') return endOfMonth(from);
  return endOfQuarter(from);
}

// The next due date after `due` that's still after today. Doing a weekly
// task early or late both land on the following Sunday after today, not
// on a week that's already gone.
export function nextOccurrence(repeat, due, today) {
  let next = due;
  do {
    if (repeat === 'weekly') next = addDays(next, 7);
    else if (repeat === 'monthly') next = endOfMonth(next, 1);
    else next = endOfQuarter(endOfMonth(next, 1));
  } while (next <= today);
  return next;
}

// A timestamp as a date in the household's time zone.
function householdDate(timestamp) {
  return timestamp ? householdToday(new Date(timestamp)) : null;
}

const MAX_TITLE = 300;
const MAX_TEXT = 2000;
const MAX_SHORT = 120;

function cleanText(value, max) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// Turns a PATCH body into the columns to write, applying the status rules:
// finishing a repeating task rolls it to its next due date instead of
// closing it, and "waiting" remembers since when. Returns { update } or
// { error }; `rolled` says a repeating task moved on rather than closing.
export function buildTaskUpdate(task, patch, today, now = new Date()) {
  const update = {};
  const body = patch ?? {};

  if ('title' in body) {
    const title = cleanText(body.title, MAX_TITLE);
    if (!title) return { error: 'A task needs a title.' };
    update.title = title;
  }
  for (const [field, max] of [['notes', MAX_TEXT], ['waiting_on', MAX_SHORT]]) {
    if (field in body) {
      const value = cleanText(body[field], max);
      if (value === undefined) return { error: `"${field}" must be text.` };
      update[field] = value;
    }
  }
  if ('link_url' in body) {
    const link = cleanText(body.link_url, 500);
    if (link === undefined || (link && !/^https?:\/\/\S+$/.test(link))) {
      return { error: 'The link has to start with http:// or https://.' };
    }
    update.link_url = link;
  }
  if ('owner' in body) {
    if (!OWNERS.includes(body.owner)) return { error: '"owner" must be michael, mer or both.' };
    update.owner = body.owner;
  }
  if ('lead' in body) {
    if (body.lead !== null && !PEOPLE.includes(body.lead)) return { error: '"lead" must be michael, mer or empty.' };
    update.lead = body.lead;
  }
  for (const field of ['start_date', 'due_date', 'repeat_until']) {
    if (field in body) {
      if (body[field] !== null && !isDateString(body[field])) return { error: `"${field}" must be a YYYY-MM-DD date.` };
      update[field] = body[field];
    }
  }
  if ('date_precision' in body) {
    if (!PRECISIONS.includes(body.date_precision)) return { error: '"date_precision" must be day or month.' };
    update.date_precision = body.date_precision;
  }
  if ('repeat' in body) {
    if (body.repeat !== null && !REPEATS.includes(body.repeat)) return { error: '"repeat" must be weekly, monthly, quarterly or empty.' };
    update.repeat = body.repeat;
  }
  for (const field of ['critical', 'focus']) {
    if (field in body) {
      if (typeof body[field] !== 'boolean') return { error: `"${field}" must be true or false.` };
      update[field] = body[field];
    }
  }

  const merged = { ...task, ...update };
  if (merged.start_date && merged.due_date && merged.start_date > merged.due_date) {
    return { error: 'The start date is after the due date.' };
  }

  let rolled = false;
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) return { error: `"status" must be one of ${STATUSES.join(', ')}.` };
    const status = body.status;

    if (status === 'done' && merged.repeat && merged.due_date) {
      const next = nextOccurrence(merged.repeat, merged.due_date, today);
      update.times_done = (task.times_done || 0) + 1;
      update.last_done_on = today;
      if (!merged.repeat_until || next <= merged.repeat_until) {
        rolled = true;
        update.status = 'todo';
        update.due_date = next;
        update.completed_at = null;
        update.waiting_since = null;
      }
    }
    if (!rolled) {
      update.status = status;
      if (status === 'done') {
        if (task.status !== 'done') {
          update.completed_at = now.toISOString();
          update.last_done_on = today;
        }
      } else {
        update.completed_at = null;
      }
      if (status === 'waiting') {
        update.waiting_since = task.status === 'waiting' && task.waiting_since ? task.waiting_since : today;
      } else {
        update.waiting_since = null;
      }
    }
  }

  if (Object.keys(update).length === 0) return { error: 'Nothing to change.' };
  update.updated_at = now.toISOString();
  return { update, rolled };
}

export function isOpen(task) {
  return OPEN_STATUSES.includes(task.status);
}

function byDueDate(a, b) {
  if (a.due_date === b.due_date) return (a.code || '').localeCompare(b.code || '');
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date < b.due_date ? -1 : 1;
}

// The Penguin Summit agenda, as lists of task/decision ids:
// - focus: this week's top picks
// - overdue: open and past due
// - next_30: open, not overdue, and either already started or due within
//   30 days. "Started" is what keeps a "Q1" task from hiding until March.
// - waiting: waiting on someone else, longest first
// - done_recently: finished (or a repeat ticked off) in the last 7 days
// - decisions_due: open decisions with a decide-by in the next 60 days
export function buildAgenda(tasks, decisions, today) {
  const horizon = addDays(today, NEXT_30_DAYS);
  const recent = addDays(today, -DONE_RECENTLY_DAYS);
  const open = tasks.filter(isOpen).sort(byDueDate);

  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const overdueIds = new Set(overdue.map((t) => t.id));
  const next30 = open.filter(
    (t) =>
      !overdueIds.has(t.id) &&
      ((t.start_date && t.start_date <= today) || (t.due_date && t.due_date <= horizon))
  );
  const waiting = open
    .filter((t) => t.status === 'waiting')
    .sort((a, b) => (a.waiting_since || today).localeCompare(b.waiting_since || today));
  const doneRecently = tasks.filter(
    (t) =>
      (t.status === 'done' && householdDate(t.completed_at) >= recent) ||
      (t.repeat && t.last_done_on && t.last_done_on >= recent)
  );
  const decisionsDue = decisions
    .filter((d) => d.status === 'open' && d.decide_by && d.decide_by <= addDays(today, DECISIONS_LOOKAHEAD_DAYS))
    .sort((a, b) => a.decide_by.localeCompare(b.decide_by));

  return {
    today,
    focus: open.filter((t) => t.focus).map((t) => t.id),
    overdue: overdue.map((t) => t.id),
    next_30: next30.map((t) => t.id),
    waiting: waiting.map((t) => t.id),
    done_recently: doneRecently.map((t) => t.id),
    decisions_due: decisionsDue.map((d) => d.id),
  };
}

// An input task that's still open and due after the decision's decide-by
// date means the decision is scheduled before the thing it depends on.
export function decisionWarnings(decision, inputTasks) {
  if (decision.status !== 'open' || !decision.decide_by) return [];
  return inputTasks
    .filter((t) => isOpen(t) && t.due_date && t.due_date > decision.decide_by)
    .map((t) => `${t.code || t.title} is due ${t.due_date}, after this decision's ${decision.decide_by}.`);
}

export function daysWaiting(task, today) {
  return task.waiting_since ? daysBetween(task.waiting_since, today) : 0;
}
