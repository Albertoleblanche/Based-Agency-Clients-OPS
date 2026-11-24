-- Gmail label "Radar" (Nov 24): each person's key for the small Apps Script that sends the emails they
-- label "Radar" to Radar as suggested tasks. Only a hash of the key is kept. Radar's server reads and
-- writes this table with the service key; nobody reads it from the app, so it has no policies.
create table if not exists public.gmail_label_keys (
  user_id      uuid primary key references public.team_profiles(id) on delete cascade,
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  sent_count   integer not null default 0
);
alter table public.gmail_label_keys enable row level security;
