-- ============================================================================
-- addendum-harvest-time.sql
-- Step 3 of the Harvest plan: time is logged the way Harvest does it,
-- Client → Project → Task (the task decides billable). Run after
-- addendum-harvest-sync.sql.
--
-- Each time entry keeps the Harvest project and task it was logged to, and
-- goes to Harvest under the person who logged it. Entries from before keep
-- their service and go as before, through the client and service mappings.
--
-- Run in Supabase -> SQL Editor. Safe to run more than once.
-- Until it's run, Log Time keeps asking for a service as before.
-- ============================================================================

alter table public.time_entries add column if not exists harvest_project_id bigint;
alter table public.time_entries add column if not exists harvest_task_id bigint;
