// Browser-side JS for /log.html (Stage 22): the household decision log.
// Read-only. Decisions are recorded on the Move page and proposals are
// approved on the homepage; this just shows them together.

const TYPE_LABEL = {
  decision: '⚖️ Decision',
  key_date: '📅 Key date',
  proposal: '🐧 Benny suggestion',
};
const WHO = { michael: 'Michael', mer: 'Mer', both: 'both of us' };

function whenLabel(at) {
  if (!at) return '';
  // Decisions carry a plain date; the others a full timestamp.
  const date = at.length === 10 ? new Date(`${at}T12:00:00`) : new Date(at);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadLog() {
  const statusEl = document.getElementById('log-status');
  try {
    const response = await fetch('/api/log');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load the log.');

    if (data.entries.length === 0) {
      statusEl.textContent = 'Nothing yet. Recorded decisions and approved suggestions will show up here.';
      return;
    }
    statusEl.classList.add('hidden');
    document.getElementById('log').innerHTML = data.entries
      .map(
        (e) => `
        <li class="py-3">
          <p class="text-xs hl-muted">${TYPE_LABEL[e.type] || e.type} · ${whenLabel(e.at)}${
            e.type === 'decision' && WHO[e.by] ? ` · ${WHO[e.by]}` : ''
          }</p>
          <p class="hl-dim mt-1">${escapeHtml(e.title)}</p>
          ${e.detail ? `<p class="text-sm hl-muted mt-1 whitespace-pre-line">${escapeHtml(e.detail.trim())}</p>` : ''}
        </li>`
      )
      .join('');
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('hl-error');
  }
}

loadLog();
