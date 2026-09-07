const form = document.getElementById('add-form');
const input = document.getElementById('chore-input');
const addStatus = document.getElementById('add-status');
const choresEl = document.getElementById('chores');

const ASSIGNEE_LABEL = { michael: 'Michael', mer: 'Mer' };
// Same family colors used everywhere else (calendar dots, the house-lights
// legend) — an assignee chip should mean the same thing here too.
const ASSIGNEE_COLOR = { michael: '#34D399', mer: '#A78BFA' };

function formatDueDate(dueDate) {
  if (!dueDate) return null;
  // dueDate is "YYYY-MM-DD" — append a time so JS parses it in local time
  // instead of UTC midnight (which can display as the day before).
  const date = new Date(`${dueDate}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function choreRow(chore) {
  const dueLabel = formatDueDate(chore.due_date);
  const color = ASSIGNEE_COLOR[chore.assignee];
  const chipStyle = color
    ? `background:${color}29;color:${color};`
    : 'background:rgba(255,255,255,0.08);color:var(--hl-text-dim);';
  return `
    <li class="py-3 flex items-start gap-3">
      <input
        type="checkbox"
        data-id="${chore.id}"
        ${chore.completed ? 'checked' : ''}
        class="mt-1 chore-checkbox"
      />
      <div class="flex-1 ${chore.completed ? 'opacity-40 line-through' : ''}">
        <p class="hl-dim">${chore.title}</p>
        <p class="text-xs hl-muted mt-1">
          <span class="hl-chip" style="${chipStyle}">${ASSIGNEE_LABEL[chore.assignee] || chore.assignee}</span>
          ${dueLabel ? ' · due ' + dueLabel : ''}
        </p>
      </div>
    </li>
  `;
}

async function loadChores() {
  const response = await fetch('/api/chores');
  const data = await response.json();

  if (!response.ok) {
    choresEl.innerHTML = `<li class="py-4 text-sm hl-error">${data.error || 'Could not load chores.'}</li>`;
    return;
  }

  if (data.chores.length === 0) {
    choresEl.innerHTML = '<li class="py-4 hl-muted text-sm">No chores yet — add one above.</li>';
    return;
  }

  choresEl.innerHTML = data.chores.map(choreRow).join('');

  // Wire up the checkboxes we just rendered.
  document.querySelectorAll('.chore-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', async (event) => {
      const id = event.target.dataset.id;
      const completed = event.target.checked;
      await fetch(`/api/chores/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      loadChores(); // re-render so strikethrough/reordering reflects the change
    });
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  addStatus.textContent = 'Thinking...';
  form.querySelector('button').disabled = true;

  try {
    const response = await fetch('/api/chores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();

    if (!response.ok) {
      addStatus.textContent = data.error || 'Something went wrong.';
    } else {
      input.value = '';
      addStatus.textContent = '';
      loadChores();
    }
  } catch (err) {
    addStatus.textContent = `Could not reach the backend: ${err.message}`;
  } finally {
    form.querySelector('button').disabled = false;
  }
});

loadChores();
