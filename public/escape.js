// Anything that didn't come from our own code (a chore title the agent
// relayed from Discord, a calendar invite someone emailed us) has to be
// escaped before it goes into innerHTML — otherwise a title containing
// HTML would run as part of the page. Loaded before each page's own script.
window.escapeHtml = function (value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};
