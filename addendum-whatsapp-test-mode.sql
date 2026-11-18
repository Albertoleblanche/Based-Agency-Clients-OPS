-- ============================================================================
-- addendum-whatsapp-test-mode.sql
--
-- Puts WhatsApp in test mode for one person. Only that person sees the WhatsApp
-- screen and Settings → WhatsApp in Radar (whatever their role), sees every item,
-- and gets the connector's Slack messages. Nobody else sees it or is messaged.
--
-- Run after schema-whatsapp-tasks.sql, in Supabase → SQL Editor.
-- 1. Replace the email below with the one you sign in to Radar with.
-- 2. Run. If no Radar user signs in with that email, it stops and changes nothing.
-- ============================================================================

do $$
declare tester uuid;
begin
  select id into tester from auth.users where lower(email) = lower('your-email@based-agency.com');
  if tester is null then
    raise exception 'No Radar user signs in with that email. Nothing was changed.';
  end if;
  update public.wa_settings set pilot_user_ids = array[tester], updated_at = now() where id = 1;
end $$;

-- Check: this should list only you.
select u.email, tp.name
from public.wa_settings s
join auth.users u on u.id = any(s.pilot_user_ids)
left join public.team_profiles tp on tp.id = u.id
where s.id = 1;

-- To go live later (admins and approvers manage it, everyone sees their own items,
-- everyone gets their Slack list), run:
--   update public.wa_settings set pilot_user_ids = '{}', updated_at = now() where id = 1;
