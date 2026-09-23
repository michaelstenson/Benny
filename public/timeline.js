const errorEl = document.getElementById('error');
const viewToggleButtons = document.querySelectorAll('.hl-view-toggle-btn');
const timelineViewEl = document.getElementById('timeline-view');
const monthViewEl = document.getElementById('month-view');

const PERSON_COLOR = { michael: '#34D399', mer: '#A78BFA' };

function personDot(personId, small) {
  const color = PERSON_COLOR[personId];
  if (!color) return '';
  return `<span class="hl-dot${small ? ' hl-dot-sm' : ''}" style="background:${color};box-shadow:0 0 6px ${color};" title="${personId}"></span>`;
}

// --- View toggle ---

let loadedMonth = false;

viewToggleButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    viewToggleButtons.forEach((b) => b.classList.toggle('active', b === btn));
    const view = btn.dataset.view;
    timelineViewEl.classList.toggle('hidden', view !== 'timeline');
    monthViewEl.classList.toggle('hidden', view !== 'month');
    if (view === 'month' && !loadedMonth) {
      loadedMonth = true;
      loadMonth();
    }
  });
});

// --- Timeline view: chores due + timed events, merged chronologically ---

const timelineLoadingEl = document.getElementById('timeline-loading');
const timelineListEl = document.getElementById('timeline-list');
const timelineEmptyEl = document.getElementById('timeline-empty');

function choreRow(chore) {
  const label = chore.overdue ? 'Overdue' : 'Due';
  const dueLabel = new Date(`${chore.due_date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `
    <li class="py-3 flex items-start gap-3">
      ${personDot(chore.assignee)}
      <div class="flex-1">
        <p class="${chore.overdue ? 'hl-up' : 'hl-dim'}">${chore.title}</p>
        <p class="text-xs hl-muted mt-0.5">${label} ${dueLabel} · Chore</p>
      </div>
    </li>
  `;
}

function eventRow(event) {
  const when = new Date(event.start).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `
    <li class="py-3 flex items-start gap-3">
      ${personDot(event.owner)}
      <div class="flex-1">
        <p class="hl-dim">${event.title}</p>
        <p class="text-xs hl-muted mt-0.5">${when}${event.location ? ' · ' + event.location : ''}</p>
      </div>
    </li>
  `;
}

async function loadTimeline() {
  try {
    const response = await fetch('/api/timeline');
    const data = await response.json();
    timelineLoadingEl.classList.add('hidden');

    if (!response.ok) {
      errorEl.textContent = data.error || 'Something went wrong loading the timeline.';
      errorEl.classList.remove('hidden');
      return;
    }

    // Chores sort by start of their due date; timed events already carry
    // a full timestamp — merging on a common sort key interleaves them
    // naturally (a chore due today sits above today's later meetings).
    const items = [
      ...data.chores.map((c) => ({ kind: 'chore', sortKey: `${c.due_date}T00:00:00`, data: c })),
      ...data.events.map((e) => ({ kind: 'event', sortKey: e.start, data: e })),
    ].sort((a, b) => new Date(a.sortKey) - new Date(b.sortKey));

    if (items.length === 0) {
      timelineEmptyEl.classList.remove('hidden');
      return;
    }

    timelineListEl.classList.remove('hidden');
    timelineListEl.innerHTML = items
      .map((item) => (item.kind === 'chore' ? choreRow(item.data) : eventRow(item.data)))
      .join('');
  } catch (err) {
    timelineLoadingEl.classList.add('hidden');
    errorEl.textContent = `Could not reach the backend: ${err.message}`;
    errorEl.classList.remove('hidden');
  }
}

// --- Month view: rolling 6-week grid ---

const monthLoadingEl = document.getElementById('month-loading');
const monthContentEl = document.getElementById('month-content');
const monthGridEl = document.getElementById('month-grid');

function monthCellHtml(day, today) {
  const dayNumber = Number(day.date.slice(8, 10));
  const isToday = day.date === today;
  const isPast = day.date < today;
  const classes = ['hl-month-cell'];
  if (isToday) classes.push('is-today');
  else if (isPast) classes.push('is-past');

  const allDayHtml = day.allDayEvents
    .slice(0, 3)
    .map((e) => `<div class="hl-month-allday" style="color:${PERSON_COLOR[e.owner] || 'var(--hl-text-dim)'}" title="${e.title}">${e.title}</div>`)
    .join('');
  const overflowHtml =
    day.allDayEvents.length > 3 ? `<div class="hl-month-allday hl-muted">+${day.allDayEvents.length - 3} more</div>` : '';

  const dotsHtml = day.timedOwners.map((owner) => personDot(owner, true)).join('');

  return `
    <div class="${classes.join(' ')}">
      <div class="hl-month-date">${dayNumber}</div>
      ${allDayHtml}${overflowHtml}
      <div class="hl-month-dots">${dotsHtml}</div>
    </div>
  `;
}

async function loadMonth() {
  try {
    const response = await fetch('/api/calendar/month');
    const data = await response.json();
    monthLoadingEl.classList.add('hidden');

    if (!response.ok) {
      errorEl.textContent = data.error || 'Something went wrong loading the month view.';
      errorEl.classList.remove('hidden');
      return;
    }

    monthContentEl.classList.remove('hidden');
    monthGridEl.innerHTML = data.days.map((day) => monthCellHtml(day, data.today)).join('');
  } catch (err) {
    monthLoadingEl.classList.add('hidden');
    errorEl.textContent = `Could not reach the backend: ${err.message}`;
    errorEl.classList.remove('hidden');
  }
}

loadTimeline();
