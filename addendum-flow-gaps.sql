-- ============================================================================
-- addendum-flow-gaps.sql
-- Closes the gaps in the log -> draft -> review -> send flow (Nov 21):
--   client_improvements.edited_at   when the words were last changed, so a draft
--                                    written before that says "edited since"
--   client_improvements.carry_over  older work someone added to the next update
--                                    from "Never went out" in the Queue
--   time_entries.improvement_id     filled in for older work: each piece of work
--                                    logged before the link existed is linked to
--                                    its time when there's exactly one clear match
--                                    (same person, same client, same words, within
--                                    a day), so deleting either one deletes both.
--
-- Run addendum-deleted-work.sql first (it adds the link). Safe to run more than
-- once. Until it's run the app works as before: edits aren't flagged on drafts,
-- and "Add to Next Update" asks for this file.
-- Run in: Supabase dashboard -> SQL Editor.
-- ============================================================================

alter table public.client_improvements add column if not exists edited_at timestamptz;
alter table public.client_improvements add column if not exists carry_over boolean not null default false;

-- Link older work to its time: one-to-one matches only, never a guess.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'time_entries' and column_name = 'improvement_id') then
    with pairs as (
      select t.id as entry_id, i.id as imp_id
        from public.time_entries t
        join public.team_profiles p on p.id = t.user_id
        join public.client_improvements i
          on i.client_id::text = t.client_id::text
         and i.author = p.name
         and abs(t.entry_date::date - (i.date::timestamptz at time zone 'UTC')::date) <= 1
         and lower(btrim(t.description)) = lower(btrim(i.text))
       where t.improvement_id is null
         and t.deleted_at is null
         and i.deleted_at is null
         and not exists (select 1 from public.time_entries x where x.improvement_id = i.id)
    ), one_to_one as (
      select entry_id, imp_id from pairs
       where entry_id in (select entry_id from pairs group by entry_id having count(*) = 1)
         and imp_id in (select imp_id from pairs group by imp_id having count(*) = 1)
    )
    update public.time_entries t
       set improvement_id = o.imp_id
      from one_to_one o
     where t.id = o.entry_id;
  end if;
end $$;
