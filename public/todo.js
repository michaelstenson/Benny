// To-Do (Oct 2026): chores, groceries and any other list in one place,
// laid out like Microsoft To Do. One request (GET /api/todos) brings every
// list, every open to-do, the last month's finished ones and the open move
// tasks with a date; My Day, Important, Planned and the Michael/Mer views
// are worked out here from that. Today's calendar and weather for My Day
// come from /api/digest.
//
// Move tasks belong to the move tracker. Here they can be ticked off or
// starred (the star is the tracker's "this week's focus"), through the
// tracker's own PATCH /api/tasks/:id, and everything else links there.

const $ = (id) => document.getElementById(id);
const esc = window.escapeHtml;
const { PEOPLE, belongsTo, getPerson, setPerson } = window.MoveShared;

const VIEW_KEY = 'benny.todo.view';
const COUNT_DAYS = 30; // sidebar counts for dated views look this far ahead
const DEFAULT_LIST = 'chores';
const phone = window.matchMedia('(max-width: 760px)');

const SMART = {
  myday: { icon: '☀️', name: 'My Day' },
  important: { icon: '⭐', name: 'Important' },
  planned: { icon: '📅', name: 'Planned' },
  michael: { person: 'michael', name: 'Michael' },
  mer: { person: 'mer', name: 'Mer' },
};

let data = null; // { today, lists, todos, move_tasks }
let day = null; // { events, weather } from the digest, or null if it failed
const state = {
  view: storedView(),
  selected: null,
  folded: { done: true, later: true },
  hint: '',
  settingsOpen: false,
  newList: false,
  adding: false,
};

// --- Small helpers ----------------------------------------------------------

function storedView() {
  try {
    return localStorage.getItem(VIEW_KEY) || 'myday';
  } catch {
    return 'myday';
  }
}

function rememberView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not remembered; it opens on My Day next time.
  }
}

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
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "Today", "Tomorrow", "Thu, Oct 22", or "Sep 18, 2027" in another year.
function dateLabel(date) {
  const today = data.today;
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  const options = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (date.slice(0, 4) !== today.slice(0, 4)) {
    delete options.weekday;
    options.year = 'numeric';
  }
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, options);
}

function dot(person, size = 'sm') {
  const { color } = PEOPLE[person];
  return `<span class="hl-dot ${size === 'sm' ? 'hl-dot-sm' : ''}" style="background:${color};box-shadow:0 0 6px ${color};"></span>`;
}

// --- What's in each view ----------------------------------------------------

const isMove = (item) => item.kind === 'move';
const isOpen = (item) => isMove(item) || !item.done;
const starred = (item) => (isMove(item) ? item.focus : item.important);
const late = (item) => isOpen(item) && item.due_date && item.due_date < data.today;
const inMyDay = (todo) => todo.my_day === data.today || todo.due_date === data.today;
const listOf = (slug) => data.lists.find((l) => l.slug === slug);

// A move task shared by both of us is its lead's, or both of ours if it
// has no lead yet (the Move page's rule).
function people(item) {
  if (isMove(item)) return ['michael', 'mer'].filter((p) => belongsTo(item, p));
  return item.assignee ? [item.assignee] : [];
}

function allItems() {
  return [...data.todos, ...data.move_tasks];
}

function find(id) {
  return allItems().find((item) => item.id === id);
}

function inView(view, item) {
  if (view === 'myday') return !isMove(item) && !item.done && inMyDay(item);
  if (view === 'important') return isOpen(item) && starred(item);
  if (view === 'planned') return isOpen(item) && Boolean(item.due_date);
  if (SMART[view]?.person) return isOpen(item) && people(item).includes(view);
  return !isMove(item) && item.list === view;
}

// Far-off dated things still show in Planned and the person views (under
// "Later"), but only the next 30 days count toward the number beside them.
function counts(view) {
  const horizon = addDays(data.today, COUNT_DAYS);
  const dated = view === 'planned' || Boolean(SMART[view]?.person);
  const items = allItems().filter(
    (item) => inView(view, item) && isOpen(item) && (!dated || !item.due_date || item.due_date <= horizon)
  );
  return { n: items.length, late: items.some(late) };
}

const byDue = (a, b) =>
  (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.created_at || '').localeCompare(b.created_at || '');

// --- Rendering --------------------------------------------------------------

function render() {
  if (!data) return;
  if (!SMART[state.view] && !listOf(state.view)) state.view = 'myday';
  if (state.selected && !find(state.selected)) {
    // Finished or deleted while open: back to its list.
    state.selected = null;
    if ($('app').dataset.screen === 'detail') $('app').dataset.screen = 'list';
  }

  // Re-rendering replaces the add box; keep what's being typed in it.
  const input = $('add-input');
  const typed = input ? input.value : '';
  const typing = document.activeElement === input;

  renderNav();
  renderMain();
  renderDetail();

  const fresh = $('add-input');
  if (fresh) {
    fresh.value = typed;
    if (typing) fresh.focus();
  }
}

function renderNav() {
  const item = (key, icon, name) => {
    const c = counts(key);
    return `<button class="hl-todo-nav-item ${state.view === key ? 'is-active' : ''}" data-view="${esc(key)}">
      <span class="hl-todo-icon">${icon}</span>${esc(name)}
      ${c.n ? `<span class="hl-todo-count ${c.late ? 'is-late' : ''}">${c.n}</span>` : ''}</button>`;
  };
  const device = getPerson();
  const seg = (p, label) =>
    `<button data-device="${p}" class="${device === p ? 'is-on' : ''}" style="--seg:${PEOPLE[p] ? PEOPLE[p].color : 'var(--hl-gold)'}">${label}</button>`;

  $('nav').innerHTML = `
    <div class="hl-todo-brand">
      <a href="/" class="hl-logo" aria-label="Home">
        <svg width="16" height="20" viewBox="0 0 100 122" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M76 46C90 52 94 66 90 78C82 74 72 66 68 56L76 46Z" fill="#F4ECD8"/><path d="M50 8C66 8 76 26 76 46V96C76 110 64 118 50 118C36 118 24 110 24 96V46C24 26 34 8 50 8Z" fill="#F4ECD8"/><path d="M50 30C58 30 62 42 62 54V100C62 108 57 112 50 112C43 112 38 108 38 100V54C38 42 42 30 50 30Z" fill="#211F2B"/><path d="M67 13L98 23L67 33Z" fill="#F2C879"/><circle cx="59" cy="18" r="3.4" fill="#211F2B"/></svg>
      </a>
      <div><div class="hl-h1" style="font-size:19px">To-Do</div><a href="/" class="hl-back">← home</a></div>
    </div>
    ${item('myday', '☀️', 'My Day')}
    ${item('important', '⭐', 'Important')}
    ${item('planned', '📅', 'Planned')}
    ${item('michael', dot('michael', 'md'), 'Michael')}
    ${item('mer', dot('mer', 'md'), 'Mer')}
    <div class="hl-todo-sep"></div>
    ${data.lists.map((l) => item(l.slug, esc(l.emoji || '📋'), l.name)).join('')}
    ${state.newList
      ? `<form class="hl-todo-new-form" id="new-list-form"><input class="hl-input" id="new-list-name" maxlength="40" placeholder="List name" autocomplete="off" /><button class="hl-button" style="padding:7px 12px">Add</button></form>`
      : '<button class="hl-todo-nav-item hl-todo-new" data-new-list><span class="hl-todo-icon">＋</span>New list</button>'}
    <div class="hl-todo-sep"></div>
    <div class="hl-label">Linked</div>
    <a class="hl-todo-nav-item" href="/move.html"><span class="hl-todo-icon">🇳🇱</span>Netherlands move<span class="hl-todo-count">↗</span></a>
    <div class="hl-todo-device"><span>Typing as</span><span class="hl-todo-seg">${seg('michael', 'Michael')}${seg('mer', 'Mer')}${seg('all', 'Either')}</span></div>`;

  if (state.newList) $('new-list-name').focus();
}

function metaFor(item, view) {
  const meta = [];
  if (isMove(item)) meta.push(`<span class="hl-todo-tag">Move · ${esc(item.code || '')}</span>`);
  else if (SMART[view]) {
    const list = listOf(item.list);
    if (list) meta.push(`<span>${esc(list.emoji || '📋')} ${esc(list.name)}</span>`);
  }
  if (!isMove(item) && item.my_day === data.today && view !== 'myday' && isOpen(item)) meta.push('<span>☀️ My Day</span>');
  if (item.due_date) {
    const cls = late(item) ? 'is-late' : item.due_date === data.today ? 'is-today' : '';
    meta.push(`<span class="${cls}">${late(item) ? 'Overdue · ' : ''}${dateLabel(item.due_date)}</span>`);
  }
  if (item.repeat) meta.push(`<span>🔁 ${esc(item.repeat)}</span>`);
  if (item.steps?.length) meta.push(`<span>${item.steps.filter((s) => s.done).length} of ${item.steps.length}</span>`);
  if (item.notes) meta.push('<span title="Has a note">📝</span>');
  const ppl = people(item);
  if (ppl.length && !(ppl.length === 1 && view === ppl[0])) {
    const leads = isMove(item) && item.owner === 'both' && item.lead ? ' leads' : '';
    const label = ppl.length === 2 ? 'Both' : PEOPLE[ppl[0]].label + leads;
    meta.push(`<span class="hl-todo-who">${ppl.map((p) => dot(p)).join('')}${label}</span>`);
  }
  return meta;
}

function row(item, view, { suggest = false } = {}) {
  const ppl = people(item);
  const color = ppl.length === 1 ? PEOPLE[ppl[0]].color : null;
  const meta = metaFor(item, view);
  const done = !isOpen(item);
  const starLabel = isMove(item) ? "This week's focus" : 'Important';
  return `<div class="hl-todo-row ${done ? 'is-done' : ''} ${state.selected === item.id ? 'is-selected' : ''}" data-open="${item.id}">
    <button class="hl-todo-check ${done ? 'is-done' : ''}" data-check="${item.id}" ${color ? `style="--who:${color}"` : ''} aria-label="${done ? 'Not done' : 'Done'}">${done ? '✓' : ''}</button>
    <div class="hl-todo-row-body"><div class="hl-todo-title">${esc(item.title)}</div>${meta.length ? `<div class="hl-todo-meta">${meta.join('')}</div>` : ''}</div>
    ${suggest ? `<button class="hl-todo-sun" data-myday="${item.id}" title="Add to My Day">☀️ Add</button>` : ''}
    <button class="hl-star ${starred(item) ? 'is-on' : ''}" data-star="${item.id}" aria-label="${starLabel}" title="${starLabel}">${starred(item) ? '★' : '☆'}</button>
  </div>`;
}

function group(key, label, items, view, { foldable = false, isLate = false, suggest = false, action = '' } = {}) {
  if (!items.length) return '';
  const folded = foldable && state.folded[key];
  const title = `<span class="hl-label">${label} · ${items.length}</span>`;
  return `<section class="hl-todo-group">
    <div class="hl-todo-group-head ${isLate ? 'is-late' : ''}">
      ${foldable ? `<button data-fold="${key}"><span class="hl-todo-caret">${folded ? '▸' : '▾'}</span>${title}</button>` : title}
      ${action}
    </div>
    ${folded ? '' : `<div class="hl-todo-rows">${items.map((item) => row(item, view, { suggest })).join('')}</div>`}
  </section>`;
}

function eventRow(event) {
  const time = event.allDay
    ? 'All day'
    : new Date(event.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const owner = PEOPLE[event.owner];
  return `<div class="hl-todo-row is-event"><span class="hl-todo-time">${esc(time)}</span>
    <div class="hl-todo-row-body"><div class="hl-todo-title">${esc(event.title)}</div>
    ${owner ? `<div class="hl-todo-meta"><span class="hl-todo-who">${dot(event.owner)}${owner.label}'s calendar</span></div>` : ''}</div></div>`;
}

function subtitle(view, list) {
  if (view === 'myday') {
    const date = new Date(`${data.today}T00:00:00Z`).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
    });
    const w = day?.weather;
    return w ? `${date} · ${w.summary}, ${w.high_f}° / ${w.low_f}°` : date;
  }
  if (view === 'important') return 'Starred to-dos, and this week’s focus from the move plan';
  if (view === 'planned') return 'Everything with a date, move tasks included';
  if (SMART[view]?.person) return `${SMART[view].name}’s to-dos, plus move tasks ${SMART[view].name} leads`;
  return list.mode === 'items' ? 'Shared · one item per comma, duplicates skipped' : 'Shared · Benny reads who and when';
}

function addHint(view, list) {
  if (list) {
    return list.mode === 'items'
      ? 'Commas make separate items. Anything already on the list is skipped.'
      : 'Benny reads who and when: “Mer water the plants Thursday”.';
  }
  if (view === 'myday') return 'Lands in Chores and in My Day.';
  if (view === 'important') return 'Lands in Chores, starred.';
  if (view === 'planned') return 'Lands in Chores, due today unless you say when.';
  return `Lands in Chores, for ${SMART[view].name} unless you name someone else.`;
}

function settingsPanel(list) {
  if (!state.settingsOpen) return '';
  return `<form class="hl-todo-settings" id="list-settings">
    <input class="hl-input" id="list-emoji" maxlength="16" value="${esc(list.emoji || '')}" placeholder="📋" aria-label="Emoji" />
    <input class="hl-input" id="list-name" maxlength="40" value="${esc(list.name)}" aria-label="List name" />
    <select class="hl-input" id="list-mode" style="grid-column:1 / -1" aria-label="How adding works">
      <option value="tasks" ${list.mode === 'tasks' ? 'selected' : ''}>Benny reads who and when from what you type</option>
      <option value="items" ${list.mode === 'items' ? 'selected' : ''}>Plain items, one per comma, duplicates skipped</option>
    </select>
    <div class="hl-todo-settings-actions">
      ${[DEFAULT_LIST, 'pets'].includes(list.slug) ? '<span></span>' : '<button type="button" class="hl-link" data-delete-list style="background:none;border:none;font:inherit;font-size:13px;padding:0">Delete list</button>'}
      <button class="hl-button" style="padding:8px 16px">Save</button>
    </div>
  </form>`;
}

function renderMain() {
  const view = state.view;
  const list = listOf(view);
  const meta = SMART[view] || { name: list.name };
  const icon = meta.person
    ? `<span class="hl-dot" style="width:14px;height:14px;background:${PEOPLE[meta.person].color};box-shadow:0 0 10px ${PEOPLE[meta.person].color}"></span>`
    : `<span class="hl-todo-emoji">${esc(meta.icon || list.emoji || '📋')}</span>`;
  const placeholder = list ? (list.mode === 'items' ? 'Add items' : 'Add a task') : 'Add a task';
  const items = allItems().filter((item) => inView(view, item));
  let body = '';

  if (view === 'myday') {
    const events = day?.events || [];
    if (events.length) {
      body += `<section class="hl-todo-group"><div class="hl-todo-group-head"><span class="hl-label">On the calendar · ${events.length}</span></div>
        <div class="hl-todo-rows">${events.map(eventRow).join('')}</div></section>`;
    }
    body += group('today', 'Today', items.sort(byDue), view);
    const overdue = data.todos.filter((t) => late(t) && t.my_day !== data.today).sort(byDue);
    body += group('overdue', 'Overdue, not in My Day', overdue, view, { isLate: true, suggest: true });
    if (!events.length && !items.length) {
      body += `<div class="hl-todo-empty">Nothing in My Day yet. Add a task${overdue.length ? ', or bring one in from Overdue' : ''}.</div>`;
    }
  } else if (view === 'planned' || meta.person) {
    const open = items.sort(byDue);
    const week = addDays(data.today, 7);
    const month = addDays(data.today, COUNT_DAYS);
    body += group('late', 'Overdue', open.filter(late), view, { isLate: true });
    body += group('today', 'Today', open.filter((i) => i.due_date === data.today), view);
    body += group('week', 'Next 7 days', open.filter((i) => i.due_date > data.today && i.due_date <= week), view);
    body += group('month', 'Next 30 days', open.filter((i) => i.due_date > week && i.due_date <= month), view);
    body += group('later', 'Later', open.filter((i) => i.due_date > month), view, { foldable: true });
    body += group('nodate', 'No date', open.filter((i) => !i.due_date), view);
    if (!open.length) body += '<div class="hl-todo-empty">Nothing planned.</div>';
  } else if (view === 'important') {
    body += `<div class="hl-todo-rows">${items.sort(byDue).map((i) => row(i, view)).join('')}</div>`;
    if (!items.length) body += '<div class="hl-todo-empty">Star a to-do to see it here.</div>';
  } else {
    const open = items.filter(isOpen);
    // Items lists keep the order things were added (the shopping order);
    // task lists put starred ones first, then by due date.
    const sorted = list.mode === 'items'
      ? open.sort((a, b) => a.created_at.localeCompare(b.created_at))
      : [...open.filter((i) => i.important).sort(byDue), ...open.filter((i) => !i.important).sort(byDue)];
    body += `<div class="hl-todo-rows">${sorted.map((i) => row(i, view)).join('')}</div>`;
    const done = items.filter((i) => i.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
    const clear = list.mode === 'items' ? '<button class="hl-link" data-clear style="background:none;border:none;font:inherit;padding:0">Clear completed</button>' : '';
    body += group('done', 'Completed', done, view, { foldable: true, action: clear });
    if (!items.length) body += `<div class="hl-todo-empty">Nothing on ${esc(list.name)} yet.</div>`;
  }

  $('main').innerHTML = `
    <button class="hl-todo-back" data-screen="nav">‹ Lists</button>
    <div class="hl-todo-head">${icon}<h1>${esc(meta.name)}</h1>
      ${list ? '<button class="hl-todo-icon-btn" data-settings aria-label="List settings" title="List settings">⋯</button>' : ''}</div>
    <div class="hl-todo-sub">${esc(subtitle(view, list))}</div>
    ${list ? settingsPanel(list) : ''}
    <form class="hl-todo-add" id="add"><span class="hl-todo-plus">＋</span><input id="add-input" placeholder="${placeholder}" autocomplete="off" maxlength="300" ${state.adding ? 'disabled' : ''} /></form>
    <div class="hl-todo-hint">${esc(state.hint || addHint(view, list))}</div>
    ${body}`;
}

function addedLabel(item) {
  const when = new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return item.source === 'agent' ? `Added by Benny · ${when}` : `Added ${when}`;
}

function renderDetail() {
  const el = $('detail');
  const item = state.selected ? find(state.selected) : null;
  $('app').classList.toggle('has-detail', Boolean(item));
  if (!item) {
    el.innerHTML = '';
    delete el.dataset.id;
    return;
  }
  // Don't redraw under someone typing a title, note or step.
  const active = document.activeElement;
  if (el.dataset.id === item.id && el.contains(active) && ['TEXTAREA', 'INPUT'].includes(active.tagName)) return;
  el.dataset.id = item.id;

  const backTo = (SMART[state.view] || listOf(state.view)).name;
  const back = `<button class="hl-todo-back" data-screen="list">‹ ${esc(backTo)}</button>`;
  const star = `<button class="hl-star ${starred(item) ? 'is-on' : ''}" data-star="${item.id}" title="${isMove(item) ? "This week's focus" : 'Important'}">${starred(item) ? '★' : '☆'}</button>`;

  if (isMove(item)) {
    const who = item.owner !== 'both'
      ? PEOPLE[item.owner].label
      : item.lead ? `Both · ${PEOPLE[item.lead].label} leads` : 'Both';
    el.innerHTML = `${back}
      <div class="hl-todo-detail-top"><button class="hl-todo-check" data-check="${item.id}" aria-label="Done"></button>
        <div class="hl-todo-detail-title">${esc(item.title)}</div>${star}</div>
      <div class="hl-todo-box">
        <div class="hl-todo-line"><span class="hl-todo-icon">🇳🇱</span>${esc(item.project_name)}<span class="hl-todo-tag" style="margin-left:auto">${esc(item.code || '')}</span></div>
        <div class="hl-todo-line"><span class="hl-todo-icon">📅</span>Due<span style="margin-left:auto">${dateLabel(item.due_date)}</span></div>
        ${item.repeat ? `<div class="hl-todo-line"><span class="hl-todo-icon">🔁</span>Repeats<span style="margin-left:auto">${esc(item.repeat)}</span></div>` : ''}
        <div class="hl-todo-line"><span class="hl-todo-icon">👥</span>Who<span style="margin-left:auto">${esc(who)}</span></div>
      </div>
      <p class="hl-todo-note">Ticking this off marks it done in the move tracker${item.repeat ? ', and the next one comes due' : ''}. The star is this week's focus (three at most). Dates, owners and notes are edited in the tracker.</p>
      <a href="/move.html" class="hl-link">Open in the move tracker →</a>
      <div class="hl-todo-foot"><span>From the move plan</span><button class="hl-todo-icon-btn" data-close aria-label="Close">✕</button></div>`;
    return;
  }

  const seg = (p, label, color) =>
    `<button data-assign="${p}" class="${(item.assignee || '') === p ? 'is-on' : ''}" style="--seg:${color}">${label}</button>`;
  const steps = item.steps || [];
  el.innerHTML = `${back}
    <div class="hl-todo-detail-top">
      <button class="hl-todo-check ${item.done ? 'is-done' : ''}" data-check="${item.id}" ${item.assignee ? `style="--who:${PEOPLE[item.assignee].color}"` : ''} aria-label="${item.done ? 'Not done' : 'Done'}">${item.done ? '✓' : ''}</button>
      <textarea class="hl-todo-detail-title" id="title-edit" rows="2" maxlength="200" aria-label="Title">${esc(item.title)}</textarea>
      ${star}
    </div>
    <div class="hl-todo-box">
      ${steps.map((s, i) => `<div class="hl-todo-step ${s.done ? 'is-done' : ''}">
        <button class="hl-todo-check ${s.done ? 'is-done' : ''}" data-step="${i}" aria-label="Step done">${s.done ? '✓' : ''}</button>
        <span>${esc(s.title)}</span><button class="hl-todo-icon-btn" data-remove-step="${i}" aria-label="Remove step">✕</button></div>`).join('')}
      <form class="hl-todo-line" id="step-add" style="padding:6px 12px"><span class="hl-todo-icon" style="color:var(--hl-gold)">＋</span>
        <input class="hl-todo-step-input" id="step-input" maxlength="200" placeholder="${steps.length ? 'Next step' : 'Add step'}" autocomplete="off" /></form>
    </div>
    <div class="hl-todo-box"><button class="hl-todo-line ${item.my_day === data.today ? 'is-on' : ''}" data-myday="${item.id}">
      <span class="hl-todo-icon">☀️</span>${item.my_day === data.today ? 'In My Day (tap to remove)' : 'Add to My Day'}</button></div>
    <div class="hl-todo-box">
      <label class="hl-todo-line"><span class="hl-todo-icon">📅</span>Due<input type="date" id="due-edit" value="${esc(item.due_date || '')}" /></label>
      <label class="hl-todo-line"><span class="hl-todo-icon">🔁</span>Repeat<select id="repeat-edit">
        ${['', 'daily', 'weekly', 'monthly'].map((r) => `<option value="${r}" ${(item.repeat || '') === r ? 'selected' : ''}>${r ? r[0].toUpperCase() + r.slice(1) : 'Never'}</option>`).join('')}
      </select></label>
      <div class="hl-todo-line"><span class="hl-todo-icon">👤</span>For<span class="hl-todo-seg">${seg('michael', 'Michael', PEOPLE.michael.color)}${seg('mer', 'Mer', PEOPLE.mer.color)}${seg('', 'Anyone', '#F2C879')}</span></div>
      <label class="hl-todo-line"><span class="hl-todo-icon">📋</span>List<select id="list-edit">
        ${data.lists.map((l) => `<option value="${esc(l.slug)}" ${item.list === l.slug ? 'selected' : ''}>${esc(l.emoji || '📋')} ${esc(l.name)}</option>`).join('')}
      </select></label>
    </div>
    <textarea class="hl-todo-notes" id="notes-edit" maxlength="2000" placeholder="Add a note">${esc(item.notes || '')}</textarea>
    <div class="hl-todo-foot"><span>${esc(addedLabel(item))}</span>
      <span><button class="hl-todo-icon-btn" data-delete="${item.id}" aria-label="Delete" title="Delete">🗑</button><button class="hl-todo-icon-btn" data-close aria-label="Close">✕</button></span></div>`;
}

function screen(name) {
  $('app').dataset.screen = name;
  window.scrollTo(0, 0);
}

// --- Saving -----------------------------------------------------------------

// Shows the change straight away, then keeps whatever the server saved
// (or puts it back and says why).
async function patchTodo(todo, body, local = {}) {
  const before = { ...todo };
  Object.assign(todo, local);
  render();
  try {
    const { todo: saved, rolled } = await api('PATCH', `/api/todos/${todo.id}`, body);
    Object.assign(todo, saved, { kind: 'todo' });
    if (rolled) flash(`Done. The next one is due ${dateLabel(saved.due_date)}.`);
  } catch (err) {
    Object.assign(todo, before);
    flash(err.message, true);
  }
  render();
}

async function patchMoveTask(task, body, local = {}) {
  const before = { ...task };
  Object.assign(task, local);
  render();
  try {
    const { task: saved, rolled } = await api('PATCH', `/api/tasks/${task.id}`, body);
    if (body.status === 'done' && !rolled) {
      data.move_tasks = data.move_tasks.filter((t) => t.id !== task.id);
      flash(`${task.code || 'Move task'} marked done in the move tracker.`);
    } else {
      Object.assign(task, { focus: saved.focus, due_date: saved.due_date, status: saved.status });
      if (rolled) flash(`${task.code || 'Done'}: the next one is due ${dateLabel(saved.due_date)}.`);
    }
  } catch (err) {
    Object.assign(task, before);
    flash(err.message, true);
  }
  render();
}

async function addFromBox(text) {
  const list = listOf(state.view);
  const person = SMART[state.view]?.person;
  state.adding = true;
  state.hint = list?.mode === 'items' ? 'Adding…' : 'Benny is reading that…';
  render();
  try {
    if (list?.mode === 'items') {
      const items = text.split(',').map((s) => s.trim()).filter(Boolean);
      const result = await api('POST', `/api/lists/${encodeURIComponent(list.slug)}/items`, { items });
      data.todos.push(...result.todos.map((t) => ({ ...t, kind: 'todo' })));
      state.hint = result.skipped.length ? `Already on the list: ${result.skipped.join(', ')}` : '';
    } else {
      const device = getPerson();
      const { todo } = await api('POST', '/api/todos', {
        text,
        list: list ? list.slug : DEFAULT_LIST,
        assignee_hint: person || (PEOPLE[device] ? device : null),
        defaults: {
          my_day: state.view === 'myday',
          important: state.view === 'important',
          due_today: state.view === 'planned',
        },
      });
      data.todos.push({ ...todo, kind: 'todo' });
      const bits = [`Benny read: “${todo.title}”`];
      if (todo.assignee) bits.push(`for ${PEOPLE[todo.assignee].label}`);
      if (todo.due_date) bits.push(dateLabel(todo.due_date));
      if (!list && todo.list === DEFAULT_LIST && state.view !== 'myday') bits.push('in Chores');
      state.hint = bits.join(' · ');
    }
    $('add-input').value = '';
  } catch (err) {
    state.hint = '';
    flash(err.message, true);
  }
  state.adding = false;
  render();
  $('add-input')?.focus();
}

// --- Events -----------------------------------------------------------------

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.id === 'add') {
    const text = $('add-input').value.trim();
    if (text && !state.adding) addFromBox(text);
  }

  if (form.id === 'step-add') {
    const title = $('step-input').value.trim();
    const todo = find(state.selected);
    if (!title || !todo) return;
    const steps = [...(todo.steps || []), { title, done: false }];
    $('step-input').value = '';
    $('step-input').blur(); // renderDetail holds off while a field has focus
    await patchTodo(todo, { steps }, { steps });
    $('step-input')?.focus();
  }

  if (form.id === 'new-list-form') {
    const name = $('new-list-name').value.trim();
    if (!name) return;
    try {
      const { list } = await api('POST', '/api/lists', { name, emoji: '📋', mode: 'tasks' });
      data.lists.push(list);
      state.newList = false;
      state.view = list.slug;
      state.hint = '';
      rememberView(list.slug);
      screen('list');
    } catch (err) {
      flash(err.message, true);
    }
    render();
  }

  if (form.id === 'list-settings') {
    const list = listOf(state.view);
    const body = { name: $('list-name').value, emoji: $('list-emoji').value.trim() || null, mode: $('list-mode').value };
    try {
      const { list: saved } = await api('PATCH', `/api/lists/${encodeURIComponent(list.slug)}`, body);
      Object.assign(list, saved);
      state.settingsOpen = false;
    } catch (err) {
      flash(err.message, true);
    }
    render();
  }
});

document.addEventListener('click', async (event) => {
  const el = event.target.closest(
    '[data-view],[data-check],[data-star],[data-myday],[data-open],[data-fold],[data-close],[data-delete],' +
      '[data-step],[data-remove-step],[data-assign],[data-screen],[data-new-list],[data-settings],' +
      '[data-delete-list],[data-clear],[data-device]'
  );
  if (!el) return;
  const ds = el.dataset;
  const today = data.today;

  if (ds.screen) {
    if (ds.screen === 'nav') state.selected = null;
    screen(ds.screen);
    return render();
  }
  if (ds.view) {
    state.view = ds.view;
    state.selected = null;
    state.hint = '';
    state.settingsOpen = false;
    rememberView(ds.view);
    screen('list');
    return render();
  }
  if ('newList' in ds) {
    state.newList = true;
    return render();
  }
  if ('settings' in ds) {
    state.settingsOpen = !state.settingsOpen;
    return render();
  }
  if ('device' in ds) {
    setPerson(ds.device);
    return render();
  }
  if (ds.fold) {
    state.folded[ds.fold] = !state.folded[ds.fold];
    return render();
  }
  if ('close' in ds) {
    state.selected = null;
    screen('list');
    return render();
  }

  if (ds.check) {
    const item = find(ds.check);
    if (isMove(item)) return patchMoveTask(item, { status: 'done' });
    return patchTodo(item, { done: !item.done }, { done: !item.done, done_at: item.done ? null : new Date().toISOString() });
  }
  if (ds.star) {
    const item = find(ds.star);
    if (isMove(item)) return patchMoveTask(item, { focus: !item.focus }, { focus: !item.focus });
    return patchTodo(item, { important: !item.important }, { important: !item.important });
  }
  if (ds.myday) {
    const todo = find(ds.myday);
    const on = todo.my_day !== today;
    return patchTodo(todo, { my_day: on }, { my_day: on ? today : null });
  }

  const todo = state.selected ? find(state.selected) : null;
  if (ds.step !== undefined && todo) {
    const steps = todo.steps.map((s, i) => (i === Number(ds.step) ? { ...s, done: !s.done } : s));
    return patchTodo(todo, { steps }, { steps });
  }
  if (ds.removeStep !== undefined && todo) {
    const steps = todo.steps.filter((_, i) => i !== Number(ds.removeStep));
    return patchTodo(todo, { steps }, { steps });
  }
  if (ds.assign !== undefined && todo) {
    const assignee = ds.assign || null;
    return patchTodo(todo, { assignee }, { assignee });
  }
  if (ds.delete) {
    const item = find(ds.delete);
    if (!confirm(`Delete “${item.title}”? This can't be undone.`)) return;
    try {
      await api('DELETE', `/api/todos/${item.id}`);
      data.todos = data.todos.filter((t) => t.id !== item.id);
      state.selected = null;
      screen('list');
    } catch (err) {
      flash(err.message, true);
    }
    return render();
  }
  if ('deleteList' in ds) {
    const list = listOf(state.view);
    const open = data.todos.filter((t) => t.list === list.slug && !t.done).length;
    const warning = open ? ` Its ${open} open to-do${open === 1 ? '' : 's'} go with it.` : '';
    if (!confirm(`Delete the list “${list.name}”?${warning} This can't be undone.`)) return;
    try {
      await api('DELETE', `/api/lists/${encodeURIComponent(list.slug)}`);
      data.lists = data.lists.filter((l) => l.slug !== list.slug);
      data.todos = data.todos.filter((t) => t.list !== list.slug);
      state.view = 'myday';
      state.settingsOpen = false;
      rememberView('myday');
    } catch (err) {
      flash(err.message, true);
    }
    return render();
  }
  if ('clear' in ds) {
    const list = listOf(state.view);
    if (!confirm(`Remove everything completed from ${list.name}? This can't be undone.`)) return;
    try {
      const { removed } = await api('DELETE', `/api/lists/${encodeURIComponent(list.slug)}/items/checked`);
      data.todos = data.todos.filter((t) => !(t.list === list.slug && t.done));
      flash(`Cleared ${removed} completed item${removed === 1 ? '' : 's'}.`);
    } catch (err) {
      flash(err.message, true);
    }
    return render();
  }

  // A click anywhere else on a row opens it (buttons inside it are handled above).
  if (ds.open && !event.target.closest('button')) {
    state.selected = ds.open;
    render();
    screen('detail');
  }
});

document.addEventListener('change', (event) => {
  const todo = state.selected ? find(state.selected) : null;
  if (!todo || isMove(todo)) return;
  const { id, value } = event.target;
  if (id === 'title-edit') {
    const title = value.trim();
    if (title && title !== todo.title) patchTodo(todo, { title }, { title });
  }
  if (id === 'notes-edit' && value.trim() !== (todo.notes || '')) patchTodo(todo, { notes: value }, { notes: value.trim() || null });
  if (id === 'due-edit') patchTodo(todo, { due_date: value || null }, { due_date: value || null });
  if (id === 'repeat-edit') patchTodo(todo, { repeat: value || null }, { repeat: value || null });
  if (id === 'list-edit') patchTodo(todo, { list: value }, { list: value });
});

// Enter saves a title instead of adding a new line to it.
document.addEventListener('keydown', (event) => {
  if (event.target.id === 'title-edit' && event.key === 'Enter') {
    event.preventDefault();
    event.target.blur();
  }
});

// --- Loading ----------------------------------------------------------------

async function load() {
  try {
    const [todos, digest] = await Promise.all([
      api('GET', '/api/todos'),
      // My Day still works without the calendar and weather.
      api('GET', '/api/digest').catch(() => null),
    ]);
    todos.todos.forEach((t) => (t.kind = 'todo'));
    todos.move_tasks.forEach((t) => (t.kind = 'move'));
    data = todos;
    day = digest;
    render();
  } catch (err) {
    $('main').innerHTML = `<p class="hl-error">${esc(err.message)}</p>`;
  }
}

// The two of us (and Benny) change the same lists, so pick up anyone
// else's changes whenever the page comes back into view.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load();
});

$('app').dataset.screen = phone.matches ? 'nav' : 'list';
load();
