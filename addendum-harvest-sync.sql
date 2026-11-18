-- ============================================================================
-- addendum-harvest-sync.sql
-- Step 1 of the Harvest plan: Radar reads Harvest's setup (clients, projects,
-- tasks, who is assigned where, and the team) so it can track time the same
-- way. Read only: Radar never changes Harvest's setup.
--
--   harvest_clients            clients, active or archived
--   harvest_projects           projects per client, with budgets and dates
--   harvest_tasks              the account's tasks
--   harvest_task_assignments   which tasks each project uses, billable or not
--   harvest_user_assignments   who is assigned to each project
--   harvest_users              Harvest people, matched to Radar by email
-- and on harvest_connection: when the setup was last read, any error, and who
-- the token belongs to (an admin's token is needed to log time for others).
--
-- Hourly rates and costs are never stored.
-- The server writes these tables (service role); everyone signed in reads them.
-- Run in Supabase -> SQL Editor. Safe to run more than once.
-- Until it's run, Radar works as before and Settings -> Harvest says so.
-- ============================================================================

create table if not exists public.harvest_clients (
  harvest_id          bigint primary key,
  name                text not null,
  is_active           boolean not null default true,
  radar_client_id     text,                      -- set when linked to a Radar client (step 2)
  harvest_updated_at  timestamptz,
  synced_at           timestamptz not null default now()
);

create table if not exists public.harvest_projects (
  harvest_id          bigint primary key,
  client_harvest_id   bigint,
  name                text not null,
  code                text,
  is_active           boolean not null default true,
  is_billable         boolean,
  budget              numeric,                   -- hours or money, per budget_by
  budget_by           text,
  budget_is_monthly   boolean,
  starts_on           date,
  ends_on             date,
  harvest_updated_at  timestamptz,
  synced_at           timestamptz not null default now()
);
create index if not exists harvest_projects_client_idx on public.harvest_projects (client_harvest_id);

create table if not exists public.harvest_tasks (
  harvest_id           bigint primary key,
  name                 text not null,
  is_active            boolean not null default true,
  billable_by_default  boolean,
  harvest_updated_at   timestamptz,
  synced_at            timestamptz not null default now()
);

create table if not exists public.harvest_task_assignments (
  harvest_id          bigint primary key,
  project_harvest_id  bigint not null,
  task_harvest_id     bigint not null,
  billable            boolean,
  is_active           boolean not null default true,
  harvest_updated_at  timestamptz,
  synced_at           timestamptz not null default now()
);
create index if not exists harvest_task_assignments_project_idx on public.harvest_task_assignments (project_harvest_id);

create table if not exists public.harvest_user_assignments (
  harvest_id          bigint primary key,
  project_harvest_id  bigint not null,
  user_harvest_id     bigint not null,
  is_active           boolean not null default true,
  is_project_manager  boolean,
  harvest_updated_at  timestamptz,
  synced_at           timestamptz not null default now()
);
create index if not exists harvest_user_assignments_project_idx on public.harvest_user_assignments (project_harvest_id);
create index if not exists harvest_user_assignments_user_idx on public.harvest_user_assignments (user_harvest_id);

create table if not exists public.harvest_users (
  harvest_id          bigint primary key,
  first_name          text,
  last_name           text,
  email               text,
  is_active           boolean not null default true,
  access_roles        text[],
  team_profile_id     uuid,                      -- the Radar person with the same email
  harvest_updated_at  timestamptz,
  synced_at           timestamptz not null default now()
);

alter table public.harvest_connection add column if not exists setup_synced_at timestamptz;   -- last read of any kind
alter table public.harvest_connection add column if not exists setup_full_at timestamptz;     -- last full read
alter table public.harvest_connection add column if not exists setup_sync_error text;
alter table public.harvest_connection add column if not exists token_user_name text;
alter table public.harvest_connection add column if not exists token_user_roles text[];

-- ---- who can read ------------------------------------------------------------------------
-- Row level security on every table; anyone signed in to Radar reads, only the server writes.
-- (The drop before each create lets this file run again; it only replaces this same rule.)
alter table public.harvest_clients enable row level security;
drop policy if exists "team reads harvest setup" on public.harvest_clients;
create policy "team reads harvest setup" on public.harvest_clients for select to authenticated
  using (exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false));
grant select on public.harvest_clients to authenticated;

alter table public.harvest_projects enable row level security;
drop policy if exists "team reads harvest setup" on public.harvest_projects;
create policy "team reads harvest setup" on public.harvest_projects for select to authenticated
  using (exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false));
grant select on public.harvest_projects to authenticated;

alter table public.harvest_tasks enable row level security;
drop policy if exists "team reads harvest setup" on public.harvest_tasks;
create policy "team reads harvest setup" on public.harvest_tasks for select to authenticated
  using (exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false));
grant select on public.harvest_tasks to authenticated;

alter table public.harvest_task_assignments enable row level security;
drop policy if exists "team reads harvest setup" on public.harvest_task_assignments;
create policy "team reads harvest setup" on public.harvest_task_assignments for select to authenticated
  using (exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false));
grant select on public.harvest_task_assignments to authenticated;

alter table public.harvest_user_assignments enable row level security;
drop policy if exists "team reads harvest setup" on public.harvest_user_assignments;
create policy "team reads harvest setup" on public.harvest_user_assignments for select to authenticated
  using (exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false));
grant select on public.harvest_user_assignments to authenticated;

alter table public.harvest_users enable row level security;
drop policy if exists "team reads harvest setup" on public.harvest_users;
create policy "team reads harvest setup" on public.harvest_users for select to authenticated
  using (exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false));
grant select on public.harvest_users to authenticated;
