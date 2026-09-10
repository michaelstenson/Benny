const loadingEl = document.getElementById('loading');
const connectRowEl = document.getElementById('connect-row');
const thermostatsEl = document.getElementById('thermostats');
const errorEl = document.getElementById('error');
const shadesEl = document.getElementById('shades');
const shadesEmptyEl = document.getElementById('shades-empty');

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

// What setpoint field(s) matter for a given mode — Auto needs both a
// heat-to and cool-to setpoint; Heat/Cool only need the one that matches.
function setpointFieldsForMode(mode) {
  if (mode === 'Auto') return ['heatSetpoint', 'coolSetpoint'];
  if (mode === 'Cool') return ['coolSetpoint'];
  return ['heatSetpoint']; // Heat and Off both edit the heat setpoint
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

function thermostatCardHtml(t) {
  const deg = degreeSymbol(t.units);
  const displaySetpoint = t.mode === 'Cool' ? t.coolSetpoint : t.heatSetpoint;
  const modes = ['Off', 'Heat', 'Cool', 'Auto'];

  return `
    <li class="py-3" data-device-id="${t.deviceId}" data-location-id="${t.locationId}">
      <p class="font-medium">${t.name}</p>
      <p class="text-sm hl-muted mt-0.5">
        ${t.indoorTemperature ?? '?'}${deg} indoors
        ${t.mode ? ` · ${t.mode}` : ''}
        ${displaySetpoint != null ? ` · setpoint ${displaySetpoint}${deg}` : ''}
      </p>

      <div class="flex flex-wrap items-center gap-2 mt-2">
        <select class="hl-input thermostat-mode text-sm">
          ${modes.map((m) => `<option value="${m}" ${m === t.mode ? 'selected' : ''}>${m}</option>`).join('')}
        </select>

        <span class="thermostat-setpoints flex items-center gap-2"></span>

        <button type="button" class="hl-button thermostat-save text-sm">Set</button>
        <span class="thermostat-status text-xs hl-muted"></span>
      </div>
    </li>
  `;
}

// Rebuilds just the setpoint input(s) for one card, based on whatever
// mode is currently selected in that card's dropdown — called on load
// and whenever the mode select changes.
function renderSetpointInputs(cardEl, thermostat) {
  const mode = cardEl.querySelector('.thermostat-mode').value;
  const fields = setpointFieldsForMode(mode);
  const labels = { heatSetpoint: 'Heat to', coolSetpoint: 'Cool to' };

  cardEl.querySelector('.thermostat-setpoints').innerHTML = fields
    .map((field) => {
      const current = thermostat[field] ?? '';
      return `
        <label class="text-xs hl-muted flex items-center gap-1">
          ${labels[field]}
          <input type="number" step="0.5" class="hl-input text-sm w-20" data-field="${field}" value="${current}" />
        </label>
      `;
    })
    .join('');
}

async function saveThermostat(cardEl) {
  const deviceId = cardEl.dataset.deviceId;
  const locationId = cardEl.dataset.locationId;
  const mode = cardEl.querySelector('.thermostat-mode').value;
  const statusEl = cardEl.querySelector('.thermostat-status');
  const saveButton = cardEl.querySelector('.thermostat-save');

  const body = { locationId, mode };
  cardEl.querySelectorAll('.thermostat-setpoints input[data-field]').forEach((input) => {
    if (input.value !== '') body[input.dataset.field] = Number(input.value);
  });

  saveButton.disabled = true;
  statusEl.textContent = 'Saving...';

  try {
    const response = await fetch(`/api/smarthome/thermostats/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();

    if (!response.ok) {
      statusEl.textContent = data.error || 'Failed to update.';
      statusEl.classList.add('hl-error');
      return;
    }

    statusEl.classList.remove('hl-error');
    statusEl.textContent = 'Saved.';
    setTimeout(() => {
      // A save changes what's actually true, so re-pull real state rather
      // than trusting what we just sent (Resideo can clamp/reject values).
      loadThermostats();
    }, 800);
  } catch (err) {
    statusEl.textContent = `Could not reach the backend: ${err.message}`;
    statusEl.classList.add('hl-error');
  } finally {
    saveButton.disabled = false;
  }
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

  thermostatsEl.innerHTML = data.thermostats.map(thermostatCardHtml).join('');

  data.thermostats.forEach((t) => {
    const cardEl = thermostatsEl.querySelector(`[data-device-id="${t.deviceId}"]`);
    renderSetpointInputs(cardEl, t);
    cardEl.querySelector('.thermostat-mode').addEventListener('change', () => renderSetpointInputs(cardEl, t));
    cardEl.querySelector('.thermostat-save').addEventListener('click', () => saveThermostat(cardEl));
  });
}

// Turns "5 minutes ago" style relative time from an ISO timestamp — the
// shade data is only as fresh as the Pi bridge's last successful poll,
// so it's worth showing how stale it might be.
function relativeTime(isoString) {
  const seconds = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Shade status comes from Supabase, pushed there by the Raspberry Pi
// bridge (powerview-bridge/) — this page never talks to the PowerView
// hub itself. An empty result is the normal state until that bridge is
// set up and running, so it's shown as a quiet placeholder, not an error.
async function loadShades() {
  try {
    const response = await fetch('/api/smarthome/shades');
    if (!response.ok) throw new Error('request failed');
    const data = await response.json();

    if (!data.shades || data.shades.length === 0) {
      shadesEmptyEl.classList.remove('hidden');
      return;
    }

    shadesEl.classList.remove('hidden');
    shadesEl.innerHTML = data.shades
      .map((s) => {
        const parts = [`${s.primary_position ?? '?'}% open`];
        if (s.tilt_position != null) parts.push(`tilt ${s.tilt_position}%`);
        if (s.battery_status) parts.push(s.battery_status);
        return `
          <li class="py-3">
            <p class="font-medium">${s.name}${s.room_name ? ` <span class="hl-muted font-normal">· ${s.room_name}</span>` : ''}</p>
            <p class="text-sm hl-muted mt-0.5">${parts.join(' · ')} · updated ${relativeTime(s.updated_at)}</p>
          </li>
        `;
      })
      .join('');
  } catch (err) {
    // Quietly treat this the same as "no bridge yet" — the thermostat
    // section above is where real connection errors get surfaced.
    shadesEmptyEl.classList.remove('hidden');
  }
}

loadThermostats();
loadShades();
