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
const MAX_LIST_NAME_LENGTH = 40;
const MAX_EMOJI_LENGTH = 16; // code points, as lists.emoji's check counts them
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

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Whether one grapheme (so 👩‍💻 or 🇳🇱 counts as one) shows as an emoji.
// Not ©, ™ or ★: Unicode files them with emoji, but they show as text
// unless marked with U+FE0F.
function isEmoji(char) {
  if ([...char].length > MAX_EMOJI_LENGTH) return false;
  if (/\p{Emoji_Presentation}|️|⃣/u.test(char)) return true;
  return char.codePointAt(0) > 0xffff && /\p{Extended_Pictographic}/u.test(char); // 🛠 without its U+FE0F
}

// "🛠️ Projects" → { emoji: '🛠️', name: 'Projects' }: a leading emoji
// becomes the list's icon, as in Microsoft To Do. A name that's only an
// emoji is left as the name.
export function splitLeadingEmoji(text) {
  const first = graphemes.segment(text)[Symbol.iterator]().next().value?.segment;
  if (!first || !isEmoji(first)) return { emoji: null, name: text };
  const rest = text.slice(first.length).trim();
  return rest ? { emoji: first, name: rest } : { emoji: null, name: text };
}

// Validates a list's name, emoji and mode, for creating one (POST
// /api/lists) or changing one (PATCH). Returns { fields } or { error }.
export function buildListFields(body, { creating }) {
  const fields = {};
  if ('emoji' in body) {
    if (body.emoji !== null && (typeof body.emoji !== 'string' || [...body.emoji].length > MAX_EMOJI_LENGTH)) {
      return { error: '"emoji" is one emoji.' };
    }
    fields.emoji = body.emoji?.trim() || null;
  }
  if (creating || 'name' in body) {
    const typed = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    // An emoji typed at the front of the name wins over the emoji field.
    const { emoji, name } = splitLeadingEmoji(typed);
    if (!name || name.length > MAX_LIST_NAME_LENGTH) return { error: `A list name is 1–${MAX_LIST_NAME_LENGTH} characters.` };
    fields.name = name;
    if (emoji) fields.emoji = emoji;
  }
  if ('mode' in body) {
    if (!MODES.includes(body.mode)) return { error: '"mode" must be tasks or items.' };
    fields.mode = body.mode;
  }
  return { fields };
}

// Validates a PATCH body against the to-do it changes. Returns { update,
// rolled } or { error }. Moving to another list is the route's job (it
// needs a lookup), so `list` isn't handled here. `by` is who's making the
// change ('michael', 'mer', 'benny' or null), kept as done_by on a tick.
export function buildTodoUpdate(todo, body, today, { by = null, now = new Date() } = {}) {
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
      update.done_by = null;
    } else {
      // Ticking off one that's already done keeps who and when.
      update.done = body.done;
      update.done_at = body.done ? (todo.done ? todo.done_at : now.toISOString()) : null;
      update.done_by = body.done ? (todo.done ? todo.done_by : by) : null;
    }
  }

  if (Object.keys(update).length === 0 && !('list' in body)) return { error: 'Nothing to change.' };
  update.updated_at = now.toISOString();
  return { update, rolled };
}
