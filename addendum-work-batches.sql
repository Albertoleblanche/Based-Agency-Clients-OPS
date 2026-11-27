-- ============================================================================
-- addendum-work-batches.sql (Nov 25)
-- Several improvements logged together, with one time entry for all of them.
--   client_improvements.time_entry_id   the time this work was logged with, shared by everything
--                                        logged in the same batch
-- Log Improvement takes several lines (one improvement each) and one Time spent: Harvest gets one
-- entry for the block of work. Deleting one of the improvements keeps the time with the others;
-- deleting the last of them takes the time too. Restoring any of them brings the time back.
--
-- Run after addendum-deleted-work.sql. Safe to run more than once. Until it's run, a batch's time is
-- saved on its own, not linked to the work (so deleting the work leaves the time).
-- Run in: Supabase dashboard -> SQL Editor.
-- ============================================================================

-- The same type as time_entries.id. Deleting the time for good leaves no dangling link.
do $$
declare idtype text;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'client_improvements' and column_name = 'time_entry_id') then
    select format_type(a.atttypid, a.atttypmod) into idtype
      from pg_attribute a
     where a.attrelid = 'public.time_entries'::regclass and a.attname = 'id';
    execute format('alter table public.client_improvements add column time_entry_id %s references public.time_entries(id) on delete set null', idtype);
  end if;
end $$;
create index if not exists client_improvements_time_entry_id_idx on public.client_improvements(time_entry_id) where time_entry_id is not null;
