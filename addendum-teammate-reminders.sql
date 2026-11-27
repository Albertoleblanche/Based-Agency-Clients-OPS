-- Reminders for a teammate, nudged from your own Slack (Nov 23)
-- Run once in Supabase → SQL Editor. Safe to run again.

-- 1. A reminder can wait on a teammate instead of a client (the client is then optional).
alter table public.client_reminders add column if not exists waiting_on uuid references public.team_profiles(id) on delete set null;
alter table public.client_reminders alter column client_id drop not null;
create index if not exists client_reminders_waiting_on_idx on public.client_reminders (waiting_on) where waiting_on is not null;

-- 2. Each person's own Slack token, so a nudge goes from their Slack, as them (lib/slack-me.js).
--    Only the server reads or writes it: row level security is on and there are no policies, so
--    nobody signed in to Radar can read anyone's token, their own included.
create table if not exists public.slack_user_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  slack_user_id text not null,
  slack_team_id text,
  access_token  text not null,
  scope         text,
  connected_at  timestamptz not null default now()
);
alter table public.slack_user_tokens enable row level security;
revoke all on public.slack_user_tokens from anon, authenticated;
