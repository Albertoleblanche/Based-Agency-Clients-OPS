-- WhatsApp: Check Now for everyone (Nov 25).
--
-- Members see their own WhatsApp items. With this they can also press Check Now (Radar WhatsApp reads
-- the groups right away, without Slack messages) and see when it last checked and checks next. They
-- still can't see or change the setup, the groups or what it read: wa_check_status() gives them only
-- where the checks stand, never the linking code.
--
-- Run in Supabase → SQL Editor, after addendum-whatsapp-check-now.sql and addendum-whatsapp-admins.sql.
-- Safe to run more than once.

-- Check Now: anyone WhatsApp is on for in Radar (in test mode, only the testers). A member asking while
-- a check is already waiting gets that one; a member clears a request only once nothing picked it up
-- for 90 seconds. Admins and approvers can always ask or clear, as before.
create or replace function public.wa_request_check(p_clear boolean default false) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v timestamptz := case when p_clear then null else now() end;
  pending timestamptz;
begin
  if coalesce(public.wa_access(), 'none') = 'none' then
    raise exception 'WhatsApp isn''t on for you in Radar' using errcode = '42501';
  end if;
  if not public.wa_is_lead() then
    select s.check_requested_at into pending from public.wa_settings s where s.id = 1;
    if p_clear then
      if pending is not null and pending > now() - interval '90 seconds' then return pending; end if;
    elsif pending is not null then
      return pending;
    end if;
  end if;
  update public.wa_settings set check_requested_at = v where id = 1;
  return v;
end;
$$;
revoke all on function public.wa_request_check(boolean) from public, anon;
grant execute on function public.wa_request_check(boolean) to authenticated;

-- Where the checks stand, for anyone WhatsApp is on for: whether the connector is running (heartbeat),
-- linked (the last connection status), linking (when a code was shown; not the code), a check waiting,
-- the check times, and the last check.
create or replace function public.wa_check_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when coalesce(public.wa_access(), 'none') = 'none' then null else (
    select jsonb_build_object(
      'heartbeat_at', s.heartbeat_at,
      'linking_at', case when s.qr is not null then s.qr_at end,
      'check_requested_at', s.check_requested_at,
      'digest_times', s.digest_times,
      'timezone', s.timezone,
      'connection', c.connection,
      'connection_at', c.started_at,
      'last_check_at', d.started_at,
      'last_check_done_at', d.finished_at)
    from public.wa_settings s
    left join lateral (select r.connection, r.started_at from public.wa_runs r
                       where r.kind in ('status', 'error') order by r.started_at desc limit 1) c on true
    left join lateral (select r.started_at, r.finished_at from public.wa_runs r
                       where r.kind = 'digest' order by r.started_at desc limit 1) d on true
    where s.id = 1)
  end;
$$;
revoke all on function public.wa_check_status() from public, anon;
grant execute on function public.wa_check_status() to authenticated;
