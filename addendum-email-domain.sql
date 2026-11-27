-- Only @based-agency.com addresses can have a Based Radar account (Nov 20).
--
-- The app already refuses other addresses when signing in, asking for a reset link, adding a member
-- and changing a sign-in email, and the server refuses them when an admin adds a member or approves an
-- email change. This puts the same rule in the database, so no other way into Supabase (a sign-up
-- call, the dashboard, a script) can create an account or move one to another domain.
--
-- First, see who would be affected. Anyone listed has a sign-in email on another domain: change it to
-- their @based-agency.com address (Supabase → Authentication → Users) before running the rest, or they
-- won't be able to sign in.
--
--   select name, email from public.team_profiles where lower(email) not like '%@based-agency.com';
--
-- Accounts that already exist are left as they are; only new accounts and changed emails are checked.
-- Safe to run more than once. Run it in Supabase → SQL Editor.

create or replace function public.enforce_team_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or lower(new.email) not like '%@based-agency.com' then
    raise exception 'Only @based-agency.com emails can have a Based Radar account'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists enforce_team_email_domain_insert on auth.users;
create trigger enforce_team_email_domain_insert
  before insert on auth.users
  for each row execute function public.enforce_team_email_domain();

drop trigger if exists enforce_team_email_domain_update on auth.users;
create trigger enforce_team_email_domain_update
  before update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.enforce_team_email_domain();
