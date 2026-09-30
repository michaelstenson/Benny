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

// --- Recurring bills (Stage 20): what's due when, not what it cost ---

const recurringForm = document.getElementById('recurring-form');
const recurringStatus = document.getElementById('recurring-status');
const recurringEl = document.getElementById('recurring');

function dueLabel(bill) {
  const date = new Date(`${bill.next_due_date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  if (bill.days_until === 0) return `due today (${date})`;
  if (bill.days_until === 1) return `due tomorrow (${date})`;
  return `due ${date} · in ${bill.days_until} days`;
}

function recurringRow(bill) {
  const soon = bill.active && bill.days_until <= 7;
  return `
    <li class="py-3 flex items-center justify-between gap-3 ${bill.active ? '' : 'opacity-40'}">
      <div>
        <p class="hl-dim font-medium">${escapeHtml(bill.name)}${bill.autopay ? ' <span class="text-xs hl-muted">· autopay</span>' : ''}</p>
        <p class="text-xs ${soon ? 'hl-up' : 'hl-muted'}">${bill.active ? dueLabel(bill) : `paused · the ${bill.due_day}${ordinal(bill.due_day)}`}</p>
      </div>
      <div class="text-right flex items-center gap-3">
        <span class="hl-dim">${bill.amount === null ? '<span class="hl-muted text-sm">varies</span>' : currency(bill.amount)}</span>
        <button type="button" class="hl-back text-xs" data-toggle="${bill.id}" data-active="${bill.active}">${bill.active ? 'pause' : 'resume'}</button>
        <button type="button" class="hl-back text-xs" data-delete="${bill.id}" data-name="${escapeHtml(bill.name)}">delete</button>
      </div>
    </li>
  `;
}

function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

async function loadRecurring() {
  const response = await fetch('/api/recurring-bills');
  const data = await response.json();

  if (!response.ok) {
    recurringEl.innerHTML = `<li class="py-4 text-sm hl-error">${escapeHtml(data.error || 'Could not load recurring bills.')}</li>`;
    return;
  }

  recurringEl.innerHTML =
    data.bills.length === 0
      ? '<li class="py-2 hl-muted text-sm">Nothing recurring yet — add your regular bills above.</li>'
      : data.bills.map(recurringRow).join('');

  recurringEl.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetch(`/api/recurring-bills/${button.dataset.toggle}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: button.dataset.active !== 'true' }),
      });
      loadRecurring();
    });
  });

  recurringEl.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm(`Delete "${button.dataset.name}"? Pausing keeps it around instead.`)) return;
      await fetch(`/api/recurring-bills/${button.dataset.delete}`, { method: 'DELETE' });
      loadRecurring();
    });
  });
}

recurringForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const amount = document.getElementById('recurring-amount').value;
  const body = {
    name: document.getElementById('recurring-name').value,
    amount: amount === '' ? null : Number(amount),
    due_day: Number(document.getElementById('recurring-day').value),
    autopay: document.getElementById('recurring-autopay').checked,
  };

  recurringForm.querySelector('button').disabled = true;
  try {
    const response = await fetch('/api/recurring-bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      recurringStatus.textContent = data.error || 'Something went wrong.';
    } else {
      recurringForm.reset();
      recurringStatus.textContent = '';
      loadRecurring();
    }
  } catch (err) {
    recurringStatus.textContent = `Could not reach the backend: ${err.message}`;
  } finally {
    recurringForm.querySelector('button').disabled = false;
  }
});

loadRecurring();
