-- addendum-whatsapp-followups.sql
-- Run once in Supabase → SQL Editor (after addendum-whatsapp-check-now.sql). Safe to run more than once.
-- The same function is at the end of schema-whatsapp-tasks.sql.

-- ============================================================================
-- The chat on an item reaches the newest message
--
--   wa_task_messages(item) used to return the request and only the first 6 messages after it,
--   so a client's follow-up a few days later (say, after the item was marked done) never showed
--   on the item. Now: the 2 messages before the request, the request itself, the first 6 after it,
--   and the newest 30 after that, so a follow-up always shows. Who may see an item's chat is
--   unchanged: leads (or the testers) any item's, everyone else only their own items'.
-- ============================================================================
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
    union
    (select m.* from public.wa_messages m join t on m.group_jid = t.group_jid, src
       where m.ts between src.a and src.b order by m.ts limit 12)
    union
    (select m.* from public.wa_messages m join t on m.group_jid = t.group_jid, src
       where m.ts > src.b order by m.ts limit 6)
    union
    (select m.* from public.wa_messages m join t on m.group_jid = t.group_jid, src
       where m.ts > src.b order by m.ts desc limit 30)
  )
  select p.wa_msg_id, p.sender, p.from_team, p.text, p.ts, p.wa_msg_id = any(t.source_msg_ids)
  from picked p cross join t
  order by p.ts;
$$;
grant execute on function public.wa_task_messages(uuid) to authenticated;
