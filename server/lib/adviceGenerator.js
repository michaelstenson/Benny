// Benny's "magic eight ball" — turns a question into two things: genuine,
// take-it-or-leave-it guidance for thinking the question through, plus ONE
// playful aside (a fortune-cookie verdict, a themed haiku, or a nonsensical
// Great British Bake Off-style "everything gets better with an egg wash"
// line) — chosen at random per question, not all three at once. Uses the
// same tool-use pattern as choreParser.js/billParser.js so the frontend
// gets clean fields to style, instead of one blob of text to parse.

import { anthropic, FAST_EXTRACTION_MODEL } from './anthropicClient.js';

// Which playful format gets used is decided here, in code, by chance —
// NOT left up to the model to pick. That's what actually guarantees only
// one shows up per answer; leaving it to the model's judgment would be a
// suggestion, not a rule.
const PLAYFUL_FORMATS = {
  fortune_cookie: {
    label: 'fortune-cookie verdict',
    fieldDescription:
      'A short (under 12 words), confident-sounding, magic-eight-ball-style predictive verdict — ' +
      "e.g. 'Without a doubt' or 'The signs point to yes, eventually.' Playful and noncommittal, " +
      'never a real prediction.',
  },
  haiku: {
    label: 'haiku',
    fieldDescription:
      'A 3-line haiku (5-7-5 syllables), loosely themed on the question, separated by newline ' +
      'characters. Can be silly, wistful, or dramatic — whatever fits the question.',
  },
  egg_wash: {
    label: 'egg-wash aside',
    fieldDescription:
      'One sentence of absurd Great British Bake Off-style advice that everything gets better ' +
      "with an egg wash — total non sequitur, doesn't need to logically follow from the question " +
      'at all.',
  },
};

function pickPlayfulFormat() {
  const keys = Object.keys(PLAYFUL_FORMATS);
  return keys[Math.floor(Math.random() * keys.length)];
}

export async function generateAdvice(question) {
  const format = pickPlayfulFormat();
  const spec = PLAYFUL_FORMATS[format];

  const tool = {
    name: 'generate_advice',
    description:
      'Give genuine guidance for a household question, plus one playful aside in a specific format.',
    input_schema: {
      type: 'object',
      properties: {
        guidance: {
          type: 'string',
          description:
            '2-4 sentences of genuine, thoughtful guidance for how to think through this specific ' +
            'question — NOT a direct answer or solution, and not real medical/legal/financial/safety ' +
            'advice. More like a good friend helping you reason it out: a useful reframe, a question ' +
            "worth asking yourself, or a consideration that's easy to overlook. Specific to what was " +
            'actually asked, not generic filler that could apply to any question.',
        },
        playful_reply: {
          type: 'string',
          description:
            `${spec.fieldDescription} This is the ONLY playful format to produce this time — a ` +
            `${spec.label}, not either of the other two styles.`,
        },
      },
      required: ['guidance', 'playful_reply'],
    },
  };

  const response = await anthropic.messages.create({
    model: FAST_EXTRACTION_MODEL,
    max_tokens: 400,
    temperature: 1,
    system:
      "You are Benny, a household assistant with two modes at once: a genuinely thoughtful " +
      'advisor, and a playful side with exactly one silly party trick per answer (this time: a ' +
      `${spec.label}). Someone is asking a real household question. First give them real, useful ` +
      `guidance for thinking it through — then, separately, indulge the silly side with a ` +
      `${spec.label} and nothing else playful. Keep the two clearly distinct; don't let the ` +
      'playful part undercut or contradict the genuine one.',
    tools: [tool],
    tool_choice: { type: 'tool', name: 'generate_advice' },
    messages: [{ role: 'user', content: question }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Benny could not come up with an answer — try asking again.');
  }

  return {
    format,
    guidance: toolUse.input.guidance,
    reply: toolUse.input.playful_reply,
  };
}
