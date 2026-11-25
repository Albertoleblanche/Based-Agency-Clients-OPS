-- ============================================================================
-- addendum-risk-flags.sql (Nov 25)
-- A client's Risk is a flag with a reason, reviewed; concerns from anyone.
--
--   client_danger_history.reason   why the Risk was set ("Unhappy with lead quality")
--   client_danger_history.kind     null: the Risk was set; 'kept': reviewed, still flagged
--   client_concerns                a teammate's concern about a client: Watch until an approver
--                                  or admin puts the client At risk or clears it (or the
--                                  person who raised it withdraws it)
--
-- Health shows the work (updates, logged work, hours, tasks, meetings, WhatsApp) and the flag
-- side by side. Once the work has been healthy for two weeks since a flag, approvers and admins
-- are asked to review it: Keep It (asks again in two weeks) or Clear Flag. Only they put a client
-- At risk or clear a flag; anyone on the team can raise a concern.
--
-- Run after addendum-risk-set-by.sql. Safe to run more than once.
-- Run in: Supabase dashboard -> SQL Editor.
-- ============================================================================

alter table public.client_danger_history add column if not exists reason text;
alter table public.client_danger_history add column if not exists kind text;

-- Who's on the team, and who leads it (admins and approvers), for the policies below
create or replace function public.rf_is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false);
$$;
create or replace function public.rf_is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_profiles tp where tp.id = auth.uid() and coalesce(tp.access_revoked, false) = false
                 and tp.role in ('admin', 'approver'));
$$;
grant execute on function public.rf_is_team() to authenticated;
grant execute on function public.rf_is_lead() to authenticated;

-- Concerns: client_id the same type as clients.id
do $$
declare idtype text;
begin
  if to_regclass('public.client_concerns') is null then
    select format_type(a.atttypid, a.atttypmod) into idtype
      from pg_attribute a where a.attrelid = 'public.clients'::regclass and a.attname = 'id';
    execute format($t$
      create table public.client_concerns (
        id           uuid primary key default gen_random_uuid(),
        client_id    %s not null references public.clients(id) on delete cascade,
        reason       text not null check (char_length(btrim(reason)) between 1 and 500),
        raised_by    text,
        raised_by_id uuid not null default auth.uid(),
        created_at   timestamptz not null default now(),
        resolved_at  timestamptz,
        resolved_by  text,
        outcome      text check (outcome in ('cleared', 'flagged', 'withdrawn'))
      )$t$, idtype);
  end if;
end $$;
create index if not exists client_concerns_open_idx on public.client_concerns(client_id) where resolved_at is null;

alter table public.client_concerns enable row level security;
revoke all on public.client_concerns from anon;
grant select, insert on public.client_concerns to authenticated;
grant update (resolved_at, resolved_by, outcome) on public.client_concerns to authenticated;

drop policy if exists "team reads concerns" on public.client_concerns;
create policy "team reads concerns" on public.client_concerns
  for select to authenticated using (public.rf_is_team());

-- anyone on the team raises one, as themselves, open
drop policy if exists "team raises concerns" on public.client_concerns;
create policy "team raises concerns" on public.client_concerns
  for insert to authenticated with check (public.rf_is_team() and raised_by_id = auth.uid() and resolved_at is null and outcome is null);

-- admins and approvers close any (cleared, or turned into a flag); whoever raised one can withdraw it
drop policy if exists "leads or the raiser close concerns" on public.client_concerns;
create policy "leads or the raiser close concerns" on public.client_concerns
  for update to authenticated
  using (public.rf_is_lead() or raised_by_id = auth.uid())
  with check (public.rf_is_lead() or (raised_by_id = auth.uid() and outcome = 'withdrawn'));
