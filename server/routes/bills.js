import { Router } from 'express';
import { supabase } from '../lib/supabaseClient.js';
import { parseBillText } from '../lib/billParser.js';

export const billsRouter = Router();

// Groups a flat list of bills into a per-category summary: the latest
// entry for each category, plus how it compares to the entry before it
// (if there is one). This is the "analyzer" part — a bit more than just
// storing rows.
function summarizeByCategory(bills) {
  const byCategory = new Map();
  for (const bill of bills) {
    if (!byCategory.has(bill.category)) byCategory.set(bill.category, []);
    byCategory.get(bill.category).push(bill);
  }

  const summary = [];
  for (const [category, entries] of byCategory) {
    // entries come in already sorted newest-first (see the query below)
    const [latest, previous] = entries;
    let percentChange = null;
    if (previous) {
      percentChange = ((latest.amount - previous.amount) / previous.amount) * 100;
    }
    summary.push({ category, latest, previous: previous || null, percentChange });
  }

  // Alphabetical is simplest and most predictable for a short list like this.
  summary.sort((a, b) => a.category.localeCompare(b.category));
  return summary;
}

// GET /api/bills — full history (newest first) plus the per-category summary.
billsRouter.get('/bills', async (req, res) => {
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .order('billing_month', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[bills] failed to list bills:', error.message);
    return res.status(500).json({ error: 'Could not load bills.' });
  }

  res.json({ bills: data, summary: summarizeByCategory(data) });
});

// POST /api/bills — the natural-language entry point. Body: { text }.
billsRouter.post('/bills', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing "text" in request body.' });
  }

  try {
    const parsed = await parseBillText(text.trim());

    const { data, error } = await supabase
      .from('bills')
      .insert({
        category: parsed.category,
        amount: parsed.amount,
        billing_month: parsed.billing_month,
        raw_input: text.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ bill: data });
  } catch (err) {
    console.error('[bills] failed to add bill:', err.message);
    res.status(500).json({ error: 'Could not understand or save that bill.' });
  }
});
