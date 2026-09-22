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
    <a href="/auth/google/${owner}" class="hl-button inline-block text-center">
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
    eventsEl.innerHTML = '<li class="py-4 hl-muted text-sm">No upcoming events found.</li>';
    return;
  }

  eventsEl.innerHTML = data.events
    .map((event) => {
      const meta = OWNER_META[event.owner];
      return `
    <li class="py-3">
      <p class="font-medium flex items-center gap-2">
        ${
          meta
            ? `<span class="hl-dot flex-shrink-0" style="background:${meta.color};box-shadow:0 0 6px ${meta.color};" title="${meta.label}"></span>`
            : ''
        }
        ${event.title}
      </p>
      <p class="text-sm hl-muted mt-0.5">
        ${formatWhen(event)}${event.location ? ' · ' + event.location : ''}
      </p>
    </li>
  `;
    })
    .join('');
}

// --- New event: natural-language entry with a preview/confirm step ---
// Unlike chores (single-step, low stakes if wrong), a calendar event is
// visible on a shared calendar — worth a "did I get this right?" pause
// before it's actually created.

const addEventForm = document.getElementById('add-event-form');
const eventInput = document.getElementById('event-input');
const addEventStatus = document.getElementById('add-event-status');
const eventPreviewEl = document.getElementById('event-preview');
const eventPreviewSummaryEl = document.getElementById('event-preview-summary');
const eventConfirmButton = document.getElementById('event-confirm');
const eventCancelButton = document.getElementById('event-cancel');

let pendingEvent = null;

function formatEventPreview(event) {
  const owner = OWNER_META[event.owner]?.label || event.owner;
  const date = new Date(`${event.date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  if (!event.start_time) {
    return `${event.title} — ${owner}'s calendar, ${date} (all day)`;
  }
  const time = new Date(`${event.date}T${event.start_time}:00`).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${event.title} — ${owner}'s calendar, ${date} at ${time}`;
}

function resetEventForm() {
  pendingEvent = null;
  eventInput.value = '';
  eventPreviewEl.classList.add('hidden');
}

addEventForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = eventInput.value.trim();
  if (!text) return;

  addEventStatus.textContent = '';
  eventPreviewEl.classList.add('hidden');
  addEventForm.querySelector('button').disabled = true;

  try {
    const response = await fetch('/api/calendar/events/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();

    if (!response.ok) {
      addEventStatus.textContent = data.error || 'Something went wrong.';
    } else {
      pendingEvent = data.event;
      eventPreviewSummaryEl.textContent = formatEventPreview(pendingEvent);
      eventPreviewEl.classList.remove('hidden');
    }
  } catch (err) {
    addEventStatus.textContent = `Could not reach the backend: ${err.message}`;
  } finally {
    addEventForm.querySelector('button').disabled = false;
  }
});

eventCancelButton.addEventListener('click', resetEventForm);

eventConfirmButton.addEventListener('click', async () => {
  if (!pendingEvent) return;

  eventConfirmButton.disabled = true;
  try {
    const response = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingEvent),
    });
    const data = await response.json();

    if (!response.ok) {
      addEventStatus.textContent = data.error || 'Could not add that to the calendar.';
      return;
    }

    resetEventForm();
    loadEvents(); // re-pull real state so the new event shows up in the merged list
  } catch (err) {
    addEventStatus.textContent = `Could not reach the backend: ${err.message}`;
  } finally {
    eventConfirmButton.disabled = false;
  }
});

loadEvents();
