const form = document.getElementById('add-form');
const input = document.getElementById('bill-input');
const addStatus = document.getElementById('add-status');
const summaryEl = document.getElementById('summary');
const historyEl = document.getElementById('history');

const currency = (amount) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);

function formatMonth(billingMonth) {
  // billingMonth is "YYYY-MM-DD" (always the 1st) — append a time so JS
  // parses it in local time instead of UTC midnight.
  const date = new Date(`${billingMonth}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function trendBadge(percentChange) {
  if (percentChange === null) {
    return '<span class="hl-muted">first bill on record</span>';
  }
  const rounded = Math.round(percentChange);
  if (rounded === 0) return '<span class="hl-muted">flat vs last time</span>';
  const up = rounded > 0;
  return `<span class="${up ? 'hl-up' : 'hl-down'}">${up ? '▲' : '▼'} ${Math.abs(rounded)}% vs last time</span>`;
}

function summaryRow(entry) {
  return `
    <li class="py-3 flex items-center justify-between">
      <div>
        <p class="hl-dim font-medium">${capitalize(entry.category)}</p>
        <p class="text-xs hl-muted">${formatMonth(entry.latest.billing_month)}</p>
      </div>
      <div class="text-right">
        <p class="hl-dim font-medium">${currency(entry.latest.amount)}</p>
        <p class="text-xs">${trendBadge(entry.percentChange)}</p>
      </div>
    </li>
  `;
}

function historyRow(bill) {
  return `
    <li class="py-2 flex items-center justify-between text-sm">
      <span class="hl-muted">${capitalize(bill.category)} · ${formatMonth(bill.billing_month)}</span>
      <span class="hl-dim">${currency(bill.amount)}</span>
    </li>
  `;
}

async function loadBills() {
  const response = await fetch('/api/bills');
  const data = await response.json();

  if (!response.ok) {
    summaryEl.innerHTML = `<li class="py-4 text-sm hl-error">${data.error || 'Could not load bills.'}</li>`;
    historyEl.innerHTML = '';
    return;
  }

  summaryEl.innerHTML =
    data.summary.length === 0
      ? '<li class="py-2 hl-muted text-sm">No bills logged yet — add one above.</li>'
      : data.summary.map(summaryRow).join('');

  historyEl.innerHTML =
    data.bills.length === 0
      ? ''
      : data.bills.map(historyRow).join('');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  addStatus.textContent = 'Thinking...';
  form.querySelector('button').disabled = true;

  try {
    const response = await fetch('/api/bills', {
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
      loadBills();
    }
  } catch (err) {
    addStatus.textContent = `Could not reach the backend: ${err.message}`;
  } finally {
    form.querySelector('button').disabled = false;
  }
});

loadBills();
