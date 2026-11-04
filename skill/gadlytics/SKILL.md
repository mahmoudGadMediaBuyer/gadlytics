---
name: gadlytics
description: Run and extend GADLYTICS — Mahmoud's media-buying dashboard for the client ملبي (Molabi): the single-file site, its Supabase backend, the daily data pull, video covers + hooks, the "upload new media to the ad platforms" flow, and deploying to GitHub Pages. Use when the user mentions GADLYTICS, لوحتي, مكتبة الكريتيف, إدارة الميديا, «حدّث كل حاجة», «ارفع الميديا», «اكتب الهوكات», covers/hooks of videos, the daily pull, or asks to deploy/update the system or its README.
---

# GADLYTICS

Live site: https://mahmoudgadmediabuyer.github.io/gadlytics/ · repo `mahmoudGadMediaBuyer/gadlytics` (public — **no secrets in it, ever**).
Reply to Mahmoud in Egyptian Arabic. Tool and field names stay English.

## Hard rules
- **Numbers:** orders, revenue, ROAS, AOV, CPA come from **Khzama** (codes ME/TT/SC/bio/com/DM only). Everything else from the ad platforms.
- **Ad accounts are read-only**, except uploading media to the media library when Mahmoud asks (the upload flow). Never create, edit, pause or launch campaigns/ad sets/ads.
- **Secrets** never go to chat or the repo: ingest key (`~/.gadlytics/ingest.key`), Snap OAuth files (`~/.claude/secrets/`), Khzama request headers. Never type passwords.
- **Videos never stay on the Mac.** Every script downloads into a temp folder and deletes the video as soon as the frame/audio is out. Only small opening-frame JPEGs are kept (`~/.gadlytics/frames/`).
- After every deploy: reload the live site signed in and confirm ملبي's data shows (not the welcome screen). Browsers cache hard — add `?v=<anything>`.
- Every change to GADLYTICS also updates **this skill** and **README.md**, and both go to the repo with the deploy (skill under `skill/gadlytics/`).

## Architecture
- **Site:** one file. Source `~/Desktop/claude/mediabuyer-console.html` → `python3 gadlytics-site/tools/build.py` → `gadlytics-site/index.html` (+ `config.js`, `supa-db.js`). Vanilla JS inside one IIFE: `render()`, `ACT[...]` click actions (`data-a`), `CHG[...]` change handlers (`data-c`), `RT.get/set` doc store, `card()`, `chPlot()` charts (soft by default), `modal()`. Syntax-check every build: `node -e` + `new Function(script)` over inline scripts.
- **Supabase** project `ibpwudzjwjraqhfdmzet`, client_id `3sa3k1k`.
  - Tables: `docs` (path/coll/data JSON store), `ad_daily`, `khzama_link_daily`, `khzama_rev`, `snapshots`, `media` (Airtable library: `url`, `hook`, `hook_auto`, `hook_full`, `thumb`, `thumb_at`, `thumb_hook`, `asset_note`, `local_file`), `mx_daily`, `camp_budget_daily`.
  - Views (security_invoker): `v_media_perf`, `v_media_daily`, `v_creative`, `v_mx_aff`, `v_fatigue`, `v_camp_day`.
  - Storage: private bucket `thumbs` (`<creative_id>.jpg`, readable by signed-in users; the site uses signed URLs).
  - Edge functions: `ingest` (write-only, key header; tables: ad_daily, khzama_link_daily, khzama_rev, snapshots, media, mx_daily, camp_budget_daily, auto_changes → docs `changes/auto_*`, media_thumbs → Storage + media.thumb/thumb_hook), `media-sync` (Airtable → media), `ai`.
- **Docs used by features:** `sys/pullreq` (refresh request), `sys/uploadreq` (upload-to-platforms request), `media_notes/<id>` (hook edits, stage, decision, `uploads`), `mediaSeen/<uid>` (new-media alert), `profiles/<uid>`, `changes/*`.
- **Ad accounts:** Meta 312559678073897 (uploads go here only) and 1355849785679367 (reporting) · TikTok advertiser 7338783723795595266 · Snap 828aa8bb-bd63-44ee-8cf8-b735981ca06f.

## Screens worth knowing
لوحتي (greeting + source freshness, new-media alert with «ارفعها على المنصات», «حدّث كل حاجة», 6 KPI tiles → main chart, platforms + «محتاج تدخلك», campaigns table + side panel, «بيانات تجريبية» in-memory demo) · اليوم مباشر (live KPIs, spend by hour vs yesterday, spend pace) · المهام (board by default) · مكتبة الكريتيف (cards with the cover — hook written on the image — card size slider; table view with image-size slider and click-to-enlarge; Airtable-style fields/filter/group/sort; bulk «أضف لإدارة الميديا» / «ارفع على المنصات»; «💾 على الجهاز» filter for videos already on the Mac). Covers are linked with `&v=<thumb_at>` so a re-written cover isn't served from Storage's 1-hour cache; table covers show the full 9:16 frame (the hook band is at the bottom)) · إدارة الميديا (stages, decisions, hooks, cover column) · سجل التغييرات v2 · المحلل · الموقع والقمع (Mixpanel) · التقارير (daily + weekly).

## Look
Default = calm palette + soft charts. Skin picker: Settings → Display → «شكل الواجهة» (Classic / Clay / Clay + Glass; `SKINS`, `skinGet`, `applySkin`, `ACT.skinSet`). Also via URL, remembered in localStorage `gad.skin`: `?skin=clay` (Claymorphism), `?skin=clayglass` (Clay + frosted glass, plain background — Mahmoud rejected green/purple background blobs), `?skin=off` resets. CSS lives in the `/* ══ Claymorphism` and `/* ══ Clay + Glass` blocks; the init IIFE sits right before `function render(){` and sets `data-skin` / `data-glass` on <html>. Light + dark tokens for both.

## Runbooks (in `runbooks/`)
| Ask | Runbook |
|---|---|
| Daily pull / «اسحب الداتا» | `daily_pull.md` (platforms → ad_daily, Khzama, Mixpanel, Meta activity log, budgets, covers for new videos, rebuild, close `sys/pullreq`) |
| «اكتب الهوكات» / covers | `covers_and_hooks.md` |
| «ارفع الميديا» | `upload_media.md` |
| Deploy / «ارفع» / update README | `deploy.md` |
| «على الجهاز» filter (videos already in ~/Downloads) | `python3 ~/.gadlytics/local_videos.py` → run the SQL it prints with execute_sql (clears old marks, marks existing videos only; never touches the files) |
| Mixpanel, snapshots, hooks queue | `snapshot.md`, `hooks.md` |

## New machine / new account
1. Copy `scripts/*` to `~/.gadlytics/`, `runbooks/*` too. Put the ingest key in `~/.gadlytics/ingest.key` (chmod 600) — ask Mahmoud; it is not in the repo. `media_sync.py` (Airtable sync) is **not** in the public repo either — it holds the board's private share link; the site's «حدّث كل حاجة» uses the `media-sync` edge function anyway.
2. `swiftc -O frame.swift -o bin/frame` and `swiftc -O hookcover.swift -o bin/hookcover` (macOS; AVFoundation/AppKit — no ffmpeg needed).
3. `pip3 install mlx-whisper numpy` (Apple Silicon). Model: `mlx-community/whisper-large-v3-turbo` (downloads on first use).
4. Snap uploads need the Adlytics Snap OAuth app: `~/Desktop/claude/adlytics-connectors/snap/` + `~/.claude/secrets/snap.env` / `snap_token.json` (Mahmoud saves the secret himself with `scripts/save-secret.sh`).
5. Connectors: Supabase, Meta Ads, TikTok for Business, Mixpanel, Canva, Claude in Chrome (GitHub upload + Khzama).
