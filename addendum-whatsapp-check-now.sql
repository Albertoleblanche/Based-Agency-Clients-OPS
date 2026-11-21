-- addendum-whatsapp-check-now.sql
-- Run once in Supabase → SQL Editor (after schema-whatsapp-tasks.sql and addendum-whatsapp-test-mode.sql).
-- Safe to run more than once. The same section is at the end of schema-whatsapp-tasks.sql.

-- ============================================================================
-- Check Now, Make a Task, and the chat around each item
--
--   * check_requested_at: Radar's Check Now button sets it; the connector on the office
--     PC sees it within 30 seconds, reads the groups right away (no Slack messages) and
--     clears it.
--   * task_id: the Radar task an item became (Make a Task).
--   * wa_task_messages(item): the messages around what the client asked, for the item
--     panel. Leads (or the testers) see any item's; everyone else only their own items'.
-- ============================================================================
alter table public.wa_tasks add column if not exists task_id text;
revoke update on public.wa_tasks from authenticated;
grant update (status, owner_key, owner_user_id, priority, due_date, task_id, updated_at)
  on public.wa_tasks to authenticated;

alter table public.wa_settings add column if not exists check_requested_at timestamptz;
grant update (check_requested_at) on public.wa_settings to authenticated;

create or replace function public.wa_task_messages(p_task uuid)
returns table (wa_msg_id text, sender text, from_team boolean, body text, sent_at timestamptz, is_source boolean)
language sql stable security definer set search_path = public as $$
  with t as (
    select w.group_jid, w.source_msg_ids from public.wa_tasks w
    where w.id = p_task
      and (public.wa_is_lead()
           or (not public.wa_in_test_mode()
               and w.owner_user_id = auth.uid()
               and exists (select 1 from public.team_profiles tp
                           where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false)))
  ), src as (
    select min(m.ts) as a, max(m.ts) as b
    from public.wa_messages m join t on m.group_jid = t.group_jid
    where m.wa_msg_id = any(t.source_msg_ids)
  ), picked as (
    (select m.* from public.wa_messages m join t on m.group_jid = t.group_jid, src
       where m.ts < src.a order by m.ts desc limit 2)
    union all
    (select m.* from public.wa_messages m join t on m.group_jid = t.group_jid, src
       where m.ts between src.a and src.b order by m.ts limit 12)
    union all
    (select m.* from public.wa_messages m join t on m.group_jid = t.group_jid, src
       where m.ts > src.b order by m.ts limit 6)
  )
  select p.wa_msg_id, p.sender, p.from_team, p.text, p.ts, p.wa_msg_id = any(t.source_msg_ids)
  from picked p cross join t
  order by p.ts;
$$;
grant execute on function public.wa_task_messages(uuid) to authenticated;
