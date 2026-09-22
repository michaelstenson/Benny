const ownerTabs = document.querySelectorAll('.owner-tab');
const errorEl = document.getElementById('error');
const connectRowEl = document.getElementById('connect-row');
const loadingEl = document.getElementById('loading');
const messagesEl = document.getElementById('messages');
const messagesEmptyEl = document.getElementById('messages-empty');
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

function formatDate(dateHeader) {
  if (!dateHeader) return '';
  const date = new Date(dateHeader);
  if (Number.isNaN(date.getTime())) return dateHeader;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function loadForActiveOwner() {
  errorEl.classList.add('hidden');
  connectRowEl.classList.add('hidden');
  messagesEl.classList.add('hidden');
  messagesEmptyEl.classList.add('hidden');
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
    connectRowEl.classList.remove('hidden');
    connectRowEl.innerHTML = `
      <a href="/auth/google/${activeOwner}" class="hl-button inline-block text-center">
        Connect ${OWNER_LABEL[activeOwner]}'s Google account
      </a>
    `;
    return;
  }

  draftSectionEl.classList.remove('hidden');

  let response;
  try {
    response = await fetch(`/api/gmail/messages?owner=${encodeURIComponent(activeOwner)}`);
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = `Could not reach the backend: ${err.message}`;
    errorEl.classList.remove('hidden');
    return;
  }

  const data = await response.json();
  loadingEl.classList.add('hidden');

  if (!response.ok) {
    errorEl.textContent = data.error || 'Something went wrong loading messages.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (data.messages.length === 0) {
    messagesEmptyEl.classList.remove('hidden');
    return;
  }

  messagesEl.classList.remove('hidden');
  messagesEl.innerHTML = data.messages
    .map(
      (m) => `
    <li class="py-3">
      <p class="font-medium">${m.subject}</p>
      <p class="text-sm hl-muted mt-0.5">${m.from || ''}${m.date ? ' · ' + formatDate(m.date) : ''}</p>
      ${m.snippet ? `<p class="text-sm hl-dim mt-1">${m.snippet}</p>` : ''}
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
