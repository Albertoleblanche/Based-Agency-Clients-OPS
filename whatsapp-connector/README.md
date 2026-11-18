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
5. `npm install`
6. `npm run link` — a QR code appears. On the phone: WhatsApp → Settings → Linked devices →
   Link a device → scan. When it says *WhatsApp connected*, press Ctrl+C.
7. `npm start` — leave this running (see "Keep it running").

Check without sending anything: `npm run dry-run` prints the Slack messages instead of sending them.
Run a digest right now: `npm run digest-now`.

## Managing it from Radar (Eric and Dan)

After the connector is running once, open Radar → WhatsApp → **Setup**:
- **Connection:** shows whether the connector is running and WhatsApp is linked. When a code is needed
  (first link, or after Re-link) the QR code appears right there to scan. No Command Prompt needed.
- **Groups being read:** switch any group on or off. Groups with "Marketing" in the name are on by
  default. Only group *names* are stored for groups that are off, never their messages.
- **When it runs:** the daily check times and time zone.
- **Who handles what:** edit what each person is responsible for. Blank = the default.

Changes reach the connector within about a minute. Still on the PC: running `npm start`, and the
`.env` secrets (they never go in a web screen). Run the second half of `schema-whatsapp-tasks.sql`
(already included in the file) so the Setup panel's tables exist.

## Keep it running

The PC must be on and awake at 9:00 and 15:00. Easiest: Task Scheduler → create a task
"At log on" that runs `npm start` in this folder, and set Power options → sleep to "Never".
(Moving to a small cloud server later only means copying this folder and the `auth` folder.)

## How it decides who gets what

Roles live in `src/roles.js`. When someone changes the assignee on an item in Radar, the agent
sees that correction on its next run and uses it as an example — that's how it learns.
Pressing **Not a task** also tells it the item wasn't real.

## If WhatsApp logs out

WhatsApp can drop linked devices. The connector writes an error to Radar (red dot on the
WhatsApp screen) and DMs Eric and Dan. Delete the `auth` folder and run `npm run link` again.

## Risk to know about

Linking through a QR code uses an unofficial library; WhatsApp's terms don't allow it and the
number could be restricted. This build keeps the footprint small (read-only, client groups
only, no read receipts). Using a spare number later is a one-line change: link that number instead.
