# Vendored libraries

Exact, pinned copies of the browser libraries the app uses, served from this
folder instead of public CDNs (no outside server can change the code the app
runs, and a CDN outage can't take it down). Files are the unmodified builds from
npm, except that source-map comments were removed.

| File | Package | Version | License |
|------|---------|---------|---------|
| supabase-2.119.0.js | @supabase/supabase-js (dist/umd/supabase.js) | 2.119.0 | MIT |
| jspdf-4.2.1.umd.min.js | jspdf | 4.2.1 | MIT |
| marked-18.2.0.umd.js | marked | 18.2.0 | MIT |
| purify-3.4.18.min.js | dompurify | 3.4.18 | Apache-2.0 or MPL-2.0 |
| cropper-1.7.0.min.js / .min.css | cropperjs | 1.7.0 | MIT |

License texts are in `licenses/`. To upgrade one: download the new build, add it
here with the version in the file name, update its tag in `index.html` (and
`mobile.html` for Supabase), and delete the old file.
