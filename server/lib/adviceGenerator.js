// Benny's "magic eight ball" — turns a yes/no-ish question into a playful,
// deliberately non-authoritative verdict, plus a themed haiku and a
// nonsensical Great British Bake Off-style "everything gets better with an
// egg wash" aside. Uses the same tool-use pattern as choreParser.js/
// billParser.js so the frontend gets three clean fields to style separately,
// instead of one blob of text to parse.

import { anthropic, FAST_EXTRACTION_MODEL } from './anthropicClient.js';

const GENERATE_ADVICE_TOOL = {
  name: 'generate_advice',
  description:
    'Generate a playful magic-eight-ball-style verdict for a household question, plus a themed ' +
    'haiku and an absurd baking-show aside.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        description:
          'A short (under 12 words), confident-sounding, magic-eight-ball-style predictive answer ' +
          "to the question — e.g. 'Without a doubt' or 'The signs point to yes, eventually.' Never " +
          'real medical, legal, financial, or safety advice — keep it playful and noncommittal if ' +
          'the question touches something serious.',
      },
      haiku: {
        type: 'string',
        description:
          'A 3-line haiku (5-7-5 syllables), loosely themed on the question, separated by newline ' +
          'characters. Can be silly, wistful, or dramatic — whatever fits the question.',
      },
      egg_wash_advice: {
        type: 'string',
        description:
          'One sentence of absurd Great British Bake Off-style advice that everything gets better ' +
          "with an egg wash — total non sequitur, doesn't need to logically follow from the " +
          'question or the verdict at all.',
      },
    },
    required: ['verdict', 'haiku', 'egg_wash_advice'],
  },
};

export async function generateAdvice(question) {
  const response = await anthropic.messages.create({
    model: FAST_EXTRACTION_MODEL,
    max_tokens: 400,
    temperature: 1,
    system:
      "You are Benny, a household assistant's silly side — a magic eight ball with a baking-show " +
      'habit. Someone is asking a predictive or yes/no-ish question for fun, not for real guidance. ' +
      'Answer in character every time, no matter how mundane or how big the question is.',
    tools: [GENERATE_ADVICE_TOOL],
    tool_choice: { type: 'tool', name: 'generate_advice' },
    messages: [{ role: 'user', content: question }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Benny could not come up with an answer — try asking again.');
  }

  return {
    verdict: toolUse.input.verdict,
    haiku: toolUse.input.haiku,
    egg_wash_advice: toolUse.input.egg_wash_advice,
  };
}
