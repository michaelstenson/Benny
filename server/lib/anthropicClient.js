// One shared Claude client, same pattern as server/lib/supabaseClient.js.

import Anthropic from '@anthropic-ai/sdk';

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[anthropic] ANTHROPIC_API_KEY is missing from .env — ' +
      'natural-language features (like adding chores or bills) will not work until it is set.'
  );
}

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Haiku is Claude's fastest, cheapest model — plenty for narrow,
// well-defined extraction tasks like "pull a title/assignee/date (or a
// category/amount/month) out of a sentence." No need to pay for a bigger
// model for jobs this constrained. Used by both choreParser.js and
// billParser.js.
export const FAST_EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';
