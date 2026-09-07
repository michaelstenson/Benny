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
