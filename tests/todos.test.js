// Tests for To-Do's rules: who ticked a to-do off (Oct 18, 2026), and
// which of us an email is. Run with `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildListFields, buildTodoUpdate, splitLeadingEmoji } from '../server/lib/todos.js';
import { actorOf, personOf } from '../server/lib/people.js';

const TODAY = '2026-10-17';
const NOW = new Date('2026-10-18T00:23:02Z');
const open = { id: 't1', title: 'Totopos', done: false, done_at: null, done_by: null, repeat: null, due_date: null, steps: [] };
const EMAILS = 'michael:Michael@Example.com, mer:mer@example.com';

test('ticking a to-do off keeps who did it and when', () => {
  const { update } = buildTodoUpdate(open, { done: true }, TODAY, { by: 'mer', now: NOW });
  assert.equal(update.done, true);
  assert.equal(update.done_at, NOW.toISOString());
  assert.equal(update.done_by, 'mer');
});

test('ticking off one that is already done keeps the first who and when', () => {
  const done = { ...open, done: true, done_at: '2026-10-18T00:14:32.121Z', done_by: 'michael' };
  const { update } = buildTodoUpdate(done, { done: true }, TODAY, { by: 'mer', now: NOW });
  assert.equal(update.done_at, '2026-10-18T00:14:32.121Z');
  assert.equal(update.done_by, 'michael');
});

test('unticking clears who and when', () => {
  const done = { ...open, done: true, done_at: NOW.toISOString(), done_by: 'mer' };
  const { update } = buildTodoUpdate(done, { done: false }, TODAY, { by: 'michael', now: NOW });
  assert.equal(update.done, false);
  assert.equal(update.done_at, null);
  assert.equal(update.done_by, null);
});

test('a repeating to-do rolls to its next date and stays open, with nobody as done_by', () => {
  const weekly = { ...open, repeat: 'weekly', due_date: '2026-10-17', steps: [{ title: 'Bins', done: true }] };
  const { update, rolled } = buildTodoUpdate(weekly, { done: true }, TODAY, { by: 'mer', now: NOW });
  assert.equal(rolled, true);
  assert.equal(update.done, false);
  assert.equal(update.done_by, null);
  assert.equal(update.due_date, '2026-10-24');
  assert.deepEqual(update.steps, [{ title: 'Bins', done: false }]);
});

test('changes that are not a tick leave done_by alone', () => {
  const { update } = buildTodoUpdate(open, { important: true, assignee: 'michael' }, TODAY, { by: 'mer', now: NOW });
  assert.equal('done_by' in update, false);
});

test('without a by, a tick is kept with nobody as done_by', () => {
  const { update } = buildTodoUpdate(open, { done: true }, TODAY, { now: NOW });
  assert.equal(update.done_by, null);
});

test('personOf names each of us from PERSON_EMAILS, ignoring case and spaces', () => {
  assert.equal(personOf('michael@example.com', EMAILS), 'michael');
  assert.equal(personOf(' MER@example.com ', EMAILS), 'mer');
});

test('personOf calls the agent Benny, and knows nobody else', () => {
  assert.equal(personOf('agent', EMAILS), 'benny');
  assert.equal(personOf('someone@example.com', EMAILS), null);
  assert.equal(personOf(null, EMAILS), null);
  assert.equal(personOf('mer@example.com', ''), null);
  assert.equal(personOf('mer@example.com', undefined), null);
});

test('personOf only maps to michael or mer', () => {
  assert.equal(personOf('x@example.com', 'benny:x@example.com,quincy:x@example.com'), null);
});

test('actorOf: a signed-in person is themselves, whatever asker says', () => {
  assert.equal(actorOf({ email: 'mer@example.com' }, undefined, EMAILS), 'mer');
  assert.equal(actorOf({ email: 'mer@example.com' }, 'michael', EMAILS), 'mer');
});

test('actorOf: Benny gets the credit unless it says which of us asked', () => {
  const agent = { email: null, agent: true };
  assert.equal(actorOf(agent, 'mer', EMAILS), 'mer');
  assert.equal(actorOf(agent, 'michael', EMAILS), 'michael');
  assert.equal(actorOf(agent, undefined, EMAILS), 'benny');
  assert.equal(actorOf(agent, 'quincy', EMAILS), 'benny');
  assert.equal(actorOf(agent, { toString: () => 'mer' }, EMAILS), 'benny');
});

test('a leading emoji becomes the list icon, as in Microsoft To Do', () => {
  assert.deepEqual(splitLeadingEmoji('🛠️Projects'), { emoji: '🛠️', name: 'Projects' });
  assert.deepEqual(splitLeadingEmoji('🛒 Groceries'), { emoji: '🛒', name: 'Groceries' });
  assert.deepEqual(splitLeadingEmoji('🇳🇱 Move'), { emoji: '🇳🇱', name: 'Move' });
  assert.deepEqual(splitLeadingEmoji('👩‍💻 Work'), { emoji: '👩‍💻', name: 'Work' });
  assert.deepEqual(splitLeadingEmoji('👍🏽 Done'), { emoji: '👍🏽', name: 'Done' });
  assert.deepEqual(splitLeadingEmoji('1️⃣ First things'), { emoji: '1️⃣', name: 'First things' });
  assert.deepEqual(splitLeadingEmoji('🛠 Bare'), { emoji: '🛠', name: 'Bare' }); // no U+FE0F
  assert.deepEqual(splitLeadingEmoji('🎃🎃 Halloween'), { emoji: '🎃', name: '🎃 Halloween' });
});

test('text that only looks like an emoji, or no emoji first, stays in the name', () => {
  for (const name of ['© Legal', '★ Stars', '#1 list', '1 thing', 'Groceries 🛒', 'Groceries', '🛒']) {
    assert.deepEqual(splitLeadingEmoji(name), { emoji: null, name });
  }
});

test('creating a list: the typed emoji wins over the default icon', () => {
  assert.deepEqual(buildListFields({ name: '  🛠️  Projects ', emoji: '📋', mode: 'tasks' }, { creating: true }).fields, {
    emoji: '🛠️', name: 'Projects', mode: 'tasks',
  });
  assert.deepEqual(buildListFields({ name: 'Hardware', emoji: '📋' }, { creating: true }).fields, { emoji: '📋', name: 'Hardware' });
});

test('renaming a list: an emoji in the name moves to the icon; the emoji field alone still works', () => {
  assert.deepEqual(buildListFields({ name: '🧰 Tools', emoji: '🛠️' }, { creating: false }).fields, { emoji: '🧰', name: 'Tools' });
  assert.deepEqual(buildListFields({ emoji: '🐧' }, { creating: false }).fields, { emoji: '🐧' });
  assert.deepEqual(buildListFields({ emoji: null }, { creating: false }).fields, { emoji: null });
});

test('list fields still refuse empty or long names, odd emoji and unknown modes', () => {
  assert.ok(buildListFields({ name: '   ' }, { creating: true }).error);
  assert.ok(buildListFields({}, { creating: true }).error);
  assert.ok(buildListFields({ name: 'x'.repeat(41) }, { creating: true }).error);
  assert.ok(buildListFields({ name: `🛠️ ${'x'.repeat(40)}` }, { creating: true }).fields); // the icon doesn't count
  assert.ok(buildListFields({ emoji: 'x'.repeat(17) }, { creating: false }).error);
  assert.ok(buildListFields({ mode: 'notes' }, { creating: false }).error);
});
