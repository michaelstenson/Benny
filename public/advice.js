const form = document.getElementById('ask-form');
const input = document.getElementById('question-input');
const askStatus = document.getElementById('ask-status');
const penguins = document.getElementById('penguins');
const loadingText = document.getElementById('loading-text');
const result = document.getElementById('result');
const guidanceEl = document.getElementById('guidance');
const haikuEl = document.getElementById('haiku');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) return;

  askStatus.textContent = '';
  result.classList.add('hidden');
  penguins.classList.remove('hidden');
  loadingText.classList.remove('hidden');
  form.querySelector('button').disabled = true;

  try {
    const response = await fetch('/api/advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await response.json();

    if (!response.ok) {
      askStatus.textContent = data.error || 'Something went wrong.';
    } else {
      guidanceEl.textContent = data.advice.guidance;
      haikuEl.textContent = data.advice.haiku;
      result.classList.remove('hidden');
    }
  } catch (err) {
    askStatus.textContent = `Could not reach the backend: ${err.message}`;
  } finally {
    penguins.classList.add('hidden');
    loadingText.classList.add('hidden');
    form.querySelector('button').disabled = false;
  }
});
