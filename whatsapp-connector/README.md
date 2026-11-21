# Radar WhatsApp connector

Reads the **client WhatsApp groups** (any group with "Marketing" in its name, plus
"American Mutual Insurance | Based Agency"), finds open client requests and unanswered
questions, assigns each to the right teammate, and shows them in Radar → **WhatsApp**.
Twice a day (default 9:00 and 15:00 New York time) it also sends everyone a Slack DM with
their items; Eric and Dan get the full team view.

**It is read-only.** It never sends a WhatsApp message, never sends read receipts, and
drops every personal chat and non-client group before anything is stored.

## One-time setup (Windows PC)

1. Install Node.js 20+ from nodejs.org.
2. In Supabase → SQL Editor, run `schema-whatsapp-tasks.sql` from the repo root.
3. In this folder: `copy .env.example .env`, then fill in the four keys
   (Supabase URL + service-role key, Anthropic key, Slack bot token). Never commit `.env`.
4. Make sure each teammate's **Slack user ID** is set in Radar → Team (the DMs need it)
   and their Radar name starts with their first name (Albert, Stan, Eric, Charlie, Dan/Daniel, Joey).
5. `npm install` (the `.npmrc` here lets npm 12 fetch the one package Baileys takes from GitHub;
   on its own, npm 12 stops with EALLOWGIT)
6. `npm run link` — a QR code appears. On the phone: WhatsApp → Settings → Linked devices →
   Link a device → scan. When it says *WhatsApp connected*, press Ctrl+C.
7. `npm start` — leave this running (see "Keep it running").

Check without sending anything: `npm run dry-run` prints the Slack messages instead of sending them.
Run a digest right now: `npm run digest-now`.

## Managing it from Radar (Eric and Dan)

After the connector is running once, open Radar → Settings → **WhatsApp** (or WhatsApp settings on the WhatsApp screen):
- **Connection:** shows whether the office PC is running it and WhatsApp is linked. When a code is needed
  (first link, or after Re-link) the QR code appears right there to scan. No Command Prompt needed.
  **Check Now** reads the groups right away (within 30 seconds of pressing it) and updates the list;
  it sends no Slack messages, those go at the set times.
- **Groups it reads:** switch any group on or off, or Turn All On / Turn All Off (with Find, just the
  groups that match). Groups with "Marketing" in the name are on by default. Only group *names* are
  stored for groups that are off, never their messages.
- **When it checks:** the daily check times and time zone.
- **Who handles what:** edit what each person is responsible for. Blank = the default.

**Weekly wins:** when someone pastes an approved win in a client's group, Radar marks it sent by
itself (a database trigger in `addendum-weekly-wins.sql` compares new messages with the client's
approved win). That needs the group linked to the client (All Clients → the client → Weekly win →
Group) and the group switched on here. Nothing changes in the connector itself.

Changes reach the connector within about a minute. Still on the PC: running `npm start`, and the
`.env` secrets (they never go in a web screen). Run the second half of `schema-whatsapp-tasks.sql`
(already included in the file) so the settings tables exist.

## Test mode (only you, while you try it)

Run `addendum-whatsapp-test-mode.sql` in Supabase → SQL Editor with your sign-in email in it.
While test mode is on:
- Only you see WhatsApp in Radar (the sidebar item, the screen, Settings → WhatsApp and the
  Integrations row), whatever your role. Everyone else, admins included, sees nothing.
- You see every item and can change everything.
- The Slack messages go only to you: one full list per check, and the logged-out alert. Nobody
  else is messaged, Eric and Dan included.
- Until the connector has loaded Radar's settings, it sends no Slack messages at all.

To go live, run the last line of that file. Radar and the connector switch over within a minute.

## Keep it running

The PC must be on and awake at 9:00 and 15:00. Easiest: Task Scheduler → create a task
"At log on" that runs `npm start` in this folder, and set Power options → sleep to "Never".
(Moving to a small cloud server later only means copying this folder and the `auth` folder.)

## How it decides who gets what

Roles live in `src/roles.js`. When someone changes the assignee on an item in Radar, the agent
sees that correction on its next run and uses it as an example — that's how it learns.
Pressing **Not a Task** also tells it the item wasn't real.

## When a client writes again after an item is done

At each check the agent also sees the group's items closed in the last two weeks (marked done in
Radar, or answered in the chat). If the client follows up on one of them (asks for more, says it
isn't fixed, or sends what the team was waiting for), it **reopens that item** with what they now
need, instead of skipping the message as an update or making a duplicate. Thanks and "looks good"
don't reopen anything. In Radar, a done item the client wrote on since shows at the top of
Waiting under "The client wrote again", and its chat runs up to the newest message, with a line
where it was marked done.

## If WhatsApp logs out

WhatsApp can drop linked devices. The connector writes an error to Radar (a red dot on the
WhatsApp screen and in Settings → WhatsApp) and DMs Eric and Dan. Press **Re-link…** there for a
new code, or delete the `auth` folder and run `npm run link` again.

## Risk to know about

Linking through a QR code uses an unofficial library; WhatsApp's terms don't allow it and the
number could be restricted. This build keeps the footprint small (read-only, client groups
only, no read receipts). Using a spare number later is a one-line change: link that number instead.
