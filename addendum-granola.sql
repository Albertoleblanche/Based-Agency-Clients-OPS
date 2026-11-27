-- ============================================================================
-- addendum-granola.sql
-- Tasks from Granola meetings (Nov 23). An admin pastes Granola's workspace API
-- key in Settings -> Connections; when a meeting's notes are ready, Radar reads
-- them, picks out the action items for people on the team, and suggests each as
-- a task to the person it's for. They add it (it becomes a normal task) or
-- dismiss it.
--
--   granola_connection  the key and the webhook Granola calls. Only the server
--                       reads it (row level security on, no rules for anyone).
--   task_suggestions    one row per suggested task. Each person sees and
--                       decides their own; admins and approvers can see all.
--                       Only the server adds them.
--
-- Safe to run more than once. Run in: Supabase dashboard -> SQL Editor.
-- ============================================================================

create table if not exists public.granola_connection (
  id              int primary key default 1 check (id = 1),
  api_key         text not null,
  webhook_id      text,
  webhook_secret  text,
  webhook_error   text,
  connected_at    timestamptz not null default now(),
  connected_by    uuid,
  last_read_at    timestamptz,     -- last time Radar looked for meetings
  last_note_at    timestamptz,     -- newest meeting it has read
  last_error      text
);
alter table public.granola_connection enable row level security;
-- no policies on purpose: the API key stays on the server

create table if not exists public.task_suggestions (
  id            uuid primary key default gen_random_uuid(),
  assignee_id   uuid not null references public.team_profiles(id) on delete cascade,
  title         text not null,
  description   text,
  client_id     text,
  due_date      date,
  priority      text not null default 'medium',
  source        text not null default 'granola',
  source_id     text not null,          -- the Granola note id
  source_title  text,                   -- the meeting's name
  source_url    text,                   -- the note in Granola
  source_at     timestamptz,            -- when the meeting was
  quote         text,                   -- the line in the notes it came from
  status        text not null default 'pending' check (status in ('pending', 'added', 'dismissed')),
  task_id       uuid,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (source, source_id, assignee_id, title)
);
create index if not exists task_suggestions_pending on public.task_suggestions (assignee_id) where status = 'pending';

alter table public.task_suggestions enable row level security;

drop policy if exists "suggestions: read" on public.task_suggestions;
create policy "suggestions: read" on public.task_suggestions
  for select to authenticated
  using (
    assignee_id = auth.uid()
    or exists (select 1 from public.team_profiles tp
               where tp.id = auth.uid() and tp.role in ('admin', 'approver')
                 and coalesce(tp.access_revoked, false) = false)
  );

drop policy if exists "suggestions: decide" on public.task_suggestions;
create policy "suggestions: decide" on public.task_suggestions
  for update to authenticated
  using (assignee_id = auth.uid())
  with check (assignee_id = auth.uid());

grant select, update on public.task_suggestions to authenticated;
