const loadingEl = document.getElementById('loading');
const contentEl = document.getElementById('content');
const noDataEl = document.getElementById('no-data');
const estimatedValueEl = document.getElementById('estimated-value');
const estimatedRangeEl = document.getElementById('estimated-range');
const summaryEl = document.getElementById('summary');
const pulledAtEl = document.getElementById('pulled-at');
const compsBodyEl = document.getElementById('comps-body');

const currency = (amount) =>
  amount == null
    ? '—'
    : new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(amount);

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function compRow(comp) {
  return `
    <tr>
      <td class="px-2 py-2 hl-dim">${comp.formatted_address || '—'}</td>
      <td class="px-2 py-2 hl-muted">${comp.status || '—'}</td>
      <td class="px-2 py-2 text-right hl-dim">${currency(comp.price)}</td>
      <td class="px-2 py-2 text-right hl-muted">${
        comp.price_per_sqft ? currency(comp.price_per_sqft) : '—'
      }</td>
      <td class="px-2 py-2 text-right hl-muted">${comp.bedrooms ?? '—'}/${comp.bathrooms ?? '—'}</td>
      <td class="px-2 py-2 text-right hl-muted">${comp.days_on_market ?? '—'}</td>
      <td class="px-2 py-2 text-right hl-muted">${
        comp.distance_miles != null ? `${comp.distance_miles.toFixed(2)} mi` : '—'
      }</td>
    </tr>
  `;
}

async function loadComps() {
  const response = await fetch('/api/comps');
  const data = await response.json();

  loadingEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  if (!response.ok) {
    summaryEl.textContent = data.error || 'Could not load comps.';
    return;
  }

  if (!data.estimate) {
    noDataEl.classList.remove('hidden');
    estimatedValueEl.textContent = '—';
    return;
  }

  estimatedValueEl.textContent = currency(data.estimate.estimated_price);
  estimatedRangeEl.textContent = `Range: ${currency(data.estimate.price_range_low)} – ${currency(
    data.estimate.price_range_high
  )}`;
  summaryEl.textContent = data.estimate.summary || '';
  pulledAtEl.textContent = `Last updated ${formatDate(data.estimate.pulled_at)}`;

  compsBodyEl.innerHTML =
    data.comps.length === 0
      ? '<tr><td colspan="7" class="px-2 py-4 hl-muted">No comps in this pull.</td></tr>'
      : data.comps.map(compRow).join('');
}

loadComps();
