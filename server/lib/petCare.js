// The rules behind pet care (Stage 23): which fields a record takes, what
// to-do a vaccination or medication puts in the Pets list, and the EU
// travel checklist for the Netherlands move. Pure functions over plain
// rows, like moveTasks.js, so the route and the tests share one copy.
//
// The travel rules were checked on Oct 16, 2026 against USDA APHIS's
// Netherlands page (updated Sept 2, 2026), the NVWA and the EU's
// pet-movement pages (EU 2026/131, 2026/705). See the README's Stage 23.
// Dates are YYYY-MM-DD strings in the household's time zone.

import { PEOPLE, addDays, isDateString } from './moveTasks.js';

export const SPECIES = ['dog', 'cat', 'turtle', 'other'];
export const EVERY = ['daily', 'weekly', 'monthly', 'as_needed'];
export const REMINDER_LEAD_DAYS = 14; // vaccine reminders come due this long before it lapses
const PRIMARY_WAIT_DAYS = 21; // a first rabies shot is valid this long after it's given
const CERTIFICATE_DAYS = 10; // USDA endorses the EU certificate within this long before arrival
const DOG_REGISTRATION_DAYS = 14; // a dog is registered in NL within this long after arrival
const MIN_RABIES_AGE_DAYS = 84; // 12 weeks

// --- Fields ------------------------------------------------------------------

const text = (max, required = false) => ({ type: 'text', max, required });
const date = (required = false) => ({ type: 'date', required });
const oneOf = (values, required = false) => ({ type: 'enum', values, required });
const flag = (nullable = false) => ({ type: 'bool', nullable });
const number = (min, max) => ({ type: 'number', min, max });

export const FIELDS = {
  pet: {
    name: text(40, true),
    species: oneOf(SPECIES, true),
    breed: text(80),
    sex: oneOf(['male', 'female']),
    birth_date: date(),
    microchip_number: text(30),
    microchip_implanted_on: date(),
    food: text(300),
    caretaker: oneOf(PEOPLE),
    vet_clinic: text(120),
    travels: flag(),
    notes: text(4000),
  },
  vaccination: {
    vaccine: text(80, true),
    rabies: flag(),
    given_on: date(true),
    valid_until: date(),
    primary_dose: flag(true),
    product: text(120),
    manufacturer: text(120),
    batch: text(60),
    vet: text(120),
    notes: text(2000),
  },
  visit: {
    visited_on: date(true),
    clinic: text(120),
    reason: text(300, true),
    weight_lb: number(0.1, 400),
    notes: text(2000),
  },
  medication: {
    name: text(120, true),
    dose: text(120),
    every: oneOf(EVERY, true),
    next_due: date(),
    started_on: date(),
    ends_on: date(),
    notes: text(2000),
  },
};

// Validates a request body for one kind of record. Creating needs every
// required field; an update takes any subset. Empty text becomes null.
// Returns { values } or { error }.
export function pickFields(kind, body, { creating }) {
  const spec = FIELDS[kind];
  const values = {};
  for (const [field, rule] of Object.entries(spec)) {
    if (!(field in (body || {}))) {
      if (creating && rule.required) return { error: `"${field}" is required.` };
      continue;
    }
    let value = body[field];
    if (rule.type === 'text') {
      if (value !== null && typeof value !== 'string') return { error: `"${field}" must be text.` };
      value = value === null ? null : value.trim().replace(/[ \t]+/g, ' ').slice(0, rule.max) || null;
    } else if (rule.type === 'date') {
      if (value === '') value = null;
      if (value !== null && !isDateString(value)) return { error: `"${field}" must be a YYYY-MM-DD date.` };
    } else if (rule.type === 'enum') {
      if (value === '') value = null;
      if (value !== null && !rule.values.includes(value)) return { error: `"${field}" must be one of ${rule.values.join(', ')}.` };
    } else if (rule.type === 'bool') {
      if (!(typeof value === 'boolean' || (rule.nullable && value === null))) return { error: `"${field}" must be true or false.` };
    } else if (rule.type === 'number') {
      if (value === '') value = null;
      if (value !== null && (typeof value !== 'number' || !(value >= rule.min && value <= rule.max))) {
        return { error: `"${field}" must be a number from ${rule.min} to ${rule.max}.` };
      }
    }
    if (rule.required && value === null) return { error: `"${field}" can't be empty.` };
    values[field] = value;
  }
  if (kind === 'vaccination' && values.given_on && values.valid_until && values.valid_until < values.given_on) {
    return { error: 'It expires before it was given.' };
  }
  if (!creating && Object.keys(values).length === 0) return { error: 'Nothing to change.' };
  return { values };
}

// --- Reminders in the Pets list ----------------------------------------------

export function longDate(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

// The to-do a vaccination puts in the Pets list: due two weeks before it
// lapses (today, if that's already passed). None without an expiry date.
export function vaccinationReminder(pet, vaccination, today) {
  if (!vaccination.valid_until) return null;
  const due = addDays(vaccination.valid_until, -REMINDER_LEAD_DAYS);
  const lapsed = vaccination.valid_until < today;
  const rabiesNote = vaccination.rabies && pet.travels
    ? ' Rabies has to stay unbroken for the move: a lapse means a new first shot, valid 21 days later.'
    : '';
  // "Rabies" reads as "rabies due"; an acronym like DHPP stays as it is.
  const name = /^[A-Z][a-z -]*$/.test(vaccination.vaccine) ? vaccination.vaccine.toLowerCase() : vaccination.vaccine;
  return {
    title: `${pet.name}: ${name} ${lapsed ? 'lapsed' : 'due'}`,
    due_date: due < today ? today : due,
    assignee: pet.caretaker || null,
    repeat: null,
    notes: `${lapsed ? 'Lapsed' : 'Expires'} ${longDate(vaccination.valid_until)}. Log the new shot on the Pets page; that ticks this off.${rabiesNote}`,
  };
}

// A medication on a schedule becomes a repeating to-do. "As needed", or
// one that has ended, makes none.
export function medicationReminder(pet, medication, today) {
  if (medication.every === 'as_needed') return null;
  if (medication.ends_on && medication.ends_on < today) return null;
  return {
    title: `${pet.name}: ${medication.name}${medication.dose ? ` (${medication.dose})` : ''}`,
    due_date: medication.next_due || today,
    assignee: pet.caretaker || null,
    repeat: medication.every,
    notes: medication.ends_on ? `Until ${longDate(medication.ends_on)}.` : null,
  };
}

// --- The EU travel checklist ---------------------------------------------------

const ISO_CHIP = /^\d{15}$/;

// Rabies shots that count for travel: given after the chip went in. Then
// the current unbroken run of them: a shot given after the one before had
// lapsed (or marked as a first dose) starts a new run, and the first shot
// of a run is only valid 21 days later.
function rabiesRun(shots, chipDate) {
  const counted = shots
    .filter((s) => s.rabies && (!chipDate || s.given_on >= chipDate))
    .sort((a, b) => a.given_on.localeCompare(b.given_on));
  let start = null;
  let previous = null;
  for (const shot of counted) {
    const lapsed = !previous || !previous.valid_until || shot.given_on > previous.valid_until;
    if (lapsed || shot.primary_dose === true) start = shot;
    previous = shot;
  }
  return { start, latest: previous, counted };
}

// What's done and what's missing for one pet to enter the Netherlands on
// `departure` (landing the next day), given that pet's vaccinations.
// Items are { status, text } with
// status ok, warn (needs fixing), todo (needs entering) or info. Pets that
// aren't travelling get null.
export function travelChecklist(pet, vaccinations, departure, today) {
  if (!pet.travels || !departure?.date) return null;
  const leave = departure.date;
  const arrival = addDays(leave, 1);
  const lastFirstShot = addDays(leave, -PRIMARY_WAIT_DAYS);
  const items = [];

  const chip = (pet.microchip_number || '').replace(/\D/g, '');
  if (!pet.microchip_number) {
    items.push({ status: 'todo', text: 'Add the microchip number.' });
  } else if (!ISO_CHIP.test(chip)) {
    items.push({
      status: 'warn',
      text: 'The chip number isn\'t 15 digits, so it may not be ISO. Bring a scanner that reads it, or have the vet add an ISO chip before the next rabies shot.',
    });
  } else {
    items.push({ status: 'ok', text: `ISO chip ${chip}.` });
  }
  if (pet.microchip_number && !pet.microchip_implanted_on) {
    items.push({ status: 'todo', text: 'Add the date the chip went in, so the rabies shots can be checked against it.' });
  }

  const rabies = vaccinations.filter((s) => s.rabies);
  const { start, latest } = rabiesRun(vaccinations, pet.microchip_implanted_on);

  if (!rabies.length) {
    items.push({
      status: 'todo',
      text: 'Log the rabies shot, with its product, manufacturer and batch (the EU certificate asks for them).',
    });
  } else if (!latest) {
    items.push({
      status: 'warn',
      text: `Every rabies shot logged was before the chip went in (${longDate(pet.microchip_implanted_on)}), so none count. A new first shot is needed by ${longDate(lastFirstShot)}.`,
    });
  } else {
    if (pet.birth_date && start.given_on < addDays(pet.birth_date, MIN_RABIES_AGE_DAYS)) {
      items.push({ status: 'warn', text: `The first rabies shot (${longDate(start.given_on)}) was before 12 weeks old. Ask the vet whether it counts.` });
    }
    if (!latest.valid_until) {
      items.push({ status: 'todo', text: `Add when the rabies shot from ${longDate(latest.given_on)} expires.` });
    } else if (latest.valid_until < today) {
      items.push({
        status: 'warn',
        text: `Rabies lapsed on ${longDate(latest.valid_until)}. The next shot counts as a new first shot and has to be given by ${longDate(lastFirstShot)}.`,
      });
    } else if (latest.valid_until < arrival) {
      items.push({
        status: 'warn',
        text: `Rabies expires ${longDate(latest.valid_until)}, before you land. Get the booster before it lapses; if it lapses, the next shot has to be by ${longDate(lastFirstShot)}.`,
      });
    } else {
      items.push({ status: 'ok', text: `Rabies valid until ${longDate(latest.valid_until)}, past arrival.` });
    }
    const validFrom = addDays(start.given_on, PRIMARY_WAIT_DAYS);
    if (start === latest && validFrom > leave) {
      items.push({ status: 'warn', text: `This first shot is only valid from ${longDate(validFrom)}, after departure. It needed to be by ${longDate(lastFirstShot)}.` });
    }
    if (!latest.product || !latest.manufacturer || !latest.batch) {
      items.push({ status: 'todo', text: 'Add the rabies shot\'s product, manufacturer and batch number (from the vaccine certificate).' });
    }
  }

  items.push({
    status: 'info',
    text: `EU health certificate: a USDA-accredited vet fills it in, and USDA endorses it between ${longDate(addDays(arrival, -CERTIFICATE_DAYS))} and ${longDate(leave)} (within 10 days before you land). No blood test or tapeworm treatment is needed for the Netherlands.`,
  });
  if (pet.species === 'dog') {
    items.push({
      status: 'info',
      text: `After landing: register ${pet.name} in a Dutch dog database by ${longDate(addDays(arrival, DOG_REGISTRATION_DAYS - 1))} (move task P-14).`,
    });
  }

  return {
    departure: leave,
    departure_confirmed: Boolean(departure.confirmed),
    arrival,
    ready: !items.some((i) => i.status === 'warn' || i.status === 'todo'),
    items,
  };
}

// "4 years", "7 months", "3 weeks", from a birth date.
export function ageLabel(birthDate, today) {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 0) return null;
  if (months >= 24) return `${Math.floor(months / 12)} years`;
  if (months >= 1) return `${months} month${months === 1 ? '' : 's'}`;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${birthDate}T00:00:00Z`)) / 86_400_000);
  return `${Math.max(1, Math.floor(days / 7))} weeks`;
}
