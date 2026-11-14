-- NOTE (Nov 2026): this is the ORIGINAL bootstrap schema from before the app
-- had logins. The live database has since moved on (real per-table data, and
-- app_storage now requires a signed-in session). Don't re-run the policy below
-- on the live project; see README → Database migrations for current changes.

-- Run this once in Supabase: Project -> SQL Editor -> New query -> paste -> Run

create table if not exists app_storage (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Auto-update the timestamp on every write
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_storage_updated_at on app_storage;
create trigger trg_app_storage_updated_at
before update on app_storage
for each row execute function set_updated_at();

-- Row Level Security: since this is an internal team tool with no login system,
-- we allow the anon (public) key to read/write. The anon key is safe to expose
-- in frontend code -- it is NOT the same as your service role / secret key.
alter table app_storage enable row level security;

drop policy if exists "app_storage_all" on app_storage;
create policy "app_storage_all"
on app_storage
for all
to anon
using (true)
with check (true);
