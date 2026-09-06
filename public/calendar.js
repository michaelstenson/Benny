const loadingEl = document.getElementById('loading');
const connectPromptEl = document.getElementById('connect-prompt');
const eventsEl = document.getElementById('events');
const errorEl = document.getElementById('error');

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

async function loadEvents() {
  let response;
  try {
    response = await fetch('/api/calendar/events');
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = `Could not reach the backend: ${err.message}`;
    errorEl.classList.remove('hidden');
    return;
  }

  // 401 specifically means "not connected yet" — show the connect button
  // rather than treating it as a generic failure.
  if (response.status === 401) {
    loadingEl.classList.add('hidden');
    connectPromptEl.classList.remove('hidden');
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
    .map(
      (event) => `
    <li class="py-3">
      <p class="text-slate-800 font-medium">${event.title}</p>
      <p class="text-sm text-slate-500">
        ${formatWhen(event)}${event.location ? ' · ' + event.location : ''}
      </p>
    </li>
  `
    )
    .join('');
}

loadEvents();
