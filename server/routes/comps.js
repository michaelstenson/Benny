import { Router } from 'express';
import { supabase } from '../lib/supabaseClient.js';
import { fetchHomeValueEstimate } from '../lib/rentcastClient.js';
import { generateCompsSummary } from '../lib/compsSummary.js';

export const compsRouter = Router();

// GET /api/comps — read-only. Returns the most recent pull's estimate,
// comps, and summary from our own database. This is what the /comps.html
// page calls; it never talks to RentCast directly (only the weekly refresh
// job does that, to stay well within RentCast's free-tier request limit).
compsRouter.get('/comps', async (req, res) => {
  const { data: estimate, error: estimateError } = await supabase
    .from('home_value_estimates')
    .select('*')
    .order('pulled_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (estimateError) {
    console.error('[comps] failed to load latest estimate:', estimateError.message);
    return res.status(500).json({ error: 'Could not load comps data.' });
  }

  if (!estimate) {
    return res.json({ estimate: null, comps: [], history: [] });
  }

  const { data: comps, error: compsError } = await supabase
    .from('home_comps')
    .select('*')
    .eq('estimate_id', estimate.id)
    .order('correlation', { ascending: false });

  if (compsError) {
    console.error('[comps] failed to load comps:', compsError.message);
    return res.status(500).json({ error: 'Could not load comps data.' });
  }

  // A short history of past estimates, for a simple trend line on the page.
  const { data: history, error: historyError } = await supabase
    .from('home_value_estimates')
    .select('pulled_at, estimated_price, price_range_low, price_range_high')
    .order('pulled_at', { ascending: true })
    .limit(52); // ~a year of weekly pulls

  if (historyError) {
    console.error('[comps] failed to load history:', historyError.message);
    return res.status(500).json({ error: 'Could not load comps data.' });
  }

  res.json({ estimate, comps, history });
});

// GET /api/comps/refresh — pulls fresh data from RentCast and stores it.
// This is a GET (not POST) because Vercel Cron Jobs always invoke via GET.
// Protected by CRON_SECRET: Vercel automatically sends
// "Authorization: Bearer <CRON_SECRET>" when it triggers a cron job, as
// long as that environment variable is set on the project — see the
// "Deploying to Vercel" section of the README for how that's wired up.
compsRouter.get('/comps/refresh', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Skip if we already pulled today — protects the RentCast free-tier
    // quota (50 requests/month) from an accidental duplicate cron
    // invocation (Vercel's own docs note cron delivery can occasionally
    // double-fire) or from someone hitting this URL manually more than
    // once. Pass ?force=1 to pull anyway (useful while testing).
    if (!req.query.force) {
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      const { data: existing, error: existingError } = await supabase
        .from('home_value_estimates')
        .select('id')
        .gte('pulled_at', startOfToday.toISOString())
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing) {
        return res.json({ skipped: true, reason: 'Already pulled today.' });
      }
    }

    const rentcastData = await fetchHomeValueEstimate();

    const { data: previousEstimate } = await supabase
      .from('home_value_estimates')
      .select('estimated_price')
      .order('pulled_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const comps = (rentcastData.comparables || []).map((c) => ({
      formatted_address: c.formattedAddress,
      property_type: c.propertyType,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      square_footage: c.squareFootage,
      lot_size: c.lotSize,
      year_built: c.yearBuilt,
      status: c.status,
      listing_type: c.listingType,
      price: c.price,
      price_per_sqft:
        c.price && c.squareFootage ? Math.round((c.price / c.squareFootage) * 100) / 100 : null,
      listed_date: c.listedDate,
      removed_date: c.removedDate,
      days_on_market: c.daysOnMarket,
      distance_miles: c.distance,
      correlation: c.correlation,
      latitude: c.latitude,
      longitude: c.longitude,
      raw: c,
    }));

    const summary = await generateCompsSummary({
      estimate: {
        estimated_price: rentcastData.price,
        price_range_low: rentcastData.priceRangeLow,
        price_range_high: rentcastData.priceRangeHigh,
      },
      comps,
      previousEstimate,
    });

    const { data: insertedEstimate, error: insertEstimateError } = await supabase
      .from('home_value_estimates')
      .insert({
        estimated_price: rentcastData.price,
        price_range_low: rentcastData.priceRangeLow,
        price_range_high: rentcastData.priceRangeHigh,
        summary,
        raw: rentcastData,
      })
      .select()
      .single();

    if (insertEstimateError) throw insertEstimateError;

    if (comps.length > 0) {
      const { error: insertCompsError } = await supabase
        .from('home_comps')
        .insert(comps.map((c) => ({ ...c, estimate_id: insertedEstimate.id })));
      if (insertCompsError) throw insertCompsError;
    }

    res.json({ estimate: insertedEstimate, compsInserted: comps.length });
  } catch (err) {
    console.error('[comps] refresh failed:', err.message);
    res.status(500).json({ error: 'Could not refresh comps data.' });
  }
});
