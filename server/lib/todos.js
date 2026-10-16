// The rules behind To-Do (Oct 2026): what a change to a to-do is allowed
// to do, and when a repeating one comes due again. Pure functions over
// plain rows, same idea as moveTasks.js, so the route stays about loading
// and saving.
//
// Dates are YYYY-MM-DD strings in the household's time zone.

import { PEOPLE, addDays, isDateString } from './moveTasks.js';

export const REPEATS = ['daily', 'weekly', 'monthly'];
export const MODES = ['tasks', 'items'];
export const MAX_TITLE_LENGTH = 200;
const MAX_NOTES_LENGTH = 2000;
const MAX_STEPS = 20;

// Same day next month, or the month's last day when it's shorter (Jan 31
// → Feb 28). That clamp sticks: the month after is the 28th too.
function addMonth(date) {
  const [year, month, day] = date.split('-').map(Number);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
}

// The next due date after `due` that's after today too, so ticking off a
// daily to-do that's a week late doesn't leave it a week behind.
export function nextDue(repeat, due, today) {
  let next = due;
  do {
    if (repeat === 'daily') next = addDays(next, 1);
    else if (repeat === 'weekly') next = addDays(next, 7);
    else next = addMonth(next);
  } while (next <= today);
  return next;
}

export function cleanTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE_LENGTH);
  return title || null;
}

function cleanSteps(value) {
  if (!Array.isArray(value) || value.length > MAX_STEPS) return null;
  const steps = [];
  for (const step of value) {
    const title = cleanTitle(step?.title);
    if (!title || typeof step.done !== 'boolean') return null;
    steps.push({ title, done: step.done });
  }
  return steps;
}

// Validates a PATCH body against the to-do it changes. Returns { update,
// rolled } or { error }. Moving to another list is the route's job (it
// needs a lookup), so `list` isn't handled here.
export function buildTodoUpdate(todo, body, today, now = new Date()) {
  const update = {};

  if ('title' in body) {
    const title = cleanTitle(body.title);
    if (!title) return { error: '"title" can\'t be empty.' };
    update.title = title;
  }
  if ('assignee' in body) {
    if (body.assignee !== null && !PEOPLE.includes(body.assignee)) return { error: '"assignee" must be michael, mer or empty.' };
    update.assignee = body.assignee;
  }
  if ('important' in body) {
    if (typeof body.important !== 'boolean') return { error: '"important" must be true or false.' };
    update.important = body.important;
  }
  if ('my_day' in body) {
    if (typeof body.my_day !== 'boolean') return { error: '"my_day" must be true or false.' };
    update.my_day = body.my_day ? today : null;
  }
  if ('notes' in body) {
    if (body.notes !== null && typeof body.notes !== 'string') return { error: '"notes" must be text.' };
    update.notes = (body.notes || '').trim().slice(0, MAX_NOTES_LENGTH) || null;
  }
  if ('steps' in body) {
    const steps = cleanSteps(body.steps);
    if (!steps) return { error: `"steps" must be up to ${MAX_STEPS} { title, done } entries.` };
    update.steps = steps;
  }
  if ('due_date' in body) {
    if (body.due_date !== null && !isDateString(body.due_date)) return { error: '"due_date" must be a YYYY-MM-DD date.' };
    update.due_date = body.due_date;
  }
  if ('repeat' in body) {
    if (body.repeat !== null && !REPEATS.includes(body.repeat)) return { error: '"repeat" must be daily, weekly, monthly or empty.' };
    update.repeat = body.repeat;
  }

  // A repeat counts forward from the due date: starting one with no date
  // makes it due today, and clearing the date stops the repeat.
  const merged = { ...todo, ...update };
  if (merged.repeat && !merged.due_date) {
    if ('due_date' in update) update.repeat = null;
    else update.due_date = today;
  }

  let rolled = false;
  if ('done' in body) {
    if (typeof body.done !== 'boolean') return { error: '"done" must be true or false.' };
    const { repeat, due_date: due } = { ...todo, ...update };
    if (body.done && repeat && due) {
      // Done with this one: the next one is due, with its steps unticked.
      rolled = true;
      update.due_date = nextDue(repeat, due, today);
      update.steps = (update.steps || todo.steps || []).map((step) => ({ ...step, done: false }));
      update.done = false;
      update.done_at = null;
    } else {
      update.done = body.done;
      update.done_at = body.done ? (todo.done ? todo.done_at : now.toISOString()) : null;
    }
  }

  if (Object.keys(update).length === 0 && !('list' in body)) return { error: 'Nothing to change.' };
  update.updated_at = now.toISOString();
  return { update, rolled };
}
