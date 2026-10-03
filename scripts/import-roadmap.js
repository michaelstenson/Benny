// One-time import of the Netherlands move roadmap (netherlands-move-roadmap.md)
// into the Stage 22 tables. After this, Benny is the source of truth: edit
// tasks on the Move page, not in the markdown.
//
//   node scripts/import-roadmap.js <path-to-roadmap.md> --dry-run   # print, write nothing
//   node scripts/import-roadmap.js <path-to-roadmap.md> --json      # rows as JSON
//   node scripts/import-roadmap.js <path-to-roadmap.md>             # write to Supabase
//
// Safe to re-run: anything that already exists (by task code, decision
// code, workstream or key-date key) is skipped, never overwritten, so it
// can't undo edits made in the app. New coded tasks added to the markdown
// later would be picked up.
//
// The markdown is read as-is; everything the review on Oct 2, 2026
// changed is in the tables below, so it's visible in one place.

import { readFileSync } from 'node:fs';
import { householdToday } from '../server/lib/recurringBills.js';
import { decisionWarnings, firstOccurrence, isDateString } from '../server/lib/moveTasks.js';

const PROJECT_SLUG = 'netherlands-move';

// Leads (Oct 2): Michael leads the home sale and DAFT, Mer leads pets and
// the in-house work (declutter, selling what won't ship). The rest get a
// lead at a Summit.
const WORKSTREAMS = [
  { key: 'foundations', name: 'Foundations', code_prefix: 'F', lead: null },
  { key: 'visa', name: 'Visa & Legal', code_prefix: 'V', lead: 'michael' },
  { key: 'pets', name: 'Pets', code_prefix: 'P', lead: 'mer' },
  { key: 'house', name: 'House & Money', code_prefix: 'H', lead: 'michael' },
  { key: 'work', name: 'Work & Career', code_prefix: 'W', lead: null },
  { key: 'dutch', name: 'Dutch & Culture', code_prefix: 'L', lead: null },
  { key: 'housing', name: 'Housing in NL', code_prefix: 'N', lead: null },
  { key: 'logistics', name: 'Logistics & Admin', code_prefix: 'G', lead: 'mer' },
  { key: 'belonging', name: 'Belonging & Wellbeing', code_prefix: 'B', lead: null },
  { key: 'arrival', name: 'First 90 days in NL', code_prefix: 'A', lead: null },
].map((w, i) => ({ ...w, sort_order: i }));

// The roadmap's proposed anchor dates. Not confirmed until D2/D3/D5 are made.
const KEY_DATES = [
  { key: 'listing', title: 'House listed', date: '2027-06-01' },
  { key: 'last-day', title: "Michael's last day at Sweetgreen", date: '2027-06-30' },
  { key: 'departure', title: 'Departure', date: '2027-09-20' },
];

// Tasks that move with a key date when it changes.
const ANCHORS = {
  departure: [
    'V-13', 'V-14', 'P-09', 'P-10', 'P-11', 'N-07', 'N-08', 'G-05', 'G-09', 'G-10', 'B-04',
    'A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07', 'A-08', 'A-09',
  ],
  'last-day': ['W-02', 'W-03', 'W-04'],
  listing: ['H-08', 'H-10', 'H-11', 'H-12'],
};

// Miss one of these and the departure date or a legal deadline slips.
const CRITICAL = [
  'V-03', 'V-07', 'V-09', 'V-12', 'V-13', 'V-14', 'P-03', 'P-07', 'P-08', 'P-09',
  'H-07', 'H-10', 'H-11', 'W-02', 'G-04', 'G-08', 'N-07', 'A-01', 'A-02', 'A-03',
];

// Habits rather than one-offs: ticking one off moves it to its next due
// date. Weekly ones fall on Sundays (Summit day). `until` is when they stop.
const REPEATS = {
  'H-01': { repeat: 'weekly', until: '2026-11-30' },
  'L-02': { repeat: 'weekly', until: '2027-01-31' },
  'P-05': { repeat: 'weekly', until: '2027-08-31' },
  'H-05': { repeat: 'weekly', until: '2027-03-31' },
  'W-07': { repeat: 'weekly', until: '2027-07-31' },
  'W-05': { repeat: 'monthly', until: '2027-09-30' },
  'B-03': { repeat: 'monthly', until: '2027-09-30' },
  'H-16': { repeat: 'monthly', until: '2027-09-15', first_due: '2027-01-31' },
  'B-05': { repeat: 'quarterly', until: null },
};

const TAGS = {
  'P-04': 'quincy', 'P-06': 'quincy', 'P-07': 'cats',
  'P-20': 'morticia', 'P-21': 'morticia', 'P-22': 'morticia',
  'P-23': 'morticia', 'P-24': 'morticia', 'P-25': 'morticia',
};

// Fixes from the Oct 2 review, plus the first 90 days (which had no owner
// or date) and Oct 2 answers (Summit time, leads).
const OVERRIDES = {
  'F-01': { notes: 'Do the review right here: change dates, owners and leads on the Move page.' },
  'F-03': { status: 'doing', notes: 'Weekly Penguin Summit: Sundays at 7pm (picked Oct 2). Still to pick: the monthly 90-minute review.' },
  'V-02': {
    start_date: '2026-10-15', due_date: '2026-11-15', date_precision: 'day',
    notes: 'The calls have to happen before D1 (decide by Nov 20).',
  },
  'V-14': { start_date: '2027-09-20', due_date: '2027-10-20', date_precision: 'day' },
  'P-09': {
    start_date: '2027-09-10', due_date: '2027-09-18', date_precision: 'day',
    notes: 'The EU health certificate must be issued within 10 days before arrival, then USDA-endorsed. Your relocator will give the exact window.',
  },
  'H-05': { lead: 'mer' },
  'H-16': {
    title: 'Work out the move runway number (DAFT capital + first 6-12 months NL living + deposits + shipping), then check it monthly',
    start_date: '2026-12-01',
    notes: 'An input to D2 (last day of work), so the first pass is due by Jan 31.',
  },
  'W-09': {
    title: 'If Mer is employed: plan notice for the last day set in D2',
    start_date: '2027-02-01', due_date: '2027-03-31',
  },
  'G-08': {
    start_date: '2027-04-01', due_date: '2027-04-30',
    notes: 'Right after D3 sets the date. Airlines cap pets per flight, so book the cabin spots with the seats.',
  },
  'G-10': { start_date: '2027-09-01', due_date: '2027-09-19', date_precision: 'day' },
  'N-08': { start_date: '2027-09-21', due_date: '2027-11-30', date_precision: 'day' },
  'A-01': {
    start_date: '2027-09-21', due_date: '2027-09-25', date_precision: 'day',
    notes: 'Register with the municipality within 5 days of arrival.',
  },
  'A-02': {
    start_date: '2027-09-25', due_date: '2027-10-31', date_precision: 'day',
    notes: 'Mandatory once you are registered. Confirm the exact deadline with your firm.',
  },
  'A-03': {
    start_date: '2027-09-21', due_date: '2027-11-30', date_precision: 'day',
    notes: 'File before the 90-day visa-free stay runs out (Dec 19 if you land Sep 20). Confirm with your firm.',
  },
  'A-04': { start_date: '2027-09-25', due_date: '2027-10-31', date_precision: 'day' },
  'A-05': { start_date: '2027-10-01', due_date: '2027-11-30', date_precision: 'day' },
  'A-06': { start_date: '2027-09-21', due_date: '2027-10-31', date_precision: 'day' },
  'A-07': { start_date: '2027-09-21', due_date: '2027-10-15', date_precision: 'day' },
  'A-08': { start_date: '2027-10-01', due_date: '2027-12-18', date_precision: 'day' },
  'A-09': { start_date: '2027-10-01', due_date: '2027-12-18', date_precision: 'day' },
};

const NEW_TASKS = [
  {
    code: 'G-11',
    owner: 'michael',
    title: "Move Benny too: make the time zone a setting, find the agent a home after the sale (the Pi lives in the house), retire the Chicago-house integrations",
    start_date: '2027-04-01', due_date: '2027-06-30', date_precision: 'month',
    notes: 'America/Chicago is hard-coded in 5 server files.',
  },
];

// Structured options and the tasks each decision needs first. Question,
// decide-by and notes come from the roadmap's Open Decisions table.
const DECISIONS = {
  D1: {
    options: ['Expatlaw', 'NordicHQ', 'Cardon & Company', 'Self-file'],
    inputs: ['V-01', 'V-02'],
  },
  D2: {
    question: 'Last day of work (Michael and Mer)',
    options: [['~May 31', 'More time, less runway'], ['~Jun 30 (proposed)', ''], ['Later', 'Fewer big tasks in summer']],
    inputs: ['W-01', 'H-16'],
    key_date: 'last-day',
  },
  D3: {
    options: ['Mid Sept', ['Late Sept / Oct', "Less heat-embargo risk for Quincy's flight"]],
    inputs: ['P-03', 'P-06'],
    key_date: 'departure',
  },
  D4: { inputs: ['P-20', 'P-21', 'P-23'] },
  D5: { inputs: ['H-06', 'H-07'], key_date: 'listing' },
  D6: { options: ['ZZP (eenmanszaak)', 'BV'], inputs: ['V-04'] },
  D7: { inputs: ['N-01', 'N-02'] },
  D8: { options: ['Sea freight', 'Air', 'Sell and rebuy'], inputs: ['G-01', 'G-03'] },
};

const OWNER_CODES = { S: 'michael', M: 'mer', B: 'both' };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function iso(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}
function lastDay(year, month) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

// The roadmap runs Oct 2026 → Dec 2027, so a bare Oct-Dec is 2026 and
// Jan-Sep is 2027. The second half of a range is the same year unless it
// wraps ("Nov-Jan").
function parseMonth(token) {
  const month = MONTHS[token.toLowerCase()];
  if (!month) throw new Error(`Unknown month "${token}"`);
  return month;
}
function yearOf(month) {
  return month >= 10 ? 2026 : 2027;
}

function parseWhen(label) {
  if (!label || /^(ongoing|quarterly)$/i.test(label)) return { start_date: null, due_date: null };

  const quarters = label.match(/^Q([1-4])(?:-Q([1-4]))?$/);
  if (quarters) {
    const firstQ = Number(quarters[1]);
    const lastQ = Number(quarters[2] || quarters[1]);
    const year = (q) => (q === 4 ? 2026 : 2027);
    return {
      start_date: iso(year(firstQ), firstQ * 3 - 2, 1),
      due_date: lastDay(year(lastQ), lastQ * 3),
    };
  }

  const open = label.match(/^([A-Za-z]+)\+$/); // "Sept+"
  if (open) {
    const month = parseMonth(open[1]);
    return { start_date: iso(yearOf(month), month, 1), due_date: lastDay(yearOf(month), month) };
  }

  const range = label.match(/^([A-Za-z]+)(?:-([A-Za-z]+))?$/);
  if (!range) throw new Error(`Can't read the date label "${label}"`);
  const firstMonth = parseMonth(range[1]);
  const firstYear = yearOf(firstMonth);
  const lastMonth = range[2] ? parseMonth(range[2]) : firstMonth;
  const lastYear = firstYear === 2026 && lastMonth < firstMonth ? 2027 : firstYear;
  return { start_date: iso(firstYear, firstMonth, 1), due_date: lastDay(lastYear, lastMonth) };
}

function cleanMarkdown(text) {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim();
}

function parseRoadmap(markdown) {
  const tasks = [];
  const decisions = [];
  const TASK_LINE = /^- \[( |x)\] \*\*([A-Z]-\d{2})\*\*\s+(?:\(([SMB]), ([^)]+)\)\s+)?(.+)$/;
  const DECISION_LINE = /^\|\s*(D\d+)\s*\|([^|]+)\|([^|]+)\|([^|]+)\|\s*$/;

  for (const line of markdown.split(/\r?\n/)) {
    const task = line.match(TASK_LINE);
    if (task) {
      const [, checked, code, ownerCode, label, title] = task;
      tasks.push({
        code,
        title: cleanMarkdown(title),
        owner: OWNER_CODES[ownerCode] || 'both',
        date_precision: 'month',
        ...parseWhen(label?.trim()),
        status: checked === 'x' ? 'done' : 'todo',
        label: label?.trim() || null,
      });
      continue;
    }
    const decision = line.match(DECISION_LINE);
    if (decision) {
      const [, code, question, decideBy, notes] = decision.map((s) => s.trim());
      const [monthToken, day] = decideBy.split(/\s+/);
      const month = parseMonth(monthToken);
      decisions.push({
        code,
        question: cleanMarkdown(question),
        decide_by: iso(yearOf(month), month, Number(day)),
        notes: cleanMarkdown(notes),
      });
    }
  }
  return { tasks, decisions };
}

function option(entry) {
  const [name, notes] = Array.isArray(entry) ? entry : [entry, ''];
  return { name, cost: '', link: '', notes };
}

function buildRows(markdown, today) {
  const parsed = parseRoadmap(markdown);
  const byPrefix = new Map(WORKSTREAMS.map((w) => [w.code_prefix, w]));
  const tasks = [...parsed.tasks, ...NEW_TASKS.map((t) => ({ status: 'todo', ...t }))];
  const byCode = new Map();
  for (const task of tasks) {
    if (byCode.has(task.code)) throw new Error(`Task code ${task.code} appears twice.`);
    byCode.set(task.code, task);
  }
  const requireCode = (code, where) => {
    if (!byCode.has(code)) throw new Error(`${where} names ${code}, which isn't in the roadmap.`);
    return byCode.get(code);
  };

  for (const task of tasks) {
    const workstream = byPrefix.get(task.code[0]);
    if (!workstream) throw new Error(`No workstream for ${task.code}.`);
    task.workstream = workstream.key;
    task.lead = task.owner === 'both' ? workstream.lead : null;
  }
  for (const [code, fields] of Object.entries(OVERRIDES)) Object.assign(requireCode(code, 'OVERRIDES'), fields);
  for (const code of CRITICAL) requireCode(code, 'CRITICAL').critical = true;
  for (const [code, tag] of Object.entries(TAGS)) requireCode(code, 'TAGS').tag = tag;
  for (const [key, codes] of Object.entries(ANCHORS)) {
    if (!KEY_DATES.some((k) => k.key === key)) throw new Error(`ANCHORS names unknown key date ${key}.`);
    for (const code of codes) requireCode(code, 'ANCHORS').anchor = key;
  }
  for (const [code, { repeat, until, first_due }] of Object.entries(REPEATS)) {
    const task = requireCode(code, 'REPEATS');
    const from = task.start_date && task.start_date > today ? task.start_date : today;
    task.repeat = repeat;
    task.repeat_until = until;
    task.due_date = first_due || firstOccurrence(repeat, from);
    task.date_precision = 'day';
  }
  for (const task of tasks) {
    for (const field of ['start_date', 'due_date', 'repeat_until']) {
      if (task[field] != null && !isDateString(task[field])) throw new Error(`${task.code} has a bad ${field}.`);
    }
    if (task.start_date && task.due_date && task.start_date > task.due_date) {
      throw new Error(`${task.code} starts after it's due.`);
    }
  }

  const decisions = parsed.decisions.map((d) => {
    const extra = DECISIONS[d.code] || {};
    for (const code of extra.inputs || []) requireCode(code, `DECISIONS.${d.code}`);
    return {
      ...d,
      question: extra.question || d.question,
      options: (extra.options || []).map(option),
      inputs: extra.inputs || [],
      key_date: extra.key_date || null,
    };
  });

  return { workstreams: WORKSTREAMS, key_dates: KEY_DATES, tasks, decisions };
}

function describe(rows) {
  const pad = (s, n) => String(s ?? '').padEnd(n);
  const lines = [];
  for (const workstream of rows.workstreams) {
    const tasks = rows.tasks.filter((t) => t.workstream === workstream.key);
    lines.push(`\n${workstream.name} (lead: ${workstream.lead || 'none yet'}), ${tasks.length} tasks`);
    for (const t of tasks) {
      const who = t.owner === 'both' ? `both${t.lead ? `>${t.lead}` : ''}` : t.owner;
      const when = t.start_date ? `${t.start_date}..${t.due_date}` : t.due_date || '-';
      const flags = [
        t.critical && 'critical',
        t.repeat && `${t.repeat} until ${t.repeat_until || 'ongoing'}`,
        t.anchor && `pinned:${t.anchor}`,
        t.status !== 'todo' && t.status,
        t.tag && `#${t.tag}`,
      ].filter(Boolean);
      lines.push(`  ${pad(t.code, 5)} ${pad(who, 13)} ${pad(when, 22)} ${pad(flags.join(', '), 40)} ${t.title.slice(0, 70)}`);
    }
  }
  lines.push('\nDecisions');
  const byCode = new Map(rows.tasks.map((t) => [t.code, t]));
  for (const d of rows.decisions) {
    const warnings = decisionWarnings({ ...d, status: 'open' }, d.inputs.map((c) => byCode.get(c)));
    lines.push(
      `  ${pad(d.code, 4)} by ${d.decide_by}  ${pad(d.question, 40)} inputs: ${d.inputs.join(', ') || '-'}` +
        `${d.key_date ? `  sets: ${d.key_date}` : ''}${d.options.length ? `  options: ${d.options.map((o) => o.name).join(' / ')}` : ''}`
    );
    for (const w of warnings) lines.push(`       ⚠ ${w}`);
  }
  const owners = { michael: 0, mer: 0, both: 0 };
  for (const t of rows.tasks) owners[t.owner]++;
  lines.push(
    `\n${rows.tasks.length} tasks (michael ${owners.michael}, mer ${owners.mer}, both ${owners.both}), ` +
      `${rows.decisions.length} decisions, ${rows.key_dates.length} key dates`
  );
  return lines.join('\n');
}

async function selectAll(supabase, table, columns, projectId) {
  const { data, error } = await supabase.from(table).select(columns).eq('project_id', projectId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

async function insertMissing(supabase, table, rows, existingKeys, keyOf) {
  const missing = rows.filter((r) => !existingKeys.has(keyOf(r)));
  if (missing.length) {
    const { error } = await supabase.from(table).insert(missing);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return missing.length;
}

async function writeRows(rows) {
  await import('dotenv/config');
  const { supabaseAdmin: supabase } = await import('../server/lib/supabaseClient.js');
  if (!supabase) throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing from .env.');

  const { data: project, error } = await supabase.from('projects').select('id').eq('slug', PROJECT_SLUG).maybeSingle();
  if (error) throw new Error(error.message);
  if (!project) throw new Error(`No "${PROJECT_SLUG}" project. Run scripts/stage22_move_tracker.sql first.`);
  const projectId = project.id;
  const counts = {};

  let workstreams = await selectAll(supabase, 'workstreams', 'id, key', projectId);
  counts.workstreams = await insertMissing(
    supabase, 'workstreams',
    rows.workstreams.map((w) => ({ ...w, project_id: projectId })),
    new Set(workstreams.map((w) => w.key)), (w) => w.key
  );
  workstreams = await selectAll(supabase, 'workstreams', 'id, key', projectId);
  const workstreamId = new Map(workstreams.map((w) => [w.key, w.id]));

  let keyDates = await selectAll(supabase, 'key_dates', 'id, key', projectId);
  counts.key_dates = await insertMissing(
    supabase, 'key_dates',
    rows.key_dates.map((k) => ({ ...k, project_id: projectId })),
    new Set(keyDates.map((k) => k.key)), (k) => k.key
  );
  keyDates = await selectAll(supabase, 'key_dates', 'id, key', projectId);
  const keyDateId = new Map(keyDates.map((k) => [k.key, k.id]));

  let tasks = await selectAll(supabase, 'tasks', 'id, code', projectId);
  const now = new Date().toISOString();
  counts.tasks = await insertMissing(
    supabase, 'tasks',
    rows.tasks.map((t) => ({
      project_id: projectId,
      workstream_id: workstreamId.get(t.workstream),
      code: t.code,
      title: t.title,
      notes: t.notes ?? null,
      owner: t.owner,
      lead: t.lead ?? null,
      start_date: t.start_date ?? null,
      due_date: t.due_date ?? null,
      date_precision: t.date_precision,
      anchor_id: t.anchor ? keyDateId.get(t.anchor) : null,
      status: t.status,
      completed_at: t.status === 'done' ? now : null,
      critical: Boolean(t.critical),
      repeat: t.repeat ?? null,
      repeat_until: t.repeat_until ?? null,
      tag: t.tag ?? null,
      source: 'app',
      created_by: 'roadmap import',
    })),
    new Set(tasks.map((t) => t.code)), (t) => t.code
  );
  tasks = await selectAll(supabase, 'tasks', 'id, code', projectId);
  const taskId = new Map(tasks.map((t) => [t.code, t.id]));

  const existingDecisions = await selectAll(supabase, 'decisions', 'id, code', projectId);
  const known = new Set(existingDecisions.map((d) => d.code));
  const newDecisions = rows.decisions.filter((d) => !known.has(d.code));
  counts.decisions = newDecisions.length;
  if (newDecisions.length) {
    const { data: inserted, error: insertError } = await supabase
      .from('decisions')
      .insert(
        newDecisions.map((d) => ({
          project_id: projectId,
          code: d.code,
          question: d.question,
          decide_by: d.decide_by,
          notes: d.notes,
          options: d.options,
          key_date_id: d.key_date ? keyDateId.get(d.key_date) : null,
          source: 'app',
          created_by: 'roadmap import',
        }))
      )
      .select('id, code');
    if (insertError) throw new Error(`decisions: ${insertError.message}`);
    const links = inserted.flatMap((d) =>
      rows.decisions.find((r) => r.code === d.code).inputs.map((code) => ({ decision_id: d.id, task_id: taskId.get(code) }))
    );
    if (links.length) {
      const { error: linkError } = await supabase.from('decision_inputs').insert(links);
      if (linkError) throw new Error(`decision_inputs: ${linkError.message}`);
    }
  }
  return counts;
}

async function main() {
  const [path, flag] = process.argv.slice(2);
  if (!path) {
    console.error('Usage: node scripts/import-roadmap.js <netherlands-move-roadmap.md> [--dry-run | --json]');
    process.exit(1);
  }
  const rows = buildRows(readFileSync(path, 'utf8'), householdToday());

  if (flag === '--json') {
    console.log(JSON.stringify(rows, null, 2));
  } else if (flag === '--dry-run') {
    console.log(describe(rows));
    console.log('\nDry run: nothing written.');
  } else {
    const counts = await writeRows(rows);
    console.log(
      `Added ${counts.workstreams} workstreams, ${counts.key_dates} key dates, ` +
        `${counts.tasks} tasks, ${counts.decisions} decisions (anything already there was skipped).`
    );
  }
}

main().catch((err) => {
  console.error(`Import failed: ${err.message}`);
  process.exit(1);
});
