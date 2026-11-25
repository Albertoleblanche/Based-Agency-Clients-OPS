-- Set Up Radar (Nov 24).
-- setup_done_at: when someone finished it (or hid the reminder). Empty = not finished yet.
-- joined_before_setup: they were on Radar before Set Up Radar existed. They don't get the full-screen
--   Welcome; they get "Connect your apps" in the sidebar and one note, and anyone who already has
--   everything that matters connected is marked done by itself the next time they open Radar.
-- New people (the default, false) get the full-screen Welcome the first time they sign in.
-- Run once. If an earlier copy of this file marked everyone done, this clears that, so the people
-- already here get the reminder too.
alter table public.team_profiles add column if not exists setup_done_at timestamptz;
alter table public.team_profiles add column if not exists joined_before_setup boolean not null default false;
update public.team_profiles set joined_before_setup = true, setup_done_at = null;
