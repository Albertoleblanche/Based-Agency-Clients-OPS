-- ============================================================================
-- addendum-task-files.sql
-- Files on tasks (Nov 23): the New Task sheet and the task panel attach files,
-- stored in the private 'attachments' bucket under tasks/<task id>/ and listed in
-- tasks.attachments. These rules let the people who can see a task (whoever
-- gave it, whoever has it, and admins and approvers) read, add and remove its
-- files. Only touches the tasks/ folder.
--
-- Safe to run more than once. Run in: Supabase dashboard -> SQL Editor.
-- ============================================================================

alter table public.tasks add column if not exists attachments jsonb not null default '[]'::jsonb;

drop policy if exists "task files: read" on storage.objects;
create policy "task files: read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'tasks'
    and exists (select 1 from public.tasks t
                where t.id::text = (storage.foldername(name))[2]
                  and (t.assigner_id = auth.uid() or t.assignee_id = auth.uid()
                       or exists (select 1 from public.team_profiles tp
                                  where tp.id = auth.uid() and tp.role in ('admin', 'approver')
                                    and coalesce(tp.access_revoked, false) = false)))
  );

drop policy if exists "task files: add" on storage.objects;
create policy "task files: add" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'tasks'
    and exists (select 1 from public.tasks t
                where t.id::text = (storage.foldername(name))[2]
                  and (t.assigner_id = auth.uid() or t.assignee_id = auth.uid()
                       or exists (select 1 from public.team_profiles tp
                                  where tp.id = auth.uid() and tp.role in ('admin', 'approver')
                                    and coalesce(tp.access_revoked, false) = false)))
  );

drop policy if exists "task files: remove" on storage.objects;
create policy "task files: remove" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'tasks'
    and exists (select 1 from public.tasks t
                where t.id::text = (storage.foldername(name))[2]
                  and (t.assigner_id = auth.uid() or t.assignee_id = auth.uid()
                       or exists (select 1 from public.team_profiles tp
                                  where tp.id = auth.uid() and tp.role in ('admin', 'approver')
                                    and coalesce(tp.access_revoked, false) = false)))
  );
