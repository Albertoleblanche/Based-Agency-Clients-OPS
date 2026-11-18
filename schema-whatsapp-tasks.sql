-- ============================================================================
-- schema-whatsapp-tasks.sql
-- Tables for the WhatsApp client-task agent (see whatsapp-connector/README.md).
--
-- The connector (a small Node service on the office PC) reads client WhatsApp
-- groups READ-ONLY, extracts open client requests / questions, and writes them
-- here. The "WhatsApp Tasks" screen in Radar reads from these tables.
--
-- Who sees what:
--   * admin / approver (Eric, Dan)  -> every task, every group, run history
--   * everyone else                 -> only the tasks assigned to them
--   * raw chat messages             -> admin / approver only
--   * the connector writes with the service-role key (bypasses RLS)
--
-- Safe to run more than once.
-- Run in: Supabase dashboard -> SQL Editor.
-- ============================================================================

-- ---- Client groups the connector is allowed to read ------------------------
create table if not exists public.wa_groups (
  jid         text primary key,                  -- WhatsApp group id, e.g. 1203...@g.us
  name        text not null,
  client_id   text,                              -- optional link to a Radar client id
  active      boolean not null default true,     -- false = connector ignores the group
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---- Messages (client groups only; personal chats are never stored) --------
create table if not exists public.wa_messages (
  id          bigint generated always as identity primary key,
  wa_msg_id   text not null,
  group_jid   text not null references public.wa_groups(jid) on delete cascade,
  sender      text,                              -- display name or phone
  from_team   boolean not null default false,    -- true when sent by the agency side
  text        text not null,
  ts          timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (group_jid, wa_msg_id)
);
create index if not exists wa_messages_group_ts_idx on public.wa_messages (group_jid, ts desc);

-- ---- Extracted tasks --------------------------------------------------------
create table if not exists public.wa_tasks (
  id               uuid primary key default gen_random_uuid(),
  group_jid        text references public.wa_groups(jid) on delete set null,
  client           text not null,
  title            text not null check (char_length(title) <= 300),
  detail           text,
  kind             text not null default 'request'
                   check (kind in ('request','question','promise','issue')),
  owner_key        text,                         -- albert | stan | eric | charlie | dan | joey
  owner_user_id    uuid,                         -- resolved team_profiles.id (null = unassigned)
  ai_owner_key     text,                         -- who the agent first picked (to learn from reassignments)
  priority         text not null default 'normal' check (priority in ('low','normal','high')),
  status           text not null default 'open'
                   check (status in ('open','answered','done','dismissed')),
  due_date         date,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  answered_at      timestamptz,
  source_msg_ids   text[] not null default '{}',
  source_excerpt   text,                         -- short quote of the client's message
  last_reminded_at timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists wa_tasks_owner_status_idx on public.wa_tasks (owner_user_id, status);
create index if not exists wa_tasks_status_idx on public.wa_tasks (status, last_seen desc);

-- ---- Connector heartbeat / run log -----------------------------------------
create table if not exists public.wa_runs (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('digest','status','error')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean not null default true,
  connection   text,                             -- open | closed | logged_out
  messages_seen integer not null default 0,
  tasks_new    integer not null default 0,
  tasks_closed integer not null default 0,
  note         text
);
create index if not exists wa_runs_started_idx on public.wa_runs (started_at desc);

-- ---- Row level security -----------------------------------------------------
alter table public.wa_groups   enable row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_tasks    enable row level security;
alter table public.wa_runs     enable row level security;

grant select on public.wa_groups, public.wa_messages, public.wa_runs to authenticated;
grant select, update on public.wa_tasks to authenticated;

-- Reusable check: signed-in, not revoked, admin or approver.
create or replace function public.wa_is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_profiles tp
    where tp.id = auth.uid()
      and coalesce(tp.access_revoked, false) = false
      and tp.role in ('admin','approver')
  );
$$;
grant execute on function public.wa_is_lead() to authenticated;

drop policy if exists "leads read wa_groups" on public.wa_groups;
create policy "leads read wa_groups" on public.wa_groups
  for select to authenticated using (public.wa_is_lead());

drop policy if exists "leads read wa_messages" on public.wa_messages;
create policy "leads read wa_messages" on public.wa_messages
  for select to authenticated using (public.wa_is_lead());

drop policy if exists "leads read wa_runs" on public.wa_runs;
create policy "leads read wa_runs" on public.wa_runs
  for select to authenticated using (public.wa_is_lead());

-- Tasks: leads see all, everyone else only their own.
drop policy if exists "read own or all wa_tasks" on public.wa_tasks;
create policy "read own or all wa_tasks" on public.wa_tasks
  for select to authenticated
  using (
    public.wa_is_lead()
    or (
      owner_user_id = auth.uid()
      and exists (select 1 from public.team_profiles tp
                  where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)
    )
  );

-- Owners (and leads) can mark a task done / dismissed / reassign it.
drop policy if exists "update own or all wa_tasks" on public.wa_tasks;
create policy "update own or all wa_tasks" on public.wa_tasks
  for update to authenticated
  using (
    public.wa_is_lead()
    or (owner_user_id = auth.uid()
        and exists (select 1 from public.team_profiles tp
                    where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false))
  )
  with check (
    public.wa_is_lead()
    or owner_user_id = auth.uid()
  );

-- Only these columns may be changed from the app (the connector owns the rest).
revoke update on public.wa_tasks from authenticated;
grant update (status, owner_key, owner_user_id, priority, due_date, updated_at)
  on public.wa_tasks to authenticated;

-- Live updates for open tabs.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wa_tasks'
  ) then
    alter publication supabase_realtime add table public.wa_tasks;
  end if;
end $$;
