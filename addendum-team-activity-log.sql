-- ============================================================================
-- addendum-team-activity-log.sql
-- Moves the team activity log (Overview → Activity) out of the shared
-- app_storage 'app-data' JSON blob and into its own append-only table.
--
-- Why: the blob was rewritten in full on every action, so two people acting
-- at the same moment could silently overwrite each other's entries, and
-- every write made each open tab reload all data. One row per entry fixes
-- both.
--
-- Safe to run more than once. The app keeps using the old blob until this
-- has been run, then switches over on its own (no redeploy needed).
-- Run in: Supabase dashboard → SQL Editor.
-- ============================================================================

create table if not exists public.team_activity_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid,                                   -- who did it (auth user id)
  tag         text not null default 'you' check (tag in ('you','auto')),  -- 'auto' = AI-generated
  text        text not null check (char_length(text) <= 2000),
  time_label  text                                    -- legacy entries only: original display time
);

create index if not exists team_activity_log_created_at_idx
  on public.team_activity_log (created_at desc);

alter table public.team_activity_log enable row level security;

-- Table-level access for signed-in users (rows are still filtered by the
-- policies below). Supabase usually grants this by default; explicit here.
grant select, insert on public.team_activity_log to authenticated;

-- Read: any signed-in team member whose access hasn't been revoked (the
-- old blob was visible to the whole team too).
drop policy if exists "team reads activity" on public.team_activity_log;
create policy "team reads activity" on public.team_activity_log
  for select to authenticated
  using (exists (
    select 1 from public.team_profiles tp
    where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false
  ));

-- Insert: only entries attributed to yourself. No update/delete policies,
-- so entries can't be edited or removed from the app.
drop policy if exists "team adds own activity" on public.team_activity_log;
create policy "team adds own activity" on public.team_activity_log
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.team_profiles tp
      where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false
    )
  );

-- Live updates for open tabs.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_activity_log'
  ) then
    alter publication supabase_realtime add table public.team_activity_log;
  end if;
end $$;

-- One-time backfill of the existing entries from the old blob (newest first
-- in the blob; created_at is spaced a second apart to keep that order).
-- Skipped automatically if the table already has rows.
insert into public.team_activity_log (created_at, user_id, tag, text, time_label)
select
  now() - (e.ord * interval '1 second'),
  case when e.item->>'userId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then (e.item->>'userId')::uuid end,
  case when e.item->>'tag' = 'auto' then 'auto' else 'you' end,
  left(coalesce(e.item->>'text', ''), 2000),
  e.item->>'t'
from public.app_storage s
cross join lateral jsonb_array_elements(
  -- works whether app_storage.value is a text or a jsonb column
  coalesce(((to_jsonb(s.value) #>> '{}')::jsonb) -> 'log', '[]'::jsonb)
) with ordinality as e(item, ord)
where s.key = 'app-data'
  and not exists (select 1 from public.team_activity_log)
  and coalesce(e.item->>'text', '') <> '';
