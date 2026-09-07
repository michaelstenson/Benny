const loadingEl = document.getElementById('loading');
const connectRowEl = document.getElementById('connect-row');
const eventsEl = document.getElementById('events');
const errorEl = document.getElementById('error');

// Same family colors used across the app's mockups — Michael's green,
// Mer's purple — so an event's owner dot means the same thing everywhere.
const OWNER_META = {
  michael: { label: 'Michael', color: '#34D399' },
  mer: { label: 'Mer', color: '#A78BFA' },
};

// If Google redirected us back here with ?error=... (e.g. you clicked
// "Cancel" on the consent screen), surface it instead of failing silently.
const params = new URLSearchParams(window.location.search);
if (params.get('error')) {
  errorEl.textContent = `Google sign-in didn't complete: ${params.get('error')}`;
  errorEl.classList.remove('hidden');
}

function formatWhen(event) {
  const start = new Date(event.start);
  if (event.allDay) {
    return start.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
  return start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Shows a "Connect ___'s calendar" button for each person who hasn't
// connected yet. Whoever already has stays out of the way — this can
// show one button, both, or none.
async function renderConnectRow() {
  let status;
  try {
    const response = await fetch('/api/calendar/status');
    status = await response.json();
  } catch (err) {
    return; // the events fetch below will surface the real error
  }

  const disconnected = Object.keys(OWNER_META).filter((owner) => !status[owner]);
  if (disconnected.length === 0) return;

  connectRowEl.classList.remove('hidden');
  connectRowEl.classList.add('flex');
  connectRowEl.innerHTML = disconnected
    .map(
      (owner) => `
    <a
      href="/auth/google/${owner}"
      class="inline-block text-center bg-slate-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition"
    >
      Connect ${OWNER_META[owner].label}'s calendar
    </a>
  `
    )
    .join('');
}

async function loadEvents() {
  await renderConnectRow();

  let response;
  try {
    response = await fetch('/api/calendar/events');
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = `Could not reach the backend: ${err.message}`;
    errorEl.classList.remove('hidden');
    return;
  }

  // 401 specifically means "neither of us is connected yet" — the
  // connect buttons above already cover that, so there's nothing more
  // to show here.
  if (response.status === 401) {
    loadingEl.classList.add('hidden');
    return;
  }

  const data = await response.json();
  loadingEl.classList.add('hidden');

  if (!response.ok) {
    errorEl.textContent = data.error || 'Something went wrong loading your calendar.';
    errorEl.classList.remove('hidden');
    return;
  }

  eventsEl.classList.remove('hidden');

  if (data.events.length === 0) {
    eventsEl.innerHTML = '<li class="py-4 text-slate-400 text-sm">No upcoming events found.</li>';
    return;
  }

  eventsEl.innerHTML = data.events
    .map((event) => {
      const meta = OWNER_META[event.owner];
      return `
    <li class="py-3">
      <p class="text-slate-800 font-medium flex items-center gap-2">
        ${
          meta
            ? `<span class="inline-block w-2 h-2 rounded-full flex-shrink-0" style="background:${meta.color}" title="${meta.label}"></span>`
            : ''
        }
        ${event.title}
      </p>
      <p class="text-sm text-slate-500">
        ${formatWhen(event)}${event.location ? ' · ' + event.location : ''}
      </p>
    </li>
  `;
    })
    .join('');
}

loadEvents();
