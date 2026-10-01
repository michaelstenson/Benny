// Browser-side JS for /projects.html (Stage 22). No ?project= shows every
// project; ?project=<slug> shows one project's milestones and decisions.

const PERSON_COLOR = { michael: '#34D399', mer: '#A78BFA' };
const PERSON_NAME = { michael: 'Michael', mer: 'Mer' };
const slug = new URLSearchParams(location.search).get('project');

const $ = (id) => document.getElementById(id);
const errorEl = $('error');

function showError(message) {
  errorEl.textContent = message || '';
  errorEl.classList.toggle('hidden', !message);
}

async function api(method, url, body) {
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showError(data.error || 'Something went wrong.');
      return null;
    }
    showError('');
    return data;
  } catch (err) {
    showError(`Could not reach the backend: ${err.message}`);
    return null;
  }
}

function dot(owner) {
  const color = PERSON_COLOR[owner];
  if (!color) return '';
  return `<span class="hl-dot" style="background:${color};box-shadow:0 0 6px ${color};" title="${owner}"></span>`;
}

function formatDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

const todayChicago = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

// --- List view ---

function projectRow(p) {
  const bits = [`${p.milestones_done}/${p.milestones_total} milestones`];
  if (p.milestones_overdue) bits.push(`<span class="hl-up">${p.milestones_overdue} overdue</span>`);
  if (p.open_decisions) bits.push(`${p.open_decisions} open decision${p.open_decisions === 1 ? '' : 's'}`);
  if (p.target_date) bits.push(`target ${formatDate(p.target_date)}`);
  if (p.status !== 'active') bits.push(p.status);
  return `
    <li class="py-3">
      <a href="?project=${encodeURIComponent(p.slug)}" class="block ${p.status === 'active' ? '' : 'opacity-50'}">
        <p class="hl-dim">${escapeHtml(p.name)}</p>
        <p class="text-xs hl-muted mt-0.5">${bits.join(' · ')}</p>
      </a>
    </li>`;
}

async function loadList() {
  const data = await api('GET', '/api/projects');
  $('list-loading').classList.add('hidden');
  if (!data) return;
  $('project-list').innerHTML = data.projects.length
    ? data.projects.map(projectRow).join('')
    : '<li class="py-4 hl-muted text-sm">No projects yet — add one below.</li>';
}

$('new-project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('new-project-name').value.trim();
  if (!name) return;
  const data = await api('POST', '/api/projects', { name });
  if (data) location.search = `?project=${encodeURIComponent(data.project.slug)}`;
});

// --- Detail view ---

let current = null; // { project, milestones, decisions }

function milestoneRow(m, byId) {
  const done = m.status === 'done';
  const waitingOn = m.depends_on.map((id) => byId.get(id)).filter(Boolean);
  const overdue = !done && m.due_date && m.due_date < todayChicago();
  const bits = [];
  if (m.due_date) bits.push(`${overdue ? 'Overdue' : 'Due'} ${formatDate(m.due_date)}`);
  if (m.owner) bits.push(PERSON_NAME[m.owner]);
  if (waitingOn.length) {
    bits.push(`${m.blocked ? '⏳ waiting on' : 'after'} ${waitingOn.map((w) => escapeHtml(w.title)).join(', ')}`);
  }
  if (m.source === 'agent') bits.push('via Benny 🐧');
  return `
    <li class="py-3 flex items-start gap-3">
      <input type="checkbox" data-id="${m.id}" ${done ? 'checked' : ''} class="mt-1 milestone-checkbox" />
      ${dot(m.owner)}
      <div class="flex-1 ${done ? 'opacity-40 line-through' : ''}">
        <p class="${overdue ? 'hl-up' : 'hl-dim'}">${escapeHtml(m.title)}</p>
        ${bits.length ? `<p class="text-xs hl-muted mt-0.5">${bits.join(' · ')}</p>` : ''}
      </div>
      <button type="button" data-delete-milestone="${m.id}" class="hl-back text-xs" title="Delete milestone">✕</button>
    </li>`;
}

function decisionRow(d) {
  const open = d.status === 'open';
  return `
    <li class="py-3">
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <p class="hl-dim">${open ? '❓' : '✅'} ${escapeHtml(d.question)}</p>
          ${open ? '' : `<p class="text-sm mt-1 whitespace-pre-line">${escapeHtml(d.outcome)}</p>`}
          <p class="text-xs hl-muted mt-0.5">${open ? 'Still open' : `Decided ${formatDate(d.decided_on)}`}${d.source === 'agent' ? ' · via Benny 🐧' : ''}</p>
        </div>
        <button type="button" data-delete-decision="${d.id}" class="hl-back text-xs" title="Delete decision">✕</button>
      </div>
      <div class="mt-1">
        ${open
          ? `<button type="button" data-decide="${d.id}" class="hl-back text-xs">Record the decision</button>`
          : `<button type="button" data-reopen="${d.id}" class="hl-back text-xs">Reopen</button>`}
      </div>
    </li>`;
}

function renderDetail() {
  const { project, milestones, decisions } = current;
  const byId = new Map(milestones.map((m) => [m.id, m]));

  $('page-title').textContent = project.name;
  document.title = `Benny — ${project.name}`;
  $('back-link').textContent = '← projects';

  const done = milestones.filter((m) => m.status === 'done').length;
  $('project-meta').textContent = [
    project.status !== 'active' ? project.status : null,
    `${done}/${milestones.length} milestones`,
    project.target_date ? `target ${formatDate(project.target_date)}` : null,
  ].filter(Boolean).join(' · ');
  $('project-description').textContent = project.description || '';

  // Open milestones first (already ordered by due date), done ones last.
  const ordered = [...milestones.filter((m) => m.status !== 'done'), ...milestones.filter((m) => m.status === 'done')];
  $('milestones').innerHTML = ordered.length
    ? ordered.map((m) => milestoneRow(m, byId)).join('')
    : '<li class="py-3 hl-muted text-sm">No milestones yet.</li>';

  $('milestone-depends').innerHTML =
    '<option value="">Doesn\'t wait on anything</option>' +
    milestones
      .filter((m) => m.status !== 'done')
      .map((m) => `<option value="${m.id}">After: ${escapeHtml(m.title)}</option>`)
      .join('');

  const openFirst = [...decisions.filter((d) => d.status === 'open'), ...decisions.filter((d) => d.status !== 'open')];
  $('decisions').innerHTML = openFirst.length
    ? openFirst.map(decisionRow).join('')
    : '<li class="py-3 hl-muted text-sm">Nothing logged yet.</li>';

  $('toggle-status').textContent = project.status === 'active' ? 'Archive (mark done)' : 'Reactivate';
}

async function loadDetail() {
  const data = await api('GET', `/api/projects/${encodeURIComponent(slug)}`);
  if (!data) return;
  current = data;
  renderDetail();
}

$('milestones').addEventListener('click', async (event) => {
  const del = event.target.closest('[data-delete-milestone]');
  if (del && confirm('Delete this milestone?')) {
    if (await api('DELETE', `/api/milestones/${del.dataset.deleteMilestone}`)) loadDetail();
  }
});
$('milestones').addEventListener('change', async (event) => {
  if (!event.target.classList.contains('milestone-checkbox')) return;
  await api('PATCH', `/api/milestones/${event.target.dataset.id}`, {
    status: event.target.checked ? 'done' : 'open',
  });
  loadDetail();
});

$('milestone-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = $('milestone-title').value.trim();
  if (!title) return;
  const body = { title, owner: $('milestone-owner').value || null, due_date: $('milestone-due').value || null };
  const dep = $('milestone-depends').value;
  if (dep) body.depends_on = [dep];
  if (await api('POST', `/api/projects/${encodeURIComponent(slug)}/milestones`, body)) {
    event.target.reset();
    loadDetail();
  }
});

$('decision-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = $('decision-question').value.trim();
  if (!question) return;
  if (await api('POST', `/api/projects/${encodeURIComponent(slug)}/decisions`, { question })) {
    event.target.reset();
    loadDetail();
  }
});

$('decisions').addEventListener('click', async (event) => {
  const decide = event.target.closest('[data-decide]');
  const reopen = event.target.closest('[data-reopen]');
  const del = event.target.closest('[data-delete-decision]');
  if (decide) {
    const outcome = prompt('What was decided?');
    if (outcome && outcome.trim() && (await api('PATCH', `/api/decisions/${decide.dataset.decide}`, { outcome }))) loadDetail();
  } else if (reopen) {
    if (await api('PATCH', `/api/decisions/${reopen.dataset.reopen}`, { outcome: null })) loadDetail();
  } else if (del && confirm('Delete this decision?')) {
    if (await api('DELETE', `/api/decisions/${del.dataset.deleteDecision}`)) loadDetail();
  }
});

$('edit-project').addEventListener('click', async () => {
  const { project } = current;
  const name = prompt('Project name', project.name);
  if (name === null) return;
  const description = prompt('Description (blank to clear)', project.description || '');
  if (description === null) return;
  const target = prompt('Target date, YYYY-MM-DD (blank for none)', project.target_date || '');
  if (target === null) return;
  const data = await api('PATCH', `/api/projects/${encodeURIComponent(slug)}`, {
    name, description: description.trim() || null, target_date: target.trim() || null,
  });
  if (data) loadDetail();
});

$('toggle-status').addEventListener('click', async () => {
  const status = current.project.status === 'active' ? 'done' : 'active';
  if (await api('PATCH', `/api/projects/${encodeURIComponent(slug)}`, { status })) loadDetail();
});

// Two people (and Benny) edit these — pick up changes when the page returns.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') (slug ? loadDetail() : loadList());
});

if (slug) {
  $('list-view').classList.add('hidden');
  $('detail-view').classList.remove('hidden');
  loadDetail();
} else {
  $('back-link').href = '/';
  loadList();
}
