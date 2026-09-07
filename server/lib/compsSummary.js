// Turns a value estimate + comps list into a short, casual paragraph —
// the "glance at it with your coffee" layer on top of the raw table.
//
// This is a different Claude pattern than choreParser.js/billParser.js:
// those force a strict schema with tool use, because we needed reliable
// structured fields out of messy human sentences. Here it's the opposite —
// we already have clean structured data (the estimate + comps from
// RentCast), and we want Claude to do what it's naturally good at: turning
// numbers into plain, readable prose. So there's no tool_choice here, just
// a normal prompt.

import { anthropic, FAST_EXTRACTION_MODEL } from './anthropicClient.js';

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function generateCompsSummary({ estimate, comps, previousEstimate }) {
  const pricePerSqftValues = comps
    .map((c) => c.price_per_sqft)
    .filter((v) => typeof v === 'number' && !Number.isNaN(v));
  const medianPricePerSqft = median(pricePerSqftValues);

  const daysOnMarketValues = comps
    .map((c) => c.days_on_market)
    .filter((v) => typeof v === 'number' && !Number.isNaN(v));
  const medianDaysOnMarket = median(daysOnMarketValues);

  const activeCount = comps.filter((c) => (c.status || '').toLowerCase() === 'active').length;

  const facts = {
    estimatedValue: estimate.estimated_price,
    valueRange: [estimate.price_range_low, estimate.price_range_high],
    previousEstimatedValue: previousEstimate?.estimated_price ?? null,
    compCount: comps.length,
    activeListingCount: activeCount,
    medianPricePerSqft,
    medianDaysOnMarket,
  };

  const message = await anthropic.messages.create({
    model: FAST_EXTRACTION_MODEL,
    max_tokens: 300,
    system:
      "You write a short, casual weekly update for a couple tracking their Chicago condo's value " +
      "ahead of a future home sale. Two to three sentences, plain English, no real-estate jargon " +
      "dump. Mention the estimated value, how it's changed since last time (if there's a previous " +
      "value to compare), and one useful observation about the comps (e.g. price per square foot, " +
      "how many are currently active, typical days on market). Warm but brief — this is meant to be " +
      'read in ten seconds, not studied.',
    messages: [
      {
        role: 'user',
        content: `Here is this week's data:\n${JSON.stringify(facts, null, 2)}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text.trim() : '';
}
