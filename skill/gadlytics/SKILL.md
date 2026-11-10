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
- **Ad accounts (ملبي):** Meta 312559678073897 (uploads go here only) and 1355849785679367 (reporting) · TikTok advertiser 7338783723795595266 · Snap 828aa8bb-bd63-44ee-8cf8-b735981ca06f.
- **Second client ديمان (client_id `dm1n4an`, app + Salla store, no Khzama)** — Meta 7804393009576374 · TikTok 7267941711098494977 (Smart+, iOS) · Snap 6a32423a-eeb3-46e3-92f6-e9db866afc4d · Apple Search Ads campaign 2142732812 · AppsFlyer id6470202546 (iOS) + sa.dimaan.app (Android) · Salla store 1420462818 · Airtable rows where client = ديمان. First paid day 2025-09-22.
  - Orders/revenue come from **`conv_daily`** (AppsFlyer by platform + campaign, by purchase day, USD×3.75, UTC days; Salla web orders as channel `web`). ROAS = (app purchases from paid sources + Salla orders) ÷ spend; organic/QR/WhatsApp are kept but excluded. Per-creative orders use the platforms' own purchases (no creative-level source). ASA/Google spend comes from AppsFlyer cost (`conv_spend_to_ad_daily.py`).
  - Client config carries `convSource:"appsflyer+salla"`; the site then reads conv_daily as if it were Khzama (`convAsKz`, codes ME/TT/SC/AS/GG, web = com), adds ASA/Google to the paid platforms (`PAIDP()`), and rewrites «خزامى/تبرع» to «AppsFlyer وسلة/طلب» in every label (`convTxt` inside `L()`). The explorer cache is per client (`exC`). With 2+ clients the site opens on the last chosen client (`gad.ws`), never a mixed total.
  - Pull: see the ديمان section at the end of `runbooks/daily_pull.md`; rebuild with `rebuild_entries_conv.sql`.
  - Never copy pulled numbers by hand: `log_results.py <session.jsonl> <tool> <dir>` dumps every MCP result of a tool from the transcript (skips repeated entries, follows "saved to …" files); `platform_rows.py` turns Meta/TikTok/Snap results into prep_ad_daily input.

## Screens worth knowing
لوحتي (greeting + source freshness, new-media alert with «ارفعها على المنصات», «حدّث كل حاجة», 6 KPI tiles → main chart, platforms + «محتاج تدخلك», campaigns table + side panel, «بيانات تجريبية» in-memory demo) · اليوم مباشر (live KPIs, spend by hour vs yesterday, spend pace) · المهام (board by default) · مكتبة الكريتيف (cards with the cover — hook written on the image — card size slider; table view with image-size slider and click-to-enlarge; Airtable-style fields/filter/group/sort; bulk «أضف لإدارة الميديا» / «ارفع على المنصات»; «💾 على الجهاز» filter for videos already on the Mac). Covers are linked with `&v=<thumb_at>` so a re-written cover isn't served from Storage's 1-hour cache; table covers show the full 9:16 frame (the hook band is at the bottom)) · إدارة الميديا (stages, decisions, hooks, cover column) · سجل التغييرات v2 · المحلل · الموقع والقمع (Mixpanel) · التقارير (daily + weekly).

## Look
Default = calm palette + soft charts. Skin picker: Settings → Display → «شكل الواجهة» (Classic / Clay / Clay + Glass; `SKINS`, `skinGet`, `applySkin`, `ACT.skinSet`). Also via URL, remembered in localStorage `gad.skin`: `?skin=clay` (Claymorphism), `?skin=clayglass` (Clay + frosted glass, plain background — Mahmoud rejected green/purple background blobs), `?skin=off` resets. CSS lives in the `/* ══ Claymorphism` and `/* ══ Clay + Glass` blocks; the init IIFE sits right before `function render(){` and sets `data-skin` / `data-glass` on <html>. Light + dark tokens for both.

## Media-buyer tools (Nov 2026)
⚡ تحديث سريع (`sys/pullreq` mode quick → today only, see daily_pull.md) · library: views/frequency/retention (`v_video_stats`), AI hook tags (`media.ai_tags`, step 3e), «الدرجة /100», ✦ الأنماط + ✍ Brief, 🚀 الإطلاقات (`settings.launch`) · مركز الإجراءات: «حوّلها لمهمة» / «تجاهل» · التجارب: مختبر الاختبارات (`labtests/*`; split by tag in ad set + Khzama link names, or city holdout from `mx_daily dim=city`) · التقارير: «الشهر والمواسم» (forecast, Hijri months, weekdays; `settings.month`). Details: README section 20.

**▶ الفيديو opens the video file, not the folder:** Airtable's URL is a Drive *folder* per creative. `video_links.py` (run by `media_sync.py` after every sync; cache `~/.gadlytics/video_links.json`) lists each public folder, picks the Snap/story version, and stores `https://drive.google.com/file/d/<id>/view` in `media.video_file`. The site uses `video_file || url` everywhere, with a small 📁 link to the folder. Backfill/recheck: `python3 ~/.gadlytics/video_links.py --all <pairs.json>`.


**أداء الحملات (Nov 2026)** — view `campperf`: platform → campaign (code only, e.g. MGG-03120) → ad set → ad («video ID · influencer»). Spend from the platform (ad_daily), donations/revenue from Khzama. Khzama links are matched by campaign code → the link's Custom part = the ad-set name (case-insensitive word/contains match; `campmap/*` docs hold manual links; single-ad-set campaigns match automatically) → video ID = the ad. Links without Custom go to the one ad set holding that video, else stay on the campaign — never split by estimate; Smart+ multi-video link = one ad; never show platform purchases. Verdict زوّد/راقب/وقّف vs `roasTarget` (+ «لسه بدري»), arrows vs previous period or same days last week. Status/CBO-ABO/budgets/bids come from table `camp_struct` (`camp_struct_prep.py`). Budget/bid/on-off edits write `campchg/*` and the page immediately calls edge function `camp-apply` (applies on the platform in ~5–10 s; tokens in private table `app_secrets`, loaded via ingest — Snap + Meta connected (Meta = Mahmoud's personal 60-day token, renew before 2027-01-07 via `push_meta_token.py`), TikTok not yet → `not_configured`, request stays pending). «تحديث الأرقام» calls edge function `camp-refresh` (Meta + Snap spend for yesterday+today and camp_struct in ~6–10 s, read-only; admin path = header x-ingest-key) and queues `sys/campreq` with `parts` [khzama|conv] for the Khzama / AppsFlyer+Salla part. Pending edit requests and those parts run via the scheduled tasks or when Mahmoud says «نفّذ طلبات الحملات» → runbook `camp_requests.md` (Snap writes via `snap_update.py`; Meta MCP is in draft mode — publish only that entity). Khzama Custom may contain digits (CPA35, Mansour_1) — the parse regex is `(?:([A-Za-z0-9_]+)-)?`.

**Phone / iPad app (Nov 2026)** — the site is a home-screen web app (Safari → Share → Add to Home Screen; `manifest.webmanifest`, `icons/`, start_url `./` — same root link as desktop; ≤1180px or standalone opens on «أداء الحملات» without ?app=1). On ≤1180px «أداء الحملات» renders `renderCampApp()` (one-row nav with refresh icon + «آخر تحديث», swipeable KPI strip, sort/search, budget/bid chips editable from the list rows, slide transitions + edge-swipe back, default «النهارده», prefs per device in `gad.ma`; list → campaign → ad set screens, bottom-sheet edits with ±% chips, pull-to-refresh; iPad ≥820px two panes, 380px list) from the same `cpModel()` as desktop; desktop unchanged (`html.ma-on` scoping). No service worker: build.py stamps `gad-build` and the page reloads itself when a newer build is deployed, so every update reaches the phone/iPad automatically. **Rule: every new screen/feature gets its phone (≤760px) and iPad (761–1180px) layout before deploy, tested at 390×844, 430×932, 375×667, 820×1180, 1024×1366, 1180×820** (README §23). Paged Supabase reads must always have a stable `.order(...)` (camp_struct paging bug, Nov 2026).


## Runbooks (in `runbooks/`)
| Ask | Runbook |
|---|---|
| Daily pull / «اسحب الداتا» | `daily_pull.md` (platforms → ad_daily, Khzama, Mixpanel, Meta activity log, budgets, covers for new videos, rebuild, close `sys/pullreq`) |
| «اكتب الهوكات» / covers | `covers_and_hooks.md` |
| «ارفع الميديا» | `upload_media.md` |
| Deploy / «ارفع» / update README | `deploy.md` |
| «على الجهاز» filter (videos already in ~/Downloads) | `python3 ~/.gadlytics/local_videos.py` → run the SQL it prints with execute_sql (clears old marks, marks existing videos only; never touches the files) |
| «نفّذ طلبات الحملات» (budget/bid edits + refresh from أداء الحملات) | `camp_requests.md` |
| Mixpanel, snapshots, hooks queue | `snapshot.md`, `hooks.md` |

## New machine / new account
1. Copy `scripts/*` to `~/.gadlytics/`, `runbooks/*` too. Put the ingest key in `~/.gadlytics/ingest.key` (chmod 600) — ask Mahmoud; it is not in the repo. `media_sync.py` (Airtable sync) is **not** in the public repo either — it holds the board's private share link; the site's «حدّث كل حاجة» uses the `media-sync` edge function anyway.
2. `swiftc -O frame.swift -o bin/frame` and `swiftc -O hookcover.swift -o bin/hookcover` (macOS; AVFoundation/AppKit — no ffmpeg needed).
3. `pip3 install mlx-whisper numpy` (Apple Silicon). Model: `mlx-community/whisper-large-v3-turbo` (downloads on first use).
4. Snap uploads need the Adlytics Snap OAuth app: `~/Desktop/claude/adlytics-connectors/snap/` + `~/.claude/secrets/snap.env` / `snap_token.json` (Mahmoud saves the secret himself with `scripts/save-secret.sh`).
5. Connectors: Supabase, Meta Ads, TikTok for Business, Mixpanel, Canva, Claude in Chrome (GitHub upload + Khzama).

App rows (Nov 10 2026): campaign/ad set/ad rows on phone/iPad show spend · donations · revenue · ROAS (4 equal columns, separators, delta under the number) — keep this order.
