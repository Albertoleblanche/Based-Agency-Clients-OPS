-- ============================================================================
-- addendum-weekly-wins.sql
-- Weekly wins, sent where the client is (from the Nov 9–12 sprints).
--
--   * Every weekly update ("win") gets a tier: 1 a result, 2 something we
--     changed for them, 3 the work done.
--   * WhatsApp clients: Radar never posts to WhatsApp. An approved win goes back
--     to whoever wrote it; they copy it, paste it in the client's group, and it
--     counts as sent.
--   * No double sends: copying a win claims it (one sender at a time), and the
--     WhatsApp reader marks it sent as soon as it shows up in the group.
--
-- Adds to client_drafts:
--   win_tier       1, 2 or 3
--   sent_via       'email' or 'whatsapp'
--   wa_copied_by   who copied it for WhatsApp (the one sending it)
--   wa_copied_at   when
--   wa_seen_at     when Radar saw it in the group
--   approved_by    who approved it
--   approved_at    when
-- and these functions for the app:
--   wa_client_groups()               the WhatsApp group linked to each client, for everyone signed in
--   win_claim(client, author, force)  copy for WhatsApp: claim the send (refused if someone else has it,
--                                      unless force, after the app has warned you)
--   win_mark_sent(client, author)     Mark as Sent
-- and a trigger that marks a win sent when the same message shows up in its client's group.
--
-- Run after schema-whatsapp-tasks.sql, in Supabase -> SQL Editor. Safe to run more than once.
-- Until it's run, the app still works: no tiers, and copying isn't shared with the team.
-- ============================================================================

alter table public.client_drafts add column if not exists win_tier smallint;
alter table public.client_drafts add column if not exists sent_via text;
alter table public.client_drafts add column if not exists wa_copied_by text;
alter table public.client_drafts add column if not exists wa_copied_at timestamptz;
alter table public.client_drafts add column if not exists wa_seen_at timestamptz;
alter table public.client_drafts add column if not exists approved_by text;
alter table public.client_drafts add column if not exists approved_at timestamptz;

do $$ begin
  alter table public.client_drafts add constraint client_drafts_win_tier_chk check (win_tier is null or win_tier between 1 and 3);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.client_drafts add constraint client_drafts_sent_via_chk check (sent_via is null or sent_via in ('email','whatsapp'));
exception when duplicate_object then null; end $$;

-- ---- who's asking ------------------------------------------------------------
create or replace function public.win_me() returns text
language sql stable security definer set search_path = public as $$
  select tp.name from public.team_profiles tp
  where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false;
$$;

-- ---- each client's WhatsApp group, for everyone signed in -----------------------
-- Just the group's name and which client it belongs to: no messages.
create or replace function public.wa_client_groups()
returns table (jid text, name text, client_id text, active boolean)
language sql stable security definer set search_path = public as $$
  select g.jid, g.name, g.client_id, g.active from public.wa_groups g
  where public.win_me() is not null;
$$;
grant execute on function public.wa_client_groups() to authenticated;

-- ---- copy for WhatsApp: claim the send -----------------------------------------
-- Allowed for the person who wrote the win, and for admins and approvers.
-- Refused (ok=false, reason='copied') when someone else already copied it and it
-- hasn't been seen in the group yet, unless p_force (the app warns first).
create or replace function public.win_claim(p_client text, p_author text, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.win_me();
  r public.client_drafts%rowtype;
  took text;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select * into r from public.client_drafts d where d.client_id::text = p_client and d.author = p_author for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'missing'); end if;
  if r.draft_sent_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'sent', 'sent_by', r.draft_sent_by, 'sent_at', r.draft_sent_at, 'seen_at', r.wa_seen_at);
  end if;
  if r.draft_status is distinct from 'approved' then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if r.author <> me and not public.wa_is_lead() then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  if nullif(r.wa_copied_by, '') is not null and r.wa_copied_by <> me and not coalesce(p_force, false) then
    return jsonb_build_object('ok', false, 'reason', 'copied', 'copied_by', r.wa_copied_by, 'copied_at', r.wa_copied_at);
  end if;
  took := case when nullif(r.wa_copied_by, '') is not null and r.wa_copied_by <> me then r.wa_copied_by end;
  update public.client_drafts d set wa_copied_by = me, wa_copied_at = now(), sent_via = 'whatsapp'
   where d.client_id::text = p_client and d.author = p_author;
  return jsonb_build_object('ok', true, 'copied_by', me, 'copied_at', now(), 'took_from', took);
end $$;
grant execute on function public.win_claim(text, text, boolean) to authenticated;

-- ---- Mark as Sent ----------------------------------------------------------------
create or replace function public.win_mark_sent(p_client text, p_author text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.win_me();
  r public.client_drafts%rowtype;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select * into r from public.client_drafts d where d.client_id::text = p_client and d.author = p_author for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'missing'); end if;
  if r.draft_sent_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'sent_by', r.draft_sent_by, 'sent_at', r.draft_sent_at);
  end if;
  if r.draft_status is distinct from 'approved' then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if r.author <> me and r.wa_copied_by is distinct from me and not public.wa_is_lead() then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  update public.client_drafts d set draft_sent_at = now(), draft_sent_by = me, sent_via = coalesce(d.sent_via, 'whatsapp')
   where d.client_id::text = p_client and d.author = p_author;
  return jsonb_build_object('ok', true, 'sent_by', me, 'sent_at', now());
end $$;
grant execute on function public.win_mark_sent(text, text) to authenticated;

-- ---- seen in the group: mark it sent ------------------------------------------------
-- Words of 4+ letters, lower case, without punctuation or WhatsApp formatting.
create or replace function public.wa_norm(t text) returns text
language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(t, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;
-- The same win: at least 70% of the win's words are in the message (so a light
-- edit before pasting still counts), and the win has at least 5 of them.
create or replace function public.wa_win_match(msg text, win text) returns boolean
language sql immutable as $$
  with w as (select distinct x from regexp_split_to_table(public.wa_norm(win), ' ') x where length(x) > 3),
       m as (select distinct x from regexp_split_to_table(public.wa_norm(msg), ' ') x where length(x) > 3)
  select (select count(*) from w) >= 5
     and (select count(*) from w where x in (select x from m))::numeric / greatest(1, (select count(*) from w)) >= 0.7;
$$;

create or replace function public.wa_mark_win_sent() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid text;
  r record;
begin
  if char_length(coalesce(new.text, '')) < 40 then return new; end if;
  select g.client_id into cid from public.wa_groups g where g.jid = new.group_jid;
  if cid is null then return new; end if;
  for r in
    select d.client_id, d.author, d.draft, d.wa_copied_by, d.draft_pending_since from public.client_drafts d
    where d.client_id::text = cid and d.draft_status = 'approved' and d.draft_sent_at is null and coalesce(d.draft, '') <> ''
  loop
    if new.ts >= coalesce(r.draft_pending_since, '-infinity'::timestamptz) - interval '1 day'
       and public.wa_win_match(new.text, r.draft) then
      update public.client_drafts d
         set draft_sent_at = new.ts,
             draft_sent_by = coalesce(nullif(r.wa_copied_by, ''), case when new.from_team then nullif(new.sender, '') end, 'WhatsApp'),
             sent_via = 'whatsapp', wa_seen_at = now()
       where d.client_id = r.client_id and d.author = r.author and d.draft_sent_at is null;
    end if;
  end loop;
  return new;
exception when others then
  return new;  -- never get in the way of the connector saving messages
end $$;

drop trigger if exists wa_messages_mark_win_sent on public.wa_messages;
create trigger wa_messages_mark_win_sent after insert on public.wa_messages
  for each row execute function public.wa_mark_win_sent();

-- ---- live updates: the app hears when a win is marked sent --------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'client_drafts') then
    alter publication supabase_realtime add table public.client_drafts;
  end if;
end $$;
