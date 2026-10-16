// Pet care (Stage 23): Quincy, Rey, Poe and Morticia's records (profile and
// chip, vaccinations, vet visits, medications), the EU travel checklist for
// the ones moving to the Netherlands, and reminders in To-Do's Pets list.
//
// Reminders are ordinary to-dos, written here and linked back by
// reminder_todo_id, so they show up in My Day, Planned, the brief and Benny
// like anything else:
// - A vaccination with an expiry date gets one, due two weeks before it
//   lapses, but only the latest shot of each vaccine: logging the new
//   rabies shot ticks off the old reminder, and logging an old shot for
//   the history doesn't nag about it.
// - A scheduled medication gets a repeating one, ticked off when it ends.
// - Ticking a reminder off in To-Do records nothing. Logging the new shot
//   here is what moves things on.
//
// The rules live in lib/petCare.js. Benny may read everything and log new
// records; editing or deleting records and pet profiles is app-only.

import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseClient.js';
import { householdToday } from '../lib/recurringBills.js';
import { cleanTitle } from '../lib/todos.js';
import {
  ageLabel,
  medicationReminder,
  pickFields,
  travelChecklist,
  vaccinationReminder,
} from '../lib/petCare.js';

export const petsRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PETS_LIST = 'pets';
const KINDS = {
  vaccinations: { kind: 'vaccination', table: 'pet_vaccinations', label: 'vaccination' },
  visits: { kind: 'visit', table: 'pet_visits', label: 'visit' },
  medications: { kind: 'medication', table: 'pet_medications', label: 'medication' },
};

function fail(res, status, error) {
  return res.status(status).json({ error });
}

function who(req) {
  return {
    source: req.user.agent ? 'agent' : 'app',
    created_by: req.user.agent ? 'agent' : req.user.email,
  };
}

async function findPet(id) {
  if (!UUID_PATTERN.test(id)) return null;
  const { data, error } = await supabaseAdmin.from('pets').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// The Pets list, made again if someone deleted it before the guard existed.
async function petsListId() {
  const { data, error } = await supabaseAdmin.from('lists').select('id').eq('slug', PETS_LIST).maybeSingle();
  if (error) throw error;
  if (data) return data.id;
  const { data: made, error: makeError } = await supabaseAdmin
    .from('lists')
    .insert({ slug: PETS_LIST, name: 'Pets', emoji: '🐾', mode: 'tasks', position: 2 })
    .select('id')
    .single();
  if (makeError) throw makeError;
  return made.id;
}

// The move's departure date, for the travel checklist.
async function loadDeparture() {
  const { data, error } = await supabaseAdmin
    .from('key_dates')
    .select('date, confirmed, project:projects!inner(slug)')
    .eq('key', 'departure')
    .eq('project.slug', 'netherlands-move')
    .maybeSingle();
  if (error) throw error;
  return data ? { date: data.date, confirmed: data.confirmed } : null;
}

// --- Reminders ----------------------------------------------------------------

async function createReminder(reminder, req) {
  const { data, error } = await supabaseAdmin
    .from('todos')
    .insert({
      list_id: await petsListId(),
      title: cleanTitle(reminder.title),
      assignee: reminder.assignee,
      due_date: reminder.due_date,
      repeat: reminder.repeat,
      notes: reminder.notes,
      ...who(req),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// Rewrites an open reminder. The assignee is left alone, in case one of us
// took it over in To-Do. Returns false if it's gone or already ticked off.
async function updateReminder(todoId, reminder) {
  const { data, error } = await supabaseAdmin
    .from('todos')
    .update({
      title: cleanTitle(reminder.title),
      due_date: reminder.due_date,
      repeat: reminder.repeat,
      notes: reminder.notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', todoId)
    .eq('done', false)
    .select('id');
  if (error) throw error;
  return data.length > 0;
}

async function closeReminder(todoId) {
  const { error } = await supabaseAdmin
    .from('todos')
    .update({ done: true, done_at: new Date().toISOString(), repeat: null, updated_at: new Date().toISOString() })
    .eq('id', todoId)
    .eq('done', false);
  if (error) throw error;
}

async function removeOpenReminder(todoId) {
  if (!todoId) return;
  const { error } = await supabaseAdmin.from('todos').delete().eq('id', todoId).eq('done', false);
  if (error) throw error;
}

// Keeps the record's reminder matching it: rewrite the open one, or remove
// it when there should be none. A new one is only made when `revive` is
// set (the record is new, or its dates changed), so fixing a typo in a
// note doesn't bring back a reminder someone already ticked off or
// deleted. Saves the link on the record.
async function ensureReminder(table, record, reminder, req, { revive }) {
  let todoId = record.reminder_todo_id;
  if (reminder) {
    const updated = todoId ? await updateReminder(todoId, reminder) : false;
    if (!updated && revive) todoId = await createReminder(reminder, req);
  } else if (todoId) {
    await removeOpenReminder(todoId);
    todoId = null;
  }
  if (todoId !== record.reminder_todo_id) {
    const { error } = await supabaseAdmin.from(table).update({ reminder_todo_id: todoId }).eq('id', record.id);
    if (error) throw error;
  }
  return todoId;
}

// Only the latest shot of each vaccine keeps a reminder; older ones have
// theirs ticked off. `changed` is the shot that was just added, edited or
// deleted: the latest one only gets a fresh reminder when it's the one
// that changed (or the one that changed was deleted), not when an old
// shot was logged for the history.
async function syncVaccineReminders(pet, vaccine, req, changed) {
  const { data, error } = await supabaseAdmin.from('pet_vaccinations').select('*').eq('pet_id', pet.id);
  if (error) throw error;
  const same = data
    .filter((v) => v.vaccine.toLowerCase() === vaccine.toLowerCase())
    .sort((a, b) => b.given_on.localeCompare(a.given_on) || b.created_at.localeCompare(a.created_at));
  if (!same.length) return null;
  const [latest, ...older] = same;
  for (const v of older) if (v.reminder_todo_id) await closeReminder(v.reminder_todo_id);
  const revive = changed === latest.id || !data.some((v) => v.id === changed);
  return ensureReminder('pet_vaccinations', latest, vaccinationReminder(pet, latest, householdToday()), req, { revive });
}

async function syncMedicationReminder(pet, medication, req) {
  const reminder = medicationReminder(pet, medication, householdToday());
  // An ended medication's reminder is ticked off rather than deleted, so
  // it stays under Completed for a while.
  if (!reminder && medication.reminder_todo_id) {
    await closeReminder(medication.reminder_todo_id);
    return medication.reminder_todo_id;
  }
  return ensureReminder('pet_medications', medication, reminder, req, { revive: true });
}

// Edits to these fields change a record's reminder; anything else (notes,
// batch, clinic) leaves it alone.
const REMINDER_FIELDS = {
  vaccination: ['vaccine', 'rabies', 'given_on', 'valid_until'],
  medication: ['name', 'dose', 'every', 'next_due', 'ends_on'],
};

// --- Reading ------------------------------------------------------------------

const byNewest = (field) => (a, b) => (b[field] || '').localeCompare(a[field] || '');

// Every pet (or one), with its records, its open reminders, its latest
// weight and, for the ones moving, the EU travel checklist.
async function loadPets(onlyId = null) {
  const today = householdToday();
  const petQuery = supabaseAdmin.from('pets').select('*').order('position').order('created_at');
  const [pets, vaccinations, visits, medications, departure, listId] = await Promise.all([
    onlyId ? petQuery.eq('id', onlyId) : petQuery,
    supabaseAdmin.from('pet_vaccinations').select('*'),
    supabaseAdmin.from('pet_visits').select('*'),
    supabaseAdmin.from('pet_medications').select('*'),
    loadDeparture(),
    petsListId(),
  ]);
  for (const result of [pets, vaccinations, visits, medications]) if (result.error) throw result.error;
  const { data: reminders, error } = await supabaseAdmin
    .from('todos')
    .select('id, title, due_date, assignee, repeat')
    .eq('list_id', listId)
    .eq('done', false)
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw error;

  const result = pets.data.map((pet) => {
    const mine = (rows) => rows.filter((r) => r.pet_id === pet.id);
    const petVaccinations = mine(vaccinations.data).sort(byNewest('given_on'));
    const petVisits = mine(visits.data).sort(byNewest('visited_on'));
    const petMedications = mine(medications.data).sort(byNewest('created_at'));
    const linked = new Set([...petVaccinations, ...petMedications].map((r) => r.reminder_todo_id).filter(Boolean));
    // Its own reminders, plus any to-do in the Pets list that names it
    // ("Quincy: order food").
    const named = new RegExp(`\\b${pet.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const weighed = petVisits.find((v) => v.weight_lb);
    return {
      ...pet,
      age: ageLabel(pet.birth_date, today),
      latest_weight: weighed ? { weight_lb: Number(weighed.weight_lb), on: weighed.visited_on } : null,
      due: reminders.filter((t) => linked.has(t.id) || named.test(t.title)),
      vaccinations: petVaccinations,
      visits: petVisits,
      medications: petMedications.map((m) => ({ ...m, active: !m.ends_on || m.ends_on >= today })),
      travel: travelChecklist(pet, petVaccinations, departure, today),
    };
  });
  return { today, departure, pets: result };
}

// GET /api/pets — every pet with everything above.
petsRouter.get('/pets', async (req, res) => {
  try {
    res.json(await loadPets());
  } catch (err) {
    console.error('[pets] failed to load pets:', err.message);
    fail(res, 500, 'Could not load the pets.');
  }
});

// GET /api/pets/:id — one pet, same shape.
petsRouter.get('/pets/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return fail(res, 404, 'No pet with that id.');
  try {
    const { pets, ...rest } = await loadPets(req.params.id);
    if (!pets.length) return fail(res, 404, 'No pet with that id.');
    res.json({ ...rest, pet: pets[0] });
  } catch (err) {
    console.error('[pets] failed to load a pet:', err.message);
    fail(res, 500, 'Could not load that pet.');
  }
});

// --- Pet profiles (app-only) ----------------------------------------------------

// POST /api/pets — body: name, species, and any other profile field.
petsRouter.post('/pets', async (req, res) => {
  const { values, error: invalid } = pickFields('pet', req.body, { creating: true });
  if (invalid) return fail(res, 400, invalid);
  try {
    const { data: existing, error: loadError } = await supabaseAdmin.from('pets').select('position');
    if (loadError) throw loadError;
    const { data, error } = await supabaseAdmin
      .from('pets')
      .insert({ ...values, position: Math.max(-1, ...existing.map((p) => p.position)) + 1, ...who(req) })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json({ pet: data });
  } catch (err) {
    console.error('[pets] failed to add a pet:', err.message);
    fail(res, err.code === '23505' ? 409 : 500, err.code === '23505' ? 'There is already a pet with that name.' : 'Could not add that pet.');
  }
});

// PATCH /api/pets/:id — any profile field.
petsRouter.patch('/pets/:id', async (req, res) => {
  const { values, error: invalid } = pickFields('pet', req.body, { creating: false });
  if (invalid) return fail(res, 400, invalid);
  try {
    const pet = await findPet(req.params.id);
    if (!pet) return fail(res, 404, 'No pet with that id.');
    const { data, error } = await supabaseAdmin
      .from('pets')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', pet.id)
      .select('*')
      .single();
    if (error) throw error;

    // A new name goes on its open reminders too ("Rey: …" → "Rey Skywalker: …").
    if (values.name && values.name !== pet.name) {
      const listId = await petsListId();
      const { data: open, error: openError } = await supabaseAdmin
        .from('todos')
        .select('id, title')
        .eq('list_id', listId)
        .eq('done', false)
        .like('title', `${pet.name.replace(/[%_]/g, '\\$&')}:%`);
      if (openError) throw openError;
      for (const todo of open) {
        await supabaseAdmin.from('todos').update({ title: cleanTitle(values.name + todo.title.slice(pet.name.length)) }).eq('id', todo.id);
      }
    }
    res.json({ pet: data });
  } catch (err) {
    console.error('[pets] failed to update a pet:', err.message);
    fail(res, err.code === '23505' ? 409 : 500, err.code === '23505' ? 'There is already a pet with that name.' : 'Could not save that pet.');
  }
});

// DELETE /api/pets/:id — the pet, its records and their open reminders.
petsRouter.delete('/pets/:id', async (req, res) => {
  try {
    const pet = await findPet(req.params.id);
    if (!pet) return fail(res, 404, 'No pet with that id.');
    for (const table of ['pet_vaccinations', 'pet_medications']) {
      const { data, error } = await supabaseAdmin.from(table).select('reminder_todo_id').eq('pet_id', pet.id);
      if (error) throw error;
      for (const row of data) await removeOpenReminder(row.reminder_todo_id);
    }
    const { error } = await supabaseAdmin.from('pets').delete().eq('id', pet.id);
    if (error) throw error;
    res.json({ deleted: pet.id });
  } catch (err) {
    console.error('[pets] failed to delete a pet:', err.message);
    fail(res, 500, 'Could not delete that pet.');
  }
});

// --- Records ----------------------------------------------------------------------

// A shot whose name says rabies is a rabies shot, even if the flag wasn't sent.
function withRabiesFlag(kind, values) {
  if (kind === 'vaccination' && values.vaccine && !('rabies' in values) && /rabies/i.test(values.vaccine)) {
    return { ...values, rabies: true };
  }
  return values;
}

async function reminderSummary(todoId) {
  if (!todoId) return null;
  const { data, error } = await supabaseAdmin.from('todos').select('id, title, due_date, repeat, done').eq('id', todoId).maybeSingle();
  if (error) throw error;
  return data && !data.done ? data : null;
}

// POST /api/pets/:id/vaccinations | visits | medications
petsRouter.post('/pets/:id/:records(vaccinations|visits|medications)', async (req, res) => {
  const { kind, table, label } = KINDS[req.params.records];
  const { values, error: invalid } = pickFields(kind, req.body, { creating: true });
  if (invalid) return fail(res, 400, invalid);
  try {
    const pet = await findPet(req.params.id);
    if (!pet) return fail(res, 404, 'No pet with that id.');
    const { data: record, error } = await supabaseAdmin
      .from(table)
      .insert({ ...withRabiesFlag(kind, values), pet_id: pet.id, ...who(req) })
      .select('*')
      .single();
    if (error) throw error;

    let reminderId = null;
    if (kind === 'vaccination') {
      await syncVaccineReminders(pet, record.vaccine, req, record.id);
      const { data: fresh } = await supabaseAdmin.from(table).select('reminder_todo_id').eq('id', record.id).single();
      reminderId = fresh?.reminder_todo_id;
    } else if (kind === 'medication') {
      reminderId = await syncMedicationReminder(pet, record, req);
    }
    res.status(201).json({ [kind]: { ...record, reminder_todo_id: reminderId }, reminder: await reminderSummary(reminderId) });
  } catch (err) {
    console.error(`[pets] failed to add a ${label}:`, err.message);
    fail(res, 500, `Could not save that ${label}.`);
  }
});

// PATCH and DELETE /api/pet-vaccinations/:id, /api/pet-visits/:id,
// /api/pet-medications/:id. App-only.
for (const [records, { kind, table, label }] of Object.entries(KINDS)) {
  petsRouter.patch(`/pet-${records}/:id`, async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return fail(res, 404, `No ${label} with that id.`);
    const { values, error: invalid } = pickFields(kind, req.body, { creating: false });
    if (invalid) return fail(res, 400, invalid);
    try {
      const { data: before, error: loadError } = await supabaseAdmin.from(table).select('*').eq('id', req.params.id).maybeSingle();
      if (loadError) throw loadError;
      if (!before) return fail(res, 404, `No ${label} with that id.`);
      const merged = { ...before, ...values };
      if (kind === 'vaccination' && merged.valid_until && merged.valid_until < merged.given_on) {
        return fail(res, 400, 'It expires before it was given.');
      }
      const { data: record, error } = await supabaseAdmin
        .from(table)
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', before.id)
        .select('*')
        .single();
      if (error) throw error;

      const pet = await findPet(record.pet_id);
      const touchesReminder = (REMINDER_FIELDS[kind] || []).some((f) => f in values && values[f] !== before[f]);
      if (kind === 'vaccination' && touchesReminder) {
        await syncVaccineReminders(pet, record.vaccine, req, record.id);
        if (record.vaccine.toLowerCase() !== before.vaccine.toLowerCase()) await syncVaccineReminders(pet, before.vaccine, req, null);
      } else if (kind === 'medication' && touchesReminder) {
        await syncMedicationReminder(pet, record, req);
      }
      const { data: fresh } = await supabaseAdmin.from(table).select('*').eq('id', record.id).single();
      res.json({ [kind]: fresh });
    } catch (err) {
      console.error(`[pets] failed to update a ${label}:`, err.message);
      fail(res, 500, `Could not save that ${label}.`);
    }
  });

  petsRouter.delete(`/pet-${records}/:id`, async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return fail(res, 404, `No ${label} with that id.`);
    try {
      const { data: record, error: loadError } = await supabaseAdmin.from(table).select('*').eq('id', req.params.id).maybeSingle();
      if (loadError) throw loadError;
      if (!record) return fail(res, 404, `No ${label} with that id.`);
      await removeOpenReminder(record.reminder_todo_id);
      const { error } = await supabaseAdmin.from(table).delete().eq('id', record.id);
      if (error) throw error;
      // The shot before this one may now be the latest, so it gets the reminder.
      if (kind === 'vaccination') await syncVaccineReminders(await findPet(record.pet_id), record.vaccine, req, record.id);
      res.json({ deleted: record.id });
    } catch (err) {
      console.error(`[pets] failed to delete a ${label}:`, err.message);
      fail(res, 500, `Could not delete that ${label}.`);
    }
  });
}
