-- ============================================================================
-- addendum-colors-and-plan.sql
--
-- 1. Colors on tasks and notes. Tasks and Notes show the color as a colored
--    edge on the card; None leaves it plain.
-- 2. Plan: your sprints (a few days of focused work with dates, a goal, hours
--    and reminders), and the hours a week you keep for planned work. Both are
--    private: nobody else on the team can read them, admins included.
--    A sprint's steps are ordinary tasks, linked with tasks.sprint_id.
--
-- Safe to run more than once. Until it has been run, tasks and notes save
-- without a color (the app says so once), and Plan shows everything coming up
-- but asks for this update before you can plan a sprint. No redeploy needed.
-- Run in: Supabase dashboard → SQL Editor.
-- ============================================================================

-- 1. Colors -------------------------------------------------------------------
alter table public.tasks add column if not exists color text;
alter table public.notes add column if not exists color text;

do $$ begin
  alter table public.tasks add constraint tasks_color_check
    check (color is null or color in ('red', 'yellow', 'green', 'blue', 'purple', 'gray'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.notes add constraint notes_color_check
    check (color is null or color in ('red', 'yellow', 'green', 'blue', 'purple', 'gray'));
exception when duplicate_object then null; end $$;

-- 2. Plan ---------------------------------------------------------------------
create table if not exists public.plan_sprints (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  client_id   text,                                   -- the client it's for, if any
  note_id     text,                                   -- the note it was planned from, if any
  start_date  date not null,
  end_date    date not null,
  hours       numeric(6,1) not null default 0 check (hours >= 0),
  goal        text check (goal is null or char_length(goal) <= 2000),
  color       text check (color is null or color in ('red', 'yellow', 'green', 'blue', 'purple', 'gray')),
  -- [{ "kind": "start" | "half" | "end" | "custom", "label": "...", "at": "<ISO time>", "sent": false }]
  reminders   jsonb not null default '[]'::jsonb,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint plan_sprints_dates check (end_date >= start_date)
);
create index if not exists plan_sprints_user_idx on public.plan_sprints (user_id, start_date);

create table if not exists public.plan_settings (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  weekly_hours numeric(5,1) not null default 20 check (weekly_hours > 0 and weekly_hours <= 80),
  updated_at   timestamptz not null default now()
);

-- A sprint's steps are tasks; deleting the sprint keeps the tasks.
alter table public.tasks add column if not exists sprint_id uuid references public.plan_sprints(id) on delete set null;
create index if not exists tasks_sprint_idx on public.tasks (sprint_id) where sprint_id is not null;

-- Private to the person who made them.
alter table public.plan_sprints enable row level security;
alter table public.plan_settings enable row level security;
grant select, insert, update, delete on public.plan_sprints to authenticated;
grant select, insert, update, delete on public.plan_settings to authenticated;

drop policy if exists "own sprints" on public.plan_sprints;
create policy "own sprints" on public.plan_sprints
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own plan settings" on public.plan_settings;
create policy "own plan settings" on public.plan_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
