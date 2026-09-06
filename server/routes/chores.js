import { Router } from 'express';
import { supabase } from '../lib/supabaseClient.js';
import { parseChoreText } from '../lib/choreParser.js';

export const choresRouter = Router();

// GET /api/chores — everything, incomplete chores first (soonest due
// date first within that), completed ones last.
choresRouter.get('/chores', async (req, res) => {
  const { data, error } = await supabase
    .from('chores')
    .select('*')
    .order('completed', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[chores] failed to list chores:', error.message);
    return res.status(500).json({ error: 'Could not load chores.' });
  }

  res.json({ chores: data });
});

// POST /api/chores — the natural-language entry point. Body: { text }.
choresRouter.post('/chores', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing "text" in request body.' });
  }

  try {
    const parsed = await parseChoreText(text.trim());

    const { data, error } = await supabase
      .from('chores')
      .insert({
        title: parsed.title,
        assignee: parsed.assignee,
        due_date: parsed.due_date,
        raw_input: text.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ chore: data });
  } catch (err) {
    console.error('[chores] failed to add chore:', err.message);
    res.status(500).json({ error: 'Could not understand or save that chore.' });
  }
});

// PATCH /api/chores/:id — toggle (or explicitly set) completed.
// Body: { completed: true|false }.
choresRouter.patch('/chores/:id', async (req, res) => {
  const { id } = req.params;
  const { completed } = req.body;

  if (typeof completed !== 'boolean') {
    return res.status(400).json({ error: '"completed" must be true or false.' });
  }

  const { data, error } = await supabase
    .from('chores')
    .update({ completed })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[chores] failed to update chore:', error.message);
    return res.status(500).json({ error: 'Could not update that chore.' });
  }

  res.json({ chore: data });
});
