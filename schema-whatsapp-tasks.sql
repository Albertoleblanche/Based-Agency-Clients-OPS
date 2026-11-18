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

-- ============================================================================
-- Setup panel (Radar -> WhatsApp -> Setup), for admin / approver only.
-- ============================================================================

-- Which groups are read. auto_match = the name rule matched; manual = an admin
-- switched it on/off by hand (the connector then stops overriding it).
-- Only group NAMES are stored for groups that are switched off, never messages.
alter table public.wa_groups add column if not exists auto_match boolean not null default false;
alter table public.wa_groups add column if not exists manual     boolean not null default false;

grant update (active, manual, updated_at) on public.wa_groups to authenticated;
drop policy if exists "leads update wa_groups" on public.wa_groups;
create policy "leads update wa_groups" on public.wa_groups
  for update to authenticated using (public.wa_is_lead()) with check (public.wa_is_lead());

-- One settings row, shared by the connector and the Radar setup panel.
create table if not exists public.wa_settings (
  id               int primary key default 1 check (id = 1),
  digest_times     text[] not null default '{09:00,15:00}' check (cardinality(digest_times) between 1 and 6),
  timezone         text not null default 'America/New_York',
  role_notes       jsonb not null default '{}'::jsonb,   -- {"albert": "what Albert handles", ...}
  qr               text,                                  -- current QR code (PNG data URL), cleared once linked
  qr_at            timestamptz,
  relink_requested boolean not null default false,
  heartbeat_at     timestamptz,                           -- connector writes this every ~30s
  updated_at       timestamptz not null default now()
);
insert into public.wa_settings (id) values (1) on conflict (id) do nothing;

alter table public.wa_settings enable row level security;
grant select on public.wa_settings to authenticated;
grant update (digest_times, timezone, role_notes, relink_requested, updated_at) on public.wa_settings to authenticated;

drop policy if exists "leads read wa_settings" on public.wa_settings;
create policy "leads read wa_settings" on public.wa_settings
  for select to authenticated using (public.wa_is_lead());
drop policy if exists "leads update wa_settings" on public.wa_settings;
create policy "leads update wa_settings" on public.wa_settings
  for update to authenticated using (public.wa_is_lead()) with check (public.wa_is_lead());

-- ============================================================================
-- Test mode
--
-- While pilot_user_ids has anyone in it, WhatsApp is in test mode: only those people
-- see the WhatsApp screen and Settings → WhatsApp (whatever their role in Radar), they
-- see every item, and the connector sends its Slack messages only to them. Nobody else
-- sees it or hears about it. Run addendum-whatsapp-test-mode.sql to put yourself in it.
-- Empty the list to go live: then admins and approvers manage it and everyone sees
-- their own items.
-- ============================================================================
alter table public.wa_settings add column if not exists pilot_user_ids uuid[] not null default '{}';

create or replace function public.wa_in_test_mode() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select cardinality(s.pilot_user_ids) > 0 from public.wa_settings s where s.id = 1), false);
$$;

-- Leads: the testers while testing, otherwise admins and approvers.
create or replace function public.wa_is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_profiles tp
                 where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)
     and case when public.wa_in_test_mode()
              then exists (select 1 from public.wa_settings s where s.id = 1 and auth.uid() = any(s.pilot_user_ids))
              else exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and tp.role in ('admin','approver'))
         end;
$$;

-- What Radar shows this person: 'manage' (every item and Settings → WhatsApp),
-- 'own' (their own items) or 'none'.
create or replace function public.wa_access() returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.wa_is_lead() then 'manage'
    when public.wa_in_test_mode() then 'none'
    when exists (select 1 from public.team_profiles tp
                 where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false) then 'own'
    else 'none'
  end;
$$;
grant execute on function public.wa_in_test_mode() to authenticated;
grant execute on function public.wa_access() to authenticated;

-- While testing, nobody but the testers reads or changes items, not even their own.
drop policy if exists "read own or all wa_tasks" on public.wa_tasks;
create policy "read own or all wa_tasks" on public.wa_tasks
  for select to authenticated
  using (
    public.wa_is_lead()
    or (
      not public.wa_in_test_mode()
      and owner_user_id = auth.uid()
      and exists (select 1 from public.team_profiles tp
                  where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)
    )
  );

drop policy if exists "update own or all wa_tasks" on public.wa_tasks;
create policy "update own or all wa_tasks" on public.wa_tasks
  for update to authenticated
  using (
    public.wa_is_lead()
    or (
      not public.wa_in_test_mode()
      and owner_user_id = auth.uid()
      and exists (select 1 from public.team_profiles tp
                  where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)
    )
  )
  with check (
    public.wa_is_lead()
    or (not public.wa_in_test_mode() and owner_user_id = auth.uid())
  );
