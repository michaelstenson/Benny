// Shared lists (Stage 19) — groceries first, but any number of lists fit
// the same two tables. Deliberately no Claude parsing here, unlike
// chores/bills: "oat milk" is already exactly what goes on the list, so
// items are stored as typed. Either of us can add from the app, and
// Benny the agent can add from Discord ("Benny, add oat milk").

import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';

export const listsRouter = Router();

const MAX_ITEMS_PER_REQUEST = 50;
const MAX_ITEM_LENGTH = 200;

async function findList(slug) {
  const { data, error } = await supabaseAdmin
    .from('lists')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// GET /api/lists — every list, with how many items are still open.
listsRouter.get('/lists', async (req, res) => {
  const [{ data: lists, error: listsError }, { data: openItems, error: itemsError }] =
    await Promise.all([
      supabaseAdmin.from('lists').select('id, slug, name').order('created_at'),
      supabaseAdmin.from('list_items').select('list_id').eq('checked', false),
    ]);

  if (listsError || itemsError) {
    console.error('[lists] failed to load lists:', (listsError || itemsError).message);
    return res.status(500).json({ error: 'Could not load lists.' });
  }

  const openCounts = {};
  for (const item of openItems) openCounts[item.list_id] = (openCounts[item.list_id] || 0) + 1;

  res.json({
    lists: lists.map(({ id, slug, name }) => ({ slug, name, open_count: openCounts[id] || 0 })),
  });
});

// GET /api/lists/:slug/items — open items first (oldest first, the order
// they were added), then checked ones (most recently checked first).
listsRouter.get('/lists/:slug/items', async (req, res) => {
  try {
    const list = await findList(req.params.slug);
    if (!list) return res.status(404).json({ error: 'No list by that name.' });

    const { data, error } = await supabaseAdmin
      .from('list_items')
      .select('id, text, checked, checked_at, source, created_by, created_at')
      .eq('list_id', list.id)
      .order('checked', { ascending: true })
      .order('checked_at', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    res.json({ list: { slug: list.slug, name: list.name }, items: data });
  } catch (err) {
    console.error('[lists] failed to load items:', err.message);
    res.status(500).json({ error: 'Could not load that list.' });
  }
});

// POST /api/lists/:slug/items — body: { items: ["oat milk", "eggs"] }.
// An array rather than one string, so the agent can add "milk, eggs and
// bread" as three items without the server guessing where to split.
// Anything already open on the list (ignoring case) is skipped rather
// than doubled up — both of us adding "milk" should leave one milk.
listsRouter.post('/lists/:slug/items', async (req, res) => {
  const raw = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!raw || raw.length === 0) {
    return res.status(400).json({ error: 'Send { "items": ["..."] } with at least one item.' });
  }
  if (raw.length > MAX_ITEMS_PER_REQUEST) {
    return res.status(400).json({ error: `At most ${MAX_ITEMS_PER_REQUEST} items at a time.` });
  }

  const texts = raw
    .filter((t) => typeof t === 'string')
    .map((t) => t.trim().replace(/\s+/g, ' ').slice(0, MAX_ITEM_LENGTH))
    .filter(Boolean);
  if (texts.length === 0) return res.status(400).json({ error: 'Those items were all empty.' });

  try {
    const list = await findList(req.params.slug);
    if (!list) return res.status(404).json({ error: 'No list by that name.' });

    const { data: open, error: openError } = await supabaseAdmin
      .from('list_items')
      .select('text')
      .eq('list_id', list.id)
      .eq('checked', false);
    if (openError) throw openError;

    const seen = new Set(open.map((i) => i.text.toLowerCase()));
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
        .from('list_items')
        .insert(
          toAdd.map((text) => ({
            list_id: list.id,
            text,
            source: req.user.agent ? 'agent' : 'app',
            created_by: req.user.agent ? 'agent' : req.user.email,
          }))
        )
        .select('id, text, checked, checked_at, source, created_by, created_at');
      if (error) throw error;
      added = data;
    }

    res.status(201).json({ added, skipped });
  } catch (err) {
    console.error('[lists] failed to add items:', err.message);
    res.status(500).json({ error: 'Could not add those items.' });
  }
});

// PATCH /api/list-items/:id — body: { checked: true|false }.
listsRouter.patch('/list-items/:id', async (req, res) => {
  const { checked } = req.body ?? {};
  if (typeof checked !== 'boolean') {
    return res.status(400).json({ error: '"checked" must be true or false.' });
  }

  const { data, error } = await supabaseAdmin
    .from('list_items')
    .update({ checked, checked_at: checked ? new Date().toISOString() : null })
    .eq('id', req.params.id)
    .select('id, text, checked, checked_at, source, created_by, created_at')
    .maybeSingle();

  if (error) {
    console.error('[lists] failed to update item:', error.message);
    return res.status(500).json({ error: 'Could not update that item.' });
  }
  if (!data) return res.status(404).json({ error: 'No item with that id.' });

  res.json({ item: data });
});

// DELETE /api/lists/:slug/items/checked — clears everything already
// checked off ("we bought it, get it off the list"). App-only: it's not
// on the agent's allowlist, since it's the one irreversible action here.
listsRouter.delete('/lists/:slug/items/checked', async (req, res) => {
  try {
    const list = await findList(req.params.slug);
    if (!list) return res.status(404).json({ error: 'No list by that name.' });

    const { data, error } = await supabaseAdmin
      .from('list_items')
      .delete()
      .eq('list_id', list.id)
      .eq('checked', true)
      .select('id');
    if (error) throw error;

    res.json({ removed: data.length });
  } catch (err) {
    console.error('[lists] failed to clear checked items:', err.message);
    res.status(500).json({ error: 'Could not clear checked items.' });
  }
});
