// Browser-side JS for /lists.html (Stage 19). One page for every shared
// list; ?list=<slug> picks which (groceries by default). Typing
// "oat milk, eggs, coffee" adds three items — the split happens here,
// so the API only ever receives an explicit array.

const params = new URLSearchParams(location.search);
let activeSlug = params.get('list') || 'groceries';

const titleEl = document.getElementById('list-title');
const tabsEl = document.getElementById('list-tabs');
const itemsEl = document.getElementById('items');
const form = document.getElementById('add-form');
const input = document.getElementById('item-input');
const addStatus = document.getElementById('add-status');
const clearButton = document.getElementById('clear-checked');

function itemRow(item) {
  return `
    <li class="py-3 flex items-start gap-3">
      <input
        type="checkbox"
        data-id="${item.id}"
        ${item.checked ? 'checked' : ''}
        class="mt-1 item-checkbox"
      />
      <div class="flex-1 ${item.checked ? 'opacity-40 line-through' : ''}">
        <p class="hl-dim">${escapeHtml(item.text)}</p>
        ${item.source === 'agent' ? '<p class="text-xs hl-muted mt-1">via Benny 🐧</p>' : ''}
      </div>
    </li>
  `;
}

// Tabs only appear once there's more than one list to switch between.
async function loadTabs() {
  const response = await fetch('/api/lists');
  if (!response.ok) return;
  const { lists } = await response.json();
  if (lists.length < 2) return;

  tabsEl.innerHTML = lists
    .map(
      (l) => `<a href="?list=${encodeURIComponent(l.slug)}"
        class="hl-view-toggle-btn ${l.slug === activeSlug ? 'active' : ''}">
        ${escapeHtml(l.name)}${l.open_count ? ` (${l.open_count})` : ''}</a>`
    )
    .join('');
  tabsEl.style.display = '';
}

async function loadItems() {
  const response = await fetch(`/api/lists/${encodeURIComponent(activeSlug)}/items`);
  const data = await response.json();

  if (!response.ok) {
    itemsEl.innerHTML = `<li class="py-4 text-sm hl-error">${escapeHtml(data.error || 'Could not load this list.')}</li>`;
    clearButton.classList.add('hidden');
    return;
  }

  titleEl.textContent = data.list.name;
  document.title = `Benny — ${data.list.name}`;

  clearButton.classList.toggle('hidden', !data.items.some((i) => i.checked));

  if (data.items.length === 0) {
    itemsEl.innerHTML = '<li class="py-4 hl-muted text-sm">Nothing on this list — add something above.</li>';
    return;
  }

  itemsEl.innerHTML = data.items.map(itemRow).join('');

  document.querySelectorAll('.item-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', async (event) => {
      await fetch(`/api/list-items/${event.target.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked: event.target.checked }),
      });
      loadItems(); // re-render so checked items drop to the bottom
    });
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const items = input.value
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (items.length === 0) return;

  form.querySelector('button').disabled = true;
  try {
    const response = await fetch(`/api/lists/${encodeURIComponent(activeSlug)}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await response.json();

    if (!response.ok) {
      addStatus.textContent = data.error || 'Something went wrong.';
    } else {
      input.value = '';
      addStatus.textContent = data.skipped.length
        ? `Already on the list: ${data.skipped.join(', ')}`
        : '';
      loadItems();
    }
  } catch (err) {
    addStatus.textContent = `Could not reach the backend: ${err.message}`;
  } finally {
    form.querySelector('button').disabled = false;
  }
});

clearButton.addEventListener('click', async () => {
  await fetch(`/api/lists/${encodeURIComponent(activeSlug)}/items/checked`, { method: 'DELETE' });
  loadItems();
});

// Two people (and Benny) edit the same list — so pick up anyone else's
// changes whenever the page comes back into view, e.g. switching back to
// the app mid-shop.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadItems();
});

loadTabs();
loadItems();
