// An error that already knows which HTTP status it should become. The
// calendar-write and Gmail-draft code paths are called from two places
// now — their own routes, and approving a proposal (Stage 21) — so they
// throw this instead of writing a response themselves, and each caller
// turns it into whatever response fits.
//
// "That Google connection needs (re)connecting" is a 424, never a 401:
// auth-guard.js treats any 401 from /api as "you're signed out of Benny"
// and bounces to the login page, which would hide the real reason.

export class ActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
