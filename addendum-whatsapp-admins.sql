-- WhatsApp: one setup for the whole team, changed by admins (Nov 24).
--
-- Settings → WhatsApp is shared by everyone: the linked number, the groups it reads, when it
-- checks and who handles what. Only admins change it (while in test mode, the testers do).
-- Approvers still see every item, get the full list in Slack and can press Check Now.
-- Members see their own items.
--
-- Run in Supabase → SQL Editor. Safe to run more than once.

-- Who can change the setup: admins; while testing, the testers instead.
create or replace function public.wa_can_setup() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_profiles tp
                 where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)
     and case when public.wa_in_test_mode()
              then exists (select 1 from public.wa_settings s where s.id = 1 and auth.uid() = any(s.pilot_user_ids))
              else exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and tp.role = 'admin')
         end;
$$;
grant execute on function public.wa_can_setup() to authenticated;

-- Changing the settings and the groups: only whoever can set it up (it was admins and approvers).
drop policy if exists "leads update wa_settings" on public.wa_settings;
drop policy if exists "admins update wa_settings" on public.wa_settings;
create policy "admins update wa_settings" on public.wa_settings
  for update to authenticated using (public.wa_can_setup()) with check (public.wa_can_setup());

drop policy if exists "leads update wa_groups" on public.wa_groups;
drop policy if exists "admins update wa_groups" on public.wa_groups;
create policy "admins update wa_groups" on public.wa_groups
  for update to authenticated using (public.wa_can_setup()) with check (public.wa_can_setup());

-- Check Now: anyone who sees every item can ask for a check, or clear a request nothing picked up.
create or replace function public.wa_request_check(p_clear boolean default false) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz := case when p_clear then null else now() end;
begin
  if not public.wa_is_lead() then
    raise exception 'Only admins and approvers can ask for a check' using errcode = '42501';
  end if;
  update public.wa_settings set check_requested_at = v where id = 1;
  return v;
end;
$$;
revoke all on function public.wa_request_check(boolean) from public, anon;
grant execute on function public.wa_request_check(boolean) to authenticated;

-- Go live (the button in Settings → WhatsApp): empties the testers, so everyone sees their own
-- items, admins and approvers see them all, and admins manage the setup.
create or replace function public.wa_go_live() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_can_setup() then
    raise exception 'Only an admin can do this' using errcode = '42501';
  end if;
  update public.wa_settings set pilot_user_ids = '{}', updated_at = now() where id = 1;
end;
$$;
revoke all on function public.wa_go_live() from public, anon;
grant execute on function public.wa_go_live() to authenticated;
