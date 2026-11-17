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
