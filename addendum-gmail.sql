-- Tasks from Gmail (Nov 24, lib/gmail-tasks.js): each person who connects their work Gmail (Settings →
-- Connections → Gmail) has a row here. Only the server reads it (it holds their Google token), so it
-- has no policies; the app asks the server whether you're connected.
-- Run once in Supabase → SQL Editor. Safe to run more than once.
create table if not exists public.gmail_connections (
  user_id       uuid primary key references public.team_profiles(id) on delete cascade,
  refresh_token text not null,
  google_email  text,
  connected_at  timestamptz not null default now(),
  last_read_at  timestamptz,
  cursor_at     timestamptz,
  last_error    text,
  last_stats    jsonb,
  seen_ids      text[] not null default '{}'
);
alter table public.gmail_connections enable row level security;
