# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Based Agency's own team. Account managers log the week's work for each client and draft client update emails. Approvers and admins review those drafts, approve and send them, and watch client health across the agency. The person who built it (an admin and approver) uses it all day on a Windows PC. There is also a phone version for quick checks.

## Product Purpose
It keeps every client's weekly update moving from work logged → AI-drafted client email → approved → sent, so no client goes a week without hearing what was done. Around that loop it holds the team's operating work: tasks, reminders, calendar, time against each client's monthly hour budget, and client health/risk. Success: every active client gets its update on time, at-risk clients are seen early, and nobody has to hunt for what needs them next.

## Positioning
An internal tool built around one ritual, the weekly client update, rather than a general project manager. Its mechanism is the chain from logged improvements to an AI draft to an approval queue to a sent email, with client risk and importance deciding what comes first.

## Operating Context
Used all day at a desk alongside Google Ads, Meta, Slack, Harvest and email. Peaks: drafting and approving client updates during the week, sending in batches. Clients are residential contractors and home-services businesses (remodelers, roofers, plumbers, flooring, electricians).

## Capabilities and Constraints
- Screens today: Today, This Week, Review, Focus Reports, All Clients (+ client page), Health, Tasks, Reminders, Notes, Calendar, Time (Harvest sync, hour budgets, payroll), Team, Recently Deleted, Settings. Plus the iPhone app (mobile.html).
- Weekly updates: every client gets one a week, on no fixed day. It's due 7 days after the last one; an approver checks every update and sends it the day it's ready. Nothing is sent automatically.
- Draft states per client and author: no draft yet → draft ready (pending, then "ready to notify") → approved → sent → archived. Needs re-review when new work lands on an approved draft.
- Client fields: service, status, importance 1–10, risk 1–5, monthly hour budget, custom fields.
- Roles: admin, approver, member; members don't see the Team Queue.
- Vanilla JS, no build step, Supabase backend, Vercel hosting; desktop app plus a separate phone page. Installable as a desktop app.
- Light and dark themes; the user mostly works in dark.

## Brand Commitments
- Product name in use: "Based Radar — Team Workflow" (brand name, logo and brand color are customizable in Settings; current brand color is a red-orange, logo is a red tile with a white mark).
- Requested direction: look and feel like a native Apple app, following Apple's design principles, with Apple's system font. Feel: quiet, flat, one accent color, generous spacing.

## Evidence on Hand
Real client names and data live in Supabase and are not in this repo. Mockups use clearly fictional sample clients and figures.

## Product Principles
1. The weekly update loop comes first; everything else supports it.
2. Show what needs attention next, in priority order, before showing everything.
3. One place per job: no screen should make you hunt across others to finish a task.
4. Familiar, native behavior over invention.
