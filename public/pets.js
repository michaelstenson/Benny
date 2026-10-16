// Pets (Stage 23): one card per pet, with its reminders, the EU travel
// checklist for the move, its profile, and its vaccinations, vet visits
// and medications. Everything comes from GET /api/pets; reminders are
// to-dos in To-Do's Pets list, which the server keeps in step with the
// records.

const $ = (id) => document.getElementById(id);
const esc = window.escapeHtml;
const { dayLabel } = window.MoveShared;

const PET_KEY = 'benny.pet';
const EMOJI = { dog: '🐕', cat: '🐈', turtle: '🐢', other: '🐾' };
const STATUS_ICON = { ok: '✓', warn: '!', todo: '○', info: 'i' };

let data = null; // { today, departure, pets }
const state = { petId: stored(), form: null, addingPet: false };

// Fields for each form: [field, label, input type, options]. The server
// (lib/petCare.js FIELDS) has the final say on what's valid.
const YES_NO_UNSURE = [['', 'Not sure'], ['true', 'First shot (or after a lapse)'], ['false', 'Booster']];
const FORMS = {
  pet: [
    ['breed', 'Breed', 'text'],
    ['sex', 'Sex', 'select', [['', '—'], ['male', 'Male'], ['female', 'Female']]],
    ['birth_date', 'Born', 'date'],
    ['microchip_number', 'Microchip number', 'text'],
    ['microchip_implanted_on', 'Chip put in', 'date'],
    ['food', 'Food', 'text'],
    ['vet_clinic', 'Vet clinic', 'text'],
    ['caretaker', 'Reminders go to', 'select', [['', 'Either of us'], ['michael', 'Michael'], ['mer', 'Mer']]],
    ['travels', 'Moving to the Netherlands', 'checkbox'],
    ['notes', 'Notes', 'textarea'],
  ],
  vaccination: [
    ['vaccine', 'Vaccine', 'text', 'vaccine-names'],
    ['given_on', 'Given', 'date'],
    ['valid_until', 'Valid until', 'date'],
    ['primary_dose', 'Kind of shot', 'select', YES_NO_UNSURE],
    ['product', 'Product (rabies: for the EU certificate)', 'text'],
    ['manufacturer', 'Manufacturer', 'text'],
    ['batch', 'Batch / lot', 'text'],
    ['vet', 'Vet', 'text'],
    ['notes', 'Notes', 'textarea'],
  ],
  visit: [
    ['visited_on', 'Date', 'date'],
    ['reason', 'Reason', 'text'],
    ['clinic', 'Clinic', 'text'],
    ['weight_lb', 'Weight (lb)', 'number'],
    ['notes', 'Notes', 'textarea'],
  ],
  medication: [
    ['name', 'Medication', 'text'],
    ['dose', 'Dose', 'text'],
    ['every', 'How often', 'select', [['monthly', 'Monthly'], ['weekly', 'Weekly'], ['daily', 'Daily'], ['as_needed', 'As needed']]],
    ['next_due', 'Next dose', 'date'],
    ['started_on', 'Started', 'date'],
    ['ends_on', 'Ends', 'date'],
    ['notes', 'Notes', 'textarea'],
  ],
};
const ROUTES = { vaccination: 'vaccinations', visit: 'visits', medication: 'medications' };

// --- Helpers --------------------------------------------------------------------

function stored() {
  try {
    return localStorage.getItem(PET_KEY);
  } catch {
    return null;
  }
}

function remember(id) {
  try {
    localStorage.setItem(PET_KEY, id);
  } catch {
    // Opens on the first pet next time.
  }
}

function flash(message, isError) {
  let el = $('flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash';
    el.className = 'hl-flash';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.classList.add('is-visible');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => el.classList.remove('is-visible'), 3500);
}

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

const day = (date) => (date ? dayLabel(date, data.today) : '');
const currentPet = () => data.pets.find((p) => p.id === state.petId) || data.pets[0];

// The form's value for a field, as the API wants it.
function readField(form, [field, , type]) {
  const input = form.elements[field];
  if (type === 'checkbox') return input.checked;
  const value = input.value.trim();
  if (value === '') return null;
  if (field === 'primary_dose') return value === 'true';
  if (type === 'number') return Number(value);
  return value;
}

function fieldHtml([field, label, type, options], value) {
  const id = `f-${field}`;
  if (type === 'checkbox') {
    return `<label class="hl-pet-field hl-pet-field-wide hl-pet-checkbox"><input type="checkbox" name="${field}" ${value ? 'checked' : ''} /> ${esc(label)}</label>`;
  }
  let input;
  if (type === 'select') {
    const current = value === null || value === undefined ? '' : String(value);
    input = `<select class="hl-input" name="${field}" id="${id}">${options
      .map(([v, l]) => `<option value="${esc(v)}" ${current === v ? 'selected' : ''}>${esc(l)}</option>`)
      .join('')}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea class="hl-input" name="${field}" id="${id}" rows="3">${esc(value || '')}</textarea>`;
  } else {
    const list = options ? `list="${options}"` : '';
    const step = type === 'number' ? 'step="0.1" min="0"' : '';
    input = `<input class="hl-input" type="${type}" name="${field}" id="${id}" value="${esc(value ?? '')}" ${list} ${step} autocomplete="off" />`;
  }
  const wide = type === 'textarea' ? 'hl-pet-field-wide' : '';
  return `<label class="hl-pet-field ${wide}" for="${id}"><span>${esc(label)}</span>${input}</label>`;
}

// --- Rendering --------------------------------------------------------------------

function render() {
  if (!data) return;
  const pet = currentPet();
  $('pills').innerHTML = data.pets
    .map((p) => `<button class="hl-pet-pill ${pet && p.id === pet.id ? 'is-active' : ''}" data-pet="${p.id}">
      <span>${EMOJI[p.species] || '🐾'}</span>${esc(p.name)}${p.due.length ? `<span class="hl-pet-dot" title="${p.due.length} due"></span>` : ''}</button>`)
    .join('') +
    (state.addingPet
      ? `<form id="new-pet" class="hl-pet-new"><input class="hl-input" name="name" placeholder="Name" maxlength="40" required />
          <select class="hl-input" name="species"><option value="dog">Dog</option><option value="cat">Cat</option><option value="turtle">Turtle</option><option value="other">Other</option></select>
          <button class="hl-button">Add</button></form>`
      : '<button class="hl-pet-pill hl-pet-add" data-add-pet>＋ Add pet</button>');
  if (state.addingPet) document.querySelector('#new-pet input').focus();

  if (!pet) {
    $('pet').innerHTML = '<p class="hl-muted">No pets yet.</p>';
    return;
  }

  const capital = (word) => word[0].toUpperCase() + word.slice(1);
  const facts = [
    pet.breed || capital(pet.species),
    pet.sex ? capital(pet.sex) : null,
    pet.age,
    pet.latest_weight ? `${pet.latest_weight.weight_lb} lb (${day(pet.latest_weight.on)})` : null,
  ].filter(Boolean);

  $('pet').innerHTML = `
    <div class="hl-pet-head">
      <div class="hl-pet-emoji">${EMOJI[pet.species] || '🐾'}</div>
      <div>
        <h2 class="hl-pet-name">${esc(pet.name)}</h2>
        <p class="hl-muted hl-pet-facts">${facts.map(esc).join(' · ') || 'Add details below.'}</p>
        ${pet.travels ? '' : '<span class="hl-chip hl-pet-staying">Not moving with you</span>'}
      </div>
    </div>
    ${dueSection(pet)}
    ${travelSection(pet)}
    ${profileSection(pet)}
    ${recordSection(pet, 'vaccination', 'Vaccinations', pet.vaccinations, vaccinationRow)}
    ${recordSection(pet, 'visit', 'Vet visits', pet.visits, visitRow)}
    ${recordSection(pet, 'medication', 'Medications', pet.medications, medicationRow)}
    <datalist id="vaccine-names">${['Rabies', 'DHPP', 'Bordetella', 'Leptospirosis', 'Lyme', 'Canine influenza', 'FVRCP', 'FeLV']
      .map((v) => `<option value="${v}"></option>`).join('')}</datalist>`;
}

function dueSection(pet) {
  const rows = pet.due.map((t) => `<li class="hl-pet-row">
      <span class="${t.due_date && t.due_date < data.today ? 'hl-up' : ''}">${esc(t.title)}</span>
      <span class="hl-muted">${t.due_date ? (t.due_date < data.today ? 'Overdue · ' : '') + day(t.due_date) : ''}${t.repeat ? ` · 🔁 ${esc(t.repeat)}` : ''}</span></li>`);
  return `<section class="hl-pet-section">
    <div class="hl-pet-section-head"><h3 class="hl-label">Due</h3><a href="/todo.html" class="hl-link" data-open-todo>Open in To-Do →</a></div>
    ${rows.length ? `<ul class="hl-pet-list">${rows.join('')}</ul>` : '<p class="hl-muted hl-pet-empty">Nothing due. Vaccines with an expiry date and scheduled meds show up here.</p>'}
  </section>`;
}

function travelSection(pet) {
  const t = pet.travel;
  if (!t) return '';
  const when = `${day(t.departure)}${t.departure_confirmed ? '' : ' (proposed)'}`;
  return `<section class="hl-pet-section">
    <div class="hl-pet-section-head"><h3 class="hl-label">EU travel checklist</h3>
      <span class="hl-chip ${t.ready ? 'hl-chip-done' : 'hl-pet-chip-warn'}">${t.ready ? `Ready for ${when}` : `Not ready for ${when}`}</span></div>
    <ul class="hl-pet-list">${t.items.map((i) => `<li class="hl-pet-check is-${i.status}">
      <span class="hl-pet-check-icon">${STATUS_ICON[i.status]}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>
  </section>`;
}

function profileSection(pet) {
  return `<details class="hl-pet-section hl-pet-profile" ${pet.microchip_number ? '' : 'open'}>
    <summary class="hl-pet-section-head"><h3 class="hl-label">Profile</h3><span class="hl-muted">${pet.microchip_number ? `Chip ${esc(pet.microchip_number)}` : 'Add the chip number'}</span></summary>
    <form id="profile" class="hl-pet-form">${FORMS.pet.map((f) => fieldHtml(f, pet[f[0]])).join('')}</form>
    <p class="hl-muted hl-pet-empty">Changes save as you go.</p>
  </details>`;
}

function recordSection(pet, kind, title, rows, rowHtml) {
  const form = state.form;
  const adding = form && form.kind === kind && !form.id;
  return `<section class="hl-pet-section">
    <div class="hl-pet-section-head"><h3 class="hl-label">${title}${rows.length ? ` · ${rows.length}` : ''}</h3>
      ${adding ? '' : `<button class="hl-link hl-pet-linkbtn" data-add="${kind}">＋ Add</button>`}</div>
    ${adding ? recordForm(kind, {}) : ''}
    ${rows.length ? `<ul class="hl-pet-list">${rows.map((r) => (form && form.id === r.id ? `<li>${recordForm(kind, r)}</li>` : rowHtml(r))).join('')}</ul>` : adding ? '' : '<p class="hl-muted hl-pet-empty">None yet.</p>'}
  </section>`;
}

function recordForm(kind, record) {
  const defaults = record.id ? record : { given_on: data.today, visited_on: data.today, every: 'monthly' };
  return `<form class="hl-pet-form hl-pet-record-form" data-form="${kind}" ${record.id ? `data-id="${record.id}"` : ''}>
    ${FORMS[kind].map((f) => fieldHtml(f, defaults[f[0]])).join('')}
    <div class="hl-pet-form-actions hl-pet-field-wide">
      <button type="button" class="hl-link hl-pet-linkbtn" data-cancel>Cancel</button>
      <button class="hl-button">${record.id ? 'Save' : 'Add'}</button>
    </div>
  </form>`;
}

function actions(kind, record, extra = '') {
  return `<span class="hl-pet-actions">${extra}
    <button class="hl-pet-icon" data-edit="${kind}" data-id="${record.id}" aria-label="Edit" title="Edit">✎</button>
    <button class="hl-pet-icon" data-delete="${kind}" data-id="${record.id}" aria-label="Delete" title="Delete">✕</button></span>`;
}

function by(record) {
  return record.source === 'agent' ? ' · logged by Benny' : '';
}

function vaccinationRow(v) {
  const valid = v.valid_until ? ` · valid until ${day(v.valid_until)}` : '';
  const lapsed = v.valid_until && v.valid_until < data.today;
  const detail = [v.product, v.manufacturer, v.batch && `batch ${v.batch}`, v.vet, v.primary_dose === true ? 'first shot' : null].filter(Boolean);
  return `<li class="hl-pet-row">
    <div><span>${v.rabies ? '<span class="hl-chip hl-pet-chip-rabies">Rabies</span> ' : ''}${v.rabies && /^rabies$/i.test(v.vaccine) ? '' : esc(v.vaccine)}</span>
      <span class="hl-muted ${lapsed ? 'hl-up' : ''}">Given ${day(v.given_on)}${valid}${lapsed ? ' (lapsed)' : ''}${by(v)}</span>
      ${detail.length ? `<span class="hl-muted">${esc(detail.join(' · '))}</span>` : ''}</div>
    ${actions('vaccination', v)}</li>`;
}

function visitRow(v) {
  const detail = [v.clinic, v.weight_lb ? `${Number(v.weight_lb)} lb` : null].filter(Boolean);
  return `<li class="hl-pet-row">
    <div><span>${esc(v.reason)}</span>
      <span class="hl-muted">${day(v.visited_on)}${detail.length ? ` · ${esc(detail.join(' · '))}` : ''}${by(v)}</span>
      ${v.notes ? `<span class="hl-muted">${esc(v.notes)}</span>` : ''}</div>
    ${actions('visit', v)}</li>`;
}

function medicationRow(m) {
  const how = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', as_needed: 'As needed' }[m.every];
  const when = m.active
    ? [how, m.next_due && m.every !== 'as_needed' ? `next ${day(m.next_due)}` : null, m.ends_on ? `until ${day(m.ends_on)}` : null]
    : [how, `ended ${day(m.ends_on)}`];
  const stop = m.active ? `<button class="hl-link hl-pet-linkbtn" data-stop="${m.id}">Stop</button>` : '';
  return `<li class="hl-pet-row ${m.active ? '' : 'is-ended'}">
    <div><span>${esc(m.name)}${m.dose ? ` <span class="hl-muted">(${esc(m.dose)})</span>` : ''}</span>
      <span class="hl-muted">${esc(when.filter(Boolean).join(' · '))}${by(m)}</span></div>
    ${actions('medication', m, stop)}</li>`;
}

// --- Saving ---------------------------------------------------------------------------

async function load() {
  try {
    data = await api('GET', '/api/pets');
    if (!data.pets.some((p) => p.id === state.petId)) state.petId = data.pets[0]?.id || null;
    render();
  } catch (err) {
    $('pet').innerHTML = `<p class="hl-error">${esc(err.message)}</p>`;
  }
}

async function saveProfileField(input) {
  const pet = currentPet();
  const spec = FORMS.pet.find((f) => f[0] === input.name);
  const value = readField($('profile'), spec);
  if ((pet[input.name] ?? null) === value) return;
  try {
    await api('PATCH', `/api/pets/${pet.id}`, { [input.name]: value });
    await load();
    flash('Saved.');
  } catch (err) {
    flash(err.message, true);
    render();
  }
}

async function saveRecord(form) {
  const kind = form.dataset.form;
  const id = form.dataset.id;
  const pet = currentPet();
  const body = {};
  for (const spec of FORMS[kind]) {
    const value = readField(form, spec);
    if (id) {
      const record = [...pet.vaccinations, ...pet.visits, ...pet.medications].find((r) => r.id === id);
      const before = record[spec[0]] ?? null;
      if (String(before) !== String(value) && !(before === null && value === null)) body[spec[0]] = value;
    } else if (value !== null) {
      body[spec[0]] = value;
    }
  }
  if (kind === 'vaccination' && 'vaccine' in body) body.rabies = /rabies/i.test(body.vaccine || '');
  if (id && !Object.keys(body).length) {
    state.form = null;
    return render();
  }
  try {
    const result = id
      ? await api('PATCH', `/api/pet-${ROUTES[kind]}/${id}`, body)
      : await api('POST', `/api/pets/${pet.id}/${ROUTES[kind]}`, body);
    state.form = null;
    await load();
    flash(result.reminder ? `Saved. Reminder in To-Do: ${result.reminder.title}, ${day(result.reminder.due_date)}.` : 'Saved.');
  } catch (err) {
    flash(err.message, true);
  }
}

// --- Events -----------------------------------------------------------------------------

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-pet],[data-add-pet],[data-add],[data-edit],[data-delete],[data-cancel],[data-stop],[data-open-todo]');
  if (!el) return;
  const ds = el.dataset;
  if (ds.pet) {
    state.petId = ds.pet;
    state.form = null;
    remember(ds.pet);
    return render();
  }
  if ('addPet' in ds) {
    state.addingPet = true;
    return render();
  }
  if (ds.add) {
    state.form = { kind: ds.add };
    render();
    return document.querySelector(`[data-form="${ds.add}"] input, [data-form="${ds.add}"] select`)?.focus();
  }
  if (ds.edit) {
    state.form = { kind: ds.edit, id: ds.id };
    return render();
  }
  if ('cancel' in ds) {
    state.form = null;
    return render();
  }
  if ('openTodo' in ds) {
    try {
      localStorage.setItem('benny.todo.view', 'pets');
    } catch {
      // To-Do opens on its last view instead.
    }
    return;
  }
  if (ds.stop) {
    // A course runs through its end date, so stopping now makes yesterday
    // the last day; otherwise today's reminder would still come up.
    const yesterday = new Date(Date.parse(`${data.today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    try {
      await api('PATCH', `/api/pet-medications/${ds.stop}`, { ends_on: yesterday });
      await load();
      flash('Stopped. Its reminder is ticked off.');
    } catch (err) {
      flash(err.message, true);
    }
    return;
  }
  if (ds.delete) {
    const label = { vaccination: 'this vaccination', visit: 'this visit', medication: 'this medication' }[ds.delete];
    if (!confirm(`Delete ${label}? Its open reminder goes too. This can't be undone.`)) return;
    try {
      await api('DELETE', `/api/pet-${ROUTES[ds.delete]}/${ds.id}`);
      await load();
    } catch (err) {
      flash(err.message, true);
    }
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'new-pet') {
    try {
      const { pet } = await api('POST', '/api/pets', { name: form.elements.name.value, species: form.elements.species.value });
      state.addingPet = false;
      state.petId = pet.id;
      remember(pet.id);
      await load();
    } catch (err) {
      flash(err.message, true);
    }
  }
  if (form.dataset.form) saveRecord(form);
});

// Profile fields save on their own as soon as they change.
document.addEventListener('change', (event) => {
  if (event.target.form && event.target.form.id === 'profile') saveProfileField(event.target);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !state.form) load();
});

load();
