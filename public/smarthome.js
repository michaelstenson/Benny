const loadingEl = document.getElementById('loading');
const connectRowEl = document.getElementById('connect-row');
const thermostatsEl = document.getElementById('thermostats');
const errorEl = document.getElementById('error');

// If Resideo redirected us back here with ?error=... (e.g. you clicked
// "Cancel" on the consent screen), surface it instead of failing silently.
const params = new URLSearchParams(window.location.search);
if (params.get('error')) {
  errorEl.textContent = `Resideo sign-in didn't complete: ${params.get('error')}`;
  errorEl.classList.remove('hidden');
}

function degreeSymbol(units) {
  if (units === 'Fahrenheit') return '°F';
  if (units === 'Celsius') return '°C';
  return '°';
}

async function renderConnectRow() {
  let status;
  try {
    const response = await fetch('/api/smarthome/status');
    status = await response.json();
  } catch (err) {
    return; // the thermostats fetch below will surface the real error
  }

  if (status.connected) return;

  connectRowEl.classList.remove('hidden');
  connectRowEl.classList.add('flex');
  connectRowEl.innerHTML = `
    <a href="/auth/resideo" class="hl-button inline-block text-center">
      Connect thermostat
    </a>
  `;
}

async function loadThermostats() {
  await renderConnectRow();

  let response;
  try {
    response = await fetch('/api/smarthome/thermostats');
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = `Could not reach the backend: ${err.message}`;
    errorEl.classList.remove('hidden');
    return;
  }

  // 401 specifically means "not connected yet" — the connect button above
  // already covers that, so there's nothing more to show here.
  if (response.status === 401) {
    loadingEl.classList.add('hidden');
    return;
  }

  const data = await response.json();
  loadingEl.classList.add('hidden');

  if (!response.ok) {
    errorEl.textContent = data.error || 'Something went wrong loading the thermostat.';
    errorEl.classList.remove('hidden');
    return;
  }

  thermostatsEl.classList.remove('hidden');

  if (data.thermostats.length === 0) {
    thermostatsEl.innerHTML = '<li class="py-4 hl-muted text-sm">No thermostats found on this account.</li>';
    return;
  }

  thermostatsEl.innerHTML = data.thermostats
    .map((t) => {
      const deg = degreeSymbol(t.units);
      const setpoint = t.mode === 'Cool' ? t.coolSetpoint : t.heatSetpoint;
      return `
    <li class="py-3">
      <p class="font-medium">${t.name}</p>
      <p class="text-sm hl-muted mt-0.5">
        ${t.indoorTemperature ?? '?'}${deg} indoors
        ${t.mode ? ` · ${t.mode}` : ''}
        ${setpoint != null ? ` · setpoint ${setpoint}${deg}` : ''}
      </p>
    </li>
  `;
    })
    .join('');
}

loadThermostats();
