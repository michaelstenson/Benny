// Two steps: ask for an email (POST /auth/login sends the code), then
// ask for the code (POST /auth/verify sets the session cookie). The
// code step is what makes this work from the home-screen app on a
// phone — see server/routes/session.js for why.

const emailForm = document.getElementById('email-form');
const codeForm = document.getElementById('code-form');
const emailInput = document.getElementById('email-input');
const codeInput = document.getElementById('code-input');
const statusEl = document.getElementById('login-status');

const params = new URLSearchParams(location.search);
const next = params.get('next') || '/';

const LINK_ERRORS = {
  link: "That sign-in link didn't work — it may have expired or already been used. Send a new code.",
  missing: 'That sign-in link was incomplete. Send a new code.',
};
if (LINK_ERRORS[params.get('error')]) showStatus(LINK_ERRORS[params.get('error')], true);

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('hl-error', isError);
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showStatus('Sending…');
  try {
    await post('/auth/login', { email: emailInput.value });
    emailForm.classList.add('hidden');
    codeForm.classList.remove('hidden');
    codeInput.focus();
    showStatus('');
  } catch (err) {
    showStatus(err.message, true);
  }
});

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showStatus('Checking…');
  try {
    await post('/auth/verify', { email: emailInput.value, code: codeInput.value });
    // Only ever go back to a path on this site.
    location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  } catch (err) {
    showStatus(err.message, true);
  }
});

document.getElementById('restart').addEventListener('click', () => {
  codeForm.classList.add('hidden');
  emailForm.classList.remove('hidden');
  codeInput.value = '';
  showStatus('');
});
