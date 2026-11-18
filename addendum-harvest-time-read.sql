-- ============================================================================
-- addendum-harvest-time-read.sql
-- Step 4 of the Harvest plan: time logged in Harvest shows in Radar.
-- Run after addendum-harvest-time.sql.
--
-- Harvest's time entries from the first of last month on are read into
-- Radar's time entries: one sent from Radar is matched by its Harvest id;
-- one logged in Harvest is added, marked as from Harvest, under the Radar
-- person matched by email. Someone without a Radar account keeps their
-- Harvest person, so their hours still count for the client.
--
--   source            'harvest' when it was logged in Harvest
--   harvest_user_id   the Harvest person who logged it
--   harvest_locked    invoiced or approved in Harvest: read only in Radar
--   harvest_updated_at
-- and on harvest_connection, when time was last read (and read in full).
--
-- Run in Supabase -> SQL Editor. Safe to run more than once.
-- Until it's run, Radar sends time to Harvest as before and reads none back.
-- ============================================================================

alter table public.time_entries add column if not exists source text;
alter table public.time_entries add column if not exists harvest_user_id bigint;
alter table public.time_entries add column if not exists harvest_locked boolean;
alter table public.time_entries add column if not exists harvest_updated_at timestamptz;
-- time from someone without a Radar account has no Radar person
alter table public.time_entries alter column user_id drop not null;

create index if not exists time_entries_harvest_entry_idx on public.time_entries (harvest_entry_id);

alter table public.harvest_connection add column if not exists time_synced_at timestamptz;
alter table public.harvest_connection add column if not exists time_full_at timestamptz;
