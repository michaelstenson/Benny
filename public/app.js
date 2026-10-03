// This runs in the browser. Its only job right now is to call our own
// backend's /api/hello endpoint and show what comes back — that round
// trip (browser -> Express -> Supabase -> back to the browser) is the
// "end to end" part of hello-world.

const statusEl = document.getElementById('status');

async function checkIn() {
  try {
    const response = await fetch('/api/hello');
    const data = await response.json();

    const dbLine = data.supabaseConnected
      ? '✅ Supabase is connected'
      : `⚠️ Supabase check failed${data.supabaseError ? `: ${data.supabaseError}` : ''}`;

    statusEl.innerHTML = `
      <span class="hl-dim">${data.message}</span>
      <span class="block mt-1">${dbLine}</span>
    `;
  } catch (err) {
    statusEl.textContent = `Could not reach the backend: ${err.message}`;
    statusEl.classList.add('hl-error');
  }
}

checkIn();

// --- Today digest: merges calendar events + due/overdue chores ---

const digestLoadingEl = document.getElementById('digest-loading');
const digestListEl = document.getElementById('digest-list');
const digestEmptyEl = document.getElementById('digest-empty');
const digestWeatherEl = document.getElementById('digest-weather');

// Same family colors used everywhere else (calendar dots, chore chips) —
// an owner/assignee here should mean the same thing it does on those pages.
const PERSON_META = {
  michael: { label: 'Michael', color: '#34D399' },
  mer: { label: 'Mer', color: '#A78BFA' },
};

function personDot(personId) {
  const meta = PERSON_META[personId];
  if (!meta) return '';
  return `<span class="hl-dot flex-shrink-0" style="background:${meta.color};box-shadow:0 0 6px ${meta.color};" title="${meta.label}"></span>`;
}

function choreDigestRow(chore) {
  return `
    <li class="py-2 flex items-start gap-2">
      ${personDot(chore.assignee)}
      <p class="${chore.overdue ? 'hl-up' : 'hl-dim'}">
        ${escapeHtml(chore.title)}${chore.overdue ? ' <span class="text-xs">(overdue)</span>' : ''}
      </p>
    </li>
  `;
}

function eventDigestRow(event) {
  const time = event.allDay
    ? 'All day'
    : new Date(event.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `
    <li class="py-2 flex items-start gap-2">
      ${personDot(event.owner)}
      <p class="hl-dim">${escapeHtml(event.title)} <span class="text-xs hl-muted">· ${time}</span></p>
    </li>
  `;
}

// Recurring bills due in the next week (Stage 20) — no person dot, since
// a bill belongs to the household, not to one of us.
function billDigestRow(bill) {
  const when =
    bill.days_until === 0 ? 'due today' : bill.days_until === 1 ? 'due tomorrow' : `due in ${bill.days_until} days`;
  const amount =
    bill.amount === null
      ? ''
      : ' · ' + new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(bill.amount);
  return `
    <li class="py-2 flex items-start gap-2">
      <span class="flex-shrink-0 text-xs" title="Bill">💵</span>
      <p class="${bill.days_until === 0 && !bill.autopay ? 'hl-up' : 'hl-dim'}">
        ${escapeHtml(bill.name)} <span class="text-xs hl-muted">· ${when}${amount}${bill.autopay ? ' · autopay' : ''}</span>
      </p>
    </li>
  `;
}

function weatherLine(weather) {
  const rain = weather.precip_chance >= 30 ? ` · ${weather.precip_chance}% chance of precipitation` : '';
  return `${weather.summary}, high ${weather.high_f}° / low ${weather.low_f}°${rain}`;
}

async function loadDigest() {
  try {
    const response = await fetch('/api/digest');
    const data = await response.json();
    digestLoadingEl.classList.add('hidden');

    if (!response.ok) {
      digestLoadingEl.textContent = data.error || 'Could not load today.';
      digestLoadingEl.classList.remove('hidden');
      return;
    }

    if (data.weather) {
      digestWeatherEl.textContent = weatherLine(data.weather);
      digestWeatherEl.classList.remove('hidden');
    }

    const rows = [
      ...data.chores.map(choreDigestRow),
      ...data.events.map(eventDigestRow),
      ...(data.bills_due || []).map(billDigestRow),
    ];
    if (rows.length === 0) {
      digestEmptyEl.classList.remove('hidden');
      return;
    }

    digestListEl.innerHTML = rows.join('');
    digestListEl.classList.remove('hidden');
  } catch (err) {
    digestLoadingEl.textContent = `Could not reach the backend: ${err.message}`;
  }
}

loadDigest();

// --- Benny suggests (Stage 21): proposals waiting on a yes or no ---
//
// Everything a proposal says came from the agent, which may be relaying
// text someone else wrote (an email, an invite), so every field goes
// through escapeHtml() — and the card shows exactly what approving will
// write, since that's the whole point of the review.

const proposalsEl = document.getElementById('proposals');
const proposalsListEl = document.getElementById('proposals-list');

// "19:00" -> "7:00 PM", without going through a Date (and a timezone).
function formatClock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// A plain "YYYY-MM-DD" read as local noon, so it can't slip to the
// previous day the way parsing it as UTC midnight would.
function formatDay(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function whose(owner) {
  return `${PERSON_META[owner]?.label ?? owner}'s`;
}

function describeProposal({ kind, payload: p }) {
  if (kind === 'calendar_event') {
    const time = p.start_time
      ? `${formatClock(p.start_time)}${p.end_time ? `–${formatClock(p.end_time)}` : ''}`
      : 'All day';
    return {
      owner: p.owner,
      heading: `Add to ${whose(p.owner)} calendar`,
      detail: `
        <p class="hl-dim">${escapeHtml(p.title)}</p>
        <p class="text-xs hl-muted">${formatDay(p.date)} · ${time}</p>
      `,
    };
  }
  if (kind === 'gmail_draft') {
    return {
      owner: p.owner,
      heading: `Save a draft in ${whose(p.owner)} Gmail (not sent)`,
      detail: `
        <p class="text-xs hl-muted">To ${escapeHtml(p.to)}</p>
        <p class="hl-dim">${escapeHtml(p.subject)}</p>
        <p class="text-sm hl-muted mt-1 whitespace-pre-wrap">${escapeHtml(p.body)}</p>
      `,
    };
  }
  return { owner: null, heading: `Unknown proposal (${escapeHtml(kind)})`, detail: '' };
}

function proposalRow(proposal) {
  const { owner, heading, detail } = describeProposal(proposal);
  return `
    <li class="py-3 flex items-start gap-2" data-id="${escapeHtml(proposal.id)}">
      ${personDot(owner)}
      <div class="flex-1 min-w-0">
        <p class="text-xs hl-label">${heading}</p>
        ${detail}
        ${proposal.note ? `<p class="text-xs hl-muted mt-1">Why: ${escapeHtml(proposal.note)}</p>` : ''}
        <p class="proposal-status text-xs mt-2 ${proposal.last_error ? 'hl-error' : 'hidden'}">
          ${proposal.last_error ? `Last try didn't work: ${escapeHtml(proposal.last_error)}` : ''}
        </p>
        <div class="proposal-actions flex items-center gap-4 mt-2">
          <button type="button" class="hl-button" data-decide="approve">Approve</button>
          <button type="button" class="hl-back" data-decide="reject">Dismiss</button>
        </div>
      </div>
    </li>
  `;
}

function doneMessage(proposal) {
  const p = proposal.payload;
  if (proposal.status === 'rejected') return 'Dismissed.';
  if (proposal.kind === 'calendar_event') {
    const link = proposal.result?.htmlLink;
    return `✓ Added to ${whose(p.owner)} calendar${
      link ? ` · <a href="${escapeHtml(link)}" target="_blank" rel="noopener">open it</a>` : ''
    }`;
  }
  if (proposal.kind === 'gmail_draft') {
    return `✓ Draft saved in ${whose(p.owner)} Gmail — open it there to review and send.`;
  }
  return '✓ Done.';
}

async function decideProposal(row, decision) {
  const statusEl = row.querySelector('.proposal-status');
  const buttons = row.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  statusEl.className = 'proposal-status text-xs mt-2 hl-muted';
  statusEl.textContent = decision === 'approve' ? 'Working on it…' : 'Dismissing…';

  try {
    const response = await fetch(`/api/proposals/${row.dataset.id}/${decision}`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      statusEl.className = 'proposal-status text-xs mt-2 hl-error';
      statusEl.textContent = data.error || 'That didn’t work.';
      // 409 = someone already handled it; nothing left to press.
      if (response.status !== 409) buttons.forEach((b) => (b.disabled = false));
      return;
    }
    row.querySelector('.proposal-actions').remove();
    statusEl.className = 'proposal-status text-xs mt-2 hl-down';
    statusEl.innerHTML = doneMessage(data.proposal);
  } catch (err) {
    statusEl.className = 'proposal-status text-xs mt-2 hl-error';
    statusEl.textContent = `Could not reach the backend: ${err.message}`;
    buttons.forEach((b) => (b.disabled = false));
  }
}

proposalsListEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-decide]');
  if (button) decideProposal(button.closest('li'), button.dataset.decide);
});

async function loadProposals() {
  try {
    const response = await fetch('/api/proposals');
    if (!response.ok) return; // the card just stays hidden
    const { proposals } = await response.json();
    proposalsListEl.innerHTML = proposals.map(proposalRow).join('');
    proposalsEl.classList.toggle('hidden', proposals.length === 0);
  } catch {
    // Same as above — no card beats a broken one.
  }
}

loadProposals();

// Coming back to the tab picks up anything Benny proposed in the meantime
// (same approach as the lists page).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadProposals();
});

// --- Netherlands move (Stage 22): countdown + the next few things ---
//
// Shows this device's person (the Move page's Everyone/Michael/Mer
// toggle): this week's focus first, then anything overdue, then what's
// started or due in the next 30 days.

const MOVE_CARD_ITEMS = 5;

function moveRow(task, today) {
  const overdue = MoveShared.isOverdue(task, today);
  return `
    <li class="py-2 flex items-start gap-2">
      <span class="flex items-center gap-0.5 mt-1.5">${MoveShared.personDots(task)}</span>
      <p class="${overdue ? 'hl-up' : 'hl-dim'} text-sm">
        ${task.focus ? '★ ' : ''}${escapeHtml(task.title)}
        <span class="text-xs hl-muted">· ${escapeHtml(MoveShared.whenLabel(task, today))}${overdue ? ' · overdue' : ''}</span>
      </p>
    </li>
  `;
}

async function loadMoveCard() {
  try {
    const response = await fetch('/api/projects/netherlands-move/summary');
    if (!response.ok) return; // no plan yet: the card stays hidden
    const data = await response.json();
    const person = MoveShared.getPerson();

    const upcoming = data.key_dates.filter((k) => k.days_left >= 0);
    document.getElementById('move-countdown').textContent = upcoming
      .map((k) => `${k.days_left} days to ${k.title}`)
      .join(' · ');

    const seen = new Set();
    const items = [
      ...data.focus.map((t) => ({ ...t, focus: true })),
      ...data.overdue,
      ...data.next_30,
    ].filter((t) => MoveShared.belongsTo(t, person) && !seen.has(t.id) && seen.add(t.id));
    document.getElementById('move-list').innerHTML = items
      .slice(0, MOVE_CARD_ITEMS)
      .map((t) => moveRow(t, data.today))
      .join('');

    const decision = data.decisions_due[0];
    if (decision) {
      const el = document.getElementById('move-decision');
      el.textContent = `Next decision: ${decision.code} ${decision.question}, by ${MoveShared.dayLabel(decision.decide_by, data.today)} (${MoveShared.daysLeftLabel(decision.days_left)})`;
      el.classList.remove('hidden');
    }
    document.getElementById('move-card').classList.remove('hidden');
  } catch {
    // Same as the proposals card: no card beats a broken one.
  }
}

loadMoveCard();
