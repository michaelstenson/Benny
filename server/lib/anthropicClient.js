// One shared Claude client, same pattern as server/lib/supabaseClient.js.

import Anthropic from '@anthropic-ai/sdk';

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[anthropic] ANTHROPIC_API_KEY is missing from .env — ' +
      'natural-language features (like adding chores) will not work until it is set.'
  );
}

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Haiku is Claude's fastest, cheapest model — plenty for a narrow,
// well-defined extraction task like "pull a title/assignee/date out of a
// sentence." No need to pay for a bigger model here.
export const CHORE_PARSING_MODEL = 'claude-haiku-4-5-20251001';
