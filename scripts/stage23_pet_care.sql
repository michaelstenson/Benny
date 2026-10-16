-- Stage 23: pet care. Records for Quincy, Rey, Poe and Morticia (profile
-- and chip, vaccinations, vet visits, medications), a Pets list in To-Do
-- for whatever comes due, and the move plan's pet tasks brought in line
-- with the rules as checked on Oct 16, 2026 (see the README's Stage 23).
--
-- Additive. Run once as the migration "stage23_pet_care" (Supabase SQL
-- editor, or apply_migration).

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  species text not null check (species in ('dog', 'cat', 'turtle', 'other')),
  breed text,
  sex text check (sex in ('male', 'female')),
  birth_date date,
  microchip_number text,
  microchip_implanted_on date,
  food text,
  -- Who their reminders are for in To-Do. Nobody means either of us.
  caretaker text check (caretaker in ('michael', 'mer')),
  vet_clinic text,
  -- Morticia stays with Joe, so the EU travel checklist skips her.
  travels boolean not null default true,
  notes text,
  position int not null default 0,
  source text not null default 'app' check (source in ('app', 'agent')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pet_vaccinations (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  vaccine text not null check (length(trim(vaccine)) > 0),
  rabies boolean not null default false,
  given_on date not null,
  valid_until date,
  -- A first shot (or one after a lapse) is only valid 21 days later.
  -- Null when nobody knows.
  primary_dose boolean,
  -- What the EU animal health certificate asks for about a rabies shot.
  product text,
  manufacturer text,
  batch text,
  vet text,
  notes text,
  reminder_todo_id uuid references public.todos(id) on delete set null,
  source text not null default 'app' check (source in ('app', 'agent')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= given_on)
);

create table public.pet_visits (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  visited_on date not null,
  clinic text,
  reason text not null check (length(trim(reason)) > 0),
  weight_lb numeric(5, 1) check (weight_lb > 0),
  notes text,
  source text not null default 'app' check (source in ('app', 'agent')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pet_medications (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  dose text,
  every text not null check (every in ('daily', 'weekly', 'monthly', 'as_needed')),
  next_due date,
  started_on date,
  ends_on date,
  notes text,
  reminder_todo_id uuid references public.todos(id) on delete set null,
  source text not null default 'app' check (source in ('app', 'agent')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pet_vaccinations_pet_id_idx on public.pet_vaccinations (pet_id);
create index pet_vaccinations_reminder_idx on public.pet_vaccinations (reminder_todo_id);
create index pet_visits_pet_id_idx on public.pet_visits (pet_id);
create index pet_medications_pet_id_idx on public.pet_medications (pet_id);
create index pet_medications_reminder_idx on public.pet_medications (reminder_todo_id);

alter table public.pets enable row level security;             -- server-only, no policies
alter table public.pet_vaccinations enable row level security;
alter table public.pet_visits enable row level security;
alter table public.pet_medications enable row level security;

insert into public.pets (name, species, travels, notes, position, created_by) values
  ('Quincy', 'dog', true, null, 0, 'stage 23 setup'),
  ('Rey', 'cat', true, null, 1, 'stage 23 setup'),
  ('Poe', 'cat', true, null, 2, 'stage 23 setup'),
  ('Morticia', 'turtle', false, 'Box turtle. Staying with Joe after the move (move tasks P-20 to P-25).', 3, 'stage 23 setup');

-- Where pet reminders land in To-Do.
insert into public.lists (slug, name, emoji, mode, position)
values ('pets', 'Pets', '🐾', 'tasks', 2)
on conflict (slug) do nothing;

-- --- The move plan's Pets tasks -------------------------------------------

update public.tasks
set notes = 'Since Oct 1, 2026 the EU uses a new animal health certificate (EU 2026/131 and 2026/705). '
         || 'A USDA-accredited vet fills it in and submits it through VEHCS; USDA must endorse it within '
         || '10 days before arrival in the EU. You sign the owner''s declaration, the endorsed original '
         || 'travels with the pets, and you report them to Customs at Schiphol on arrival. No tapeworm '
         || 'treatment is needed for the Netherlands. The Pets page shows each pet''s window.',
    updated_at = now()
where code = 'P-09';

insert into public.tasks (project_id, workstream_id, code, title, notes, owner, lead, start_date, due_date, date_precision, anchor_id, critical, created_by)
select p.id, w.id, 'P-13',
       'Enter each pet''s chip and rabies records in Benny and clear the Pets page''s EU travel checklist',
       'A rabies shot only counts if it was given after the ISO chip went in (and was scanned), at 12 weeks or older, '
       || 'and never lapsed. Otherwise a new first shot is needed at least 21 days before departure. Doing this now '
       || 'leaves time to fix it.',
       'both', 'mer', date '2026-12-01', date '2026-12-31', 'month', null, true, 'stage 23 setup'
from public.projects p
join public.workstreams w on w.project_id = p.id and w.key = 'pets'
where p.slug = 'netherlands-move'
  and not exists (select 1 from public.tasks t where t.project_id = p.id and t.code = 'P-13');

insert into public.tasks (project_id, workstream_id, code, title, notes, owner, lead, start_date, due_date, date_precision, anchor_id, critical, created_by)
select p.id, w.id, 'P-14',
       'Register Quincy in a Dutch dog database (within 2 weeks of arrival)',
       'Required for dogs staying more than 3 months (NVWA). Cats aren''t required yet; the Dutch plan is to make cat chipping mandatory from 2028.',
       'both', null, k.date + 1, k.date + 14, 'day', k.id, true, 'stage 23 setup'
from public.projects p
join public.workstreams w on w.project_id = p.id and w.key = 'pets'
join public.key_dates k on k.project_id = p.id and k.key = 'departure'
where p.slug = 'netherlands-move'
  and not exists (select 1 from public.tasks t where t.project_id = p.id and t.code = 'P-14');
