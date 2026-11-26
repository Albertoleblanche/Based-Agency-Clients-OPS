-- Not in their plan (Nov 25): a request Radar picks up from a client's email, a meeting or WhatsApp
-- that's outside what the client pays for comes in labelled "Not in their plan: offer as add-on".
-- It stays a suggestion (or a WhatsApp request) like any other; whoever reviews it decides.
-- Safe to run more than once. Until it's run, everything still comes in, without the label.

alter table public.task_suggestions add column if not exists out_of_scope boolean not null default false;
alter table public.task_suggestions add column if not exists scope_note   text;

alter table public.wa_tasks add column if not exists out_of_scope boolean not null default false;
alter table public.wa_tasks add column if not exists scope_note   text;

notify pgrst, 'reload schema';
