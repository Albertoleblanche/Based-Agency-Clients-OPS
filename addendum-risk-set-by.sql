-- Who set a client's Risk (Nov 25): Health says "Flagged by Dan" instead of naming the client's owner.
alter table public.client_danger_history add column if not exists set_by text;
