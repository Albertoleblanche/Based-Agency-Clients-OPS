-- ============================================================================
-- addendum-harvest-clients.sql
-- Step 2 of the Harvest plan: Radar keeps its client list in step with Harvest.
-- Run after addendum-harvest-sync.sql.
--
-- Every active Harvest client is linked to its Radar client (same name), or
-- added to Radar marked "Needs setup" for an approver to finish. Two columns
-- let the server keep each link right over time:
--
--   name_at_link        Harvest's name when the link was made. When Harvest
--                       renames the client and Radar still uses the old name,
--                       Radar follows the new one. A name changed in Radar
--                       stays as it is.
--   archived_noted_at   when Radar noticed the client was archived in Harvest,
--                       so approvers hear about it once.
--
-- The server writes these (service role); everyone signed in reads them, as
-- before. Run in Supabase -> SQL Editor. Safe to run more than once.
-- Until it's run, Radar reads Harvest as before and adds no clients.
-- ============================================================================

alter table public.harvest_clients add column if not exists name_at_link text;
alter table public.harvest_clients add column if not exists archived_noted_at timestamptz;

create index if not exists harvest_clients_radar_client_idx on public.harvest_clients (radar_client_id);
