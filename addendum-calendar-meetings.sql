-- Meetings you can join, a calendar that keeps up, and alerts before a meeting (Nov 23)
-- Run once in Supabase → SQL Editor. Safe to run again.

-- 1. The link to join a meeting (Google Meet, or a Zoom/Teams/... link from the invite).
alter table public.calendar_events add column if not exists meeting_url text;

-- 2. Every five minutes: Google Calendar synced for everyone connected (a new or moved meeting lands
--    in Radar within minutes, a deleted one goes), and "starting in 10 minutes" alerts in the bell, by
--    push and on Slack. Without this part Radar still syncs three times a day and whenever it's open,
--    and alerts while it's open in a browser.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('radar-calendar-tick') where exists (select 1 from cron.job where jobname = 'radar-calendar-tick');
select cron.schedule('radar-calendar-tick', '*/5 * * * *',
  $$ select net.http_get(url := 'https://based-agency-radar.vercel.app/api/integrations?route=calendar-tick', timeout_milliseconds := 60000) $$);
