-- ============================================================================
-- addendum-reminder-sources.sql (Nov 25)
-- Follow-ups from Granola and Gmail land in Reminders, with where they came from.
--
-- What a client owes the agency (photos, logins, an approval, an answer), found in a Granola
-- meeting or a client's email, becomes a follow-up in Reminders instead of a task. Each one keeps
-- the meeting or email it came from, so Reminders can link back to it:
--   client_reminders.source        'granola' | 'gmail' | null (added by hand)
--   client_reminders.source_id     the Granola note or Gmail message
--   client_reminders.source_title  the meeting's title or the email's subject
--   client_reminders.source_url    a link to the notes or the email
--
-- Until this runs, those follow-ups are still made, just without the link back.
-- Run in: Supabase dashboard -> SQL Editor. Safe to run more than once.
-- ============================================================================

alter table public.client_reminders add column if not exists source text;
alter table public.client_reminders add column if not exists source_id text;
alter table public.client_reminders add column if not exists source_title text;
alter table public.client_reminders add column if not exists source_url text;
create index if not exists client_reminders_source_idx on public.client_reminders (source, source_id) where source is not null;
