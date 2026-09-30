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
