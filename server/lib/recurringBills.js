// Date math for recurring bills (Stage 20). A recurring bill only stores
// a day of the month ("due on the 15th"); these work out when that next
// lands, from the household's own "today" in Chicago.
//
// Everything here works on plain YYYY-MM-DD strings and Date.UTC, never
// the server's local clock, so there's no timezone drift — Vercel runs
// in UTC, the household doesn't.

export const HOUSEHOLD_TIMEZONE = 'America/Chicago';

export function householdToday(now = new Date()) {
  // en-CA gives YYYY-MM-DD directly — same trick as digest.js.
  return now.toLocaleDateString('en-CA', { timeZone: HOUSEHOLD_TIMEZONE });
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function toDateString(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

// The next date (today counts) a bill due on `dueDay` falls on. A bill
// due on the 31st is due on the last day of shorter months — Feb 28/29,
// Apr 30 — rather than skipping them.
export function nextDueDate(dueDay, today) {
  const [year, month, day] = today.split('-').map(Number);
  const monthIndex = month - 1;

  const thisMonth = Math.min(dueDay, daysInMonth(year, monthIndex));
  if (thisMonth >= day) return toDateString(year, monthIndex, thisMonth);

  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonthIndex = (monthIndex + 1) % 12;
  return toDateString(nextYear, nextMonthIndex, Math.min(dueDay, daysInMonth(nextYear, nextMonthIndex)));
}

export function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

// Adds next_due_date + days_until to each bill row.
export function withNextDue(bill, today) {
  const next_due_date = nextDueDate(bill.due_day, today);
  return { ...bill, next_due_date, days_until: daysBetween(today, next_due_date) };
}
