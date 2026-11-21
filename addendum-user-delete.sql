-- Deleting a teammate for good (Team → Delete permanently).
--
-- Supabase says "Database error deleting user" when a table still points at that person and
-- doesn't say what should happen to its rows when they go. This finds every such link to a user
-- (auth.users or team_profiles) in the public tables and gives it a rule, without touching links
-- that already have one:
--   * rows that only exist for that person (their profile, notifications, sign-ins, settings,
--     chats, or anything keyed by the person) are deleted with them;
--   * everything else (time, improvements, tasks, reports, history) stays, without their name.
-- Safe to run more than once. Run it in Supabase → SQL Editor.

do $$
declare
  r record;
  personal text[] := array['team_profiles', 'notifications', 'push_subscriptions', 'google_calendar_connections',
    'email_change_requests', 'claude_conversations', 'claude_chat_messages', 'claude_chat_usage', 'claude_projects',
    'plan_settings', 'avatars', 'app_storage'];
  keyed boolean;
begin
  for r in
    select c.conname, c.conrelid, c.conrelid::regclass as tbl, cl.relname, a.attname, a.attnum, a.attnotnull,
           c.confrelid::regclass as ref, ra.attname as refcol, c.confdeltype
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
    where c.contype = 'f' and n.nspname = 'public' and array_length(c.conkey, 1) = 1
      and c.confrelid in ('auth.users'::regclass, coalesce(to_regclass('public.team_profiles'), 'auth.users'::regclass))
      and c.confdeltype in ('a', 'r')   -- no rule yet (no action / restrict): these block the delete
  loop
    -- part of the row's key (or unique): the row can't exist without the person
    keyed := exists (select 1 from pg_constraint k where k.conrelid = r.conrelid and k.contype in ('p', 'u') and r.attnum = any(k.conkey));
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    if keyed or r.relname = any(personal) then
      execute format('alter table %s add constraint %I foreign key (%I) references %s(%I) on delete cascade', r.tbl, r.conname, r.attname, r.ref, r.refcol);
      raise notice '%.%: deleted with the person', r.relname, r.attname;
    else
      if r.attnotnull then execute format('alter table %s alter column %I drop not null', r.tbl, r.attname); end if;
      execute format('alter table %s add constraint %I foreign key (%I) references %s(%I) on delete set null', r.tbl, r.conname, r.attname, r.ref, r.refcol);
      raise notice '%.%: kept, without their name', r.relname, r.attname;
    end if;
  end loop;
end $$;

-- Files they uploaded (avatars, screenshots) stay. Older Supabase projects tie each file to the
-- person who uploaded it, which blocks the delete the same way.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'objects_owner_fkey' and conrelid = to_regclass('storage.objects')) then
    begin
      alter table storage.objects drop constraint objects_owner_fkey;
      raise notice 'storage.objects.owner: files they uploaded stay';
    exception when insufficient_privilege then
      raise notice 'storage.objects.owner still blocks deleting people who uploaded files (this role can''t change it)';
    end;
  end if;
end $$;

-- What happens to each table now when a person is deleted (c = deleted with them, n = kept without their name).
select cl.relname as "table", a.attname as "column", c.confrelid::regclass as "points at",
       case c.confdeltype when 'c' then 'deleted with them' when 'n' then 'kept, without their name' when 'd' then 'set to default' else 'BLOCKS the delete' end as "when deleted"
from pg_constraint c
join pg_class cl on cl.oid = c.conrelid
join pg_namespace n on n.oid = cl.relnamespace
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f' and n.nspname = 'public'
  and c.confrelid in ('auth.users'::regclass, coalesce(to_regclass('public.team_profiles'), 'auth.users'::regclass))
order by c.confdeltype in ('a', 'r') desc, 4, 1;
