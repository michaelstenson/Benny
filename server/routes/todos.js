// To-Do (Oct 2026): chores and shared lists in one place. Every to-do sits
// in a list. A list's mode decides how adding works: "tasks" lists (Chores,
// and new ones by default) have Claude read who and when out of a sentence;
// "items" lists (Groceries) take items as typed, one per comma, and skip
// anything already on the list.
//
// The page builds My Day, Important, Planned and the Michael/Mer views
// itself from GET /api/todos, which also carries open move tasks with an
// exact date (Stage 22). Those stay in the move tracker: the page changes
// them through PATCH /api/tasks/:id, never here.
//
// Replaces chores.js and lists.js. Their old routes are still answered
// at the bottom of this file, in their old shapes, until the Hermes plugin
// on the Pi has moved to the new ones.

import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { householdToday } from '../lib/recurringBills.js';
import { PEOPLE } from '../lib/moveTasks.js';
import { parseTodoText } from '../lib/todoParser.js';
import { MODES, buildTodoUpdate, cleanTitle } from '../lib/todos.js';

export const todosRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const TODO_COLUMNS =
  'id, title, assignee, due_date, important, my_day, repeat, notes, steps, done, done_at, ' +
  'raw_input, source, created_by, created_at, updated_at, list:lists!inner(slug)';
const LIST_COLUMNS = 'id, slug, name, emoji, mode, position';
const DONE_SHOWN_DAYS = 30; // how long a finished to-do stays under "Completed"
const MAX_ITEMS_PER_REQUEST = 50;
const MAX_LIST_NAME_LENGTH = 40;
const DEFAULT_LIST = 'chores'; // where adds from My Day and the other smart views land

function fail(res, status, error) {
  return res.status(status).json({ error });
}

// The list comes back nested from the join; the page only needs its slug.
function toTodo(row) {
  const { list, ...todo } = row;
  return { ...todo, list: list.slug };
}

function who(req) {
  return {
    source: req.user.agent ? 'agent' : 'app',
    created_by: req.user.agent ? 'agent' : req.user.email,
  };
}

async function findList(slug) {
  if (!SLUG_PATTERN.test(slug || '')) return null;
  const { data, error } = await supabaseAdmin.from('lists').select(LIST_COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
}

async function findTodo(id) {
  if (!UUID_PATTERN.test(id)) return null;
  const { data, error } = await supabaseAdmin.from('todos').select(TODO_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function loadLists() {
  const [{ data: lists, error: listsError }, { data: open, error: openError }] = await Promise.all([
    supabaseAdmin.from('lists').select(LIST_COLUMNS).order('position').order('created_at'),
    supabaseAdmin.from('todos').select('list_id').eq('done', false),
  ]);
  if (listsError || openError) throw listsError || openError;
  const counts = {};
  for (const todo of open) counts[todo.list_id] = (counts[todo.list_id] || 0) + 1;
  return lists.map(({ id, ...list }) => ({ ...list, open_count: counts[id] || 0 }));
}

// GET /api/todos — everything the To-Do page shows, in one round trip:
// lists, open to-dos, to-dos finished in the last 30 days, and open move
// tasks with an exact date (any distance ahead; the page folds far-off
// ones under "Later").
todosRouter.get('/todos', async (req, res) => {
  try {
    const today = householdToday();
    const since = new Date(Date.now() - DONE_SHOWN_DAYS * 86_400_000).toISOString();
    const [lists, open, done, tasks] = await Promise.all([
      loadLists(),
      supabaseAdmin.from('todos').select(TODO_COLUMNS).eq('done', false).order('created_at'),
      supabaseAdmin
        .from('todos')
        .select(TODO_COLUMNS)
        .eq('done', true)
        .gte('done_at', since)
        .order('done_at', { ascending: false }),
      supabaseAdmin
        .from('tasks')
        .select('id, code, title, owner, lead, due_date, repeat, focus, status, project:projects!inner(slug, name, status)')
        .in('status', ['todo', 'doing', 'waiting'])
        .eq('date_precision', 'day')
        .eq('project.status', 'active')
        .not('due_date', 'is', null)
        .order('due_date'),
    ]);
    for (const result of [open, done, tasks]) if (result.error) throw result.error;

    res.json({
      today,
      lists,
      todos: [...open.data, ...done.data].map(toTodo),
      move_tasks: tasks.data.map(({ project, ...task }) => ({
        ...task,
        project_slug: project.slug,
        project_name: project.name,
      })),
    });
  } catch (err) {
    console.error('[todos] failed to load to-dos:', err.message);
    fail(res, 500, 'Could not load your to-dos.');
  }
});

// POST /api/todos — body { text, list?, assignee_hint?, defaults? }. For a
// "tasks" list: Claude reads the title, who and when out of text. A named
// person wins; otherwise assignee_hint (who's typing, or whose view this
// is). defaults carries what the smart view adds: { my_day, important,
// due_today }.
todosRouter.post('/todos', async (req, res) => {
  const { text, list: slug = DEFAULT_LIST, assignee_hint: hint = null, defaults = {} } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) return fail(res, 400, 'Missing "text" in request body.');
  if (hint !== null && !PEOPLE.includes(hint)) return fail(res, 400, '"assignee_hint" must be michael, mer or empty.');

  try {
    const list = await findList(slug);
    if (!list) return fail(res, 404, 'No list by that name.');
    if (list.mode !== 'tasks') {
      return fail(res, 400, `${list.name} takes items as typed: send them to /api/lists/${list.slug}/items.`);
    }

    const today = householdToday();
    const parsed = await parseTodoText(text.trim(), { assigneeHint: hint });
    const { data, error } = await supabaseAdmin
      .from('todos')
      .insert({
        list_id: list.id,
        title: cleanTitle(parsed.title) || cleanTitle(text),
        assignee: parsed.assignee,
        due_date: parsed.due_date || (defaults.due_today === true ? today : null),
        my_day: defaults.my_day === true ? today : null,
        important: defaults.important === true,
        raw_input: text.trim(),
        ...who(req),
      })
      .select(TODO_COLUMNS)
      .single();
    if (error) throw error;

    res.status(201).json({ todo: toTodo(data) });
  } catch (err) {
    console.error('[todos] failed to add a to-do:', err.message);
    fail(res, 500, 'Could not understand or save that to-do.');
  }
});

// PATCH /api/todos/:id — any of title, done, important, my_day (true/false),
// due_date, repeat, assignee, list (a slug), notes, steps. Ticking off a
// repeating to-do moves it to its next due date instead (`rolled: true`).
todosRouter.patch('/todos/:id', async (req, res) => {
  const body = req.body ?? {};
  try {
    const todo = await findTodo(req.params.id);
    if (!todo) return fail(res, 404, 'No to-do with that id.');

    const { update, rolled, error: invalid } = buildTodoUpdate(todo, body, householdToday());
    if (invalid) return fail(res, 400, invalid);
    if ('list' in body) {
      const list = await findList(body.list);
      if (!list) return fail(res, 400, 'No list by that name.');
      update.list_id = list.id;
    }

    const { data, error } = await supabaseAdmin
      .from('todos')
      .update(update)
      .eq('id', todo.id)
      .select(TODO_COLUMNS)
      .single();
    if (error) throw error;
    res.json({ todo: toTodo(data), rolled });
  } catch (err) {
    console.error('[todos] failed to update a to-do:', err.message);
    fail(res, 500, 'Could not save that to-do.');
  }
});

// DELETE /api/todos/:id — app-only (not on the agent's allowlist).
todosRouter.delete('/todos/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return fail(res, 404, 'No to-do with that id.');
  const { data, error } = await supabaseAdmin.from('todos').delete().eq('id', req.params.id).select('id');
  if (error) {
    console.error('[todos] failed to delete a to-do:', error.message);
    return fail(res, 500, 'Could not delete that to-do.');
  }
  if (!data.length) return fail(res, 404, 'No to-do with that id.');
  res.json({ deleted: data[0].id });
});

// --- Lists ------------------------------------------------------------------

// GET /api/lists — every list in sidebar order, with its open count.
todosRouter.get('/lists', async (req, res) => {
  try {
    res.json({ lists: await loadLists() });
  } catch (err) {
    console.error('[todos] failed to load lists:', err.message);
    fail(res, 500, 'Could not load lists.');
  }
});

function listFields(body, { creating }) {
  const fields = {};
  if (creating || 'name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > MAX_LIST_NAME_LENGTH) return { error: `A list name is 1–${MAX_LIST_NAME_LENGTH} characters.` };
    fields.name = name;
  }
  if ('emoji' in body) {
    if (body.emoji !== null && (typeof body.emoji !== 'string' || body.emoji.length > 16)) return { error: '"emoji" is one emoji.' };
    fields.emoji = body.emoji?.trim() || null;
  }
  if ('mode' in body) {
    if (!MODES.includes(body.mode)) return { error: '"mode" must be tasks or items.' };
    fields.mode = body.mode;
  }
  return { fields };
}

// POST /api/lists — body { name, emoji?, mode? }. App-only. The slug comes
// from the name and never changes afterwards, so Benny can keep using it.
todosRouter.post('/lists', async (req, res) => {
  const { fields, error: invalid } = listFields(req.body ?? {}, { creating: true });
  if (invalid) return fail(res, 400, invalid);
  try {
    const { data: existing, error: loadError } = await supabaseAdmin.from('lists').select('slug, position');
    if (loadError) throw loadError;
    const base = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
    const taken = new Set(existing.map((l) => l.slug));
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

    const { data, error } = await supabaseAdmin
      .from('lists')
      .insert({ ...fields, slug, position: Math.max(0, ...existing.map((l) => l.position)) + 1 })
      .select(LIST_COLUMNS)
      .single();
    if (error) throw error;
    const { id, ...list } = data;
    res.status(201).json({ list: { ...list, open_count: 0 } });
  } catch (err) {
    console.error('[todos] failed to create a list:', err.message);
    fail(res, 500, 'Could not create that list.');
  }
});

// PATCH /api/lists/:slug — body: any of { name, emoji, mode }. App-only.
todosRouter.patch('/lists/:slug', async (req, res) => {
  const { fields, error: invalid } = listFields(req.body ?? {}, { creating: false });
  if (invalid) return fail(res, 400, invalid);
  if (!Object.keys(fields).length) return fail(res, 400, 'Nothing to change.');
  try {
    const list = await findList(req.params.slug);
    if (!list) return fail(res, 404, 'No list by that name.');
    const { data, error } = await supabaseAdmin.from('lists').update(fields).eq('id', list.id).select(LIST_COLUMNS).single();
    if (error) throw error;
    const { id, ...updated } = data;
    res.json({ list: updated });
  } catch (err) {
    console.error('[todos] failed to update a list:', err.message);
    fail(res, 500, 'Could not save that list.');
  }
});

// DELETE /api/lists/:slug — the list and every to-do on it. App-only, and
// never Chores (where the smart views add to) or Pets (where pet care's
// reminders go, Stage 23).
const KEPT_LISTS = { [DEFAULT_LIST]: 'Chores', pets: 'Pets' };
todosRouter.delete('/lists/:slug', async (req, res) => {
  if (KEPT_LISTS[req.params.slug]) return fail(res, 400, `${KEPT_LISTS[req.params.slug]} can't be deleted.`);
  try {
    const list = await findList(req.params.slug);
    if (!list) return fail(res, 404, 'No list by that name.');
    const { error } = await supabaseAdmin.from('lists').delete().eq('id', list.id);
    if (error) throw error;
    res.json({ deleted: list.slug });
  } catch (err) {
    console.error('[todos] failed to delete a list:', err.message);
    fail(res, 500, 'Could not delete that list.');
  }
});

// --- Items, for "items" lists like Groceries --------------------------------

// The list item shape from Stage 19, still what Benny's tools read.
function toItem(todo) {
  return {
    id: todo.id,
    text: todo.title,
    checked: todo.done,
    checked_at: todo.done_at,
    source: todo.source,
    created_by: todo.created_by,
    created_at: todo.created_at,
  };
}

// GET /api/lists/:slug/items — open items first (the order they were
// added), then finished ones (most recent first).
todosRouter.get('/lists/:slug/items', async (req, res) => {
  try {
    const list = await findList(req.params.slug);
    if (!list) return fail(res, 404, 'No list by that name.');
    const { data, error } = await supabaseAdmin
      .from('todos')
      .select(TODO_COLUMNS)
      .eq('list_id', list.id)
      .order('done', { ascending: true })
      .order('done_at', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ list: { slug: list.slug, name: list.name }, items: data.map(toItem) });
  } catch (err) {
    console.error('[todos] failed to load items:', err.message);
    fail(res, 500, 'Could not load that list.');
  }
});

// POST /api/lists/:slug/items — body: { items: ["oat milk", "eggs"] }.
// An array rather than one string, so the agent can add "milk, eggs and
// bread" as three items without the server guessing where to split.
// Anything already open on the list (ignoring case) is skipped rather
// than doubled up — both of us adding "milk" should leave one milk.
todosRouter.post('/lists/:slug/items', async (req, res) => {
  const raw = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!raw || raw.length === 0) return fail(res, 400, 'Send { "items": ["..."] } with at least one item.');
  if (raw.length > MAX_ITEMS_PER_REQUEST) return fail(res, 400, `At most ${MAX_ITEMS_PER_REQUEST} items at a time.`);

  const texts = raw.map(cleanTitle).filter(Boolean);
  if (texts.length === 0) return fail(res, 400, 'Those items were all empty.');

  try {
    const list = await findList(req.params.slug);
    if (!list) return fail(res, 404, 'No list by that name.');

    const { data: open, error: openError } = await supabaseAdmin
      .from('todos')
      .select('title')
      .eq('list_id', list.id)
      .eq('done', false);
    if (openError) throw openError;

    const seen = new Set(open.map((t) => t.title.toLowerCase()));
    const toAdd = [];
    const skipped = [];
    for (const text of texts) {
      if (seen.has(text.toLowerCase())) {
        skipped.push(text);
      } else {
        seen.add(text.toLowerCase());
        toAdd.push(text);
      }
    }

    let added = [];
    if (toAdd.length) {
      const { data, error } = await supabaseAdmin
        .from('todos')
        .insert(toAdd.map((title) => ({ list_id: list.id, title, ...who(req) })))
        .select(TODO_COLUMNS);
      if (error) throw error;
      added = data.map(toTodo);
    }

    // `added` keeps the Stage 19 item shape for Benny; the page reads `todos`.
    res.status(201).json({ added: added.map(toItem), skipped, todos: added });
  } catch (err) {
    console.error('[todos] failed to add items:', err.message);
    fail(res, 500, 'Could not add those items.');
  }
});

// DELETE /api/lists/:slug/items/checked — "Clear completed": removes
// everything finished on the list. App-only, since it can't be undone.
todosRouter.delete('/lists/:slug/items/checked', async (req, res) => {
  try {
    const list = await findList(req.params.slug);
    if (!list) return fail(res, 404, 'No list by that name.');
    const { data, error } = await supabaseAdmin.from('todos').delete().eq('list_id', list.id).eq('done', true).select('id');
    if (error) throw error;
    res.json({ removed: data.length });
  } catch (err) {
    console.error('[todos] failed to clear finished items:', err.message);
    fail(res, 500, 'Could not clear finished items.');
  }
});

// --- Old routes, for the Hermes plugin until it's reinstalled ---------------
// Same paths and shapes as Stage 3's chores.js and Stage 19's lists.js,
// answered from todos. Remove with the old tables in the cleanup.

function toChore(todo) {
  return {
    id: todo.id,
    title: todo.title,
    assignee: todo.assignee,
    due_date: todo.due_date,
    completed: todo.done,
    raw_input: todo.raw_input,
    source: todo.source,
    created_by: todo.created_by,
    created_at: todo.created_at,
  };
}

async function setDone(id, done) {
  const todo = await findTodo(id);
  if (!todo) return null;
  const { update } = buildTodoUpdate(todo, { done }, householdToday());
  const { data, error } = await supabaseAdmin.from('todos').update(update).eq('id', id).select(TODO_COLUMNS).single();
  if (error) throw error;
  return data;
}

todosRouter.get('/chores', async (req, res) => {
  try {
    const list = await findList(DEFAULT_LIST);
    const { data, error } = await supabaseAdmin
      .from('todos')
      .select(TODO_COLUMNS)
      .eq('list_id', list.id)
      .order('done', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ chores: data.map(toChore) });
  } catch (err) {
    console.error('[todos] failed to list chores:', err.message);
    fail(res, 500, 'Could not load chores.');
  }
});

todosRouter.post('/chores', async (req, res) => {
  const { text } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) return fail(res, 400, 'Missing "text" in request body.');
  try {
    const list = await findList(DEFAULT_LIST);
    const parsed = await parseTodoText(text.trim());
    const { data, error } = await supabaseAdmin
      .from('todos')
      .insert({
        list_id: list.id,
        title: cleanTitle(parsed.title) || cleanTitle(text),
        assignee: parsed.assignee,
        due_date: parsed.due_date,
        raw_input: text.trim(),
        ...who(req),
      })
      .select(TODO_COLUMNS)
      .single();
    if (error) throw error;
    res.status(201).json({ chore: toChore(data) });
  } catch (err) {
    console.error('[todos] failed to add a chore:', err.message);
    fail(res, 500, 'Could not understand or save that chore.');
  }
});

todosRouter.patch('/chores/:id', async (req, res) => {
  const { completed } = req.body ?? {};
  if (typeof completed !== 'boolean') return fail(res, 400, '"completed" must be true or false.');
  try {
    const todo = await setDone(req.params.id, completed);
    if (!todo) return fail(res, 404, 'No chore with that id.');
    res.json({ chore: toChore(todo) });
  } catch (err) {
    console.error('[todos] failed to update a chore:', err.message);
    fail(res, 500, 'Could not update that chore.');
  }
});

todosRouter.patch('/list-items/:id', async (req, res) => {
  const { checked } = req.body ?? {};
  if (typeof checked !== 'boolean') return fail(res, 400, '"checked" must be true or false.');
  try {
    const todo = await setDone(req.params.id, checked);
    if (!todo) return fail(res, 404, 'No item with that id.');
    res.json({ item: toItem(todo) });
  } catch (err) {
    console.error('[todos] failed to update an item:', err.message);
    fail(res, 500, 'Could not update that item.');
  }
});

// Open to-dos (any list) due on or before `day`: what the digest, the
// morning brief and the Timeline show. Undated ones never count as due.
export async function fetchDueTodos(day) {
  const { data, error } = await supabaseAdmin
    .from('todos')
    .select('id, title, assignee, due_date, list:lists!inner(slug, name)')
    .eq('done', false)
    .lte('due_date', day)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return data.map(({ list, ...todo }) => ({ ...todo, list: list.slug, list_name: list.name }));
}
