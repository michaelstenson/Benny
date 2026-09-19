import { Router } from 'express';
import { generateAdvice } from '../lib/adviceGenerator.js';

export const adviceRouter = Router();

// POST /api/advice — the only route this feature needs. Stateless: nothing
// is persisted to Supabase, this is a fun one-shot, not a record to keep.
// Body: { question }.
adviceRouter.post('/advice', async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Missing "question" in request body.' });
  }

  try {
    const advice = await generateAdvice(question.trim());
    res.json({ advice });
  } catch (err) {
    console.error('[advice] failed to generate advice:', err.message);
    res.status(500).json({ error: 'Benny is fresh out of wisdom right now — try again.' });
  }
});
