// The move tracker (Stage 22). The Netherlands move is one project, split
// into workstreams (Visa & Legal, Pets, House & Money, ...). Each holds
// tasks with an owner, a lead, a date range and a status. Key dates (last
// day of work, listing, departure) are what tasks can be pinned to, and
// decisions (D1-D8) can move a key date when they're made.
//
// The rules (repeats, the Summit agenda, decision warnings) live in
// lib/moveTasks.js. This file loads, validates and saves. No Claude
// involved: everything here is structured fields, nothing to parse.
//
// App-only for now: none of these routes are on the agent's allowlist.

import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { householdToday, daysBetween } from '../lib/recurringBills.js';
import {
  OWNERS,
  PEOPLE,
  addDays,
  buildAgenda,
  buildTaskUpdate,
  daysWaiting,
  decisionWarnings,
  isDateString,
  isOpen,
} from '../lib/moveTasks.js';

export const projectsRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const TASK_COLUMNS =
  'id, code, workstream_id, title, notes, owner, lead, start_date, due_date, date_precision, anchor_id, ' +
  'status, waiting_on, waiting_since, critical, focus, repeat, repeat_until, times_done, last_done_on, ' +
  'tag, link_url, completed_at, source, created_by, created_at, updated_at';
const DECISION_COLUMNS =
  'id, code, question, options, notes, decide_by, status, outcome, decided_on, decided_by, key_date_id';
const MAX_OPTIONS = 10;

function fail(res, status, error) {
  return res.status(status).json({ error });
}

async function findProject(slug) {
  if (!SLUG_PATTERN.test(slug)) return null;
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, slug, name, description, why, status')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Everything the Move page shows, in one round of parallel queries.
async function loadProject(project, today) {
  const results = await Promise.all([
    supabaseAdmin.from('workstreams').select('id, key, name, code_prefix, lead, sort_order').eq('project_id', project.id).order('sort_order'),
    supabaseAdmin.from('key_dates').select('id, key, title, date, confirmed').eq('project_id', project.id).order('date'),
    supabaseAdmin.from('tasks').select(TASK_COLUMNS).eq('project_id', project.id),
    supabaseAdmin.from('decisions').select(DECISION_COLUMNS).eq('project_id', project.id).order('decide_by', { nullsFirst: false }),
    supabaseAdmin.from('decision_inputs').select('decision_id, task_id'),
  ]);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
  const [workstreams, keyDates, tasks, decisions, inputs] = results.map((r) => r.data);

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const inputsByDecision = new Map();
  for (const { decision_id, task_id } of inputs) {
    if (!inputsByDecision.has(decision_id)) inputsByDecision.set(decision_id, []);
    if (taskById.has(task_id)) inputsByDecision.get(decision_id).push(task_id);
  }

  return {
    workstreams,
    key_dates: keyDates.map((k) => ({
      ...k,
      days_left: daysBetween(today, k.date),
      pinned_open_tasks: tasks.filter((t) => t.anchor_id === k.id && isOpen(t)).length,
    })),
    tasks: tasks.map((t) => (t.status === 'waiting' ? { ...t, days_waiting: daysWaiting(t, today) } : t)),
    decisions: decisions.map((d) => {
      const inputIds = inputsByDecision.get(d.id) || [];
      return {
        ...d,
        days_left: d.decide_by ? daysBetween(today, d.decide_by) : null,
        input_task_ids: inputIds,
        warnings: decisionWarnings(d, inputIds.map((id) => taskById.get(id))),
      };
    }),
  };
}

// GET /api/projects/:slug: the whole project plus this week's Summit
// agenda (lists of ids into `tasks` and `decisions`).
projectsRouter.get('/projects/:slug', async (req, res) => {
  try {
    const project = await findProject(req.params.slug);
    if (!project) return fail(res, 404, 'No project by that name.');
    const today = householdToday();
    const data = await loadProject(project, today);
    res.json({
      project,
      today,
      ...data,
      agenda: buildAgenda(data.tasks, data.decisions, today),
    });
  } catch (err) {
    console.error('[projects] failed to load project:', err.message);
    fail(res, 500, 'Could not load the move plan.');
  }
});

// GET /api/projects/:slug/summary: just enough for the homepage card
// (countdown, top picks, what's overdue or up next, decisions due).
projectsRouter.get('/projects/:slug/summary', async (req, res) => {
  try {
    const project = await findProject(req.params.slug);
    if (!project) return fail(res, 404, 'No project by that name.');
    const today = householdToday();
    const data = await loadProject(project, today);
    const agenda = buildAgenda(data.tasks, data.decisions, today);
    const taskById = new Map(data.tasks.map((t) => [t.id, t]));
    const decisionById = new Map(data.decisions.map((d) => [d.id, d]));
    const brief = (id) => {
      const t = taskById.get(id);
      return {
        id: t.id, code: t.code, title: t.title, owner: t.owner, lead: t.lead, status: t.status,
        start_date: t.start_date, due_date: t.due_date, date_precision: t.date_precision,
        critical: t.critical, repeat: t.repeat,
      };
    };
    res.json({
      project: { slug: project.slug, name: project.name },
      today,
      key_dates: data.key_dates,
      focus: agenda.focus.map(brief),
      overdue: agenda.overdue.map(brief),
      next_30: agenda.next_30.map(brief),
      decisions_due: agenda.decisions_due.map((id) => {
        const d = decisionById.get(id);
        return { id: d.id, code: d.code, question: d.question, decide_by: d.decide_by, days_left: d.days_left };
      }),
    });
  } catch (err) {
    console.error('[projects] failed to load summary:', err.message);
    fail(res, 500, 'Could not load the move summary.');
  }
});

// PATCH /api/projects/:slug: body { why }. F-08's "why" lives on the
// project, so it can sit at the top of the Move page.
projectsRouter.patch('/projects/:slug', async (req, res) => {
  const why = req.body?.why;
  if (why !== null && typeof why !== 'string') return fail(res, 400, '"why" must be text.');
  try {
    const project = await findProject(req.params.slug);
    if (!project) return fail(res, 404, 'No project by that name.');
    const { data, error } = await supabaseAdmin
      .from('projects')
      .update({ why: why?.trim().slice(0, 2000) || null })
      .eq('id', project.id)
      .select('id, slug, name, description, why, status')
      .single();
    if (error) throw error;
    res.json({ project: data });
  } catch (err) {
    console.error('[projects] failed to update project:', err.message);
    fail(res, 500, 'Could not save that.');
  }
});

// PATCH /api/workstreams/:id: body { lead: michael|mer|null }. Shared
// ("both") tasks that followed the old lead, or had none, follow the new
// one. Tasks someone deliberately gave a different lead keep theirs.
projectsRouter.patch('/workstreams/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return fail(res, 404, 'No such workstream.');
  const lead = req.body?.lead ?? null;
  if (lead !== null && !PEOPLE.includes(lead)) return fail(res, 400, '"lead" must be michael, mer or empty.');

  try {
    const { data: workstream, error: loadError } = await supabaseAdmin
      .from('workstreams')
      .select('id, lead')
      .eq('id', req.params.id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!workstream) return fail(res, 404, 'No such workstream.');

    const { data, error } = await supabaseAdmin
      .from('workstreams')
      .update({ lead })
      .eq('id', workstream.id)
      .select('id, key, name, code_prefix, lead, sort_order')
      .single();
    if (error) throw error;

    let followers = supabaseAdmin
      .from('tasks')
      .update({ lead, updated_at: new Date().toISOString() })
      .eq('workstream_id', workstream.id)
      .eq('owner', 'both');
    followers = workstream.lead
      ? followers.or(`lead.is.null,lead.eq.${workstream.lead}`)
      : followers.is('lead', null);
    const { data: moved, error: tasksError } = await followers.select('id');
    if (tasksError) throw tasksError;

    res.json({ workstream: data, tasks_updated: moved.length });
  } catch (err) {
    console.error('[projects] failed to update workstream:', err.message);
    fail(res, 500, 'Could not change the lead.');
  }
});

// The next free code in a workstream: V-16 exists, so a new visa task is V-17.
async function nextCode(projectId, prefix) {
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .select('code')
    .eq('project_id', projectId)
    .like('code', `${prefix}-%`);
  if (error) throw error;
  const highest = Math.max(0, ...data.map((t) => Number(t.code.split('-')[1]) || 0));
  return `${prefix}-${String(highest + 1).padStart(2, '0')}`;
}

// POST /api/projects/:slug/tasks: body { workstream, title, owner?, lead?,
// start_date?, due_date?, date_precision?, notes?, critical? }. A "both"
// task with no lead given gets the workstream's lead.
projectsRouter.post('/projects/:slug/tasks', async (req, res) => {
  const body = req.body ?? {};
  const fields = { owner: 'both', ...body };
  delete fields.workstream;
  delete fields.status;

  const today = householdToday();
  const checked = buildTaskUpdate({ status: 'todo' }, fields, today);
  if (checked.error) return fail(res, 400, checked.error);
  if (!checked.update.title) return fail(res, 400, 'A task needs a title.');

  try {
    const project = await findProject(req.params.slug);
    if (!project) return fail(res, 404, 'No project by that name.');
    const { data: workstream, error: wsError } = await supabaseAdmin
      .from('workstreams')
      .select('id, code_prefix, lead')
      .eq('project_id', project.id)
      .eq('key', String(body.workstream || ''))
      .maybeSingle();
    if (wsError) throw wsError;
    if (!workstream) return fail(res, 400, 'Pick a workstream for the task.');

    const row = { ...checked.update };
    delete row.updated_at;
    if (row.owner === 'both' && !('lead' in body)) row.lead = workstream.lead;
    if (row.owner !== 'both') row.lead = null;

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        ...row,
        project_id: project.id,
        workstream_id: workstream.id,
        code: await nextCode(project.id, workstream.code_prefix),
        source: req.user.agent ? 'agent' : 'app',
        created_by: req.user.agent ? 'agent' : req.user.email,
      })
      .select(TASK_COLUMNS)
      .single();
    if (error) throw error;
    res.status(201).json({ task: data });
  } catch (err) {
    console.error('[projects] failed to add task:', err.message);
    fail(res, 500, 'Could not add that task.');
  }
});

// PATCH /api/tasks/:id: any of title, notes, owner, lead, start_date,
// due_date, date_precision, status, waiting_on, critical, focus, link_url,
// repeat, repeat_until. Marking a repeating task done moves it to its next
// due date instead (the response says `rolled: true`).
projectsRouter.patch('/tasks/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return fail(res, 404, 'No such task.');
  try {
    const { data: task, error: loadError } = await supabaseAdmin
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('id', req.params.id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!task) return fail(res, 404, 'No such task.');

    const today = householdToday();
    const { update, rolled, error: invalid } = buildTaskUpdate(task, req.body, today);
    if (invalid) return fail(res, 400, invalid);
    if ('owner' in update && update.owner !== 'both') update.lead = null;

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update(update)
      .eq('id', task.id)
      .select(TASK_COLUMNS)
      .single();
    if (error) throw error;
    res.json({ task: data, rolled });
  } catch (err) {
    console.error('[projects] failed to update task:', err.message);
    fail(res, 500, 'Could not save that task.');
  }
});

// PATCH /api/key-dates/:id: body { date, dry_run? }. Moving a key date
// moves every open task pinned to it by the same number of days. With
// dry_run it only reports what would move, so the page can ask first.
projectsRouter.patch('/key-dates/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return fail(res, 404, 'No such key date.');
  const { date, dry_run: dryRun } = req.body ?? {};
  if (!isDateString(date)) return fail(res, 400, '"date" must be a YYYY-MM-DD date.');

  try {
    const { data: keyDate, error: loadError } = await supabaseAdmin
      .from('key_dates')
      .select('id, key, title, date, confirmed')
      .eq('id', req.params.id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!keyDate) return fail(res, 404, 'No such key date.');

    if (dryRun) {
      const delta = daysBetween(keyDate.date, date);
      const { data: pinned, error } = await supabaseAdmin
        .from('tasks')
        .select('id, code, title, start_date, due_date')
        .eq('anchor_id', keyDate.id)
        .in('status', ['todo', 'doing', 'waiting'])
        .order('due_date');
      if (error) throw error;
      return res.json({
        key_date: keyDate,
        delta_days: delta,
        tasks: pinned.map((t) => ({
          ...t,
          new_start_date: t.start_date && addDays(t.start_date, delta),
          new_due_date: t.due_date && addDays(t.due_date, delta),
        })),
      });
    }

    const { data: moved, error } = await supabaseAdmin.rpc('move_key_date', {
      p_key_date_id: keyDate.id,
      p_new_date: date,
      p_decision_id: null,
      p_changed_by: req.user.email,
    });
    if (error) throw error;
    res.json({ key_date: { ...keyDate, date }, ...moved });
  } catch (err) {
    console.error('[projects] failed to move key date:', err.message);
    fail(res, 500, 'Could not move that date.');
  }
});

function cleanOptions(options) {
  if (!Array.isArray(options) || options.length > MAX_OPTIONS) return null;
  const cleaned = [];
  for (const option of options) {
    if (!option || typeof option !== 'object') return null;
    const name = String(option.name ?? '').trim().slice(0, 100);
    if (!name) return null;
    const link = String(option.link ?? '').trim().slice(0, 500);
    if (link && !/^https?:\/\/\S+$/.test(link)) return null;
    cleaned.push({
      name,
      cost: String(option.cost ?? '').trim().slice(0, 60),
      link,
      notes: String(option.notes ?? '').trim().slice(0, 500),
    });
  }
  return cleaned;
}

// PATCH /api/decisions/:id: record a decision with { status: 'decided',
// outcome, decided_by: michael|mer|both, decided_on?, key_date? }, reopen it
// with { status: 'open' }, or edit { options, notes, decide_by }. For D2, D3
// and D5, `key_date` moves the date the decision sets (and every task
// pinned to it) and marks that date confirmed.
projectsRouter.patch('/decisions/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return fail(res, 404, 'No such decision.');
  const body = req.body ?? {};
  const update = {};

  if ('options' in body) {
    const options = cleanOptions(body.options);
    if (!options) return fail(res, 400, `Options need a name each (at most ${MAX_OPTIONS}), and links must start with http.`);
    update.options = options;
  }
  if ('notes' in body) {
    if (body.notes !== null && typeof body.notes !== 'string') return fail(res, 400, '"notes" must be text.');
    update.notes = body.notes?.trim().slice(0, 2000) || null;
  }
  if ('decide_by' in body) {
    if (body.decide_by !== null && !isDateString(body.decide_by)) return fail(res, 400, '"decide_by" must be a YYYY-MM-DD date.');
    update.decide_by = body.decide_by;
  }

  const today = householdToday();
  if (body.status === 'decided') {
    const outcome = typeof body.outcome === 'string' ? body.outcome.trim().slice(0, 2000) : '';
    if (!outcome) return fail(res, 400, 'Write down what you decided.');
    const decidedBy = body.decided_by ?? 'both';
    if (!OWNERS.includes(decidedBy)) return fail(res, 400, '"decided_by" must be michael, mer or both.');
    if (body.decided_on != null && !isDateString(body.decided_on)) return fail(res, 400, '"decided_on" must be a YYYY-MM-DD date.');
    Object.assign(update, { status: 'decided', outcome, decided_by: decidedBy, decided_on: body.decided_on || today });
  } else if (body.status === 'open') {
    Object.assign(update, { status: 'open', outcome: null, decided_by: null, decided_on: null });
  } else if ('status' in body) {
    return fail(res, 400, '"status" must be decided or open.');
  }
  if (body.key_date != null && (body.status !== 'decided' || !isDateString(body.key_date))) {
    return fail(res, 400, '"key_date" goes with status "decided" and must be a YYYY-MM-DD date.');
  }
  if (Object.keys(update).length === 0) return fail(res, 400, 'Nothing to change.');

  try {
    const { data: decision, error: loadError } = await supabaseAdmin
      .from('decisions')
      .select(DECISION_COLUMNS)
      .eq('id', req.params.id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!decision) return fail(res, 404, 'No such decision.');
    if (body.key_date && !decision.key_date_id) return fail(res, 400, "This decision doesn't set a key date.");

    const { data, error } = await supabaseAdmin
      .from('decisions')
      .update(update)
      .eq('id', decision.id)
      .select(DECISION_COLUMNS)
      .single();
    if (error) throw error;

    let moved = null;
    if (body.key_date) {
      const { data: result, error: moveError } = await supabaseAdmin.rpc('move_key_date', {
        p_key_date_id: decision.key_date_id,
        p_new_date: body.key_date,
        p_decision_id: decision.id,
        p_changed_by: req.user.email,
      });
      if (moveError) {
        // The decision is saved; say so, so nobody records it twice.
        console.error('[projects] decision saved but key date not moved:', moveError.message);
        return fail(res, 500, "The decision is saved, but its date didn't move. Change it under Key dates.");
      }
      moved = result;
    }
    res.json({ decision: data, moved });
  } catch (err) {
    console.error('[projects] failed to update decision:', err.message);
    fail(res, 500, 'Could not save that decision.');
  }
});

// "2027-09-20" -> "Sep 20, 2027", for the log's sentences.
function readableDate(date) {
  if (!isDateString(date)) return date;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// One line for an approved or dismissed "Benny suggests" proposal. The
// log never repeats an email's body, just who it was to and the subject.
function describeProposal(proposal) {
  const p = proposal.payload || {};
  if (proposal.kind === 'calendar_event') {
    const time = p.start_time ? ` at ${p.start_time}` : '';
    return `Calendar event on ${p.owner === 'mer' ? "Mer's" : "Michael's"} calendar: ${p.title} (${readableDate(p.date)}${time})`;
  }
  if (proposal.kind === 'gmail_draft') return `Email draft to ${p.to}: ${p.subject}`;
  return proposal.kind;
}

// GET /api/log: the household's decision log. Recorded decisions, key
// date changes, and every Benny proposal one of us approved or dismissed,
// newest first. All three were already stored; this just reads them
// together.
projectsRouter.get('/log', async (req, res) => {
  try {
    const results = await Promise.all([
      supabaseAdmin
        .from('decisions')
        .select('id, code, question, outcome, decided_by, decided_on')
        .eq('status', 'decided'),
      supabaseAdmin
        .from('key_date_changes')
        .select('id, old_date, new_date, tasks_shifted, changed_by, created_at, key_dates(title), decisions(code)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseAdmin
        .from('pending_actions')
        .select('id, kind, payload, note, status, decided_by, decided_at')
        .in('status', ['approved', 'rejected'])
        .order('decided_at', { ascending: false })
        .limit(100),
    ]);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;
    const [decisions, changes, proposals] = results.map((r) => r.data);

    const entries = [
      ...decisions.map((d) => ({
        type: 'decision',
        id: d.id,
        at: d.decided_on,
        title: `${d.code ? `${d.code}: ` : ''}${d.question}`,
        detail: d.outcome,
        by: d.decided_by,
      })),
      ...changes.map((c) => ({
        type: 'key_date',
        id: c.id,
        at: c.created_at,
        title:
          c.old_date === c.new_date
            ? `${c.key_dates?.title} confirmed for ${readableDate(c.new_date)}`
            : `${c.key_dates?.title} moved from ${readableDate(c.old_date)} to ${readableDate(c.new_date)}`,
        detail:
          (c.tasks_shifted ? `${c.tasks_shifted} pinned task${c.tasks_shifted === 1 ? '' : 's'} moved with it.` : '') +
          (c.decisions?.code ? ` Set by ${c.decisions.code}.` : ''),
        by: c.changed_by,
      })),
      ...proposals.map((p) => ({
        type: 'proposal',
        id: p.id,
        at: p.decided_at,
        title: `${p.status === 'approved' ? 'Approved' : 'Dismissed'}: ${describeProposal(p)}`,
        detail: p.note,
        by: p.decided_by,
      })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

    res.json({ entries });
  } catch (err) {
    console.error('[projects] failed to load log:', err.message);
    fail(res, 500, 'Could not load the decision log.');
  }
});
