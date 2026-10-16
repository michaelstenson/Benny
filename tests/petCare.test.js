// Tests for the pet care rules (Stage 23). Run with `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageLabel,
  medicationReminder,
  pickFields,
  travelChecklist,
  vaccinationReminder,
} from '../server/lib/petCare.js';

const TODAY = '2026-10-16';
const DEPARTURE = { date: '2027-09-20', confirmed: false };
const quincy = {
  id: 'q', name: 'Quincy', species: 'dog', travels: true, caretaker: 'mer',
  microchip_number: '985 112 004 567 890', microchip_implanted_on: '2021-05-01', birth_date: '2021-02-01',
};
const rabies = (given_on, valid_until, extra = {}) => ({
  rabies: true, vaccine: 'Rabies', given_on, valid_until,
  product: 'Rabvac 3', manufacturer: 'Elanco', batch: 'A123', ...extra,
});
const statuses = (checklist) => checklist.items.map((i) => i.status);
const find = (checklist, word) => checklist.items.find((i) => i.text.includes(word));

test('a vaccine reminder comes due two weeks before it lapses, for the caretaker', () => {
  const r = vaccinationReminder(quincy, rabies('2026-03-01', '2027-03-01'), TODAY);
  assert.equal(r.title, 'Quincy: rabies due');
  assert.equal(r.due_date, '2027-02-15');
  assert.equal(r.assignee, 'mer');
  assert.match(r.notes, /Expires Mar 1, 2027/);
  assert.match(r.notes, /unbroken for the move/);
});

test('a lapsed vaccine is due today, and one with no expiry has no reminder', () => {
  const r = vaccinationReminder(quincy, rabies('2025-01-01', '2026-01-01'), TODAY);
  assert.equal(r.title, 'Quincy: rabies lapsed');
  assert.equal(r.due_date, TODAY);
  assert.equal(vaccinationReminder(quincy, rabies('2026-01-01', null), TODAY), null);
});

test('acronyms keep their capitals in a reminder', () => {
  const dhpp = { vaccine: 'DHPP', rabies: false, given_on: '2026-10-10', valid_until: '2027-10-10' };
  assert.equal(vaccinationReminder(quincy, dhpp, TODAY).title, 'Quincy: DHPP due');
  assert.doesNotMatch(vaccinationReminder(quincy, dhpp, TODAY).notes, /unbroken/);
});

test('a scheduled medication repeats; as-needed and ended ones make no to-do', () => {
  const r = medicationReminder(quincy, { name: 'Heartgard', dose: '1 chew', every: 'monthly', next_due: '2026-11-01' }, TODAY);
  assert.deepEqual([r.title, r.repeat, r.due_date], ['Quincy: Heartgard (1 chew)', 'monthly', '2026-11-01']);
  assert.equal(medicationReminder(quincy, { name: 'Gabapentin', every: 'as_needed' }, TODAY), null);
  assert.equal(medicationReminder(quincy, { name: 'Antibiotic', every: 'daily', ends_on: '2026-10-01' }, TODAY), null);
  assert.equal(medicationReminder(quincy, { name: 'Antibiotic', every: 'daily' }, TODAY).due_date, TODAY);
});

test('a dog with a good chip and an unbroken rabies run is ready', () => {
  const c = travelChecklist(quincy, [rabies('2025-04-01', '2026-04-01'), rabies('2026-03-20', '2029-03-20')], DEPARTURE, TODAY);
  assert.equal(c.ready, true);
  assert.equal(c.arrival, '2027-09-21');
  assert.deepEqual(statuses(c), ['ok', 'ok', 'info', 'info']);
  assert.match(find(c, 'USDA endorses').text, /between Sep 11, 2027 and Sep 20, 2027/);
  assert.match(find(c, 'Dutch dog database').text, /by Oct 4, 2027/);
});

test('a rabies shot from before the chip went in does not count', () => {
  const early = { ...quincy, microchip_implanted_on: '2026-06-01' };
  const c = travelChecklist(early, [rabies('2026-03-20', '2029-03-20')], DEPARTURE, TODAY);
  assert.equal(c.ready, false);
  assert.match(find(c, 'before the chip').text, /new first shot is needed by Aug 30, 2027/);
});

test('rabies that lapses before arrival, or has already lapsed, is flagged', () => {
  const before = travelChecklist(quincy, [rabies('2026-03-20', '2027-03-20')], DEPARTURE, TODAY);
  assert.match(find(before, 'before you land').text, /Rabies expires Mar 20, 2027/);
  const lapsed = travelChecklist(quincy, [rabies('2025-03-20', '2026-03-20')], DEPARTURE, TODAY);
  assert.match(find(lapsed, 'lapsed').text, /given by Aug 30, 2027/);
});

test('a booster after a lapse is a new first shot, valid 21 days later', () => {
  const shots = [rabies('2024-01-01', '2025-01-01'), rabies('2027-09-10', '2030-09-10')];
  const c = travelChecklist(quincy, shots, DEPARTURE, TODAY);
  assert.match(find(c, 'only valid from').text, /Oct 1, 2027/);
});

test('missing chip, chip date and certificate details are to-dos, not passes', () => {
  const bare = { id: 'r', name: 'Rey', species: 'cat', travels: true };
  const c = travelChecklist(bare, [], DEPARTURE, TODAY);
  assert.deepEqual(statuses(c), ['todo', 'todo', 'info']);
  const noChipDate = travelChecklist({ ...bare, microchip_number: '985112004567890' }, [rabies('2026-01-01', '2029-01-01', { batch: null })], DEPARTURE, TODAY);
  assert.ok(find(noChipDate, 'date the chip went in'));
  assert.ok(find(noChipDate, 'batch number'));
  assert.equal(find(noChipDate, 'Dutch dog database'), undefined); // cats aren't registered
});

test('a short chip number is flagged as maybe not ISO', () => {
  const c = travelChecklist({ ...quincy, microchip_number: '4A2B3C4D5E' }, [rabies('2026-03-20', '2029-03-20')], DEPARTURE, TODAY);
  assert.equal(c.items[0].status, 'warn');
});

test('Morticia, who is not travelling, gets no checklist', () => {
  assert.equal(travelChecklist({ name: 'Morticia', species: 'turtle', travels: false }, [], DEPARTURE, TODAY), null);
});

test('fields are checked and cleaned', () => {
  assert.deepEqual(pickFields('visit', { visited_on: '2026-10-01', reason: '  Annual  exam ', weight_lb: 61.4 }, { creating: true }).values,
    { visited_on: '2026-10-01', reason: 'Annual exam', weight_lb: 61.4 });
  assert.match(pickFields('visit', { visited_on: '2026-10-01' }, { creating: true }).error, /reason/);
  assert.match(pickFields('vaccination', { vaccine: 'Rabies', given_on: '2026-10-01', valid_until: '2026-01-01' }, { creating: true }).error, /expires before/);
  assert.match(pickFields('medication', { name: 'X', every: 'hourly' }, { creating: true }).error, /every/);
  assert.match(pickFields('pet', { caretaker: 'joe' }, { creating: false }).error, /caretaker/);
  assert.deepEqual(pickFields('pet', { breed: '', sex: '' }, { creating: false }).values, { breed: null, sex: null });
  assert.match(pickFields('pet', {}, { creating: false }).error, /Nothing to change/);
});

test('ages read naturally', () => {
  assert.equal(ageLabel('2021-02-01', TODAY), '5 years');
  assert.equal(ageLabel('2026-03-20', TODAY), '6 months');
  assert.equal(ageLabel('2026-09-20', TODAY), '3 weeks');
  assert.equal(ageLabel(null, TODAY), null);
});
