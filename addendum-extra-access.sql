-- ============================================================================
-- addendum-extra-access.sql (Nov 25)
-- Extra access: an admin gives someone more than their role allows, without changing the role.
--
--   members can be given approver powers: approve and send updates, add and edit clients (and with
--   it set Risk and close concerns), clear Risk flags, delete tasks, restore and delete clients
--   approvers and members can be given Settings & connections (an admin's): Harvest, Granola,
--   Slack, Gmail, WhatsApp, AI and the rules
--
-- They live in team_profiles.extra_permissions. This file:
--   1. lets only admins change anyone's role, extra access, revoked access or Assistant access
--      (the app only shows those switches to admins; now the database holds to it too)
--   2. xa_has(key): the same rules as the app, for the policies below
--   3. concerns: whoever can edit clients closes them (rf_is_lead), not just admins and approvers
--   4. WhatsApp: whoever has Settings & connections sets it up (wa_can_setup), not just admins
--
-- Run in: Supabase dashboard -> SQL Editor. Safe to run more than once, before or after
-- addendum-risk-flags.sql and the WhatsApp files.
-- ============================================================================

-- 1. Roles and access: admins only ---------------------------------------------------------------
create or replace function public.xa_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_profiles tp
                 where tp.id = auth.uid() and tp.role = 'admin' and coalesce(tp.access_revoked, false) = false);
$$;
grant execute on function public.xa_is_admin() to authenticated;

create or replace function public.xa_guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- the server (service role) and the SQL Editor have no signed-in user: they may
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if (new.role is distinct from 'member'
        or coalesce(to_jsonb(new.extra_permissions), '[]'::jsonb) not in ('[]'::jsonb, 'null'::jsonb))
       and not public.xa_is_admin() then
      raise exception 'Only admins give someone a role or extra access' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.role is distinct from old.role
      or to_jsonb(new.extra_permissions) is distinct from to_jsonb(old.extra_permissions)
      or new.access_revoked is distinct from old.access_revoked
      or new.ai_chat_enabled is distinct from old.ai_chat_enabled)
     and not public.xa_is_admin() then
    raise exception 'Only admins change roles and access' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists xa_guard_profile on public.team_profiles;
create trigger xa_guard_profile before insert or update on public.team_profiles
  for each row execute function public.xa_guard_profile();

-- 2. Who has a power: the role's own, or given by an admin -----------------------------------------
create or replace function public.xa_has(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_profiles tp
    where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false
      and (tp.role = 'admin'
           or (tp.role = 'approver' and p_key in ('view_team_queue', 'approve_updates', 'edit_clients',
                                                  'lower_danger_score', 'delete_tasks', 'delete_clients'))
           or coalesce(to_jsonb(tp.extra_permissions), '[]'::jsonb) ? p_key
           or (p_key = 'view_team_queue' and coalesce(to_jsonb(tp.extra_permissions), '[]'::jsonb) ? 'approve_updates')));
$$;
grant execute on function public.xa_has(text) to authenticated;

-- 3. Concerns (addendum-risk-flags.sql): closed by whoever can edit clients ------------------------
create or replace function public.rf_is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false
                 and (tp.role in ('admin', 'approver') or coalesce(to_jsonb(tp.extra_permissions), '[]'::jsonb) ? 'edit_clients'));
$$;
grant execute on function public.rf_is_lead() to authenticated;

-- 4. WhatsApp setup: whoever has Settings & connections (while testing, still the testers) ----------
do $$
begin
  if to_regprocedure('public.wa_in_test_mode()') is not null then
    execute $f$
      create or replace function public.wa_can_setup() returns boolean
      language sql stable security definer set search_path = public as $b$
        select exists (select 1 from public.team_profiles tp
                       where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)
           and case when public.wa_in_test_mode()
                    then exists (select 1 from public.wa_settings s where s.id = 1 and auth.uid() = any(s.pilot_user_ids))
                    else public.xa_has('manage_settings')
               end;
      $b$;
    $f$;
    execute 'grant execute on function public.wa_can_setup() to authenticated';
  end if;
end $$;
