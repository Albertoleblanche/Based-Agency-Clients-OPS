# Based Agency — Client Ops

## Project layout

- `index.html` + `css/` + `js/` + `vendor/` — the desktop app (see [`js/README.md`](js/README.md) for how the code is organised and the rules for adding to it)
- `mobile.html` — the phone version (phones are redirected here automatically)
- `api/` — Vercel serverless functions (already 12 functions; shared code goes in `lib/` so it doesn't count toward Vercel's function limit)
- `lib/` — shared server code: AI client, sign-in check (`require-team-member.js`), Slack, Harvest, Google Calendar, push
- `*.sql` — database changes to run in the Supabase SQL Editor

No build step: Vercel serves the files as they are.

## Database migrations

Run new `.sql` files once in Supabase → SQL Editor. The current one:

- `addendum-team-activity-log.sql` — moves the Overview activity log into its own
  table. Safe to run more than once; the app keeps working on the old storage until
  it's run, then switches over by itself.
- `addendum-improvement-details.sql` — adds a service and screenshots to each logged
  improvement. Until it's run, Log Improvement works as before and hides Screenshots.
- `addendum-colors-and-plan.sql` — colors on tasks and notes, and the Plan tab's
  sprints and weekly hours (private to each person). Until it's run, tasks and notes
  save without a color and Plan shows what's coming up but can't save sprints.
- `schema-whatsapp-tasks.sql` — the WhatsApp tables (client groups, the open items the
  connector finds, its runs and settings). Until it's run, the WhatsApp screen says it isn't
  set up. The connector itself runs on the office PC: see `whatsapp-connector/README.md`.
- `addendum-whatsapp-test-mode.sql` — puts WhatsApp in test mode for one person (put your
  sign-in email in it first): only they see it in Radar and get its Slack messages. Its last
  line turns test mode off.
- `addendum-whatsapp-check-now.sql` — Check Now, Make a Task (an item links to the task it
  became) and the chat around each item in its panel. Until it's run, those three say so when
  used and the rest of WhatsApp works as before. (Also at the end of `schema-whatsapp-tasks.sql`.)
- `addendum-weekly-wins.sql` (run after `schema-whatsapp-tasks.sql`) — weekly wins: a tier on
  each win, WhatsApp copy and send with one sender per win (copying claims it; anyone else is
  warned first), and Radar marking a win sent when it shows up in the client's group. Until
  it's run, wins have no tier and copying isn't shared with the team; the rest works.
  It also adds `wa_last_contact()` for Quiet clients on the WhatsApp screen.
- `addendum-harvest-sync.sql` — Radar reads Harvest's setup: clients, projects, tasks (billable
  or not), who is assigned where, and the team, matched to Radar people by email. Read only;
  no rates or costs are kept. Until it's run, Settings → Harvest says so and the rest works.
- `addendum-harvest-clients.sql` — run after the one above. Radar's client list follows
  Harvest's: each Harvest client stays linked to its Radar client through renames and
  archives. Until it's run, Radar reads Harvest as before and adds no clients.
- `addendum-harvest-time.sql` — time entries keep the Harvest project and task they were logged
  to. Until it's run, Log Time asks for a service as before.
- `addendum-harvest-time-read.sql` — time logged in Harvest is read into Radar (source, Harvest
  person, invoiced lock). Until it's run, Radar sends time to Harvest and reads none back.

## Weekly wins

Every client gets a win each week on its own win day (Monday to Friday), set in the client's
panel on All Clients with how it's sent (WhatsApp, email or both) and its WhatsApp group.
Radar never posts to WhatsApp: an approved WhatsApp win goes back to whoever wrote it, they
copy it, paste it in the group, and it counts as sent. A client with no win day keeps the old
rule: due 7 days after its last update.

## Harvest

Harvest owns the setup; Radar mirrors it (step 1 of the Harvest plan). The server reads what
changed whenever someone opens Radar (at most every 10 minutes), everything each night in the
daily cron, and on Sync Now in Settings → Harvest, where admins and approvers see the
connection, what was read, each client's projects and tasks, and the team matched by email.
Use a Harvest administrator's token: it can read the whole setup and log time for everyone.

Every active Harvest client is in Radar (step 2). Each read links a Harvest client to the Radar
client with the same name (ignoring endings like "LLC"), or adds it marked **Needs setup** and
tells admins and approvers (one note for a batch of four or more). It waits at the top of All
Clients, out of This Week, Health, Today and the reminders, until an approver picks its owner,
service and how it gets its weekly win (its group or an email) and presses Finish Setup. Time
can be logged for it meanwhile. **Same as…** moves the link to a client Radar already has under
another name, with anything logged on the added one; **Not a Radar Client** sends it to Trash
and Harvest won't add it again. A rename in Harvest carries over while Radar still uses the old
name; a client archived in Harvest is mentioned to approvers once, and one still waiting for
setup just leaves.

Time is logged as in Harvest (step 3): Add Time, Start Timer, Edit Time and Log Improvement (once
a time is typed) ask for Client → Project → Task, with the client's projects you're on in Harvest
and each task's Billable or Non-billable. Entries go to Harvest as the person who logged them
(matched by email); someone not in Harvest, or a client that isn't, keeps the time in Radar.
Older entries without a project still go through the client and service mappings.

Time logged in Harvest shows in Radar (step 4): from the first of last month on, what changed
whenever someone opens Radar and everything each night, the same entry in both. It shows From
Harvest on the Time screen; invoiced ones are read only; a full read with an administrator's token
removes what was deleted in Harvest. People only in Harvest count by name. A client's monthly hours
follow its Harvest projects' monthly hour budgets.

---

# Original setup guide (first deployment)

Everything code-related is done. Three things need a human to click through them —
here's exactly what to do, in order.

## 1. Create the database (Supabase)

1. Go to https://supabase.com → sign up (free) → **New project**.
2. Once it's created, go to **SQL Editor** → **New query**.
3. Paste in the entire contents of `schema.sql` (in this folder) and click **Run**.
4. Go to **Settings → Data API** (Supabase split this out from the old single "API"
   page). The **Project URL** is at the top there. For the key, either:
   - Click the **Connect** button near the top of the project dashboard — it shows
     both values pre-filled, ready to copy, or
   - Go to **Settings → API Keys**. Use the **Legacy API Keys** tab and copy the
     `anon` `public` key, OR use the newer **Publishable key** (`sb_publishable_...`)
     — both work identically for this purpose.
   Do **not** use the `service_role` / `secret` key — that one must never appear in
   frontend code.
5. Open `index.html`, find this block near the top of the `<script>` section:
   ```js
   const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_PUBLIC_KEY';
   ```
   Replace both placeholders with the values you copied. Save the file.

## 2. Put the code on GitHub

1. Create a new repository on https://github.com (private is fine).
2. Upload these three items into it, keeping the folder structure:
   - `index.html`
   - `api/generate-draft.js`
   - `schema.sql` (optional to include, just for your records)

## 3. Deploy (Vercel)

1. Go to https://vercel.com → sign up (free) → **Add New → Project**.
2. Import the GitHub repo you just created.
3. Before clicking Deploy, open **Environment Variables** and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: an API key from https://console.anthropic.com/settings/keys
     (This is a **different key** from anything used inside Claude.ai — it's a
     separate API account with its own billing. Anthropic's API is pay-as-you-go;
     draft generation for a few clients a week will cost a small fraction of a
     dollar, but it is a real cost, unlike usage inside Claude.ai.)
4. Click **Deploy**. Vercel gives you a live URL (e.g. `based-agency.vercel.app`)
   in about a minute.

## 4. Share it

Send that URL to the team. No login needed — same as before, it's one shared link.
Bookmark it; it won't change unless you redeploy under a different project name.

## What changed from the Claude version

- **Storage**: `window.storage` → Supabase (a real database). Same shared/personal
  split, but "personal" is now per-browser (`localStorage`) rather than tied to a
  Claude account, since there's no login system here. If people switch devices,
  their name/theme preference won't follow them — they'd just re-enter it once.
- **AI drafting**: calls now go through `api/generate-draft.js` (your own backend)
  instead of directly to Anthropic — this is what keeps your API key private.
- **Everything else** — the UI, the filters, the queue, the Google Sheet sync — is
  unchanged. It's the same app, just running on infrastructure you control instead
  of Claude's.

## Costs at this scale

- Supabase free tier: plenty for this (well under the row/bandwidth limits).
- Vercel free tier: plenty for this (well under the function-invocation limits).
- Anthropic API: usage-based, pay-as-you-go. Realistically a few dollars a month
  at most for weekly drafting across a normal client list.
