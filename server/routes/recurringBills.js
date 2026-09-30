// Recurring bills (Stage 20) — the "what's due and when" side of bills.
// Different from /api/bills (Stage 4), which logs what each month's bill
// actually *was* for the analyzer: this is the standing list of what
// comes due every month ("mortgage, $2,100, the 1st, autopay"), so the
// digest and the morning brief can warn a few days ahead.
//
// App-only on purpose — not on the agent's allowlist. The agent sees
// what's due through GET /api/digest, but money stays out of its hands
// until the proposals inbox (Stage 21).

import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { householdToday, withNextDue } from '../lib/recurringBills.js';

export const recurringBillsRouter = Router();

const COLUMNS = 'id, name, amount, due_day, autopay, active, created_at';

// Checks/cleans the editable fields. `partial` allows PATCH to send only
// some of them. Returns { fields } or { error }.
function cleanFields(body, { partial = false } = {}) {
  const fields = {};

  if (!partial || 'name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) return { error: 'Give the bill a name (up to 100 characters).' };
    fields.name = name;
  }
  if (!partial || 'amount' in body) {
    // Blank/null amount is allowed — for bills that vary month to month.
    if (body.amount === null || body.amount === undefined || body.amount === '') {
      fields.amount = null;
    } else {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) return { error: 'Amount must be a positive number, or blank.' };
      fields.amount = Math.round(amount * 100) / 100;
    }
  }
  if (!partial || 'due_day' in body) {
    const dueDay = Number(body.due_day);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      return { error: 'Due day must be a day of the month, 1–31.' };
    }
    fields.due_day = dueDay;
  }
  for (const flag of ['autopay', 'active']) {
    if (flag in body) {
      if (typeof body[flag] !== 'boolean') return { error: `"${flag}" must be true or false.` };
      fields[flag] = body[flag];
    }
  }
  return { fields };
}

// GET /api/recurring-bills — active bills first, soonest due first.
recurringBillsRouter.get('/recurring-bills', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('recurring_bills').select(COLUMNS);
  if (error) {
    console.error('[recurring-bills] failed to list:', error.message);
    return res.status(500).json({ error: 'Could not load recurring bills.' });
  }

  const today = householdToday();
  const bills = data
    .map((bill) => withNextDue(bill, today))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.days_until - b.days_until);

  res.json({ bills });
});

// POST /api/recurring-bills — body: { name, amount?, due_day, autopay? }
recurringBillsRouter.post('/recurring-bills', async (req, res) => {
  const { fields, error: invalid } = cleanFields(req.body ?? {});
  if (invalid) return res.status(400).json({ error: invalid });

  const { data, error } = await supabaseAdmin
    .from('recurring_bills')
    .insert(fields)
    .select(COLUMNS)
    .single();
  if (error) {
    console.error('[recurring-bills] failed to add:', error.message);
    return res.status(500).json({ error: 'Could not save that bill.' });
  }

  res.status(201).json({ bill: withNextDue(data, householdToday()) });
});

// PATCH /api/recurring-bills/:id — any of name, amount, due_day, autopay, active.
recurringBillsRouter.patch('/recurring-bills/:id', async (req, res) => {
  const { fields, error: invalid } = cleanFields(req.body ?? {}, { partial: true });
  if (invalid) return res.status(400).json({ error: invalid });
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'Nothing to change.' });

  const { data, error } = await supabaseAdmin
    .from('recurring_bills')
    .update(fields)
    .eq('id', req.params.id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    console.error('[recurring-bills] failed to update:', error.message);
    return res.status(500).json({ error: 'Could not update that bill.' });
  }
  if (!data) return res.status(404).json({ error: 'No bill with that id.' });

  res.json({ bill: withNextDue(data, householdToday()) });
});

// DELETE /api/recurring-bills/:id
recurringBillsRouter.delete('/recurring-bills/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('recurring_bills')
    .delete()
    .eq('id', req.params.id)
    .select('id');
  if (error) {
    console.error('[recurring-bills] failed to delete:', error.message);
    return res.status(500).json({ error: 'Could not delete that bill.' });
  }
  if (data.length === 0) return res.status(404).json({ error: 'No bill with that id.' });

  res.json({ deleted: true });
});
