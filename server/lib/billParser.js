// Same pattern as choreParser.js: hand Claude a strict tool schema instead
// of asking it to write JSON in prose, so what comes back is guaranteed
// to have the shape our database expects.

import { anthropic, FAST_EXTRACTION_MODEL } from './anthropicClient.js';

const EXTRACT_BILL_TOOL = {
  name: 'extract_bill',
  description: 'Extract a structured household bill from a natural-language sentence.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description:
          'A short, lowercase, normalized label for the bill type — e.g. "electric", "gas", ' +
          '"water", "internet", "trash". Map synonyms to a consistent label (e.g. "power" or ' +
          '"ComEd" -> "electric"; "wifi", "Xfinity", or "Comcast" -> "internet"), so the same ' +
          'kind of bill always gets the same category over time.',
      },
      amount: {
        type: 'number',
        description: 'The dollar amount of the bill as a plain number, e.g. 142.5 (no "$").',
      },
      billing_month: {
        type: 'string',
        description:
          'The month this bill is FOR (not necessarily today), as an ISO date representing ' +
          'the 1st of that month, e.g. "2026-08-01". If no month is mentioned, use the current ' +
          'month given in the system prompt.',
      },
    },
    required: ['category', 'amount', 'billing_month'],
  },
};

export async function parseBillText(text) {
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const currentMonth = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const response = await anthropic.messages.create({
    model: FAST_EXTRACTION_MODEL, // same small/fast model as chores — this extraction is just as narrow
    max_tokens: 300,
    system:
      `Today is ${isoToday} (${currentMonth}). Use this to resolve which month a bill is for ` +
      'when the sentence only names a month ("for August") or names none at all (assume the ' +
      'current month).',
    tools: [EXTRACT_BILL_TOOL],
    tool_choice: { type: 'tool', name: 'extract_bill' },
    messages: [{ role: 'user', content: text }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return a structured bill — try rephrasing.');
  }

  return {
    category: String(toolUse.input.category).toLowerCase().trim(),
    amount: toolUse.input.amount,
    billing_month: toolUse.input.billing_month,
  };
}
