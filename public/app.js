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
        ${chore.title}${chore.overdue ? ' <span class="text-xs">(overdue)</span>' : ''}
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
      <p class="hl-dim">${event.title} <span class="text-xs hl-muted">· ${time}</span></p>
    </li>
  `;
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

    const rows = [...data.chores.map(choreDigestRow), ...data.events.map(eventDigestRow)];
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
