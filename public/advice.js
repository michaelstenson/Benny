const form = document.getElementById('ask-form');
const input = document.getElementById('question-input');
const askStatus = document.getElementById('ask-status');
const penguins = document.getElementById('penguins');
const loadingText = document.getElementById('loading-text');
const result = document.getElementById('result');
const guidanceEl = document.getElementById('guidance');
const verdictEl = document.getElementById('verdict');
const haikuEl = document.getElementById('haiku');
const eggwashEl = document.getElementById('eggwash');

// Shows exactly one of the three playful elements — whichever format the
// backend chose for this question — and hides the other two.
function renderPlayfulReply(format, reply) {
  verdictEl.classList.add('hidden');
  haikuEl.classList.add('hidden');
  eggwashEl.classList.add('hidden');

  if (format === 'fortune_cookie') {
    verdictEl.textContent = reply;
    verdictEl.classList.remove('hidden');
  } else if (format === 'haiku') {
    haikuEl.textContent = reply;
    haikuEl.classList.remove('hidden');
  } else if (format === 'egg_wash') {
    eggwashEl.textContent = `🥚 ${reply}`;
    eggwashEl.classList.remove('hidden');
  }
}

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
      renderPlayfulReply(data.advice.format, data.advice.reply);
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
