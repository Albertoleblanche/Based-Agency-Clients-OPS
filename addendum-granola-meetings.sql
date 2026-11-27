-- ============================================================================
-- addendum-granola-meetings.sql
-- Meeting notes from Granola (Nov 23, evening).
--
--   1. Only the people who were in a meeting can read its notes; admins and
--      approvers can read them all. Radar keeps each meeting it read in
--      app_storage under "granola-note:<id>", with the emails of the people who
--      were there ("people"). This adds a rule on top of the table's existing
--      rules (it doesn't replace them): a "granola-note:" row is readable only
--      by those people, admins and approvers. Every other row is unchanged.
--      Only the server writes "granola-" rows; nobody else can add, change or
--      delete them.
--   2. Admins and approvers can settle a teammate's suggestion when they turn
--      the same point of a meeting into a task for that person, so it leaves
--      that person's Tasks.
--
-- Safe to run more than once. Run in: Supabase dashboard -> SQL Editor.
-- ============================================================================

-- 1. Who can read a meeting's notes
create or replace function public.granola_note_visible(p_key text, p_value text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_email text;
  v_role text;
  v_revoked boolean;
  v jsonb;
begin
  if p_key is null or p_key not like 'granola-note:%' then return true; end if;
  select lower(u.email), tp.role, coalesce(tp.access_revoked, false)
    into v_email, v_role, v_revoked
    from auth.users u left join public.team_profiles tp on tp.id = u.id
   where u.id = auth.uid();
  if v_email is null or v_revoked then return false; end if;
  if v_role in ('admin', 'approver') then return true; end if;
  begin
    v := p_value::jsonb;
  exception when others then
    return false;
  end;
  return coalesce(v -> 'people', '[]'::jsonb) ? v_email;
end;
$$;
revoke all on function public.granola_note_visible(text, text) from public;
grant execute on function public.granola_note_visible(text, text) to authenticated;

drop policy if exists "app_storage: meeting notes for those there" on public.app_storage;
create policy "app_storage: meeting notes for those there" on public.app_storage
  as restrictive for select to authenticated, anon
  using (public.granola_note_visible(key, value::text));

drop policy if exists "app_storage: granola rows are the server's (add)" on public.app_storage;
create policy "app_storage: granola rows are the server's (add)" on public.app_storage
  as restrictive for insert to authenticated, anon
  with check (key not like 'granola-%');

drop policy if exists "app_storage: granola rows are the server's (change)" on public.app_storage;
create policy "app_storage: granola rows are the server's (change)" on public.app_storage
  as restrictive for update to authenticated, anon
  using (key not like 'granola-%')
  with check (key not like 'granola-%');

drop policy if exists "app_storage: granola rows are the server's (delete)" on public.app_storage;
create policy "app_storage: granola rows are the server's (delete)" on public.app_storage
  as restrictive for delete to authenticated, anon
  using (key not like 'granola-%');

-- 2. Admins and approvers settle a teammate's suggestion
drop policy if exists "suggestions: settle for the team" on public.task_suggestions;
create policy "suggestions: settle for the team" on public.task_suggestions
  for update to authenticated
  using (exists (select 1 from public.team_profiles tp
                 where tp.id = auth.uid() and tp.role in ('admin', 'approver')
                   and coalesce(tp.access_revoked, false) = false))
  with check (exists (select 1 from public.team_profiles tp
                      where tp.id = auth.uid() and tp.role in ('admin', 'approver')
                        and coalesce(tp.access_revoked, false) = false));
