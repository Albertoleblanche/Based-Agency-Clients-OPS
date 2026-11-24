-- Set Up Radar (Nov 24): when someone finished the first-run setup. Empty = it opens by itself when they
-- sign in. Everyone already on the team is marked done, so it only opens for new people (anyone can
-- still open it from the menu under their name).
alter table public.team_profiles add column if not exists setup_done_at timestamptz;
update public.team_profiles set setup_done_at = now() where setup_done_at is null;
