-- WhatsApp: who's the team, by phone number (Nov 25).
--
-- A message counts as the team's when it comes from the linked phone or from a number listed in
-- Radar → Settings → WhatsApp → Who's on the team. Names no longer decide it, so a client called
-- Dan is never taken for Dan. Until a number is listed, first names still decide, as before.
--
-- wa_messages.sender_id     who sent it: their number (digits with the country code), or
--                           "lid:<digits>" when WhatsApp hides the number in that group
-- wa_settings.linked_number the number the connector is linked as (the agency's phone)
-- wa_team_numbers           the team: a number (or hidden id), whose it is
-- wa_team_seen              suggestions from the connector: people in most of the client groups it
--                           reads (a client is in one or two). Only those are kept, never everyone.
-- wa_mark_team()            the connector marks stored messages again when the team changes
--
-- Run in Supabase → SQL Editor. Safe to run more than once.

alter table public.wa_messages add column if not exists sender_id text;
create index if not exists wa_messages_sender_id on public.wa_messages (sender_id) where sender_id is not null;
alter table public.wa_settings add column if not exists linked_number text;

create table if not exists public.wa_team_numbers (
  number     text primary key check (number ~ '^([0-9]{8,15}|lid:[0-9]{5,30})$'),
  profile_id uuid references public.team_profiles(id) on delete set null,
  label      text,                       -- a name, when it isn't someone on Radar
  added_by   uuid references public.team_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.wa_team_seen (
  number     text primary key,
  name       text,                       -- the name they use on WhatsApp
  groups     integer not null default 0, -- in how many of the client groups it reads
  total      integer not null default 0, -- of how many
  dismissed  boolean not null default false,   -- "not the team"
  updated_at timestamptz not null default now()
);

alter table public.wa_team_numbers enable row level security;
alter table public.wa_team_seen    enable row level security;

-- Seeing them: whoever sees every WhatsApp item. Changing them: whoever changes the WhatsApp setup.
drop policy if exists "leads read wa_team_numbers" on public.wa_team_numbers;
create policy "leads read wa_team_numbers" on public.wa_team_numbers
  for select to authenticated using (public.wa_is_lead());
drop policy if exists "setup adds wa_team_numbers" on public.wa_team_numbers;
create policy "setup adds wa_team_numbers" on public.wa_team_numbers
  for insert to authenticated with check (public.wa_can_setup());
drop policy if exists "setup changes wa_team_numbers" on public.wa_team_numbers;
create policy "setup changes wa_team_numbers" on public.wa_team_numbers
  for update to authenticated using (public.wa_can_setup()) with check (public.wa_can_setup());
drop policy if exists "setup removes wa_team_numbers" on public.wa_team_numbers;
create policy "setup removes wa_team_numbers" on public.wa_team_numbers
  for delete to authenticated using (public.wa_can_setup());

drop policy if exists "leads read wa_team_seen" on public.wa_team_seen;
create policy "leads read wa_team_seen" on public.wa_team_seen
  for select to authenticated using (public.wa_is_lead());
drop policy if exists "setup dismisses wa_team_seen" on public.wa_team_seen;
create policy "setup dismisses wa_team_seen" on public.wa_team_seen
  for update to authenticated using (public.wa_can_setup()) with check (public.wa_can_setup());

-- The connector (service role) marks stored messages to match the team: from one of these = the
-- team, from any other known sender = the client. Messages with no known sender are left as they are.
create or replace function public.wa_mark_team(p_numbers text[]) returns integer
language sql security definer set search_path = public as $$
  with u as (
    update public.wa_messages m set from_team = (m.sender_id = any(p_numbers))
     where m.sender_id is not null and m.from_team is distinct from (m.sender_id = any(p_numbers))
    returning 1)
  select count(*)::int from u;
$$;
revoke all on function public.wa_mark_team(text[]) from public, anon, authenticated;
grant execute on function public.wa_mark_team(text[]) to service_role;
