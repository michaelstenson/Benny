// Projects module (Stage 22) — generic on purpose, so the Netherlands
// move and selling the house are both just projects. A project has
// milestones (owner, due date, what they wait on) and a decisions log
// (what's been decided vs. still open). Milestones also show up on the
// Timeline, and GET /api/projects/review is what the agent's weekly
// project review is built from.
//
// Autonomy (per the agent plan): milestones and decisions are low-stakes
// data inside the app, so the agent may add and update them directly.
// Creating or archiving a project and every delete stay app-only — see
// the allowlist in agentAuth.js.

import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { OWNERS } from '../lib/tokenStore.js';

export const projectsRouter = Router();

const HOUSEHOLD_TIMEZONE = 'America/Chicago';
const MAX_NAME_LENGTH = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;
const MAX_DEPENDENCIES = 20;
const REVIEW_LOOKAHEAD_DAYS = 14;
const REVIEW_LOOKBACK_DAYS = 7;

const PROJECT_STATUSES = ['active', 'paused', 'done'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f-]{36}$/;

const PROJECT_COLUMNS = 'id, slug, name, description, status, target_date, source, created_by, created_at';
const MILESTONE_COLUMNS =
  'id, project_id, title, owner, due_date, status, completed_at, source, created_by, created_at';
const DECISION_COLUMNS =
  'id, project_id, question, outcome, status, decided_on, decided_by, source, created_by, created_at';

// --- small helpers ---

function localDateString(date) {
  return date.toLocaleDateString('en-CA', { timeZone: HOUSEHOLD_TIMEZONE });
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function singleLine(value, max) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

// Free text (a description, a decision's outcome) may span lines.
function multiLine(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function actor(req) {
  return {
    source: req.user.agent ? 'agent' : 'app',
    created_by: req.user.agent ? 'agent' : req.user.email,
  };
}

function decider(req) {
  return req.user.agent ? 'agent' : req.user.email;
}

async function findProject(slug) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Dependencies live in their own table (so deleting a milestone cleans
// up whatever pointed at it). Everywhere else they're flattened to a
// plain `depends_on: [milestoneId]` array, plus a derived `blocked`
// flag: true while anything it depends on isn't done yet.
function withDependencies(milestones, links) {
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const dependsOn = new Map();
  for (const { milestone_id, depends_on_id } of links) {
    if (!dependsOn.has(milestone_id)) dependsOn.set(milestone_id, []);
    dependsOn.get(milestone_id).push(depends_on_id);
  }
  return milestones.map((m) => {
    const deps = dependsOn.get(m.id) || [];
    return {
      ...m,
      depends_on: deps,
      blocked: m.status !== 'done' && deps.some((id) => byId.get(id)?.status !== 'done'),
    };
  });
}

async function loadMilestones(projectIds) {
  const { data: milestones, error } = await supabaseAdmin
    .from('milestones')
    .select(MILESTONE_COLUMNS)
    .in('project_id', projectIds)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (milestones.length === 0) return [];

  const { data: links, error: linksError } = await supabaseAdmin
    .from('milestone_dependencies')
    .select('milestone_id, depends_on_id')
    .in('milestone_id', milestones.map((m) => m.id));
  if (linksError) throw linksError;

  return withDependencies(milestones, links);
}

// Checks a proposed depends_on list for a milestone: real ids, same
// project, not itself, and no loop (A waits on B waits on A would make
// both permanently "blocked"). Returns { ids } or { error }.
async function validateDependencies(raw, projectId, selfId) {
  if (!Array.isArray(raw)) return { error: '"depends_on" must be an array of milestone ids.' };
  const ids = [...new Set(raw)];
  if (ids.length > MAX_DEPENDENCIES) {
    return { error: `A milestone can wait on at most ${MAX_DEPENDENCIES} others.` };
  }
  if (!ids.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
    return { error: '"depends_on" must be an array of milestone ids.' };
  }
  if (ids.length === 0) return { ids };
  if (selfId && ids.includes(selfId)) return { error: 'A milestone cannot wait on itself.' };

  const { data: siblings, error } = await supabaseAdmin
    .from('milestones')
    .select('id')
    .eq('project_id', projectId);
  if (error) throw error;
  const inProject = new Set(siblings.map((s) => s.id));
  if (!ids.every((id) => inProject.has(id))) {
    return { error: 'Each "depends_on" id must be a milestone in this same project.' };
  }

  if (selfId) {
    // Walk forward from what we'd depend on; reaching ourselves is a loop.
    const { data: links, error: linksError } = await supabaseAdmin
      .from('milestone_dependencies')
      .select('milestone_id, depends_on_id')
      .in('milestone_id', [...inProject]);
    if (linksError) throw linksError;
    const next = new Map();
    for (const { milestone_id, depends_on_id } of links) {
      if (!next.has(milestone_id)) next.set(milestone_id, []);
      next.get(milestone_id).push(depends_on_id);
    }
    const seen = new Set();
    const stack = [...ids];
    while (stack.length) {
      const id = stack.pop();
      if (id === selfId) return { error: 'That would make a loop of milestones waiting on each other.' };
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) || []));
    }
  }
  return { ids };
}

async function replaceDependencies(milestoneId, ids) {
  const { error: deleteError } = await supabaseAdmin
    .from('milestone_dependencies')
    .delete()
    .eq('milestone_id', milestoneId);
  if (deleteError) throw deleteError;
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin
    .from('milestone_dependencies')
    .insert(ids.map((depends_on_id) => ({ milestone_id: milestoneId, depends_on_id })));
  if (error) throw error;
}

async function loadMilestone(id) {
  const { data, error } = await supabaseAdmin
    .from('milestones')
    .select(MILESTONE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const all = await loadMilestones([data.project_id]);
  return all.find((m) => m.id === id) || null;
}

// --- projects ---

// GET /api/projects — every project with a quick tally for the list page.
projectsRouter.get('/projects', async (req, res) => {
  try {
    const today = localDateString(new Date());
    const { data: projects, error } = await supabaseAdmin
      .from('projects')
      .select(PROJECT_COLUMNS)
      .order('created_at');
    if (error) throw error;

    const ids = projects.map((p) => p.id);
    const [milestones, decisionsResult] = await Promise.all([
      ids.length ? loadMilestones(ids) : [],
      ids.length
        ? supabaseAdmin.from('decisions').select('project_id').eq('status', 'open').in('project_id', ids)
        : { data: [], error: null },
    ]);
    if (decisionsResult.error) throw decisionsResult.error;

    res.json({
      projects: projects.map((project) => {
        const mine = milestones.filter((m) => m.project_id === project.id);
        const open = mine.filter((m) => m.status !== 'done');
        return {
          ...project,
          milestones_total: mine.length,
          milestones_done: mine.length - open.length,
          milestones_overdue: open.filter((m) => m.due_date && m.due_date < today).length,
          open_decisions: decisionsResult.data.filter((d) => d.project_id === project.id).length,
        };
      }),
    });
  } catch (err) {
    console.error('[projects] failed to list projects:', err.message);
    res.status(500).json({ error: 'Could not load projects.' });
  }
});

// GET /api/projects/review — the data behind the agent's weekly project
// review: for each active project, what's overdue, what's coming up,
// what's stuck waiting on something, what just got done, and which
// decisions are still open. Defined before /projects/:slug so "review"
// isn't read as a slug.
projectsRouter.get('/projects/review', async (req, res) => {
  try {
    const today = localDateString(new Date());
    const horizon = addDays(today, REVIEW_LOOKAHEAD_DAYS);
    const since = addDays(today, -REVIEW_LOOKBACK_DAYS);

    const { data: projects, error } = await supabaseAdmin
      .from('projects')
      .select(PROJECT_COLUMNS)
      .eq('status', 'active')
      .order('created_at');
    if (error) throw error;
    if (projects.length === 0) return res.json({ date: today, projects: [] });

    const ids = projects.map((p) => p.id);
    const [milestones, { data: decisions, error: decisionsError }] = await Promise.all([
      loadMilestones(ids),
      supabaseAdmin
        .from('decisions')
        .select(DECISION_COLUMNS)
        .in('project_id', ids)
        .order('created_at'),
    ]);
    if (decisionsError) throw decisionsError;

    const titles = new Map(milestones.map((m) => [m.id, m.title]));
    const brief = (m) => ({
      id: m.id,
      title: m.title,
      owner: m.owner,
      due_date: m.due_date,
      waiting_on: m.depends_on.map((id) => titles.get(id)).filter(Boolean),
    });

    res.json({
      date: today,
      projects: projects.map((project) => {
        const mine = milestones.filter((m) => m.project_id === project.id);
        const open = mine.filter((m) => m.status !== 'done');
        const myDecisions = decisions.filter((d) => d.project_id === project.id);
        return {
          slug: project.slug,
          name: project.name,
          description: project.description,
          target_date: project.target_date,
          days_to_target: project.target_date
            ? Math.round((Date.parse(project.target_date) - Date.parse(today)) / 86_400_000)
            : null,
          milestones_total: mine.length,
          milestones_done: mine.length - open.length,
          overdue: open.filter((m) => m.due_date && m.due_date < today).map(brief),
          due_soon: open
            .filter((m) => m.due_date && m.due_date >= today && m.due_date <= horizon)
            .map(brief),
          blocked: open.filter((m) => m.blocked).map(brief),
          // Open milestones with no date and nobody on them are the
          // quiet way a project stalls, so the review calls them out.
          undated: open.filter((m) => !m.due_date).map(brief),
          recently_completed: mine
            .filter((m) => m.status === 'done' && m.completed_at && m.completed_at.slice(0, 10) >= since)
            .map(brief),
          open_decisions: myDecisions
            .filter((d) => d.status === 'open')
            .map(({ id, question, created_at }) => ({ id, question, created_at })),
          recent_decisions: myDecisions
            .filter((d) => d.status === 'decided' && d.decided_on >= since)
            .map(({ id, question, outcome, decided_on }) => ({ id, question, outcome, decided_on })),
        };
      }),
    });
  } catch (err) {
    console.error('[projects] failed to build review:', err.message);
    res.status(500).json({ error: 'Could not build the project review.' });
  }
});

// GET /api/projects/:slug — the project with all its milestones and decisions.
projectsRouter.get('/projects/:slug', async (req, res) => {
  try {
    const project = await findProject(req.params.slug);
    if (!project) return res.status(404).json({ error: 'No project by that name.' });

    const [milestones, { data: decisions, error }] = await Promise.all([
      loadMilestones([project.id]),
      supabaseAdmin
        .from('decisions')
        .select(DECISION_COLUMNS)
        .eq('project_id', project.id)
        .order('created_at', { ascending: true }),
    ]);
    if (error) throw error;

    res.json({ project, milestones, decisions });
  } catch (err) {
    console.error('[projects] failed to load project:', err.message);
    res.status(500).json({ error: 'Could not load that project.' });
  }
});

// Cleans a project body for create/update. Only the fields that were
// sent come back, so PATCH can change one thing at a time.
function validateProjectFields(body, { requireName }) {
  const out = {};
  if (body.name !== undefined || requireName) {
    const name = singleLine(body.name, MAX_NAME_LENGTH);
    if (!name) return { error: '"name" is required.' };
    out.name = name;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return { error: '"description" must be text.' };
    }
    out.description = body.description ? multiLine(body.description, MAX_TEXT_LENGTH) || null : null;
  }
  if (body.target_date !== undefined) {
    if (body.target_date !== null && !isRealDate(body.target_date)) {
      return { error: '"target_date" must be YYYY-MM-DD or null.' };
    }
    out.target_date = body.target_date;
  }
  if (body.status !== undefined) {
    if (!PROJECT_STATUSES.includes(body.status)) {
      return { error: `"status" must be one of: ${PROJECT_STATUSES.join(', ')}.` };
    }
    out.status = body.status;
  }
  return { fields: out };
}

// POST /api/projects — app only. Body: { name, description?, target_date? }.
projectsRouter.post('/projects', async (req, res) => {
  const { fields, error: invalid } = validateProjectFields(req.body ?? {}, { requireName: true });
  if (invalid) return res.status(400).json({ error: invalid });

  const slug = slugify(fields.name);
  if (!slug) return res.status(400).json({ error: 'Give the project a name with letters or numbers in it.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({ ...fields, slug, ...actor(req) })
      .select(PROJECT_COLUMNS)
      .single();
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'There is already a project with that name.' });
    }
    if (error) throw error;
    res.status(201).json({ project: data });
  } catch (err) {
    console.error('[projects] failed to create project:', err.message);
    res.status(500).json({ error: 'Could not create that project.' });
  }
});

// PATCH /api/projects/:slug — app only. Any of name, description,
// target_date, status. The slug never changes, so links keep working.
projectsRouter.patch('/projects/:slug', async (req, res) => {
  const { fields, error: invalid } = validateProjectFields(req.body ?? {}, { requireName: false });
  if (invalid) return res.status(400).json({ error: invalid });
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'Nothing to change.' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(fields)
      .eq('slug', req.params.slug)
      .select(PROJECT_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No project by that name.' });
    res.json({ project: data });
  } catch (err) {
    console.error('[projects] failed to update project:', err.message);
    res.status(500).json({ error: 'Could not update that project.' });
  }
});

// --- milestones ---

function validateMilestoneFields(body, { requireTitle }) {
  const out = {};
  if (body.title !== undefined || requireTitle) {
    const title = singleLine(body.title, MAX_TITLE_LENGTH);
    if (!title) return { error: '"title" is required.' };
    out.title = title;
  }
  if (body.owner !== undefined) {
    if (body.owner !== null && !OWNERS.includes(body.owner)) {
      return { error: `"owner" must be one of: ${OWNERS.join(', ')} (or null).` };
    }
    out.owner = body.owner;
  }
  if (body.due_date !== undefined) {
    if (body.due_date !== null && !isRealDate(body.due_date)) {
      return { error: '"due_date" must be YYYY-MM-DD or null.' };
    }
    out.due_date = body.due_date;
  }
  return { fields: out };
}

// POST /api/projects/:slug/milestones — body: { title, owner?, due_date?, depends_on? }.
projectsRouter.post('/projects/:slug/milestones', async (req, res) => {
  const body = req.body ?? {};
  const { fields, error: invalid } = validateMilestoneFields(body, { requireTitle: true });
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const project = await findProject(req.params.slug);
    if (!project) return res.status(404).json({ error: 'No project by that name.' });

    let dependencyIds = [];
    if (body.depends_on !== undefined) {
      const checked = await validateDependencies(body.depends_on, project.id, null);
      if (checked.error) return res.status(400).json({ error: checked.error });
      dependencyIds = checked.ids;
    }

    const { data, error } = await supabaseAdmin
      .from('milestones')
      .insert({ ...fields, project_id: project.id, ...actor(req) })
      .select('id')
      .single();
    if (error) throw error;
    await replaceDependencies(data.id, dependencyIds);

    res.status(201).json({ milestone: await loadMilestone(data.id) });
  } catch (err) {
    console.error('[projects] failed to add milestone:', err.message);
    res.status(500).json({ error: 'Could not add that milestone.' });
  }
});

// PATCH /api/milestones/:id — any of title, owner, due_date, depends_on,
// or status ("open" | "done"). Marking done stamps completed_at; marking
// it open again clears it. Finishing something that still waits on
// another milestone is allowed — real life doesn't always go in order.
projectsRouter.patch('/milestones/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ error: 'No milestone with that id.' });
  const body = req.body ?? {};
  const { fields, error: invalid } = validateMilestoneFields(body, { requireTitle: false });
  if (invalid) return res.status(400).json({ error: invalid });

  if (body.status !== undefined) {
    if (!['open', 'done'].includes(body.status)) {
      return res.status(400).json({ error: '"status" must be "open" or "done".' });
    }
    fields.status = body.status;
    fields.completed_at = body.status === 'done' ? new Date().toISOString() : null;
  }
  if (Object.keys(fields).length === 0 && body.depends_on === undefined) {
    return res.status(400).json({ error: 'Nothing to change.' });
  }

  try {
    const { data: existing, error: findError } = await supabaseAdmin
      .from('milestones')
      .select('id, project_id, status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing) return res.status(404).json({ error: 'No milestone with that id.' });

    let dependencyIds = null;
    if (body.depends_on !== undefined) {
      const checked = await validateDependencies(body.depends_on, existing.project_id, existing.id);
      if (checked.error) return res.status(400).json({ error: checked.error });
      dependencyIds = checked.ids;
    }

    // Re-marking something already done shouldn't move its completed_at.
    if (fields.status === 'done' && existing.status === 'done') delete fields.completed_at;

    if (Object.keys(fields).length) {
      const { error } = await supabaseAdmin.from('milestones').update(fields).eq('id', existing.id);
      if (error) throw error;
    }
    if (dependencyIds) await replaceDependencies(existing.id, dependencyIds);

    res.json({ milestone: await loadMilestone(existing.id) });
  } catch (err) {
    console.error('[projects] failed to update milestone:', err.message);
    res.status(500).json({ error: 'Could not update that milestone.' });
  }
});

// DELETE /api/milestones/:id — app only. Anything that waited on it is
// simply released (the dependency rows cascade away).
projectsRouter.delete('/milestones/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ error: 'No milestone with that id.' });
  const { data, error } = await supabaseAdmin
    .from('milestones')
    .delete()
    .eq('id', req.params.id)
    .select('id');
  if (error) {
    console.error('[projects] failed to delete milestone:', error.message);
    return res.status(500).json({ error: 'Could not delete that milestone.' });
  }
  if (data.length === 0) return res.status(404).json({ error: 'No milestone with that id.' });
  res.json({ removed: data.length });
});

// --- decisions ---

// POST /api/projects/:slug/decisions — body: { question, outcome? }.
// With an outcome it's logged as already decided; without, it's an open
// question to settle later.
projectsRouter.post('/projects/:slug/decisions', async (req, res) => {
  const body = req.body ?? {};
  const question = singleLine(body.question, MAX_TITLE_LENGTH);
  if (!question) return res.status(400).json({ error: '"question" is required.' });
  if (body.outcome !== undefined && body.outcome !== null && typeof body.outcome !== 'string') {
    return res.status(400).json({ error: '"outcome" must be text.' });
  }
  const outcome = multiLine(body.outcome, MAX_TEXT_LENGTH);

  try {
    const project = await findProject(req.params.slug);
    if (!project) return res.status(404).json({ error: 'No project by that name.' });

    const row = { project_id: project.id, question, ...actor(req) };
    if (outcome) {
      row.outcome = outcome;
      row.status = 'decided';
      row.decided_on = localDateString(new Date());
      row.decided_by = decider(req);
    }
    const { data, error } = await supabaseAdmin
      .from('decisions')
      .insert(row)
      .select(DECISION_COLUMNS)
      .single();
    if (error) throw error;
    res.status(201).json({ decision: data });
  } catch (err) {
    console.error('[projects] failed to add decision:', err.message);
    res.status(500).json({ error: 'Could not add that decision.' });
  }
});

// PATCH /api/decisions/:id — any of question and outcome. Giving an
// outcome records the decision (who, and today's date); sending
// "outcome": null reopens it. "decided_on" may be sent to backdate one
// that was actually made earlier.
projectsRouter.patch('/decisions/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ error: 'No decision with that id.' });
  const body = req.body ?? {};
  const fields = {};

  if (body.question !== undefined) {
    const question = singleLine(body.question, MAX_TITLE_LENGTH);
    if (!question) return res.status(400).json({ error: '"question" cannot be empty.' });
    fields.question = question;
  }
  if (body.decided_on !== undefined && !isRealDate(body.decided_on)) {
    return res.status(400).json({ error: '"decided_on" must be YYYY-MM-DD.' });
  }
  if (body.outcome !== undefined) {
    if (body.outcome !== null && typeof body.outcome !== 'string') {
      return res.status(400).json({ error: '"outcome" must be text or null.' });
    }
    const outcome = body.outcome === null ? '' : multiLine(body.outcome, MAX_TEXT_LENGTH);
    if (body.outcome !== null && !outcome) {
      return res.status(400).json({ error: '"outcome" cannot be empty — send null to reopen.' });
    }
    if (outcome) {
      fields.outcome = outcome;
      fields.status = 'decided';
      fields.decided_on = body.decided_on ?? localDateString(new Date());
      fields.decided_by = decider(req);
    } else {
      Object.assign(fields, { outcome: null, status: 'open', decided_on: null, decided_by: null });
    }
  } else if (body.decided_on !== undefined) {
    return res.status(400).json({ error: '"decided_on" goes along with an "outcome".' });
  }
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'Nothing to change.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('decisions')
      .update(fields)
      .eq('id', req.params.id)
      .select(DECISION_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No decision with that id.' });
    res.json({ decision: data });
  } catch (err) {
    console.error('[projects] failed to update decision:', err.message);
    res.status(500).json({ error: 'Could not update that decision.' });
  }
});

// DELETE /api/decisions/:id — app only.
projectsRouter.delete('/decisions/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ error: 'No decision with that id.' });
  const { data, error } = await supabaseAdmin
    .from('decisions')
    .delete()
    .eq('id', req.params.id)
    .select('id');
  if (error) {
    console.error('[projects] failed to delete decision:', error.message);
    return res.status(500).json({ error: 'Could not delete that decision.' });
  }
  if (data.length === 0) return res.status(404).json({ error: 'No decision with that id.' });
  res.json({ removed: data.length });
});
