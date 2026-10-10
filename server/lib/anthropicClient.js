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
// model for jobs this constrained. Used by the chore, bill and calendar
// parsers, the advice generator and the comps summary.
//
// Haiku 5.5 since Oct 2026: on the same test sentences it matched Haiku
// 4.5 on every bill and event and all but one chore, at about a tenth of
// the cost. It thinks before answering by default, and that thinking
// counts toward max_tokens, so text-only calls need headroom; it also
// rejects any temperature other than 1. Leave effort at its default:
// "low" dropped a due date in testing.
export const FAST_EXTRACTION_MODEL = 'claude-haiku-5-5';

// Reading a PDF or image attachment (attachmentReader.js) stays on Haiku
// 4.5. On a scanned referral, Haiku 5.5 misread one character of the
// email domain (both times it was tried), and 4.5 got it right. That's
// the field a draft gets sent to, and 4.5 costs well under a cent a page.
export const TRANSCRIPTION_MODEL = 'claude-haiku-4-5-20251001';
