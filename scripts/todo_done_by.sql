-- Who ticked a to-do off (Oct 2026), so To-Do can say "✓ Mer · 7:23 PM"
-- and "who checked off the limes?" has an answer. Additive: the column
-- starts empty, and to-dos finished before it stay unattributed.
--
-- Run once as the migration "todo_done_by" BEFORE deploying the code that
-- reads it: GET /api/todos selects done_by and fails without it.

alter table public.todos
  add column done_by text check (done_by in ('michael', 'mer', 'benny'));
