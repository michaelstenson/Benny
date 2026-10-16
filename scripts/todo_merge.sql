-- To-Do (Oct 2026): chores and shared lists become one kind of thing, a
-- to-do that sits in a list. Chores is now a list like Groceries.
--
-- Additive on purpose: `chores` and `list_items` stay until the new code
-- has been deployed and used for a while, then a cleanup drops them. The
-- copy at the bottom keeps each row's id (so ids Benny already has still
-- work) and is an upsert, so it can be run again right before deploying
-- to carry over anything added through the old app in the meantime. Until
-- that deploy, the old tables are the truth and win.
--
-- Run once as the migration "todo_merge" (Supabase SQL editor, or
-- apply_migration). Re-run only the copy section, and only before the
-- deploy: afterwards the old tables are stale, and it would undo changes.

alter table public.lists
  add column emoji text check (emoji is null or length(emoji) <= 16),
  add column mode text not null default 'tasks' check (mode in ('tasks', 'items')),
  add column position int not null default 0;

update public.lists set emoji = '🛒', mode = 'items', position = 1 where slug = 'groceries';
insert into public.lists (slug, name, emoji, mode, position)
values ('chores', 'Chores', '🧹', 'tasks', 0)
on conflict (slug) do nothing;

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  assignee text check (assignee in ('michael', 'mer')),
  due_date date,
  important boolean not null default false,
  -- The day it was put in My Day. My Day shows today's, so it empties
  -- itself overnight without a job to clear it.
  my_day date,
  repeat text check (repeat in ('daily', 'weekly', 'monthly')),
  notes text,
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  done boolean not null default false,
  done_at timestamptz,
  raw_input text,
  source text not null default 'app' check (source in ('app', 'agent')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A repeat counts forward from the due date, so it needs one.
  check (repeat is null or due_date is not null)
);
create index todos_list_id_idx on public.todos (list_id);
create index todos_done_due_date_idx on public.todos (done, due_date);
alter table public.todos enable row level security; -- server-only, no policies

-- --- Copy (safe to re-run) -------------------------------------------------

insert into public.todos (id, list_id, title, assignee, due_date, done, done_at, raw_input, source, created_by, created_at)
select c.id, l.id, c.title, c.assignee, c.due_date, c.completed,
       -- chores never recorded when they were finished
       case when c.completed then now() end,
       c.raw_input, c.source, c.created_by, c.created_at
from public.chores c
cross join (select id from public.lists where slug = 'chores') l
on conflict (id) do update set
  title = excluded.title,
  assignee = excluded.assignee,
  due_date = excluded.due_date,
  done = excluded.done,
  done_at = case when excluded.done then coalesce(public.todos.done_at, excluded.done_at) end,
  updated_at = now();

insert into public.todos (id, list_id, title, done, done_at, source, created_by, created_at)
select i.id, i.list_id, i.text, i.checked, i.checked_at, i.source, i.created_by, i.created_at
from public.list_items i
on conflict (id) do update set
  title = excluded.title,
  done = excluded.done,
  done_at = excluded.done_at,
  updated_at = now();

-- A list item checked off and then cleared through the old app is gone
-- from list_items, so drop its copy too.
delete from public.todos t
using public.lists l
where t.list_id = l.id and l.slug <> 'chores'
  and not exists (select 1 from public.list_items i where i.id = t.id);
