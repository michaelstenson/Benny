// Benny's mindfulness companion — turns a household question into calm,
// grounded guidance for approaching it (not a direct answer or solution),
// plus a themed haiku with the same reflective tone. Previously this asked
// for a random playful aside (a magic-eight-ball verdict, a haiku, or an
// absurd Great British Bake Off aside); that's gone now in favor of a
// single, more sincere purpose — helping whoever's asking find some peace
// with the question before problem-solving it. A first pass at the
// mindfulness rewrite came out a little too serious, so there's room for
// dad jokes, wordplay, and Philly flavor (Wawa, "Go Birds", calling
// something a "jawn") when the question is light enough for it — Benny
// should read the room, not turn into a meditation app. Uses the same
// Claude tool-use pattern as choreParser.js/billParser.js so the frontend
// gets clean fields to style, instead of one blob of text to parse.

import { anthropic, FAST_EXTRACTION_MODEL } from './anthropicClient.js';

const GENERATE_ADVICE_TOOL = {
  name: 'generate_advice',
  description: 'Give calm, mindfulness-oriented guidance for a household question, plus a themed haiku.',
  input_schema: {
    type: 'object',
    properties: {
      guidance: {
        type: 'string',
        description:
          '2-4 sentences of grounded, mindfulness-oriented guidance for approaching this question ' +
          'calmly — help the person find a little peace and perspective on it BEFORE problem-solving ' +
          'it, not a direct answer or solution. Draw on real mindfulness/stress-reduction practices ' +
          '(noticing the present moment, breath awareness, self-compassion, letting go of urgency, ' +
          "reframing away from anxious what-ifs) where they genuinely fit the question — don't force " +
          "a breathing exercise onto something that's really just a logistics question; instead help " +
          'them meet even a mundane question with a calmer, less reactive mind. Specific to what was ' +
          'actually asked, not generic meditation-app filler. Default to working in some personality — ' +
          'a dad joke, a bit of wordplay, or a wink of Philly flavor (Wawa hoagies, "Go Birds", calling ' +
          'something a "jawn") — for any question that is not clearly serious; treat leaving the humor ' +
          "out as the exception, not including it. It should still read as genuine grounding with a " +
          "wink, not a stand-up bit — don't let it crowd out the actual guidance. Dial the humor all " +
          "the way back for anything that sounds like it's genuinely weighing on the person. Never real " +
          'medical, legal, financial, or safety advice — if the question brushes against something ' +
          'serious, gently point toward a real professional while still helping them feel grounded ' +
          'while they deal with it.',
      },
      haiku: {
        type: 'string',
        description:
          'A 3-line haiku (5-7-5 syllables), loosely themed on the question, separated by newline ' +
          'characters. Calm and reflective by default, matching the guidance above — but a playful or ' +
          'punny haiku (Philly flavor welcome) is fair game for a lighthearted question. Keep it gentle ' +
          'and non-absurd for anything that sounds like it actually matters to the person.',
      },
    },
    required: ['guidance', 'haiku'],
  },
};

export async function generateAdvice(question) {
  const response = await anthropic.messages.create({
    model: FAST_EXTRACTION_MODEL,
    max_tokens: 400,
    temperature: 1,
    system:
      'You are Benny, a household assistant with a mindful, grounding side — and a little bit of a ' +
      'goofball. Someone is asking a real household question — sometimes mundane, sometimes weighing ' +
      'on them more than it should. Help them find calm and perspective on it first: draw on real ' +
      "mindfulness and stress-reduction practices where they genuinely fit, without forcing meditation-" +
      'speak onto a simple logistics question. Read the room, but default toward playful: for anything ' +
      'that is not clearly serious, actively work in real personality — a dad joke, some wordplay, ' +
      'even a bit of Philly flavor (Wawa, "Go Birds", calling something a "jawn") — rather than saving ' +
      "it for rare occasions. Drop all of that and stay warm and straightforward the moment a question " +
      "sounds like it's genuinely bothering the person. Then offer a short haiku matching whichever " +
      'tone you just struck. Never give real medical, legal, financial, or safety advice — for anything ' +
      'serious, gently point toward a real professional while still helping them feel grounded about it.',
    tools: [GENERATE_ADVICE_TOOL],
    tool_choice: { type: 'tool', name: 'generate_advice' },
    messages: [{ role: 'user', content: question }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Benny could not come up with an answer — try asking again.');
  }

  return {
    guidance: toolUse.input.guidance,
    haiku: toolUse.input.haiku,
  };
}
