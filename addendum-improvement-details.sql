-- ============================================================================
-- addendum-improvement-details.sql
-- Adds the two fields the Log Improvement sheet has beyond the text:
--   service      which service the work was for (Google Ads, SEO, ...)
--   attachments  screenshots, as [{ name, path, size, type, uploadedAt }]
-- and lets team members store those screenshots in the private
-- 'attachments' bucket, under improvements/<improvement id>/.
--
-- Safe to run more than once. Until it's run, the app logs improvements
-- exactly as before and leaves the Screenshots row out of the sheet.
-- Run in: Supabase dashboard -> SQL Editor.
-- ============================================================================

alter table public.client_improvements add column if not exists service text;
alter table public.client_improvements add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Screenshot files: readable, addable and removable by any signed-in team
-- member whose access hasn't been revoked (the same people who can see the
-- improvements themselves). Only touches the improvements/ folder.
drop policy if exists "team reads improvement files" on storage.objects;
create policy "team reads improvement files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'improvements'
    and exists (select 1 from public.team_profiles tp
                where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)
  );

drop policy if exists "team adds improvement files" on storage.objects;
create policy "team adds improvement files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'improvements'
    and exists (select 1 from public.team_profiles tp
                where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)
  );

drop policy if exists "team removes improvement files" on storage.objects;
create policy "team removes improvement files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'improvements'
    and exists (select 1 from public.team_profiles tp
                where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)
  );
