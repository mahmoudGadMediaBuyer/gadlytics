# Deploy GADLYTICS («ارفع» / «حدّث آخر حاجة»)

1. Build: `cd ~/Desktop/claude/gadlytics-site && python3 tools/build.py` (source: ~/Desktop/claude/mediabuyer-console.html).
2. Syntax check: node over every inline <script> with `new Function(...)` → 0 errors.
3. Optional local check: copy index.html, config.js, supa-db.js to a served folder (launch config "console", port 4180); Mahmoud signs in himself.
4. Upload with Claude in Chrome (his GitHub session): open https://github.com/mahmoudGadMediaBuyer/gadlytics/upload/main → find the file input → file_upload
   index.html (+ README.md) → set the commit message → click "Commit changes". The skill goes to /upload/main/skill/gadlytics (and /scripts, /runbooks).
5. Wait until `curl -s https://mahmoudgadmediabuyer.github.io/gadlytics/?v=$RANDOM | shasum` equals the local index.html sha.
6. Reload the live site **signed in** (add ?v=… — browsers cache) and confirm ملبي's numbers show on لوحتي, not the welcome screen.
7. Update this skill + README with whatever changed, and upload them in the same pass. Never upload secrets (ingest key, Snap/Meta tokens, Khzama headers) — the repo is public.

Gotcha (Nov 2026): GitHub's upload page often ignores the first click on «Commit changes» (and a typed summary sometimes vanishes). Wait ~15 s after file_upload until every file shows a file icon, set the summary with JS (input[name=message] + input event), click the button by screenshot coordinate, then confirm the URL left /upload and compare blob SHAs via the API (`git hash-object` locally vs contents API `sha`) — raw.githubusercontent is cached for minutes.
