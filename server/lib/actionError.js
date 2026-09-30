// An error that already knows which HTTP status it should become. The
// calendar-write and Gmail-draft code paths are called from two places
// now — their own routes, and approving a proposal (Stage 21) — so they
// throw this instead of writing a response themselves, and each caller
// turns it into whatever response fits.

export class ActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
