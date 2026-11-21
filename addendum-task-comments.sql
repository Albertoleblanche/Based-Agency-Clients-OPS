-- ============================================================================
-- addendum-task-comments.sql
-- Comments on a task, shown in the task panel (Tasks → click a task → Activity).
--
-- Like tasks themselves, comments are private to the two people on the task:
-- the person who assigned it and the person it's assigned to. Nobody else on
-- the team can read them, admins included.
--
-- Safe to run more than once. Until it has been run, the task panel simply
-- doesn't show the comment box (no redeploy needed after running it).
-- Run in: Supabase dashboard → SQL Editor.
-- ============================================================================

create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

alter table public.task_comments enable row level security;
grant select, insert, delete on public.task_comments to authenticated;

-- Read: only the assigner and the assignee of the task.
drop policy if exists "task people read comments" on public.task_comments;
create policy "task people read comments" on public.task_comments
  for select to authenticated
  using (exists (
    select 1 from public.tasks t
    where t.id = task_comments.task_id
      and (t.assigner_id = auth.uid() or t.assignee_id = auth.uid())
  ));

-- Write: the same two people, as themselves.
drop policy if exists "task people add comments" on public.task_comments;
create policy "task people add comments" on public.task_comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and (t.assigner_id = auth.uid() or t.assignee_id = auth.uid())
    )
  );

-- Delete: your own comments only.
drop policy if exists "authors delete their comments" on public.task_comments;
create policy "authors delete their comments" on public.task_comments
  for delete to authenticated
  using (user_id = auth.uid());
