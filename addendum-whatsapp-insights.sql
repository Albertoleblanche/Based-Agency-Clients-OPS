-- WhatsApp insights (Nov 24): urgent alerts, account signals, client details, client mood,
-- reply times, and done items in the weekly update.
--
-- The connector (whatsapp-connector/src/watch.js) reads each new burst of client messages a
-- minute or two after it arrives:
--   • urgent        → an item at once (wa_tasks.urgent_at) and a Slack + Radar alert to its owner
--   • needs a reply → wa_alerts 'waiting'; if nobody answers within the work hours set, the
--                     client's owner is nudged
--   • account signals (pausing, budget, a competitor, growing) → wa_signals, for admins
--   • the client's own details (contact, email, phone, website) → wa_detail_suggestions
-- Each check also rates the client's mood from the week's messages (wa_moods), for Health.
-- Reply times come from the stored messages (wa_reply_turns()).
-- A WhatsApp item marked done can become a line in that client's weekly update
-- (wa_tasks.improvement_id: the work it made).
--
-- Run in Supabase → SQL Editor after schema-whatsapp-tasks.sql. Safe to run more than once.

alter table public.wa_tasks add column if not exists urgent_at timestamptz;
alter table public.wa_tasks add column if not exists improvement_id text;

-- ---- Alerts the connector sends (and the waits it watches) --------------------------------------
create table if not exists public.wa_alerts (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('urgent','waiting')),
  group_jid    text not null references public.wa_groups(jid) on delete cascade,
  client_id    text,
  wa_msg_id    text not null,                 -- the client message it's about
  asked_at     timestamptz not null,          -- when the client sent it
  task_id      uuid,                          -- urgent: the item made for it
  owner_key    text,
  reason       text,
  excerpt      text,
  notified_at  timestamptz,                   -- null: not sent yet (outside work hours, or still waiting)
  resolved_at  timestamptz,                   -- waiting: the team answered
  created_at   timestamptz not null default now(),
  unique (kind, group_jid, wa_msg_id)
);
create index if not exists wa_alerts_open_idx on public.wa_alerts (kind, notified_at, resolved_at);

-- ---- Account signals: risks and openings a client mentions --------------------------------------
create table if not exists public.wa_signals (
  id           bigint generated always as identity primary key,
  group_jid    text references public.wa_groups(jid) on delete set null,
  client_id    text,
  client       text not null,                 -- the name, for when it isn't linked to a Radar client
  type         text not null check (type in ('risk','opportunity')),
  kind         text not null,                 -- pause | cancel | budget | competitor | unhappy | expansion | new_service | referral | hiring | other
  summary      text not null,
  excerpt      text,
  wa_msg_ids   text[] not null default '{}',
  status       text not null default 'new' check (status in ('new','handled','dismissed')),
  handled_by   uuid,
  handled_at   timestamptz,
  notified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists wa_signals_status_idx on public.wa_signals (status, created_at desc);

-- ---- Client details found in the chats, waiting for someone to accept ----------------------------
create table if not exists public.wa_detail_suggestions (
  id           bigint generated always as identity primary key,
  client_id    text not null,
  group_jid    text references public.wa_groups(jid) on delete set null,
  field        text not null check (field in ('contact','email','phone','website')),
  value        text not null check (char_length(value) <= 300),
  excerpt      text,
  status       text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  decided_by   uuid,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists wa_detail_suggestions_uniq on public.wa_detail_suggestions (client_id, field, lower(value));

-- ---- Client mood, one row per check that read the client's messages ----------------------------
create table if not exists public.wa_moods (
  id           bigint generated always as identity primary key,
  group_jid    text references public.wa_groups(jid) on delete set null,
  client_id    text,
  client       text not null,
  level        text not null check (level in ('happy','neutral','frustrated','angry')),
  reason       text,
  excerpt      text,
  at           timestamptz not null default now()
);
create index if not exists wa_moods_client_idx on public.wa_moods (client_id, at desc);

alter table public.wa_alerts enable row level security;
alter table public.wa_signals enable row level security;
alter table public.wa_detail_suggestions enable row level security;
alter table public.wa_moods enable row level security;

-- Leads (admins and approvers; the testers in test mode) see and handle all of it. Everyone who
-- sees WhatsApp at all sees the mood, because Health shows it on their clients.
drop policy if exists "leads read wa_alerts" on public.wa_alerts;
create policy "leads read wa_alerts" on public.wa_alerts for select to authenticated using (public.wa_is_lead());

drop policy if exists "leads read wa_signals" on public.wa_signals;
create policy "leads read wa_signals" on public.wa_signals for select to authenticated using (public.wa_is_lead());
drop policy if exists "leads update wa_signals" on public.wa_signals;
create policy "leads update wa_signals" on public.wa_signals for update to authenticated using (public.wa_is_lead()) with check (public.wa_is_lead());

drop policy if exists "leads read wa_detail_suggestions" on public.wa_detail_suggestions;
create policy "leads read wa_detail_suggestions" on public.wa_detail_suggestions for select to authenticated using (public.wa_is_lead());
drop policy if exists "leads update wa_detail_suggestions" on public.wa_detail_suggestions;
create policy "leads update wa_detail_suggestions" on public.wa_detail_suggestions for update to authenticated using (public.wa_is_lead()) with check (public.wa_is_lead());

drop policy if exists "team reads wa_moods" on public.wa_moods;
create policy "team reads wa_moods" on public.wa_moods for select to authenticated using (public.wa_access() <> 'none');

-- ---- Reply times --------------------------------------------------------------------------------
-- Each time a client writes after the team (or for the first time in the window), when the team
-- first answered and who. Radar turns these into work-hours waits.
create or replace function public.wa_reply_turns(p_days int default 14)
returns table(group_jid text, asked_at timestamptz, replied_at timestamptz, replier text, ask text)
language sql stable security definer set search_path = public as $$
  with m as (
    select w.group_jid, w.ts, w.from_team, w.text,
           lag(w.from_team) over (partition by w.group_jid order by w.ts) as prev_team
    from public.wa_messages w
    join public.wa_groups g on g.jid = w.group_jid and g.active
    where w.ts > now() - make_interval(days => least(greatest(p_days, 1), 60))
  )
  select a.group_jid, a.ts, r.ts, r.sender, left(a.text, 200)
  from m a
  left join lateral (
    select x.ts, x.sender from public.wa_messages x
    where x.group_jid = a.group_jid and x.from_team and x.ts > a.ts
    order by x.ts asc limit 1
  ) r on true
  where not a.from_team and (a.prev_team is null or a.prev_team)
    and public.wa_is_lead()
  order by a.ts desc
  limit 2000;
$$;
grant execute on function public.wa_reply_turns(int) to authenticated;
