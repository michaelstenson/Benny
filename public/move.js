// Browser-side JS for /move.html (Stage 22): the Netherlands move plan.
// One GET loads everything (tasks, decisions, key dates, and the Summit
// agenda the server works out), and every change re-loads it, the same
// approach lists.js takes. Simple, and the two of us never see stale state
// for long.

const { PEOPLE, whenLabel, dayLabel, isOverdue, belongsTo, personDots, whoLabel, daysLeftLabel } = MoveShared;
const SLUG = 'netherlands-move';
const MAX_FOCUS = 3;

let data = null;
let person = MoveShared.getPerson();
let openEditor = null; // "<list>:<task id>": one task editor open at a time
let editingKeyDate = null; // { id, date, preview }
let editingOptionsFor = null; // decision id
let editingWhy = false;
const openDetails = new Set();

const $ = (id) => document.getElementById(id);
const esc = (value) => escapeHtml(value);

function flash(message, isError) {
  let el = $('flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash';
    el.className = 'hl-flash';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.classList.add('is-visible');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => el.classList.remove('is-visible'), 3500);
}

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
  return payload;
}

async function load() {
  try {
    data = await api('GET', `/api/projects/${SLUG}`);
    $('load-status').classList.add('hidden');
    $('plan').classList.remove('hidden');
    render();
  } catch (err) {
    $('load-status').textContent = err.message;
    $('load-status').classList.add('hl-error');
  }
}

const taskById = () => new Map(data.tasks.map((t) => [t.id, t]));
const keyDateById = () => new Map(data.key_dates.map((k) => [k.id, k]));

function render() {
  $('project-name').textContent = data.project.name;
  document.querySelectorAll('#person-toggle [data-person]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.person === person);
  });
  renderKeyDates();
  renderWhy();
  renderAgenda();
  renderDecisions();
  renderWorkstreams();
}

// --- Key dates -----------------------------------------------------------

function renderKeyDates() {
  $('key-dates').innerHTML = data.key_dates
    .map(
      (k) => `
      <button type="button" class="hl-countdown ${editingKeyDate?.id === k.id ? 'is-active' : ''}" data-key-date="${k.id}"
        aria-label="${esc(`${k.title}: ${dayLabel(k.date, data.today)}, ${daysLeftLabel(k.days_left)}${k.confirmed ? '' : ', proposed'}. Change date`)}">
        <span class="hl-countdown-days">${k.days_left >= 0 ? k.days_left : '✓'}</span>
        <span class="hl-countdown-text">
          <span class="block">${k.days_left >= 0 ? 'days to ' : ''}${esc(k.title)}</span>
          <span class="block text-xs hl-muted">${dayLabel(k.date, data.today)}${k.confirmed ? '' : ' · proposed'}</span>
        </span>
      </button>`
    )
    .join('');

  const editor = $('key-date-editor');
  if (!editingKeyDate) {
    editor.classList.add('hidden');
    editor.innerHTML = '';
    return;
  }
  const k = data.key_dates.find((x) => x.id === editingKeyDate.id);
  const setter = data.decisions.find((d) => d.key_date_id === k.id);
  const preview = editingKeyDate.preview;
  editor.classList.remove('hidden');
  editor.innerHTML = `
    <form id="key-date-form" class="flex flex-wrap items-end gap-3">
      <label class="hl-field">
        <span>${esc(k.title)}</span>
        <input type="date" name="date" class="hl-input" value="${esc(editingKeyDate.date)}" required>
      </label>
      <button type="submit" class="hl-button">${preview ? 'Move it' : 'See what moves'}</button>
      <button type="button" class="hl-back" data-action="close-key-date">Cancel</button>
    </form>
    <p class="text-xs hl-muted mt-2">
      ${k.pinned_open_tasks} open task${k.pinned_open_tasks === 1 ? ' is' : 's are'} pinned to this date and move with it.
      ${setter && !k.confirmed ? `It stays "proposed" until you record ${esc(setter.code)}.` : ''}
    </p>
    ${
      preview
        ? `<div class="mt-3 text-sm">
            <p class="hl-dim">${
              preview.delta_days === 0
                ? 'Same date. Nothing moves.'
                : `Moves ${preview.tasks.length} task${preview.tasks.length === 1 ? '' : 's'} ${preview.delta_days > 0 ? 'later' : 'earlier'} by ${Math.abs(preview.delta_days)} days:`
            }</p>
            <ul class="mt-2 hl-muted text-xs space-y-1">${preview.delta_days === 0 ? '' : preview.tasks
              .map((t) => `<li><span class="hl-code">${esc(t.code)}</span> ${esc(t.title)}: due ${t.due_date ? dayLabel(t.new_due_date, data.today) : 'no date'}</li>`)
              .join('')}</ul>
          </div>`
        : ''
    }`;
}

async function submitKeyDate(form) {
  const date = form.date.value;
  const k = editingKeyDate;
  try {
    if (!k.preview || k.date !== date) {
      const preview = await api('PATCH', `/api/key-dates/${k.id}`, { date, dry_run: true });
      editingKeyDate = { id: k.id, date, preview };
      renderKeyDates();
      return;
    }
    const result = await api('PATCH', `/api/key-dates/${k.id}`, { date });
    editingKeyDate = null;
    flash(result.tasks_shifted ? `Moved, along with ${result.tasks_shifted} pinned tasks.` : 'Date saved.');
    await load();
  } catch (err) {
    flash(err.message, true);
  }
}

// --- Why (F-08) ------------------------------------------------------------

function renderWhy() {
  const why = data.project.why;
  if (editingWhy) {
    $('why').innerHTML = `
      <form id="why-form">
        <label class="hl-field">
          <span>Our why: five sentences on what you want life in the Netherlands to feel like</span>
          <textarea name="why" rows="5" class="hl-input w-full">${esc(why || '')}</textarea>
        </label>
        <div class="flex gap-3 mt-2"><button type="submit" class="hl-button">Save</button>
        <button type="button" class="hl-back" data-action="cancel-why">Cancel</button></div>
      </form>`;
    return;
  }
  $('why').innerHTML = why
    ? `<blockquote class="hl-why">${esc(why)}</blockquote>
       <button type="button" class="hl-back mt-1" data-action="edit-why">Edit our why</button>`
    : `<p class="text-sm hl-muted">Your "why" (F-08) isn't written yet. It goes here, to reread when the logistics get ugly.
       <button type="button" class="hl-link" data-action="edit-why">Write it</button></p>`;
}

// --- Tasks -----------------------------------------------------------------

function taskMeta(t) {
  const today = data.today;
  const overdue = isOverdue(t, today);
  const anchor = t.anchor_id ? keyDateById().get(t.anchor_id) : null;
  const bits = [
    `<span class="inline-flex items-center gap-1">${personDots(t)} ${esc(whoLabel(t))}</span>`,
    `<span class="${overdue ? 'hl-up' : ''}">${esc(whenLabel(t, today))}${overdue ? ' · overdue' : ''}</span>`,
  ];
  if (t.status === 'doing') bits.push('<span class="hl-dim">in progress</span>');
  if (t.status === 'waiting') {
    const days = t.days_waiting || 0;
    bits.push(
      `<span class="${days >= 7 ? 'hl-up' : 'hl-dim'}">waiting on ${esc(t.waiting_on || 'someone')}, ${days} day${days === 1 ? '' : 's'}</span>`
    );
  }
  if (t.status === 'dropped') bits.push('dropped');
  if (t.critical) bits.push('<span class="hl-critical">critical</span>');
  if (anchor) bits.push(`<span title="Moves when ${esc(anchor.title)} moves">📌 ${esc(anchor.title)}</span>`);
  if (t.link_url) bits.push(`<a href="${esc(t.link_url)}" target="_blank" rel="noopener noreferrer">link ↗</a>`);
  return bits.join('<span class="hl-sep">·</span>');
}

function taskRow(t, list) {
  const key = `${list}:${t.id}`;
  const closed = t.status === 'done' || t.status === 'dropped';
  const editing = openEditor === key;
  return `
    <li class="py-3 flex items-start gap-3">
      <input type="checkbox" class="task-done mt-1 flex-shrink-0" data-id="${t.id}" ${t.status === 'done' ? 'checked' : ''}
        ${t.status === 'dropped' ? 'disabled' : ''} aria-label="Done: ${esc(t.title)}">
      <div class="flex-1 min-w-0 ${closed && !editing ? 'opacity-50' : ''}">
        <button type="button" class="hl-task-title ${t.status === 'done' ? 'line-through' : ''}" data-open="${key}">
          ${t.code ? `<span class="hl-code">${esc(t.code)}</span> ` : ''}${esc(t.title)}
        </button>
        <p class="text-xs hl-muted mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5">${taskMeta(t)}</p>
        ${t.notes && !editing ? `<p class="text-xs hl-dim mt-1 whitespace-pre-line">${esc(t.notes)}</p>` : ''}
        ${editing ? taskEditor(t) : ''}
      </div>
      <button type="button" class="hl-star ${t.focus ? 'is-on' : ''}" data-star="${t.id}" ${closed ? 'disabled' : ''}
        aria-label="${t.focus ? 'Remove from' : 'Add to'} this week's focus" title="This week's focus">${t.focus ? '★' : '☆'}</button>
    </li>`;
}

function option(value, label, current) {
  return `<option value="${value}" ${String(current ?? '') === value ? 'selected' : ''}>${label}</option>`;
}

function taskEditor(t) {
  const anchor = t.anchor_id ? keyDateById().get(t.anchor_id) : null;
  return `
    <form class="task-editor hl-editor mt-3" data-id="${t.id}">
      <label class="hl-field"><span>Title</span>
        <input name="title" class="hl-input w-full" value="${esc(t.title)}" required maxlength="300"></label>
      <div class="hl-editor-grid">
        <label class="hl-field"><span>Status</span>
          <select name="status" class="hl-input">
            ${option('todo', 'To do', t.status)}${option('doing', 'In progress', t.status)}${option('waiting', 'Waiting on someone', t.status)}
            ${option('done', 'Done', t.status)}${option('dropped', 'Dropped', t.status)}
          </select></label>
        <label class="hl-field"><span>Waiting on</span>
          <input name="waiting_on" class="hl-input" value="${esc(t.waiting_on || '')}" placeholder="e.g. Expatlaw's quote" maxlength="120"></label>
        <label class="hl-field"><span>Owner</span>
          <select name="owner" class="hl-input">
            ${option('both', 'Both of us', t.owner)}${option('michael', 'Michael', t.owner)}${option('mer', 'Mer', t.owner)}
          </select></label>
        <label class="hl-field"><span>Lead (when it's both)</span>
          <select name="lead" class="hl-input">
            ${option('', 'Nobody yet', t.lead)}${option('michael', 'Michael', t.lead)}${option('mer', 'Mer', t.lead)}
          </select></label>
        <label class="hl-field"><span>Starts</span>
          <input type="date" name="start_date" class="hl-input" value="${t.start_date || ''}"></label>
        <label class="hl-field"><span>Due</span>
          <input type="date" name="due_date" class="hl-input" value="${t.due_date || ''}"></label>
        <label class="hl-field"><span>Show dates as</span>
          <select name="date_precision" class="hl-input">
            ${option('day', 'Exact days', t.date_precision)}${option('month', 'Just months', t.date_precision)}
          </select></label>
        <label class="hl-field"><span>Repeats</span>
          <select name="repeat" class="hl-input">
            ${option('', 'No', t.repeat)}${option('weekly', 'Weekly (Sundays)', t.repeat)}
            ${option('monthly', 'Monthly', t.repeat)}${option('quarterly', 'Quarterly', t.repeat)}
          </select></label>
        <label class="hl-field"><span>Repeats until</span>
          <input type="date" name="repeat_until" class="hl-input" value="${t.repeat_until || ''}"></label>
        <label class="hl-field"><span>Link (quote, listing, folder)</span>
          <input type="url" name="link_url" class="hl-input" value="${esc(t.link_url || '')}" placeholder="https://"></label>
      </div>
      <label class="flex items-center gap-2 text-sm hl-dim mt-3">
        <input type="checkbox" name="critical" ${t.critical ? 'checked' : ''}> Critical: the move slips if this does</label>
      <label class="hl-field mt-3"><span>Notes</span>
        <textarea name="notes" rows="3" class="hl-input w-full" maxlength="2000">${esc(t.notes || '')}</textarea></label>
      ${anchor ? `<p class="text-xs hl-muted mt-2">📌 Pinned to ${esc(anchor.title)}: its dates move when that date moves.</p>` : ''}
      <div class="flex items-center gap-3 mt-3">
        <button type="submit" class="hl-button">Save</button>
        <button type="button" class="hl-back" data-action="close-editor">Cancel</button>
      </div>
    </form>`;
}

// Only the fields that actually changed go in the PATCH.
function changedFields(form, t) {
  const text = (name) => form[name].value.trim() || null;
  const values = {
    title: form.title.value.trim(),
    status: form.status.value,
    waiting_on: text('waiting_on'),
    owner: form.owner.value,
    lead: form.lead.value || null,
    start_date: form.start_date.value || null,
    due_date: form.due_date.value || null,
    date_precision: form.date_precision.value,
    repeat: form.repeat.value || null,
    repeat_until: form.repeat_until.value || null,
    link_url: text('link_url'),
    critical: form.critical.checked,
    notes: text('notes'),
  };
  const patch = {};
  for (const [field, value] of Object.entries(values)) {
    if ((t[field] ?? null) !== value) patch[field] = value;
  }
  return patch;
}

async function saveTask(id, patch, successMessage) {
  try {
    const result = await api('PATCH', `/api/tasks/${id}`, patch);
    if (result.rolled) {
      flash(`Done ${result.task.times_done}×. Next one: ${dayLabel(result.task.due_date, data.today)}.`);
    } else if (successMessage) {
      flash(successMessage);
    }
    await load();
    return true;
  } catch (err) {
    flash(err.message, true);
    return false;
  }
}

function taskList(tasks, list, empty) {
  if (tasks.length === 0) return empty ? `<p class="text-sm hl-muted py-2">${empty}</p>` : '';
  return `<ul class="hl-divide">${tasks.map((t) => taskRow(t, list)).join('')}</ul>`;
}

// --- The Summit agenda -------------------------------------------------------

function renderAgenda() {
  const tasks = taskById();
  const pick = (ids) => ids.map((id) => tasks.get(id)).filter((t) => t && belongsTo(t, person));
  const sections = [
    ['focus', "⭐ This week's focus", 'Nothing starred yet. Pick up to three at the Summit.'],
    ['overdue', 'Overdue', null],
    ['next_30', 'Now and in the next 30 days', 'Nothing started or due in the next 30 days.'],
    ['waiting', 'Waiting on someone', null],
    ['done_recently', 'Done in the last 7 days', null],
  ];
  let html = '';
  for (const [key, title, empty] of sections) {
    const list = pick(data.agenda[key]);
    if (list.length === 0 && !empty) continue;
    html += `<h3 class="hl-agenda-title">${title} <span class="hl-muted">${list.length || ''}</span></h3>${taskList(list, key, empty)}`;
  }

  const decisions = data.agenda.decisions_due.map((id) => data.decisions.find((d) => d.id === id));
  if (decisions.length) {
    html += `<h3 class="hl-agenda-title">Decisions coming up <span class="hl-muted">${decisions.length}</span></h3>
      <ul class="hl-divide">${decisions
        .map(
          (d) => `<li class="py-2 text-sm">
            <a href="#decision-${esc(d.code)}" data-jump="${d.id}"><span class="hl-code">${esc(d.code)}</span> ${esc(d.question)}</a>
            <span class="text-xs ${d.days_left < 14 ? 'hl-up' : 'hl-muted'}"> · decide by ${dayLabel(d.decide_by, data.today)} (${daysLeftLabel(d.days_left)})</span>
            ${d.warnings.length ? '<span class="text-xs hl-up"> · ⚠ check its inputs</span>' : ''}
          </li>`
        )
        .join('')}</ul>`;
  }
  $('agenda').innerHTML = html;
}

// --- Decisions -------------------------------------------------------------

function optionsBlock(d) {
  if (editingOptionsFor === d.id) {
    const rows = [...d.options, { name: '', cost: '', link: '', notes: '' }];
    return `
      <form class="options-form mt-3" data-id="${d.id}">
        <p class="text-xs hl-muted mb-2">One row per option. Leave a name empty to remove that row.</p>
        ${rows
          .map(
            (o) => `<div class="hl-option-row">
              <input name="name" class="hl-input" placeholder="Option" value="${esc(o.name)}" maxlength="100">
              <input name="cost" class="hl-input" placeholder="Cost" value="${esc(o.cost)}" maxlength="60">
              <input name="link" class="hl-input" placeholder="Link" value="${esc(o.link)}" maxlength="500">
              <input name="notes" class="hl-input" placeholder="Notes" value="${esc(o.notes)}" maxlength="500">
            </div>`
          )
          .join('')}
        <div class="flex gap-3 mt-2"><button type="submit" class="hl-button">Save options</button>
        <button type="button" class="hl-back" data-action="close-options">Cancel</button></div>
      </form>`;
  }
  const list = d.options.length
    ? `<ul class="mt-1 space-y-1">${d.options
        .map(
          (o) => `<li class="text-sm hl-dim">• ${esc(o.name)}${o.cost ? ` <span class="hl-muted">· ${esc(o.cost)}</span>` : ''}
            ${o.link ? ` · <a href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">link ↗</a>` : ''}
            ${o.notes ? `<span class="block text-xs hl-muted ml-3">${esc(o.notes)}</span>` : ''}</li>`
        )
        .join('')}</ul>`
    : '<p class="text-sm hl-muted mt-1">No options listed yet.</p>';
  return `<div class="mt-3"><p class="hl-label">Options</p>${list}
    <button type="button" class="hl-link text-xs mt-1" data-edit-options="${d.id}">${d.options.length ? 'Edit options' : 'Add options'}</button></div>`;
}

function decisionCard(d) {
  const tasks = taskById();
  const keyDate = d.key_date_id ? keyDateById().get(d.key_date_id) : null;
  const inputs = d.input_task_ids.map((id) => tasks.get(id)).filter(Boolean);
  const decided = d.status === 'decided';
  const summaryWhen = decided
    ? `<span class="hl-chip hl-chip-done">decided</span>`
    : `<span class="text-xs ${d.days_left !== null && d.days_left < 14 ? 'hl-up' : 'hl-muted'}">by ${d.decide_by ? `${dayLabel(d.decide_by, data.today)} · ${daysLeftLabel(d.days_left)}` : 'no date'}</span>`;

  const body = decided
    ? `<div class="mt-3">
        <p class="hl-label">Decided ${d.decided_on ? dayLabel(d.decided_on, data.today) : ''}${d.decided_by ? ` · ${d.decided_by === 'both' ? 'both of us' : PEOPLE[d.decided_by].label}` : ''}</p>
        <p class="hl-dim mt-1 whitespace-pre-line">${esc(d.outcome)}</p>
        <button type="button" class="hl-back mt-2" data-reopen="${d.id}">Reopen</button>
      </div>`
    : `<form class="decision-form mt-4" data-id="${d.id}">
        <label class="hl-field"><span>What did you decide?</span>
          <textarea name="outcome" rows="2" class="hl-input w-full" required maxlength="2000"></textarea></label>
        <div class="flex flex-wrap items-end gap-3 mt-2">
          <label class="hl-field"><span>Decided by</span>
            <select name="decided_by" class="hl-input">${option('both', 'Both of us', 'both')}${option('michael', 'Michael', '')}${option('mer', 'Mer', '')}</select></label>
          ${
            keyDate
              ? `<label class="hl-field"><span>${esc(keyDate.title)}</span>
                  <input type="date" name="key_date" class="hl-input" value="${keyDate.date}" required></label>`
              : ''
          }
          <button type="submit" class="hl-button">Record decision</button>
        </div>
        ${keyDate ? `<p class="text-xs hl-muted mt-2">Recording this confirms ${esc(keyDate.title)}. Change the date and its ${keyDate.pinned_open_tasks} pinned tasks move with it.</p>` : ''}
      </form>`;

  return `
    <details class="hl-inset hl-details" id="decision-${esc(d.code)}" data-details="decision:${d.id}" ${openDetails.has(`decision:${d.id}`) ? 'open' : ''}>
      <summary class="flex items-center gap-2 flex-wrap">
        <span class="hl-code">${esc(d.code)}</span>
        <span class="hl-dim font-semibold">${esc(d.question)}</span>
        ${summaryWhen}
        ${d.warnings.length ? '<span class="text-xs hl-up">⚠</span>' : ''}
      </summary>
      ${d.notes ? `<p class="text-sm hl-muted mt-3 whitespace-pre-line">${esc(d.notes)}</p>` : ''}
      ${d.warnings.map((w) => `<p class="text-xs hl-up mt-2">⚠ ${esc(w)}</p>`).join('')}
      ${optionsBlock(d)}
      ${
        inputs.length
          ? `<div class="mt-3"><p class="hl-label">Needs first</p><ul class="mt-1 space-y-1">${inputs
              .map(
                (t) => `<li class="text-sm ${t.status === 'done' ? 'hl-muted line-through' : 'hl-dim'}">
                  <span class="hl-code">${esc(t.code)}</span> ${esc(t.title)}
                  <span class="text-xs hl-muted">· ${esc(whenLabel(t, data.today))}</span></li>`
              )
              .join('')}</ul></div>`
          : ''
      }
      ${body}
    </details>`;
}

function renderDecisions() {
  $('decisions').innerHTML = data.decisions.map(decisionCard).join('');
}

// --- Workstreams -------------------------------------------------------------

function sortForList(a, b) {
  const closed = (t) => (t.status === 'done' || t.status === 'dropped' ? 1 : 0);
  if (closed(a) !== closed(b)) return closed(a) - closed(b);
  if ((a.due_date || '9999') !== (b.due_date || '9999')) return (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1;
  return (a.code || '').localeCompare(b.code || '');
}

function renderWorkstreams() {
  const today = data.today;
  $('workstreams').innerHTML = data.workstreams
    .map((w) => {
      const all = data.tasks.filter((t) => t.workstream_id === w.id);
      const tasks = all.filter((t) => belongsTo(t, person)).sort(sortForList);
      const done = all.filter((t) => t.status === 'done').length;
      const live = all.filter((t) => t.status !== 'dropped').length;
      const overdue = all.filter((t) => isOverdue(t, today)).length;
      const key = `ws:${w.id}`;
      return `
        <details class="hl-inset hl-details" data-details="${key}" ${openDetails.has(key) ? 'open' : ''}>
          <summary class="flex items-center gap-2 flex-wrap">
            <span class="hl-dim font-semibold">${esc(w.name)}</span>
            <span class="text-xs hl-muted">${w.lead ? `${PEOPLE[w.lead].label} leads` : 'no lead yet'} · ${done}/${live} done</span>
            ${overdue ? `<span class="text-xs hl-up">${overdue} overdue</span>` : ''}
          </summary>
          <label class="hl-field mt-3 inline-flex">
            <span>Lead</span>
            <select class="hl-input" data-workstream-lead="${w.id}">
              ${option('', 'Nobody yet', w.lead)}${option('michael', 'Michael', w.lead)}${option('mer', 'Mer', w.lead)}
            </select>
          </label>
          ${taskList(tasks, key, person === 'all' ? 'No tasks yet.' : `Nothing here on ${PEOPLE[person].label}'s list.`)}
          <form class="add-task flex flex-wrap gap-2 mt-3" data-workstream="${esc(w.key)}">
            <input name="title" class="hl-input flex-1 min-w-[12rem]" placeholder="Add a task to ${esc(w.name)}" maxlength="300" required>
            <select name="owner" class="hl-input">${option('both', 'Both', 'both')}${option('michael', 'Michael', '')}${option('mer', 'Mer', '')}</select>
            <input type="date" name="due_date" class="hl-input" aria-label="Due date">
            <button type="submit" class="hl-button">Add</button>
          </form>
        </details>`;
    })
    .join('');
}

// --- Events (delegated, since everything re-renders after each change) -------

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button, a');
  if (!target || !data) return;

  if (target.dataset.person) {
    person = target.dataset.person;
    MoveShared.setPerson(person);
    render();
  } else if (target.dataset.open) {
    openEditor = openEditor === target.dataset.open ? null : target.dataset.open;
    render();
  } else if (target.dataset.action === 'close-editor') {
    openEditor = null;
    render();
  } else if (target.dataset.star) {
    const task = taskById().get(target.dataset.star);
    const focused = data.tasks.filter((t) => t.focus && t.status !== 'done' && t.status !== 'dropped').length;
    if (!task.focus && focused >= MAX_FOCUS) {
      flash(`Three is the limit. Unstar one first.`, true);
      return;
    }
    await saveTask(task.id, { focus: !task.focus });
  } else if (target.dataset.keyDate) {
    const k = data.key_dates.find((x) => x.id === target.dataset.keyDate);
    editingKeyDate = editingKeyDate?.id === k.id ? null : { id: k.id, date: k.date, preview: null };
    renderKeyDates();
  } else if (target.dataset.action === 'close-key-date') {
    editingKeyDate = null;
    renderKeyDates();
  } else if (target.dataset.action === 'edit-why') {
    editingWhy = true;
    renderWhy();
  } else if (target.dataset.action === 'cancel-why') {
    editingWhy = false;
    renderWhy();
  } else if (target.dataset.editOptions) {
    editingOptionsFor = target.dataset.editOptions;
    renderDecisions();
  } else if (target.dataset.action === 'close-options') {
    editingOptionsFor = null;
    renderDecisions();
  } else if (target.dataset.reopen) {
    try {
      await api('PATCH', `/api/decisions/${target.dataset.reopen}`, { status: 'open' });
      flash('Reopened.');
      await load();
    } catch (err) {
      flash(err.message, true);
    }
  } else if (target.dataset.jump) {
    openDetails.add(`decision:${target.dataset.jump}`);
    renderDecisions();
  }
});

document.addEventListener('change', async (event) => {
  const el = event.target;
  if (el.classList.contains('task-done')) {
    await saveTask(el.dataset.id, { status: el.checked ? 'done' : 'todo' });
  } else if (el.dataset.workstreamLead !== undefined) {
    try {
      const result = await api('PATCH', `/api/workstreams/${el.dataset.workstreamLead}`, { lead: el.value || null });
      flash(result.tasks_updated ? `Lead set, and ${result.tasks_updated} shared tasks now have that lead.` : 'Lead set.');
      await load();
    } catch (err) {
      flash(err.message, true);
    }
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;
  try {
    if (form.classList.contains('task-editor')) {
      const task = taskById().get(form.dataset.id);
      const patch = changedFields(form, task);
      if (Object.keys(patch).length === 0) {
        openEditor = null;
        render();
        return;
      }
      if (await saveTask(task.id, patch, 'Saved.')) openEditor = null;
      render();
    } else if (form.id === 'key-date-form') {
      await submitKeyDate(form);
    } else if (form.id === 'why-form') {
      const result = await api('PATCH', `/api/projects/${SLUG}`, { why: form.why.value });
      data.project = { ...data.project, ...result.project };
      editingWhy = false;
      renderWhy();
    } else if (form.classList.contains('options-form')) {
      const options = [...form.querySelectorAll('.hl-option-row')]
        .map((row) => Object.fromEntries(['name', 'cost', 'link', 'notes'].map((n) => [n, row.querySelector(`[name="${n}"]`).value.trim()])))
        .filter((o) => o.name);
      await api('PATCH', `/api/decisions/${form.dataset.id}`, { options });
      editingOptionsFor = null;
      flash('Options saved.');
      await load();
    } else if (form.classList.contains('decision-form')) {
      const body = { status: 'decided', outcome: form.outcome.value, decided_by: form.decided_by.value };
      if (form.key_date) body.key_date = form.key_date.value;
      const result = await api('PATCH', `/api/decisions/${form.dataset.id}`, body);
      const shifted = result.moved?.tasks_shifted;
      flash(shifted ? `Recorded. ${shifted} pinned tasks moved with the date.` : 'Recorded. It is in the decision log.');
      await load();
    } else if (form.classList.contains('add-task')) {
      await api('POST', `/api/projects/${SLUG}/tasks`, {
        workstream: form.dataset.workstream,
        title: form.title.value,
        owner: form.owner.value,
        due_date: form.due_date.value || null,
      });
      flash('Added.');
      await load();
    }
  } catch (err) {
    flash(err.message, true);
  } finally {
    if (button && document.body.contains(button)) button.disabled = false;
  }
});

// Remember which workstreams and decisions are open across re-renders.
document.addEventListener(
  'toggle',
  (event) => {
    const key = event.target.dataset?.details;
    if (!key) return;
    if (event.target.open) openDetails.add(key);
    else openDetails.delete(key);
  },
  true
);

// Both of us edit the same plan, so pick up the other's changes when the
// page comes back into view, unless something is mid-edit.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !openEditor && !editingKeyDate && !editingWhy && !editingOptionsFor) load();
});

load();
