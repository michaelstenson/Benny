// Turns a sentence like "remind Mer to water the plants Thursday" into a
// structured { title, assignee, due_date } object, using Claude's "tool
// use" feature (also called function calling): instead of asking Claude
// to write JSON in a text reply and hoping it's well-formed, we give it a
// strict schema and it fills in the fields, guaranteed to match.

import { anthropic, CHORE_PARSING_MODEL } from './anthropicClient.js';

// This is the schema Claude has to fill in. Giving it exactly two allowed
// assignee values (rather than accepting free text) is what makes this
// reliable enough to store directly in the database.
const EXTRACT_CHORE_TOOL = {
  name: 'extract_chore',
  description: 'Extract a structured household chore/task from a natural-language sentence.',
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
          "Who the task is for. If the sentence doesn't name a person, assume 'michael' " +
          '(the person typing it in).',
      },
      due_date: {
        type: 'string',
        description:
          'The due date as an ISO date (YYYY-MM-DD), resolved from words like "Thursday" or ' +
          '"tomorrow" using the current date given in the system prompt. Omit this field ' +
          'entirely if no date or day is mentioned.',
      },
    },
    required: ['title', 'assignee'],
  },
};

export async function parseChoreText(text) {
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const weekday = today.toLocaleDateString('en-US', { weekday: 'long' });

  const response = await anthropic.messages.create({
    model: CHORE_PARSING_MODEL,
    max_tokens: 300,
    system:
      `Today is ${weekday}, ${isoToday}. Use this to resolve relative dates ` +
      '("Thursday", "tomorrow", "next week") into real ISO dates. The only two ' +
      'people in this household are "michael" and "mer" — map any name, nickname, ' +
      'or pronoun to one of those two.',
    tools: [EXTRACT_CHORE_TOOL],
    tool_choice: { type: 'tool', name: 'extract_chore' }, // forces Claude to use the tool, not reply in plain text
    messages: [{ role: 'user', content: text }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return a structured chore — try rephrasing.');
  }

  return {
    title: toolUse.input.title,
    assignee: toolUse.input.assignee,
    due_date: toolUse.input.due_date ?? null,
  };
}
