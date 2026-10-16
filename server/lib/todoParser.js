// Turns a sentence like "remind Mer to water the plants Thursday" into a
// structured { title, assignee, due_date } object, using Claude's "tool
// use" feature (also called function calling): instead of asking Claude
// to write JSON in a text reply and hoping it's well-formed, we give it a
// strict schema and it fills in the fields, guaranteed to match.
//
// Was choreParser.js until To-Do (Oct 2026). A to-do can now belong to
// nobody, so the person is only filled in when the sentence names one;
// otherwise it falls back to whoever is typing, when the page knows.

import { anthropic, FAST_EXTRACTION_MODEL } from './anthropicClient.js';
import { HOUSEHOLD_TIMEZONE, householdToday } from './recurringBills.js';

const NAMES = { michael: 'Michael', mer: 'Mer' };

// This is the schema Claude has to fill in. Giving it exactly two allowed
// assignee values (rather than accepting free text) is what makes this
// reliable enough to store directly in the database.
const EXTRACT_TODO_TOOL = {
  name: 'extract_todo',
  description: 'Extract a structured household to-do from a natural-language sentence.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: "A short imperative description of the task, e.g. 'Water the plants'.",
      },
      assignee: {
        type: 'string',
        enum: ['michael', 'mer'],
        description:
          'Who the task is for, only if the sentence names or clearly points to a person. ' +
          'Omit this field when nobody is mentioned.',
      },
      due_date: {
        type: 'string',
        description:
          'The due date as an ISO date (YYYY-MM-DD), resolved from words like "Thursday" or ' +
          '"tomorrow" using the current date given in the system prompt. Omit this field ' +
          'entirely if no date or day is mentioned.',
      },
    },
    required: ['title'],
  },
};

// assigneeHint: who is typing (or whose view they're adding from), used
// when the sentence doesn't name anyone, and for "me".
export async function parseTodoText(text, { assigneeHint = null } = {}) {
  // Today in Chicago, not on the server's UTC clock: after 7pm Central,
  // UTC is already tomorrow, and "tomorrow" used to land a day late.
  const isoToday = householdToday();
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: HOUSEHOLD_TIMEZONE });
  const typer = NAMES[assigneeHint]
    ? ` The person typing is ${NAMES[assigneeHint]}, so "me" or "I" means "${assigneeHint}".`
    : '';

  const response = await anthropic.messages.create({
    model: FAST_EXTRACTION_MODEL,
    max_tokens: 300,
    system:
      `Today is ${weekday}, ${isoToday}. Use this to resolve relative dates ` +
      '("Thursday", "tomorrow", "next week") into real ISO dates. "Next week" with no ' +
      'day named means 7 days from today. The only two ' +
      'people in this household are "michael" and "mer" — map any name, nickname, ' +
      'or pronoun to one of those two.' + typer,
    tools: [EXTRACT_TODO_TOOL],
    tool_choice: { type: 'tool', name: 'extract_todo' }, // forces Claude to use the tool, not reply in plain text
    messages: [{ role: 'user', content: text }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return a structured to-do — try rephrasing.');
  }

  return {
    title: toolUse.input.title,
    assignee: toolUse.input.assignee ?? (NAMES[assigneeHint] ? assigneeHint : null),
    due_date: toolUse.input.due_date ?? null,
  };
}
