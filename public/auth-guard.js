// Loaded first on every signed-in page. The pages themselves are plain
// static files (Vercel's CDN serves them directly, so the server can't
// gate them) — what's actually protected is the /api data behind them.
// This script just makes being signed out feel right in the browser:
//   1. On load, ask /api/me who's signed in; if nobody, go to /login.html.
//   2. If any later /api call comes back 401 (e.g. the session expired
//      while the page sat open), do the same.
// The session itself is an httpOnly cookie the browser sends on its own,
// so nothing here ever touches a token.

(function () {
  function goToLogin() {
    const next = location.pathname + location.search;
    location.href = '/login.html?next=' + encodeURIComponent(next);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const response = await originalFetch(input, init);
    const url = typeof input === 'string' ? input : input.url;
    if (response.status === 401 && new URL(url, location.href).pathname.startsWith('/api/')) {
      goToLogin();
    }
    return response;
  };

  window.bennySignOut = async function () {
    await originalFetch('/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  };

  originalFetch('/api/me').then((r) => {
    if (r.status === 401) goToLogin();
  });
})();
