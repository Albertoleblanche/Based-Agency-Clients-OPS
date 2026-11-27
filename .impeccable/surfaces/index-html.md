---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

## Scope
Concept redesign of the Based Radar desktop app (index.html), shown as screens on a design canvas. Mode: Operate.

## Audience and task
Based Agency's team (account managers and approvers) working all day at a desk, mostly in dark mode. They need to see, in priority order, what needs them (updates to review, clients at risk, work due), then work through the weekly client-update loop: logged work → AI draft → approved → sent.

## Constraints
Keep every feature and the classic Mac app structure (the user chose it). Fix: feels like a website, unclear priorities, colors/contrast, too busy.

## Direction contract
THESIS: Based Radar as a well-behaved Mac app: one source-list sidebar, a unified toolbar, and content laid out the way Apple's Mail, Reminders, Calendar and Settings lay out theirs. It refuses the web admin dashboard: card grids, pills on everything, a different color per widget.
OWN-WORLD: macOS graphite and paper surfaces (window, sidebar material, grouped lists), San Francisco at Mac sizes (13 body, 11 secondary, 15/17 headings, 26 large title), hairline separators, inset grouped lists, 6–10px radii, SF-weight line icons. One accent (Based orange) only for selection and the primary action; state is a small system-colored dot plus words.
STORY: Open the app and Today lists what needs you, most urgent first. Pick an item and you land on its screen with it selected in a list + detail layout. Approve and send from the toolbar without hunting.
FIRST VIEWPORT: a 1360×860 window on the desktop: traffic lights over a 228px sidebar (Today, Updates, Clients, Work, Team), a toolbar with title, search and New, then the large title "Today", one summary line, the "Waiting for your review" list leading the left two-thirds, and the week's progress and agenda on the right.
FORM: canon (the user chose the standing exit "Classic Mac app, done properly"), seed key c19db83f, degraded roll (no challengers).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
