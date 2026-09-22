// Turns a sentence like "put dinner with the Hansens on my calendar Friday
// at 7" into a structured event draft, using the same Claude tool-use
// pattern as choreParser.js. Deliberately returns a DRAFT only — nothing
// here talks to Google. The actual write happens in a separate step (see
// POST /api/calendar/events in calendar.js), only after the person
// reviews this draft and confirms it — adding the wrong thing to a shared
// calendar is a worse mistake than a wrong chore, so this one gets a
// review step chores never needed.

import { anthropic, FAST_EXTRACTION_MODEL } from './anthropicClient.js';

const EXTRACT_EVENT_TOOL = {
  name: 'extract_event',
  description: 'Extract a structured calendar event from a natural-language sentence.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: "A short, clear event title, e.g. 'Dinner with the Hansens'.",
      },
      owner: {
        type: 'string',
        enum: ['michael', 'mer'],
        description:
          "Whose calendar this goes on. If the sentence doesn't name a person, assume 'michael' " +
          '(the person typing it in).',
      },
      date: {
        type: 'string',
        description:
          'The event date as an ISO date (YYYY-MM-DD), resolved from words like "Friday" or "next ' +
          'Tuesday" using the current date given in the system prompt.',
      },
      start_time: {
        type: 'string',
        description:
          'Start time as 24-hour HH:MM (e.g. "19:00" for 7pm). Omit this field entirely for an ' +
          'all-day event with no specific time mentioned.',
      },
      end_time: {
        type: 'string',
        description:
          'End time as 24-hour HH:MM, only if a duration or explicit end time was mentioned (e.g. ' +
          '"7 to 9"). Omit if not specified — a default 1-hour duration is used instead.',
      },
    },
    required: ['title', 'owner', 'date'],
  },
};

export async function parseEventText(text) {
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const weekday = today.toLocaleDateString('en-US', { weekday: 'long' });

  const response = await anthropic.messages.create({
    model: FAST_EXTRACTION_MODEL,
    max_tokens: 300,
    system:
      `Today is ${weekday}, ${isoToday}. Use this to resolve relative dates ` +
      '("Friday", "next Tuesday", "tomorrow") into real ISO dates. The only two ' +
      'people in this household are "michael" and "mer" — map any name, nickname, ' +
      'or pronoun to one of those two.',
    tools: [EXTRACT_EVENT_TOOL],
    tool_choice: { type: 'tool', name: 'extract_event' },
    messages: [{ role: 'user', content: text }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return a structured event — try rephrasing.');
  }

  return {
    title: toolUse.input.title,
    owner: toolUse.input.owner,
    date: toolUse.input.date,
    start_time: toolUse.input.start_time ?? null,
    end_time: toolUse.input.end_time ?? null,
  };
}
