const ownerTabs = document.querySelectorAll('.owner-tab');
const errorEl = document.getElementById('error');
const connectRowEl = document.getElementById('connect-row');
const loadingEl = document.getElementById('loading');
const draftsHeaderEl = document.getElementById('drafts-header');
const openGmailDraftsEl = document.getElementById('open-gmail-drafts');
const draftsEl = document.getElementById('drafts');
const draftsEmptyEl = document.getElementById('drafts-empty');
const draftSectionEl = document.getElementById('draft-section');
const draftForm = document.getElementById('draft-form');
const draftStatusEl = document.getElementById('draft-status');

const OWNER_LABEL = { michael: 'Michael', mer: 'Mer' };

let activeOwner = 'michael';

function setActiveTab() {
  ownerTabs.forEach((tab) => {
    const isActive = tab.dataset.owner === activeOwner;
    tab.style.opacity = isActive ? '1' : '0.5';
  });
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Used for two different situations that both need the same fix: never
// connected at all (status check says so, no API call needed to know),
// and connected-but-missing-the-Gmail-scope (only discovered once an
// actual Gmail call comes back 403) — either way, the fix is "reconnect,"
// so both show the same button rather than the second case just being a
// dead-end error message.
function showConnectRow(label) {
  connectRowEl.classList.remove('hidden');
  connectRowEl.innerHTML = `
    <p class="text-sm hl-muted mb-2">${label}</p>
    <a href="/auth/google/${activeOwner}" class="hl-button inline-block text-center">
      Connect ${OWNER_LABEL[activeOwner]}'s Google account
    </a>
  `;
}

async function loadForActiveOwner() {
  errorEl.classList.add('hidden');
  connectRowEl.classList.add('hidden');
  draftsHeaderEl.classList.add('hidden');
  draftsEl.classList.add('hidden');
  draftsEmptyEl.classList.add('hidden');
  draftSectionEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  loadingEl.textContent = 'Loading...';

  let status;
  try {
    const response = await fetch('/api/gmail/status');
    status = await response.json();
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = `Could not reach the backend: ${err.message}`;
    errorEl.classList.remove('hidden');
    return;
  }

  if (!status[activeOwner]) {
    loadingEl.classList.add('hidden');
    showConnectRow(`${OWNER_LABEL[activeOwner]} hasn't connected a Google account yet.`);
    return;
  }

  let response;
  try {
    response = await fetch(`/api/gmail/drafts?owner=${encodeURIComponent(activeOwner)}`);
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = `Could not reach the backend: ${err.message}`;
    errorEl.classList.remove('hidden');
    return;
  }

  const data = await response.json();
  loadingEl.classList.add('hidden');

  // 403 specifically means "connected, but that connection predates the
  // Gmail scope" — same fix as never having connected at all, so it gets
  // the same reconnect button rather than a dead-end error.
  if (response.status === 403) {
    showConnectRow(data.error);
    return;
  }

  if (!response.ok) {
    errorEl.textContent = data.error || 'Something went wrong loading drafts.';
    errorEl.classList.remove('hidden');
    return;
  }

  draftSectionEl.classList.remove('hidden');
  draftsHeaderEl.classList.remove('hidden');
  openGmailDraftsEl.href = 'https://mail.google.com/mail/u/0/#drafts';

  if (data.drafts.length === 0) {
    draftsEmptyEl.classList.remove('hidden');
    return;
  }

  draftsEl.classList.remove('hidden');
  draftsEl.innerHTML = data.drafts
    .map(
      (d) => `
    <li class="py-3">
      <p class="font-medium">${d.subject}</p>
      <p class="text-sm hl-muted mt-0.5">To: ${d.to_address} · ${formatDate(d.created_at)}</p>
    </li>
  `
    )
    .join('');
}

ownerTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    activeOwner = tab.dataset.owner;
    setActiveTab();
    loadForActiveOwner();
  });
});

draftForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const to = document.getElementById('draft-to').value.trim();
  const subject = document.getElementById('draft-subject').value.trim();
  const body = document.getElementById('draft-body').value.trim();
  if (!to || !subject || !body) return;

  draftStatusEl.textContent = 'Creating draft...';
  draftForm.querySelector('button').disabled = true;

  try {
    const response = await fetch('/api/gmail/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: activeOwner, to, subject, body }),
    });
    const data = await response.json();

    if (!response.ok) {
      draftStatusEl.textContent = data.error || 'Could not create that draft.';
      draftStatusEl.classList.add('hl-error');
    } else {
      draftStatusEl.classList.remove('hl-error');
      draftStatusEl.textContent =
        `Draft created in ${OWNER_LABEL[activeOwner]}'s Gmail — nothing was sent. Go check Drafts to confirm.`;
      draftForm.reset();
      loadForActiveOwner(); // re-pull so the new draft shows up in the list above
    }
  } catch (err) {
    draftStatusEl.textContent = `Could not reach the backend: ${err.message}`;
    draftStatusEl.classList.add('hl-error');
  } finally {
    draftForm.querySelector('button').disabled = false;
  }
});

setActiveTab();
loadForActiveOwner();
