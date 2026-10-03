-- Stage 22, reshaped around the Netherlands move roadmap.
--
-- The first stage22 migration (stage22_projects_module, Oct 1) created
-- milestones + milestone_dependencies that never had code or rows; tasks
-- and key dates replace them. The separate "home-sale" project becomes the
-- House & Money workstream of the move, so its row goes too.
--
-- Run once, as the migration "stage22_move_tracker" (Supabase SQL editor,
-- or apply_migration), then run scripts/import-roadmap.js.

drop table public.milestone_dependencies;
drop table public.milestones;
delete from public.projects where slug = 'home-sale';

alter table public.projects add column why text;

create table public.workstreams (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9-]+$'),
  name text not null check (length(trim(name)) > 0),
  code_prefix text not null check (code_prefix ~ '^[A-Z]$'),
  lead text check (lead in ('michael', 'mer')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, key),
  unique (project_id, code_prefix)
);

create table public.key_dates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9-]+$'),
  title text not null check (length(trim(title)) > 0),
  date date not null,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, key)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  workstream_id uuid not null references public.workstreams(id) on delete restrict,
  code text unique check (code ~ '^[A-Z]-[0-9]{2,3}$'),
  title text not null check (length(trim(title)) > 0),
  notes text,
  owner text not null default 'both' check (owner in ('michael', 'mer', 'both')),
  lead text check (lead in ('michael', 'mer')),
  start_date date,
  due_date date,
  date_precision text not null default 'day' check (date_precision in ('day', 'month')),
  anchor_id uuid references public.key_dates(id) on delete set null,
  status text not null default 'todo' check (status in ('todo', 'doing', 'waiting', 'done', 'dropped')),
  waiting_on text,
  waiting_since date,
  critical boolean not null default false,
  focus boolean not null default false,
  repeat text check (repeat in ('weekly', 'monthly', 'quarterly')),
  repeat_until date,
  times_done int not null default 0,
  last_done_on date,
  tag text,
  link_url text check (link_url is null or link_url ~ '^https?://'),
  completed_at timestamptz,
  source text not null default 'app' check (source in ('app', 'agent')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date is null or due_date is null or start_date <= due_date),
  check ((status = 'done') = (completed_at is not null))
);
create index tasks_project_id_idx on public.tasks (project_id);
create index tasks_workstream_id_idx on public.tasks (workstream_id);
create index tasks_anchor_id_idx on public.tasks (anchor_id);

alter table public.decisions
  add column code text unique check (code ~ '^D[0-9]{1,2}$'),
  add column decide_by date,
  add column options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  add column notes text,
  add column key_date_id uuid references public.key_dates(id) on delete set null,
  add constraint decisions_decided_by_check check (decided_by is null or decided_by in ('michael', 'mer', 'both'));

create table public.decision_inputs (
  decision_id uuid not null references public.decisions(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  primary key (decision_id, task_id)
);
create index decision_inputs_task_id_idx on public.decision_inputs (task_id);

create table public.key_date_changes (
  id uuid primary key default gen_random_uuid(),
  key_date_id uuid not null references public.key_dates(id) on delete cascade,
  old_date date not null,
  new_date date not null,
  tasks_shifted int not null default 0,
  decision_id uuid references public.decisions(id) on delete set null,
  changed_by text,
  created_at timestamptz not null default now()
);
create index key_date_changes_key_date_id_idx on public.key_date_changes (key_date_id);

alter table public.workstreams enable row level security;      -- server-only, no policies
alter table public.key_dates enable row level security;
alter table public.tasks enable row level security;
alter table public.decision_inputs enable row level security;
alter table public.key_date_changes enable row level security;

-- Moving a key date moves every open task pinned to it by the same number
-- of days and logs the change, all in one transaction. Only the server's
-- service_role key may call it.
create function public.move_key_date(
  p_key_date_id uuid,
  p_new_date date,
  p_decision_id uuid default null,
  p_changed_by text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old date;
  v_delta int;
  v_shifted int := 0;
begin
  select date into v_old from public.key_dates where id = p_key_date_id for update;
  if not found then
    raise exception 'key date not found' using errcode = 'P0002';
  end if;

  v_delta := p_new_date - v_old;
  if v_delta <> 0 then
    update public.tasks
       set start_date = start_date + v_delta,
           due_date = due_date + v_delta,
           repeat_until = repeat_until + v_delta,
           date_precision = 'day',
           updated_at = now()
     where anchor_id = p_key_date_id
       and status not in ('done', 'dropped');
    get diagnostics v_shifted = row_count;
  end if;

  update public.key_dates
     set date = p_new_date,
         confirmed = confirmed or p_decision_id is not null
   where id = p_key_date_id;

  insert into public.key_date_changes (key_date_id, old_date, new_date, tasks_shifted, decision_id, changed_by)
  values (p_key_date_id, v_old, p_new_date, v_shifted, p_decision_id, p_changed_by);

  return jsonb_build_object('old_date', v_old, 'new_date', p_new_date, 'delta_days', v_delta, 'tasks_shifted', v_shifted);
end;
$$;
revoke all on function public.move_key_date(uuid, date, uuid, text) from public, anon, authenticated;
grant execute on function public.move_key_date(uuid, date, uuid, text) to service_role;
