-- ============================================================================
-- addendum-deleted-work.sql
-- Deleted work goes to Recently Deleted, together with the time logged with it.
--   client_improvements.deleted_at   when it was deleted (null = not deleted)
--   client_improvements.deleted_by   who deleted it (their team_profiles id)
--   time_entries.improvement_id      the work this time was logged with
-- Deleting either one moves both; the time comes out of Harvest at once.
-- Restore brings both back and makes the time again in Harvest. Delete for
-- Good removes both. Deleted work is left out everywhere else in the app and
-- in the scheduled updates.
--
-- Safe to run more than once. Until it's run, deleting work removes it for
-- good, as before, and time isn't linked to its work.
-- Run in: Supabase dashboard -> SQL Editor.
-- ============================================================================

alter table public.client_improvements add column if not exists deleted_at timestamptz;
alter table public.client_improvements add column if not exists deleted_by uuid;
create index if not exists client_improvements_deleted_at_idx
  on public.client_improvements(deleted_at) where deleted_at is not null;

-- The link from time to its work, the same type as client_improvements.id.
-- Deleting the work for good leaves no dangling link (the app deletes its time first).
do $$
declare idtype text;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'time_entries' and column_name = 'improvement_id') then
    select format_type(a.atttypid, a.atttypmod) into idtype
      from pg_attribute a
     where a.attrelid = 'public.client_improvements'::regclass and a.attname = 'id';
    execute format('alter table public.time_entries add column improvement_id %s references public.client_improvements(id) on delete set null', idtype);
  end if;
end $$;
create index if not exists time_entries_improvement_id_idx on public.time_entries(improvement_id);
