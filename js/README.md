# App code layout

The desktop app (`index.html`) used to be one 18,800-line file. Its code now lives
in plain JavaScript files — no build step, no bundler. Vercel serves them as-is.

```
index.html         page shell + screen markup; loads everything below in order
css/               base → layout → overview → screens → components → responsive
js/core/           shared foundation (state, Supabase client, helpers, toasts,
                   modals, loading/saving, live updates, navigation)
js/ui/             reusable display pieces (date/time pickers, pills, badges)
js/features/       one file per area of the app (clients, queues, notes, tasks,
                   calendar, time tracker, reports, assistant, settings, team…)
js/app.js          startup: login, auth state, live-update safety nets — last
vendor/            pinned third-party libraries (Supabase, jsPDF, marked,
                   DOMPurify, Cropper)
```

## Rules that keep it working

1. **They are classic scripts sharing one global scope.** A function or top-level
   `let`/`const` in any file is visible to every other file and to inline
   `onclick="…"` handlers in the markup, exactly as when it was one file.
2. **Load order matters only for code that runs while the page loads.** Anything
   inside a function runs later and can use anything from any file. But a top-level
   statement such as `let from = getWeekStart(new Date())` runs immediately, so
   `getWeekStart` must be in the same file or an earlier one. Shared helpers live in
   `js/core/helpers.js`, which loads first.
3. **Don't add `async`, `defer` or `type="module"`** to the script tags — that would
   change the order or the scoping.
4. **New file?** Add a `<script src>` tag in `index.html` in the right place.

## Showing text typed by people

Anything a person typed (client names, notes, task titles, file names…) must go
through one of these before it becomes HTML (defined in `js/core/helpers.js`):

| Where it goes                      | Use                                  |
|------------------------------------|--------------------------------------|
| Text or an attribute               | `${escapeHtml(value)}`               |
| `href` / `src`                     | `${safeUrl(value)}`                  |
| An inline handler argument         | `onclick="fn(${jsArg(value)})"` — no quotes around it |
| Stored text allowed light bold/italic | `${sanitizeInlineHtml(value)}`    |

## Screen addresses

Every screen has its own address — `#clients`, `#tasks`, `#calendar`,
`#client/<id>`… (the part after `#` is the screen's `view-…` id). It's still one
page: switching screens changes the address with `history.pushState`, so refresh,
Back/Forward, bookmarks and shared links all work. The code is in
`js/core/navigation.js` (`syncAddressToView`, `openScreenFromAddress`).
- `core/desktop-app.js` — desktop-app behaviour: install as an app (own window, title bar), window colour, scrollbars that show while scrolling, right-click menus, keyboard shortcuts (styles in `css/desktop-app.css`).

- A new screen gets an address automatically once it has a `view-<name>` element.
- Addresses only open screens the person can reach from their sidebar; anything
  else falls back to Overview.
- Push notifications link to the same addresses (`pushUrlFor()` in
  `lib/push-notify.js`); tapping one focuses an open tab and opens that screen.
- On phones the address is forwarded to `mobile.html`, which opens the closest
  matching screen once and then clears it.
