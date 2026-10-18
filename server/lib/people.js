// Which of us is which (Oct 2026). Sign-in only knows emails
// (ALLOWED_EMAILS); PERSON_EMAILS says whose each one is, as
// "michael:michael@example.com,mer:mer@example.com", so To-Do can say
// "Mer" rather than an email. Benny the agent signs in with a token, and
// its rows say created_by 'agent', so it's 'benny'.

import { PEOPLE } from './moveTasks.js';

// 'michael', 'mer' or 'benny' for a created_by-style value (an email, or
// 'agent'), or null for an email PERSON_EMAILS doesn't name.
export function personOf(actor, emails = process.env.PERSON_EMAILS) {
  if (actor === 'agent') return 'benny';
  if (typeof actor !== 'string' || !actor) return null;
  for (const pair of (emails || '').split(',')) {
    const [person, email] = pair.split(':').map((s) => s.trim().toLowerCase());
    if (PEOPLE.includes(person) && email === actor.trim().toLowerCase()) return person;
  }
  return null;
}

if (!process.env.PERSON_EMAILS) {
  console.warn('[people] PERSON_EMAILS is empty — To-Do will show who ticked things off as nobody.');
}
