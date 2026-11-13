# GADLYTICS

**A performance-tracking and decision platform for paid media**, built for the Molabi (ملبي) charity account at Tamkeen. It joins ad-platform data (Meta, TikTok, Snapchat) with **Khzama** (خزامى), the donation system that records the real orders and revenue.

| | |
|---|---|
| **Live site** | https://mahmoudgadmediabuyer.github.io/gadlytics/ |
| **Hosting** | Static single-page app on GitHub Pages |
| **Backend** | Supabase (Postgres + Auth + Edge Functions), Row Level Security on every table |
| **UI language** | Arabic (RTL) by default, English toggle |
| **Currency / timezone** | SAR · Asia/Riyadh (UTC+3) |
| **Users** | Media buyer (owner), plus optional teammates, roles and a client portal |

The site **only displays data**. It never writes to or changes an ad account. All pulling is done outside the site by Claude through the platform connectors, and every decision the site suggests is yours to make.

---

## Table of contents

1. [Core idea and the golden rule](#1-core-idea-and-the-golden-rule)
2. [How Khzama links to the ads](#2-how-khzama-links-to-the-ads)
3. [Data pipeline](#3-data-pipeline)
4. [Signing in, opening the app, your profile](#4-signing-in-opening-the-app-your-profile)
5. [Global controls](#5-global-controls)
6. [Screens, one by one](#6-screens-one-by-one)
7. [Metrics and formulas](#7-metrics-and-formulas)
8. [Decision rules (how suggestions are made)](#8-decision-rules-how-suggestions-are-made)
9. [Refresh schedule](#9-refresh-schedule)
10. [Covers and hooks; upload to the platforms](#10-covers-and-hooks-on-the-mac--videos-never-stay-on-disk)
11. [AI assistant](#11-ai-assistant)
12. [Repository layout](#12-repository-layout)
13. [Database reference](#13-database-reference)
14. [Building and deploying](#14-building-and-deploying)
15. [Security and privacy](#15-security-and-privacy)
16. [Troubleshooting](#16-troubleshooting)
17. [FAQ](#17-faq)
18. [Glossary](#18-glossary)
19. [Look and feel (November 2026)](#19-look-and-feel-november-2026)
20. [Media-buyer tools (November 2026)](#20-media-buyer-tools-november-2026)
21. [Second client: ديمان](#21-second-client-ديمان--app--salla-store-november-2026)
22. [أداء الحملات — campaign performance, fast edits, «تحديث الأرقام»](#22-أداء-الحملات--campaign-performance-november-2026)
23. [Phone / iPad app](#23-التطبيق-على-الموبايل--الآيباد-november-2026)
24. [Sidebar order](#24-sidebar-order-nov-10-2026-mahmouds-order--desktop-sidebar-and-the-phoneipad-menu-sheet-use-the-same-list)
25. [ROAS verdicts + push notifications](#25-roas-verdicts-per-client--phone-notifications-nov-10-2026)
26. [Bulk edit, undo, spend pace, change log, alerts history](#26-أداء-الحملات--bulk-edit-undo-spend-pace-change-log-alerts-history-nov-10-2026)
27. [Mac = iPad layout](#27-أداء-الحملات-on-the-mac--the-ipad-layout-nov-10-2026)
28. [Server alerts engine (`camp-alerts`)](#28-server-alerts-engine-camp-alerts-nov-10-2026)
29. [Connections, tokens, scheduled tasks — status and renewals](#29-connections-tokens-scheduled-tasks--status-and-renewals-nov-10-2026)
30. [Rules learned the hard way](#30-rules-learned-the-hard-way-nov-8-10-2026)
31. [Changelog](#31-changelog)
32. [AI assistants API (instinct / MCP) — `gad-api`](#32-ai-assistants-api-instinct--mcp--gad-api-nov-10-2026)
33. [iPhone / iPad widget (Scriptable)](#33-iphone--ipad-widget-scriptable-nov-11-2026)
34. [Khzama live sync (Chrome extension)](#34-khzama-live-sync-chrome-extension-nov-11-2026)
35. [Season mode «وضع الموسم»](#35-season-mode-وضع-الموسم-nov-11-2026)
36. [Design system «Bramble»](#36-design-system-bramble-nov-11-2026--phase-1-of-3)
    - 34.4 [Campaign links «روابط الحملات» (extension 1.1.0 / 1.2.0)](#344-campaign-links-روابط-الحملات--the-extension-registers-a-builds-affiliate-links-v110-nov-12-2026)
    - 34.5 [Launch tool «أداة الإطلاق» (extension 1.3.0 → 1.4.1)](#345-launch-tool-أداة-الإطلاق--the-extension-runs-the-tamkeen-launch-tool-for-a-build-v130-nov-12-2026)
37. [Campaign launch from GADLYTICS «إطلاق الحملات»](#37-campaign-launch-from-gadlytics-إطلاق-الحملات-nov-12-2026)
38. [Launch system field guide — extension changelog, architecture, timings, open items, operating guide](#38-launch-system-field-guide--extension-changelog-architecture-timings-open-items-operating-guide-nov-13-2026)

---

## 1) Core idea and the golden rule

Ad platforms measure orders and revenue with their pixels. On Molabi those numbers run **higher than reality** because of duplicated events, view-through attribution and tracking issues on a site we don't control. **Khzama** records each actual donation, so it is the source of truth.

> ### Golden rule
> **Every metric comes from the ad platforms, except orders and revenue, which come from Khzama.**
> Anything derived from orders or revenue (**ROAS, CPA, AOV**) is computed with Khzama's figures.

| From the ad platforms | From Khzama |
|---|---|
| Spend, impressions, reach, frequency, clicks, link clicks, CTR, CPM, CPC, landing-page views, video plays, 2s/6s views, ThruPlay, 25/50/75/100% views, Hook rate, Hold rate, and the funnel events (view content, add to cart, initiate checkout, payment info) | Orders (donations) and revenue. From these, ROAS = Khzama revenue ÷ platform spend, CPA = spend ÷ Khzama orders, AOV = Khzama revenue ÷ Khzama orders |

The platforms' own purchase and revenue numbers are still kept, labelled **"backend"** or "platform", so you can see the gap. They never replace Khzama's figures.

---

## 2) How Khzama links to the ads

Every ad's landing URL carries a **Khzama link name** (Parameters), generated by the Tamkeen launch tool. The site parses that name to tie each Khzama donation to a platform, campaign, video and influencer.

**Structure** (fields separated by `-`):

```
<campaign no.>-<optional custom>-<Creative ID>-<platform code>-<product>-<variation>-<content type>-<influencer>…
```

**Example:**

```
MGG-03060-Story-20260810134858-SC-Sqya-Sqya-Dywf-Alrhmn-Influencer-Mnswr-Alsalmy
```

- **Creative ID:** 14 digits, a timestamp such as `20260810134858`. It is the key that joins Khzama, the ad platforms and the Airtable creative board.
- **Platform code:** decides which source a donation is credited to.

**Counted Khzama codes (only these):**

| Code | Source |
|---|---|
| `ME` | Meta (Facebook / Instagram) |
| `TT` | TikTok |
| `SC` | Snapchat |
| `bio` | Profile bio links |
| `com` | Comment links |
| `DM` | Direct-message links |

Any other code belongs to other departments and is **excluded** from every total.

### Name unification

Influencer, product and project names appear in Arabic in some places and in transliterated Latin in others. Examples are `Mnswr-Alsalmy` = منصور السالمي, and the several spellings of أبو جودي.

The site builds a dictionary from the Airtable board and the launch-tool parameters. It uses it to **merge these into one row** everywhere: the Analyzer, the filters and the pick-lists.

A video with two influencers shows both names in a fixed order, for example «أنس اكشن + منصور السالمي».

---

## 3) Data pipeline

```
 Meta Ads ─┐
 TikTok ───┤  (Claude via MCP connectors, read-only)
 Snap SAR ─┤
 Snap USD ─┘  (local OAuth token, USD × 3.75)
                         │
 Khzama ─────────────────┤  (Claude via Chrome — Khzama has no API)
                         │
 Airtable board ─────────┤  (public shared view, read-only)
 Mixpanel ───────────────┤  (Claude via MCP, read-only — site behaviour only)
                         ▼
                   Supabase  ──►  GADLYTICS site (display only)
```

### 3.1 Sources

| Source | Granularity | How it is pulled |
|---|---|---|
| **Meta** | Ad × day, plus video (creative) × day | Meta Ads MCP connector |
| **TikTok** | Ad × day; Smart+ at the creative (material) level | TikTok for Business MCP connector |
| **Snap (SAR account)** | Ad × day | Snap MCP connector |
| **Snap (USD account, separate business)** | Ad × day | Local OAuth token, converted to SAR at **3.75** |
| **Khzama** | Link name × day (orders, revenue) | Read through Chrome, since Khzama has no API |
| **Airtable creative board** | One row per video, all board columns | Public shared view, via the `media-sync` function |
| **Mixpanel** (project Molabi) | Site events per day (and per hour): by Khzama link, device, utm source, payment method | Mixpanel MCP connector, five fixed reports named `GAD mx <dim>` |

### 3.2 Special handling

- **TikTok Smart+ double counting.** Smart+ campaigns report spend both per ad and per material (video). When material-level rows exist for the same account, ad and date, the ad-level rows are dropped, so the spend is counted once.
- **USD to SAR.** Every USD row carries `currency=USD, fx=3.75` and is converted before it is stored.
- **Clicks.** Link clicks are used when the platform reports them. Otherwise all clicks are used.

### 3.3 Daily pull (automatic)

A scheduled task in the Claude desktop app, **"GADLYTICS — daily pull for Molabi"**, runs every day at **08:30** and:

1. Pulls the **last 3 days** from every platform account, per ad and per video, day by day. Re-pulling three days lets late-arriving conversions settle.
2. Pulls the Khzama link totals for the same days (read from the screen of `admin.molabi.sa/affiliateLinks`, then `~/.gadlytics/khzama_ingest.py`; see §34). Today is kept live by the Chrome extension in §34, so this step only checks `sys/khzama_live` and backfills gaps.
3. Rebuilds the daily report docs: platform metrics plus Khzama orders and revenue.

**Requirements:**

- The Claude app and Chrome must be open.
- Chrome must be signed in to Khzama.
- The first run asks permission for each tool. Choose **"Always allow"**.

---

## 4) Signing in, opening the app, your profile

### 4.1 Signing in

- Open the site and sign in with your **email and password** (a Supabase Auth account).
- The session persists, so you won't need to sign in again on the same browser.

### 4.2 Opening it fast

- **Desktop shortcut:** a `GADLYTICS` file on the Mac desktop opens the site on double-click.
- **Install as an app:** in Chrome, go to ⋮ → *Cast, save and share* → **Install page as app**.
- **From the Claude app:** the `GADLYTICS` entry in the preview list opens the site inside Claude.

### 4.3 Your profile (ملفي الشخصي)

Open your profile in any of these ways:

- Click your **name and photo** in the top bar.
- Click your name in the sidebar.
- Use **"✎ Edit profile"** on *My dashboard*.

| Field | Notes |
|---|---|
| **Photo** | "📷 Change photo" takes any image; it is cropped square and scaled to 192 px automatically. "Remove photo" falls back to an initial in a coloured circle. |
| **Initials colour** | 8 colours for the circle shown when there is no photo. |
| **Name** | Your display name everywhere: top bar, sidebar, tasks, community. |
| **Job title** | Shown under your name instead of the role, for example "Media buyer". |
| **Email** | Read-only. It is your sign-in email. |
| **Phone, About** | Free text. |
| **🔒 Change password** | Enter the new password twice, at least 8 characters. Leave it empty to keep the current one. |
| **Sign out** | Ends the session on this browser. |

The profile is saved in Supabase (`docs` → `profiles/<auth user id>`), so it follows you to any device.

---

## 5) Global controls

| Control | Where | What it does |
|---|---|---|
| **Client switcher** | Top bar | Pick a client, or "All clients". Molabi is the main one. |
| **Screen search** | Top bar (shortcut `/`) | Type a screen name and press Enter to jump to it. |
| **Notifications 🔔** | Top bar | Badge = pending approvals + unread mentions + tasks due soon. |
| **EN / عربي** | Top bar | Switch language. |
| **Theme** | Top bar | Light or dark. |
| **Mode: Simple / All tools** | Bottom of the sidebar | Simple hides advanced screens and sections. |
| **Filter bar** | Most analysis screens | Date range, platform and comparison period. |
| **Copy buttons** | Overview and briefs | Copy a ready-to-paste text summary. |

---

## 6) Screens, one by one

The sidebar is grouped into **Work (شغلي)**, **Monitoring (متابعة)**, **Analysis (تحليل)**, **Operations (تشغيل)**, **Administration (الإدارة)** and **Settings (الإعدادات)**.

### 6.1 My dashboard (لوحتي)

A personal home screen, top to bottom:

- **Greeting** with your name, today's date, "numbers up to <last day with spend>", and a dot per source (platforms, Khzama, Mixpanel): green when fresh, red with how many days late. Buttons: **Demo data** and **Edit profile**.
- **🆕 New on Airtable** (only when there is something new): how many videos/media were added on Airtable since you last looked, a strip of their covers, and three buttons — **⇪ Upload them to the platforms**, **Open in library** (opens the library filtered to the new ones) and **✓ Seen**. Seeing them clears the alert and the count badge on *Creative library* in the sidebar. "Last seen" is kept per user (`mediaSeen/<uid>`), so it follows you across devices.
- **System refresh** (below).
- **Six KPI tiles** for the last day with spend: spend, revenue (Khzama), ROAS, orders (Khzama), cost per order, average donation — each with the change vs the day before and a 10-day sparkline. Clicking a tile shows it in the main chart.
- **Main chart:** spend vs revenue (or the metric you clicked), 7 / 14 / 30 days, daily / weekly / monthly; click a legend item to hide it.
- **Platforms:** share of spend and ROAS per platform (click to filter the table) and **Needs you**: campaigns below target (or the account average) three days in a row.
- **Campaign performance:** campaign, platform, spend, orders, revenue, ROAS, 14-day trend, status (Scale / Watch / Pause vs the reference). Search, platform filter, sort by any column; a click opens a side panel with the campaign's numbers, chart, recommendation, and links to the campaign file and the change log.
- **Morning summary, My clients today, My tasks, Mentions, Team** — as before.

**Demo data (بيانات تجريبية):** fills every screen that reads the report data (dashboard, overview, today live, action center, reports) with random numbers, **in the browser's memory only** — nothing is saved or sent. A bar on every screen says it's on, with a button to turn it off. Screens that read the database directly (analyzer, media, library, site, change log) keep showing real data.

**System refresh (تحديث السيستم)** — at the top of My dashboard:

- **↻ Refresh everything** does four things in order, showing each step:
  1. Refreshes the **creative library from Airtable**.
  2. Reloads **every number from the database**: reports, analyzer, site (Mixpanel), creative fatigue, media management and the change log.
  3. Registers a **new pull request for the platforms and Khzama**. The site cannot talk to the ad platforms itself, so Claude runs the pull: with the next daily pull, or right away when you tell Claude «اسحب دلوقتي». The request then shows as done.
  4. Requests a **snapshot of today** for *Today live* (only the request: the automatic snapshot schedule stays off until the season).
- Under the button, the **latest day received from each source**: platforms (spend), Khzama (orders and revenue), Mixpanel, and the last Airtable sync. A source more than a day behind turns red with how many days it is late.

### 6.2 Tasks and Community (المهام / المجتمع)

- **Tasks:** personal tasks or tasks assigned to teammates, with due dates and an overdue flag. A task can be linked to a client.
- **Community:** team channels (general, updates, fun, per-client), direct messages and @mentions. Unread counts appear in the sidebar.

### 6.3 Action center (مركز الإجراءات)

The screen to open first every morning.

**Per-platform summary cards** cover Meta, TikTok, Snap and bio / com / DM. Each card shows:

- Spend, orders, revenue, ROAS, CPA and AOV.
- The change from the previous period of the same length.
- A rating against the period average: **Excellent** (≥ 1.15× average ROAS), **OK** (≥ 0.9×) or **Weak**.

**Top 3 and bottom 3** campaigns, videos and influencers:

- Only items with at least **1% of total spend** qualify, so tiny tests don't dominate.
- Click any row to open it in the Analyzer.

**"Needs you" (محتاج تدخلك)** lists alerts in priority order, such as:

- ROAS below target.
- Scaling opportunities.
- CPA or ROAS anomalies against the trend.
- Days with no data.
- Budget pacing.
- Data-quality issues.

**Refresh** reloads the latest numbers. The label beside it says when data last arrived.

### 6.4 Today live (اليوم مباشر)

Intraday tracking from cumulative **snapshots** taken through the day.

**Snapshot sheet (top).** One row per snapshot time, with column groups in this order:

1. One coloured group per platform: spend, revenue, ROAS and AOV.
2. bio, com and DM.
3. **Total:** spend, orders, revenue, ROAS, AOV and CPA.

**Countdown:**

- Shows the time left until the next snapshot.
- Choose every 15, 30 or 60 minutes, or on demand.
- Faster and slower buttons, plus **"Take a snapshot now"**.

**Below the sheet:**

- A **chart** of the day's climb.
- **Cards** comparing each number with the same time yesterday.
- A **same-hour comparison** with yesterday, the same weekday last week and the 7-day average.
- The **best and worst hours**.

> **Automatic snapshots are currently OFF.** In season they run every 15 minutes, 24 hours a day. The "Start snapshot" button records a request, and Claude takes the snapshot on its next check.

### 6.5 Overview (نظرة عامة)

One screen whose content follows the period chosen in the filter bar.

| Period | What you get |
|---|---|
| **Today** | Live brief. Numbers against the same hour yesterday; an end-of-day projection ("if the pace holds"); the biggest win and biggest problem; top alerts; data quality; "Copy summary". |
| **Yesterday** | Closing report. Comparison with the day before and the 7-day average; best and worst platform and campaign; **tomorrow's actions** (scale, reduce or pause, each with a reason); "Copy report". |
| **Any range** | KPI cards, trend chart, platform share, ROAS by platform, health score and goal progress. |

Always at the bottom: **"All conclusions and analysis"**. It covers what changed, the best times and platforms, daily spend by platform, and performance per client and per platform. A toggle hides or shows it.

### 6.6 Analyzer (المحلل)

The deep-dive tool. It reads **every ad and every video, day by day**.

**Period and comparison**

- From and To dates.
- **Compare with:** the previous period, the same period last year, a custom range, or none.

**Break down by** (one dimension at a time):

| Group | Dimensions |
|---|---|
| Structure | Platform, Account, Campaign |
| Creative | Video (Creative ID), Influencer, Creator (Airtable advertiser), Content type, Size |
| Business | Project, Season, Product, Variation |
| Time | Day, Week, Month, Weekday |

**Filters (multi-select)**

- Campaign, Season, Project and Creator, plus Platform.
- The lists **follow the selected platform**: choose Snap and only Snap campaigns are listed.
- Each filter opens a checklist with search, so you can pick several values at once.

**Search pick-list (دوّر):** suggests the values of the current dimension, so you choose instead of typing.

**Metrics picker.** Your selection is remembered.

| Group | Metrics |
|---|---|
| Base | Spend, Revenue, ROAS, Orders, CPA, AOV, Impressions, CPM, Clicks, CTR, CPC |
| Funnel | Clicks, LP views, View content, Add to cart, Checkout, Purchases; the step rates Click→VC, VC→ATC, ATC→Checkout, Checkout→Buy and Click→Buy; Cost/ATC, Cost/Checkout |
| Video | Impressions, Plays, Hook rate, 2s, 6s, ThruPlay, reached 25/50/75%, Hold (100%), Spend, ROAS |
| Extra | Reach, Frequency, Link clicks, All clicks, Cost/LP view, Cost/VC, Payment info, 25/50/75/100% view counts |

For cost metrics such as CPA, CPM, CPC and frequency, **lower is better**, so their colouring is inverted.

**Saved views (⭐)**

- "Save this view" stores the breakdowns, filters, platforms, metrics, comparison and period under a name. A period that ends today is saved as rolling ("last N days").
- One click on a saved view re-applies it; × deletes it. Views are stored in Supabase, so they follow you to any device.

**Two-level breakdown ("Then by")**

- Pick a second dimension (e.g. Platform → Campaign, Influencer → Platform). Each row then shows its top 8 children indented underneath (for the first 60 rows), with the same metrics.

**Platform vs Khzama metrics** (in the metrics picker)

- Platform orders (pixel), Platform ROAS (pixel), and the gap in % between the platform's orders/revenue and Khzama's. Use them to see which platform or campaign over-reports, and by how much.

**Interactions**

- **Click a row** to see its breakdown by platform, campaign, month and video.
- **Campaign file:** when breaking down by campaign, click one to see:
  - its funnel, with the conversion % at each step;
  - weekday performance;
  - a day-by-day chart of spend against Khzama revenue.
- **⇆ Side by side:** two periods next to each other, with every metric and its change, overall and per platform.
- **CSV export** of the current table.

### 6.6b Site & funnel (الموقع والقمع)

What visitors do **on the store** between the ad click and the donation, from **Mixpanel**. Mixpanel never replaces Khzama: official orders and revenue still come from Khzama, and Mixpanel payments are used only for funnel ratios and comparison.

- **Period:** today, last 7 / 14 / 30 days, or a custom range.
- **KPI cards:**
  - Sessions (and per day), page views and checkouts.
  - Paid (Mixpanel) with its value.
  - **Site conversion** (paid ÷ sessions) and **checkout completion** (paid ÷ checkouts).
  - **Khzama donations** (official, your codes only) and checkout errors.
- **Site notes:** automatic flags.
  - A source whose visitors reach checkout but nobody pays.
  - Android converting far below iPhone.
  - Apple Pay share of payments.
  - The busiest payment hour.
  - A large gap between Khzama and Mixpanel for one platform.
- **On-site funnel:** page view → view content → add to cart → checkout → paid. Shows the % kept at each step, and the biggest drop is highlighted in red.
- **Tracking health:** platform-reported orders, Mixpanel payments and Khzama donations side by side for Meta, TikTok and Snap. Includes a warning when Khzama data is older than Mixpanel's.
- **By source:** one row per code: ME / TT / SC / bio / com / DM, other departments, and visits with no link.
  - The funnel counts at each step.
  - View→paid and checkout→paid rates.
  - **Cost per visit** (platform spend ÷ Mixpanel page views).
  - Khzama donations.
- **By campaign:** the same funnel per campaign number, sortable by views, checkouts or payments.
  - A campaign with 3 or more checkouts and no payments shows its completion as a red 0%.
  - Click a campaign to open its campaign file.
- **By device** and **payment methods:** Apple Pay, card and bank transfer, with their share and average value.
- **Hours (Riyadh time):** sessions and payments for each hour of the day.
- **Day by day:** sessions, view content, checkouts, Mixpanel payments, Khzama donations and conversion.

**Also added to other screens:**
- **Campaign file:** an "On-site funnel (Mixpanel)" block. It shows each step rate next to the same platform's average.
- **Creative library → video detail:** the on-site funnel for that video, matched by Creative ID across all pulled days.
- **Action center:** a "Site yesterday" card comparing yesterday with the 7-day average.
  - If visitors reached checkout and nobody paid, it says the problem is likely the checkout, not the ads.
  - If visits are low, it says the problem is upstream (the ads or the spend).
- **Today live:** a "Site today (Mixpanel)" strip comparing sessions, view content, checkouts and payments with the same hour yesterday.

**Data notes:**
- Attribution comes from Mixpanel's `affiliate` property. It holds the **same link name as Khzama**, so it survives even when the utm parameters are lost (they are lost on about 58% of visits).
- Ghost purchases fired by Google Tag Manager's preview page (`gtm-msr.appspot.com`) are excluded at pull time.
- Only your link codes are stored by name. Other departments' links are summed into "other departments".

### 6.7 Reports (التقارير)

The screen has two modes at the top: **Custom report** and **Ready weekly summary**.

**Ready weekly summary (الملخص الأسبوعي الجاهز)**

- One full week, Sunday → Saturday (Riyadh), against the week before. Move with "Previous week / Next week".
- Contents:
  - KPI cards for the paid platforms: spend, orders and revenue (Khzama), ROAS, CPA, AOV, each with its change; bio / comments / DM orders noted separately.
  - **Recommendations for next week**, generated from the numbers: scale the best campaign, review the weakest, platforms whose ROAS fell 20%+, the best video to iterate on, fatigued creatives, and checkout completion on the site.
  - Platforms table with the ROAS change, then best and weakest campaigns, videos and creators (only items with at least 3% of spend).
  - Site figures from Mixpanel, videos burning out, and the week's changes (manual and automatic).
- Buttons: **Copy summary** (text for WhatsApp or email), **Print / PDF**, **Download** (a standalone HTML file).

**Custom report**

Ready **daily, weekly and monthly** reports with day names. They have a platform filter and a metric picker with:

| Group | Metrics |
|---|---|
| Results | Spend, Revenue, ROAS, Orders, CPA, AOV |
| Delivery | Impressions, CPM, Clicks, CTR, CPC |
| Funnel | View content, Add to cart, Checkouts, the step conversion rates, Cost/ATC, Cost/Checkout |
| Platform-reported | Backend orders, revenue and ROAS |

The reports are built for handing over or printing, and they also appear in the client's portal.

### 6.8 Data entry (إدخال البيانات)

Manual input for anything that isn't pulled automatically: a **quick snapshot** or a **full daily report** per platform. Manual entries appear everywhere the automatic ones do.

### 6.9 Campaign roster (إدارة الحملات)

A sheet where **each column is a day and each row is a platform**. Each cell holds the **codes** of the campaigns running that day: the code only, not the full name.

**Colours**

| Mark | Meaning |
|---|---|
| **Green** | Continued from the previous day |
| **Blue** | New that day |
| **Red outline** | Ran that day but wasn't carried to the next day (stopped) |

**Summary strip:** continued from yesterday, new, stopped, and running today.

**Editing**

| Control | Action |
|---|---|
| **←** | Carry this campaign to the next day |
| **All ←** | Carry every campaign of this platform |
| **✕** | Remove the campaign from that day |
| **+** | Add a campaign |

**Campaign file (click any code)**

- **Window:** today, yesterday, last 7 days, since launch, or a **custom range**.
- **Metrics:** spend, impressions, clicks, CTR, CPM and CPC from the platform, and orders, revenue, ROAS, CPA and AOV from Khzama. Each one is compared with the **same platform's average**.
- **Day-by-day chart.**
- **Videos table:** creator, spend, orders, **revenue** and ROAS for each video in the campaign.
- **Suggestion** with its reasons; see [§8](#8-decision-rules-how-suggestions-are-made). It is a suggestion only. The decision and execution are yours.

> Auto-filling the roster from the platforms every day is planned for the season. For now, ask Claude to "update the campaign sheet".

### 6.10 Media plans (الميديا بلان)

Plan budgets and how they split across platforms for a period.

### 6.11 Media management (إدارة الميديا)

A **Cover** column (the same image as the library, hook written on it) sits next to the video ID; the **image size** slider above the table sets its size and a click enlarges it.


Where you manage the videos that have **launched**, or that you added from the library, and decide which ones continue and which stop.

**Layout:** grouped by **project**, then by **influencer**, read right to left.

| Column | Source |
|---|---|
| Influencer | Airtable |
| Video number (Creative ID) | Airtable |
| Hook | Manual ✎, then Whisper, then Airtable's "marketing text" |
| Launch date (first spend) | Platforms |
| Meta / TikTok / Snap | ✓ if the video spent on that platform |
| Media uploaded / Campaign launched | Platforms (automatic) |
| Campaign name | Platforms. **Hidden by default** to keep rows short. |
| Performance | Computed (see below) |
| Stage | You |
| Decision | Suggested, then confirmed by you |

**Performance:** the video's ROAS divided by its **project's average ROAS**.

| Ratio | Rating |
|---|---|
| ≥ 1.15 | **Strong** |
| ≥ 0.85 | **Average** |
| below 0.85 | **Weak** |

A video needs at least **300 SAR of spend** to be rated. Below that it shows "little data".

**Decision**

- Suggested automatically:
  - strong → **Keep** (هيكمل);
  - weak → **Stop** (مش هيكمل);
  - otherwise → **Watch** (يتراقب).
- A suggestion has a dashed outline.
- **✓ / ✕ / …** lock your own decision. Click it again to return to the suggestion.

**Stages**

- Default stages: **1 Test → 2 Winners → 3 Scale**. They can be renamed, up to 10 stages.
- **↑** promotes a video to the next stage and **↓** demotes it. Every move is logged with its date.
- Under each stage you see "since {date}" and the **ROAS since the video entered that stage**, using platform spend and Khzama revenue for those days only.
- The ↑ button **lights green** when a video is strong and ready to promote.
- **Stage cards** at the top show the count, ROAS and spend for each stage. Click one to filter.

**Creative fatigue (🔥)**

- Under the performance rating a video can show **"🔥 Burning out"** or **"Early fatigue"**. Hover it to see why.
- The check compares the last 3 pulled days with the 7 days before, per video and platform:
  - **Burning out:** CTR down 20%+ **and** (Hook rate down 15%+ **or** frequency up 25%+ **or** CPM up 25%+).
  - **Early fatigue:** CTR down 12%+ and one of the others moved 10%+.
  - It needs at least 100 SAR in the recent window, 200 SAR before it, and enough days; otherwise it says "too little data".
- The same flag appears as a filterable **Fatigue** column in the creative library, a **Creative fatigue** card in the action center, and a section in the weekly summary.

**Other controls**

- **☰ Columns:** show or hide any column. Your choice is remembered on this browser.
- **Top cards:** total, Keep, Stop, Watch, unconfirmed suggestions, and launched in the last 3 days. Click a card to filter.
- Filters by project, creator and platform, plus search.
- **🎙 Auto hook:** queues a video for transcription; see [§10](#10-automatic-hooks-whisper-on-device).

### 6.12 Creative library (مكتبة الكريتيف)

**Two views** — switch with **▦ Cards / ☰ Table** (remembered):

- **Cards:** each video is a card with its **cover** — the video's opening frame **with the hook written on the image** in white bold text on a dark band — then the creative ID and rating, talent · style · status, and six numbers (ROAS, spend, orders, revenue, hook rate, CTR). A **card size** slider sets how big the cards are. Groups (from *Group*) show as section bars with their count, spend, orders and ROAS; click a bar to fold it. ⤢ on a card enlarges the cover.
- **Table:** the Airtable-style table, with a small **cover** column; the **image size** slider (shared with Media management) makes it bigger, and a click on a cover enlarges it with its hook.
- Covers marked **"No video on Drive"** are videos whose Drive folder (and its subfolders) has no video file, or whose link is broken.
- **💾 On this Mac:** one click shows only the videos already in `~/Downloads` (file named with the Creative ID). The same button is in Media management. `local_videos.py` reads the file names (it never opens, moves or deletes them) and marks `media.local_file`.
- Select videos to **➕ Add to media management** or **⇪ Upload to the platforms**. Cards show **⇪ Meta · TikTok · Snap** once a video is uploaded.


An Airtable-style board of **every Molabi video**, built to be simpler and faster than Airtable. It includes only the styles **Influencer (مشهور)**, **Model (مودل)** and **Creative (ابداعي)**; designs and photo shoots are excluded.

**Toolbar:** `🔍 Search` · `☰ Columns` · `⧩ Filter` · `▤ Group` · `⇅ Sort` · `Numbers: all time / period` · `↻ Refresh from Airtable`. An active button is highlighted and shows a count.

**Columns**

- **Every Airtable board column:** client, product, project, style, creator, season, type, category, ad status, licence validity, art director's recommendation, hold reason, URL, launch link, entry date, and the rest.
- **Computed columns:**

| Group | Columns |
|---|---|
| Spend | Spend, spend per platform |
| Khzama | Orders, revenue, ROAS, CPA |
| From the platforms | Hook rate, Hold rate, CTR, CPM |
| Your inputs | Rating, Tags, Notes |
| Activity | First and last spend, Campaigns, Platforms, "In media management" |
| Content | Hook |

- **Drag** column headers left or right to reorder them. Click a column to show or hide it.

**Filter**

| Column type | Conditions |
|---|---|
| Text | is · is not · contains · doesn't contain · is empty · is not empty |
| Number | > · < · ≥ · ≤ · = · ≠ |
| Date | on · after · before |

- "is" and "is not" support **multi-select** with search.
- Combine conditions with **All conditions** (AND) or **Any condition** (OR).

**Group**

- Up to **3 levels**.
- Each level is ordered by highest spend, A→Z or Z→A.
- Expand all or collapse all.
- Each group shows its totals.

**Sort**

- Multiple sort levels, or click a column header.
- Empty values always go last.

**Rating:** the video's ROAS against its project average. You can filter and sort by it.

**Video detail (click a row)**

- The hook, which you can edit.
- **Tags and notes**, entered manually.
- Performance on each platform and the campaigns the video ran in. Click a campaign to open its file.
- All board fields and the video link.
- Add the video to media management, or remove it.

**Adding to media management**

- Select several rows and click **"➕ Add to media management"**, or add a single video from its detail view.
- Added videos enter **stage 1**.
- A video without a hook joins the hook queue.

**Refresh:** "↻ Refresh from Airtable" re-reads the shared board view in about 10 seconds. New videos appear and changed fields update. Your tags, notes, stages and decisions are kept.

### 6.13 Approvals, change log, experiments

- **Approvals (الموافقات):** items waiting for an admin's sign-off.
- **Change log (سجل التغييرات):** built to stay readable in season, when there are dozens of edits a day. The unit is the **day**, not the single edit.
  - **Filters** (apply to every tab): from–to dates, **hour range**, platform, campaign (multi-select), and change type (budget, pause, resume, new campaign/ad set, creative, manual).
  - **Level** follows the filters: no filter = **total** across platforms; a platform = **that platform**; one or more campaigns = **those campaigns**.
  - **Daily impact (الأثر يوم بيوم):**
    - Cards: number of edits and campaigns changed, total daily budget at the start → end of the period, spend, Khzama orders and revenue, ROAS, and how many budget moves worked.
    - Chart: spend vs Khzama revenue per day, the daily budget as a dashed line, and a dot on days with edits.
    - Day-by-day table: edits, budget start → end, spend, orders, revenue, ROAS, CPA (each with its change vs the previous day), and a **verdict**.
    - The verdict appears on days the budget moved 10%+: that day and the next vs the two days before. "Worked" when a raise brought a marginal ROAS ≥ 1 and ≥ 80% of the earlier ROAS, or a cut improved ROAS without losing revenue; "Didn't work" otherwise; "Inconclusive" or "Too early" when the data can't tell.
    - Click a day to see every edit with its **time** (Meta), campaign and old → new budget, filtered by the hour range.
  - **Budget levels (مراحل الميزانية):** consecutive days on the same daily budget, with spend, orders and revenue per day, ROAS, CPA and the **marginal ROAS** vs the previous level (what each extra riyal returned). The best level is highlighted.
  - **Full log (السجل الكامل):** every entry as a card (manual + automatic), with the before/after measurement and the All / Manual / Auto filter. Add manual entries with «+ سجّل تغيير».
  - **Where the budgets come from:**
    - **Meta:** its activity log, with the exact time of every edit (Meta's own events and the "Pending Process" flips are ignored).
    - **TikTok and Snap:** no activity log is available yet (TikTok's change log is announced for December), so the daily pull records each campaign's budget once a day; a different budget from the day before counts as a budget change that day, without a time.
- **Experiments (التجارب):** define a control group and a test group, and get a verdict based on the numbers.

### 6.14 Team, performance, settings

**Team (الفريق)**

- Add teammates by searching or by email.
- Roles:

| Role | Access |
|---|---|
| **Owner** | Everything |
| **Admin** | Full access |
| **Member** | Only their assigned clients |
| **Client** | Portal only: their own reports |

- Set each person's job title and assigned clients.
- Handle join requests and disable accounts.

**Performance (تقييم الأداء):** each teammate's results on their clients.

**Settings / Control panel (لوحة التحكم):**

- Clients and their platforms.
- Goals: ROAS, CPA and budget.
- Alert thresholds.
- Which sections appear on each screen.
- Stage names for media management.
- Decision thresholds.
- Currency.

---

## 7) Metrics and formulas

| Metric | Formula | Source |
|---|---|---|
| **ROAS** | Khzama revenue ÷ platform spend | Khzama + platforms |
| **CPA** (cost per order) | Spend ÷ Khzama orders | Khzama + platforms |
| **AOV** (average order value) | Khzama revenue ÷ Khzama orders | Khzama |
| **CTR** | Clicks ÷ impressions × 100 | Platforms |
| **CPM** | Spend ÷ impressions × 1000 | Platforms |
| **CPC** | Spend ÷ clicks | Platforms |
| **Frequency** | Impressions ÷ reach | Platforms |
| **Hook rate** | 2-second views ÷ impressions × 100. Uses video plays when the platform doesn't report 2-second views. | Platforms |
| **Hold rate** | 100% views ÷ video plays × 100 | Platforms |
| **Reached 25/50/75%** | Views at that quartile ÷ video plays × 100 | Platforms |
| **Click → VC** | View content ÷ clicks × 100 | Platforms |
| **VC → ATC** | Add to cart ÷ view content × 100 | Platforms |
| **ATC → Checkout** | Initiate checkout ÷ add to cart × 100 | Platforms |
| **Checkout → Buy** | Orders ÷ initiate checkout × 100 | Mixed |
| **Click → Buy (CVR)** | Khzama orders ÷ clicks × 100 | Mixed |
| **Cost / ATC, Cost / Checkout** | Spend ÷ event count | Platforms |
| **Backend orders / revenue / ROAS** | As reported by the platform pixel | Platforms (reference only) |
| **Video rating** | Video ROAS ÷ project average ROAS | Mixed |

---

## 8) Decision rules (how suggestions are made)

Every suggestion includes **its reasons**. None of them is ever executed automatically.

### 8.1 Campaign file (roster)

Compared with the **same platform's average ROAS** over the same window:

| Condition | Suggestion |
|---|---|
| Spend < 300 SAR **or** fewer than 2 days with spend | **Too early — wait** |
| ROAS ≥ 1.2 × average **and** ROAS ≥ 2x | **Scale up** |
| ROAS ≥ 0.85 × average | **Keep running** |
| ROAS ≥ 0.6 × average | **Watch** (try a new creative or audience before pausing) |
| Otherwise | **Stop** |

Extra reasons are added when:

- **Last 3 days trend:** ROAS over the last 3 days moved by 15% or more, up or down, against the earlier days. This needs at least 5 days of data.
- **Weakest funnel step:** a step's rate is below 75% of the platform average for that step. The steps checked are click→view, view→cart, cart→checkout and click→order.

### 8.2 Media management (videos)

- **Strong / Average / Weak** by the ratio to the project average: ≥ 1.15, ≥ 0.85, or below. A rating needs at least 300 SAR of spend.
- The decision is suggested from that rating: strong → Keep, weak → Stop, otherwise → Watch.

### 8.3 Action center

- Platform rating: **Excellent** at ≥ 1.15 × the period's average ROAS, **OK** at ≥ 0.9×, otherwise **Weak**.
- The top and bottom lists only include items with **at least 1% of total spend**.

### 8.4 Overview and analysis engine

Each segment gets one status: **Scale**, **Watch**, **Optimize**, **Pause / review** or **Not enough data**. The status is based on:

- data sufficiency (minimum spend and number of days);
- ROAS against the target and reference;
- trend strength;
- data health.

The thresholds are set in Settings.

---

## 9) Refresh schedule

| What | When | How |
|---|---|---|
| Platforms + Khzama + daily reports | Daily at 08:30 (last 3 days) | Scheduled task in the Claude app |
| Airtable creative board | Any time | **↻ Refresh from Airtable** in the library |
| Mixpanel site behaviour | Daily at 08:30 with the platform pull (last 3 days + today) | Step 3 of the daily-pull runbook |
| Live snapshots | In season: every 15 min, 24h (currently off) | Scheduled task in the Claude app |
| Video hooks | When queued | Ask Claude to "write the hooks" |
| Anything else, immediately | Any time | Ask Claude |

---

## 10) Covers and hooks (on the Mac — videos never stay on disk)

For every library video (`~/.gadlytics/media_assets.py`, runbook `skill/gadlytics/runbooks/covers_and_hooks.md`):

1. Read the video's public Drive folder (and up to two levels of subfolders); prefer the Snap/story file.
2. Download **one** file into a temp folder → save the **opening frame** (540 px JPEG, skipping a black first frame) → take the audio → **delete the video**.
3. **Whisper** (`large-v3-turbo`, MLX, on-device) on the first 12 s: the **hook** = the first sentence (up to the first pause); the whole 12 s text is kept in `media.hook_full`. Four videos run at once; Whisper takes turns.
4. **Distinct hooks** (`hooks_dedupe.py`): hooks that read alike are extended to one word past where they differ (e.g. "تسمع هذا الصوت؟ هذا صوت توثيق وجبات…"). Videos with the same script word for word (edits of one video) keep the short hook — their ID tells them apart. Hooks typed by hand are never changed.
5. **Hook on the image** (`hook_covers.py` + `bin/hookcover`): the hook is drawn onto the frame (white, heavy Arabic, right-to-left, dark band) and uploaded as the cover to the private Storage bucket `thumbs`; `media.thumb_hook` records the written text.

Only the small frame images are kept (`~/.gadlytics/frames/`). New videos get their cover and hook with the daily pull.

### 10.1 Upload new media to the platforms (⇪)

The button saves a request (`sys/uploadreq`); Claude runs it on the Mac when you say «ارفع الميديا» (runbook `upload_media.md`):

- the **Snap/story** version (never the TikTok file), named by its **Creative ID**, uploaded **as is** to **Meta (account 312559678073897 only)**, **TikTok** and **Snap** (resized to 1080×1920 through Canva when needed; music off);
- links first, so Meta and TikTok uploads start together; downloads, covers, hooks and the Snap upload run five at a time;
- the video is deleted from the Mac afterwards; each video's uploads are saved in `media_notes/<id>.uploads`;
- media-library uploads only — no campaigns, ad sets or ads are created.

### 10.2 Hooks — older notes

The **hook** is the first sentence the creator says in the video.

**How it works**

- **Whisper** (`large-v3-turbo`, via MLX) runs **locally on the Mac**. Videos are never sent to a third-party service.
- For each video:
  1. Read the video's public Google Drive folder.
  2. Pick one cut, preferring Snap, TikTok, Story, Reel or 9×16.
  3. Download it to a **temporary folder**.
  4. Extract the audio.
  5. **Delete the video immediately.**
  6. Transcribe the **first 12 seconds**.
  7. Delete the audio.
  8. Save the first sentence (up to 220 characters).
- **Nothing is left on disk.**
- It takes about **14 seconds per video**, and accuracy on Saudi Arabic speech is good.

**The queue**

- A video joins the queue when it is added to media management without a hook, or when you click **🎙 Auto hook**.
- Then tell Claude **"write the hooks"** (اكتب الهوكات).

**Which hook is shown:** your manual hook first, then the Whisper hook, then Airtable's "marketing text" (نص تسويقي).

---

## 11) AI assistant

The ✦ button (bottom-left) opens an assistant that reads your numbers from the site. It answers questions such as "Weakest campaign this week?", "Why did ROAS drop?" or "Best hour?", and it can add sections to screens.

- It needs a **Claude API key**: prepaid credit from console.anthropic.com, at a few cents per question.
- The key is stored as a **Supabase Edge Function secret** named `ANTHROPIC_API_KEY`. It is never stored in the site, in GitHub or in a chat.
- Tiers: **Quick** (cheapest), **Default** and **Advanced** (most accurate).
- Without the key, the assistant says so. The rest of the site is unaffected.

---

## 12) Repository layout

| Path | Purpose |
|---|---|
| `index.html` | The whole app, built from `mediabuyer-console.html` by `tools/build.py` |
| `supa-db.js` | Supabase storage adapter (the same interface the app expects) and the sign-in screen |
| `config.js` | Supabase project URL and **anon** key (public by design, protected by RLS) |
| `schema.sql` | The `docs` table and its access policies |
| `tools/build.py` | Builds `index.html`; injects supabase-js 2.45.4, `config.js` and `supa-db.js` |
| `tools/prep_ad_daily.py` | Turns raw platform pulls into `ad_daily` rows: parses campaign and ad names, converts USD, flags Smart+ |
| `tools/rebuild_entries.sql` | Rebuilds the daily report docs (platform metrics + Khzama orders and revenue) |
| `supabase/functions/ai/` | The AI assistant function; calls the Claude API with the stored secret |
| `supabase/functions/gad-api/` | Read-only API + MCP server for AI assistants (instinct, Claude, ChatGPT). See §32. |
| `r.html` | Tiny page that turns a plain link into the `gad-api` report for browsing assistants (key in `#hash`). See §32 (and the edit flow, §32.7). |
| `widget/GADLYTICS.js` | iPhone / iPad home- and lock-screen widget for Scriptable (reads `gad-api`; pure ASCII). See §33. |
| `skill/gadlytics/` | The Claude skill: how to run everything (runbooks + Mac scripts), so the work moves to another account or machine. No secrets in it. |

**Deployed, but intentionally left out of this public repo:**

| Function | Why |
|---|---|
| `ingest` | Receives pulled data; protected by a private ingest key |
| `media-sync` | The "Refresh from Airtable" function; contains the board's private share link |

**Kept on the Mac only** (`~/.gadlytics/`):

- the ingest key;
- the daily-pull and snapshot runbooks;
- the USD Snap puller;
- the Airtable sync script;
- the Whisper hook writer;
- `meta_changes.py`, which turns Meta activity-log results (read from the session log) into automatic change-log entries and daily campaign budgets;
- `budget_snapshot.py`, the daily budget snapshot for TikTok and Snap;
- the Mixpanel parsers: `mx_prep.py` turns report results into `mx_daily` rows, and `mx_from_log.py` reads report results from the session log so numbers are never retyped.

---

## 13) Database reference

### 13.1 Tables

| Table | Contents |
|---|---|
| `docs` | Document store (`path`, `coll`, `data` JSON). See the paths below. |
| `ad_daily` | Platform metrics per **ad × day** and per **video × day**: Meta, TikTok, Snap SAR and Snap USD (converted). |
| `khzama_link_daily` | Khzama orders and revenue per **link name × day**. |
| `khzama_rev` | Khzama revenue per source code (ME/TT/SC/bio/com/DM) for a date range, with the time it was taken. Used for period snapshot cards. |
| `snapshots` | Cumulative intraday snapshots for *Today live*. |
| `mx_daily` | Mixpanel events per day: `dim` = `aff` (Khzama link), `dev` (device), `src` (utm source), `pay` (payment method) or `hour`; `event` = session, page_view, view_content, add_to_cart, begin_checkout, purchase, revenue, checkout_error. |
| `media` | One row per Airtable video: key fields, every board column (`fields` JSON), `hook_auto` (first sentence), `hook_full` (first 12 s), `thumb` (cover path in Storage `thumbs`), `thumb_hook` (hook written on the cover), `asset_note` (`no_video`), `local_file` (file name in ~/Downloads, for the «On this Mac» filter). |
| `api_keys` | API keys for `gad-api` (§32): `name`, `key_hash` (SHA-256 only — the key itself is never stored), `scopes` (`read` / `read,refresh`), `last_used_at`, `revoked_at`. RLS on, no policies; written only through `ingest`. |

### 13.2 Views (all `security_invoker`)

| View | Contents |
|---|---|
| `v_media_perf` | Per video × platform: spend, impressions, clicks, views, Khzama orders and revenue, campaigns. Smart+ deduplicated. |
| `v_media_daily` | Per video × day. Used for "ROAS since entering the stage". |
| `v_creative` | Creative-level join used by the library. |
| `camp_budget_daily` | Each campaign's daily budget day by day (start/end, edits, status), from Meta's activity log or the daily snapshot for TikTok/Snap. |
| `v_camp_day` | Per campaign × day: budget, edits, platform spend/impressions/clicks and Khzama orders/revenue — the base of the change log. |
| `v_fatigue` | Creative fatigue per video × platform: last 3 days vs the 7 before (CTR, hook rate, frequency and CPM changes, and a status). |
| `v_mx_aff` | Mixpanel funnel per Khzama link, with campaign number, Creative ID and source code (taken from Khzama's parsed link, or parsed from the name). |

### 13.3 Main `docs` paths

| Path | Holds |
|---|---|
| `config/…` | Clients, platforms, goals, settings |
| `entries/<client>__<YYYY-MM-DD>` | The daily report per client |
| `roster/…` | Campaign roster cells |
| `media_notes/<creative_id>` | Hook override, tags, note, decision, stage, stage history, in-management flag, hook-queue flag |
| `profiles/<auth user id>` | Your profile: name, title, phone, about, photo, colour |
| `team/roster`, `meta/access` | Team members, roles and access |
| `tasks/…` | Tasks |

### 13.4 Access

- RLS is enabled on every table. Only signed-in users can read.
- Pulled data is written **only** through the `ingest` function, with the private key.
- The site itself writes only to `docs`: your settings, notes, stages and profile.

---

## 14) Building and deploying

1. Edit the source file `mediabuyer-console.html`. It lives outside this repo.
2. Build:
   ```bash
   python3 tools/build.py
   ```
3. Upload `index.html`, plus any other changed files, to the `main` branch. GitHub Pages redeploys in about 1–2 minutes.
4. Hard-refresh the site (Cmd+Shift+R).
5. **Verify after every deploy.** Signed in, Molabi's data must load. The empty "add a client" welcome screen must never appear.

> Never define `window.claude` on the site. The app treats that as a different runtime and starts without your cloud data.

---

## 15) Security and privacy

- No passwords, tokens or API keys in the code or the repo.
- Secrets live as **Supabase secrets** or on the Mac (`~/.gadlytics/`).
- The `anon` key in `config.js` is public by design and limited by RLS.
- Access to the ad platforms and Khzama is **read-only**. The system never edits, launches or pauses anything.
- Videos used for hooks are deleted immediately after the audio is extracted. Nothing is stored.
- Recommended: enable **Leaked password protection** in Supabase → Authentication.

---

## 16) Troubleshooting

| Problem | Fix |
|---|---|
| "Can't reach the database" | Your data is safe. Hard-refresh (Cmd+Shift+R) or sign in again. |
| Numbers are stuck on an old day | The daily pull is waiting for approval. Open its task in the Claude app and allow it ("Always"). |
| "Yesterday" is all zeros | Either there really was no spend, or the daily pull didn't run. |
| A new video isn't in the library | Click **↻ Refresh from Airtable**. |
| A hook is empty | Click **🎙 Auto hook** and then ask Claude to "write the hooks", or type the hook with ✎. |
| The assistant says it needs a key | Add `ANTHROPIC_API_KEY` to the Supabase secrets. |
| The page looks outdated after an update | Hard-refresh (Cmd+Shift+R). |
| A campaign shows the wrong platform | Check the platform code in its Khzama link name. |
| The same influencer appears twice | That spelling isn't in the dictionary yet. Ask Claude to add it to the name-unification map. |

---

## 17) FAQ

**Why are the platform numbers different from Khzama's?**
Pixels over-count: duplicate events, view-through attribution and ghost events from the tag manager. Khzama records the actual donations, so orders and revenue come from Khzama.

**Why does a video show "little data"?**
It has spent less than 300 SAR, which is too early to judge.

**What about a video with more than one influencer?**
It shows all their names in a fixed order, for example «أنس اكشن + منصور السالمي».

**Does the system pause campaigns by itself?**
No. Everything is a suggestion, and you do the executing.

**Why do bio, com and DM appear next to the platforms?**
They are organic Khzama sources: the profile bio, comments and DMs. They count toward the totals but have no ad spend.

**Does the USD Snap account count?**
Yes. It is pulled separately, converted at 3.75 SAR per USD, and merged with the SAR account.

**Will my tags, notes and stages survive an Airtable refresh?**
Yes. They are stored separately in `media_notes`, and the sync never overwrites them.

---

## 18) Glossary

| Term | Meaning |
|---|---|
| **Khzama (خزامى)** | Molabi's donation platform; the source of truth for orders and revenue |
| **Creative ID** | The 14-digit video identifier shared by Airtable, the link names and the ads |
| **Link name / Parameters** | The structured name attached to each ad's landing URL |
| **Smart+** | TikTok's automated campaign type; reported per material (video) |
| **Hook** | The opening sentence of a video |
| **Hook rate** | Share of impressions that watched at least 2 seconds |
| **Hold rate** | Share of video plays that watched to the end |
| **Stage** | A video's step in media management (Test → Winners → Scale) |
| **Season (الموسم)** | A campaign period such as Ramadan or Hajj, taken from Airtable |
| **Project (المشروع)** | The charity project a video promotes, for example سقيا |
| **Creator / Advertiser (المعلن)** | The influencer or model in the video, from Airtable |
| **Snapshot** | A cumulative intraday reading of today's numbers |

---

## 19) Look and feel (November 2026)

> Superseded on Nov 11 2026 by the **Bramble** design system — see §36. The notes below describe the light theme and the Clay skins, which still exist.

- **Calm palette** across the whole app: the same colour families, less saturated, no glow, no coloured page background; spend is always blue, revenue green, red only for problems.
- **Soft charts** everywhere: smooth curves, thin lines, light fill, faint grid, rounded bars.
- **Tasks** open on the board: four soft columns with white cards (title, priority, client, assignee, due date in red when late) and a joined KPI strip on top.
- **Today live** starts with live KPIs vs the same hour yesterday, spend hour by hour (today vs yesterday) and spend pace per platform against where it should be by now.
- **Interface style:** Settings → Display → «شكل الواجهة» has three buttons — Classic / Clay / Clay + Glass (`SKINS`, `ACT.skinSet`, `applySkin`). Saved per browser in `localStorage gad.skin`. The URL still works too: add `?skin=clay` (Claymorphism: soft raised cards, pressed inputs, rounded pill buttons) or `?skin=clayglass` (Clay + frosted-glass cards, translucent sidebar and top bar, plain background — no coloured blobs) to the site URL. Both have light and dark versions. The choice is remembered in the browser (`localStorage gad.skin`); `?skin=off` goes back to the normal look. The default look is unchanged.

## 20) Media-buyer tools (November 2026)

All of these are free: they run on data the site already has (Supabase free tier, GitHub Pages, the existing platform connectors, Khzama, Mixpanel, and the in-app Claude assistant). The system never edits campaigns: it designs, measures and suggests, and you act in the ad platform.

- **Quick refresh** (لوحتي → «⚡ تحديث سريع»): writes `sys/pullreq` with `mode:"quick"`. Claude then pulls **today only** (platform spend + Khzama), rebuilds and closes the request. This takes minutes instead of a full pull. «حدّث كل حاجة» is unchanged.
- **▶ الفيديو opens the video itself** (library, video window, media management): Airtable's URL column points to a Drive folder. `video_links.py` lists each public folder (no download), picks the Snap/story version and saves its file link in `media.video_file`. The Airtable sync runs it every pull, so new videos get their link automatically. The 📁 next to it still opens the folder with all versions.
- **Video views, frequency, retention** (creative library):
  - Each card shows total views and frequency across every campaign and platform, including TikTok Smart+ at material level.
  - The video window has a per-platform table (views, 2s, 6s, ThruPlay, 25/50/75/100%, frequency, campaigns).
  - It also has a retention curve with a dashed line for the account average, plus a verdict ("first quarter is X% better/worse than your average").
  - Source: view `v_video_stats`, built from `ad_daily`.
  - Frequency is the *average daily* frequency (impressions ÷ summed daily reach), not unique reach over the whole period.
- **AI hook tags + score**:
  - `media.ai_tags` holds `{hook_type, angle, emotion}`. Claude classifies every spoken hook (runbook step 3e).
  - These appear as library fields: «نوع الهوك», «الزاوية», «المشاعر».
  - «الدرجة /100» is a percentile against your own videos: Khzama ROAS 50% + hook rate 25% + CTR 25%, for videos with at least 300 SAR spend.
- **Patterns panel** (library → «✦ الأنماط»):
  - ROAS, change vs average, hook % and average score for each hook type, angle, emotion, project, talent or style.
  - Click a value to filter by it.
  - «✍ اكتب Brief» asks the in-app assistant to write the next video brief from the winning patterns and hooks.
- **Launches panel** (library → «🚀 الإطلاقات»):
  - Lists every video whose first spend was in the last 21 days, with a verdict: winning / borderline / failing / gathering.
  - The rule is minimum spend + target CPA. Target CPA defaults to the account average, and both are editable in the panel (`settings.launch`).
- **Action center** («مركز الإجراءات»):
  - Each item can become a task («حوّلها لمهمة» opens the task form pre-filled).
  - «تجاهل» hides an item for today (`localStorage gad.acHide.<date>`).
- **Test lab** (التجارب → «مختبر الاختبارات», docs `labtests/*`):
  - **Groups with separate codes** (gender, age, placement, device, anything):
    - Each group is its own ad set or campaign, with a tag in its name and in its Khzama link name.
    - The designer computes the orders needed per group (80% power, 95% confidence, chosen minimum difference), the days and the total budget, and writes the exact setup steps.
    - The readout shows spend (ad_daily), real orders and ROAS (Khzama) next to platform ROAS, with a two-sided test on orders relative to spend.
  - **City holdout**:
    - Switch Meta off in chosen cities.
    - The readout is difference-in-differences on Mixpanel purchases by city (`mx_daily dim=city`, runbook step 3 «GAD mx city»), giving Meta's approximate true share.
- **Month & seasons** (التقارير → «الشهر والمواسم»):
  - Month-end forecast for spend and Khzama revenue, with needed daily spend and revenue. Budget and target are editable (`settings.month`).
  - Every Hijri month (Umm al-Qura) with spend, revenue, ROAS and per-day averages. Ramadan and Dhul Hijjah are highlighted. Hijri months and weekdays come from the view `v_daily_totals` (all days in the database: ad_daily spend at ad level + Khzama orders/revenue for ME/TT/SC/bio/com/DM), not only the period loaded in the page.
  - Weekdays over the last 90 days.


## 21) Second client: ديمان — app + Salla store (November 2026)
- Pick the client from «العميل» in the side menu. With more than one client the site opens on the last one you picked (or the first), so the numbers of two clients are never added together by accident. «كل العملاء» is still there and is remembered too.
- ديمان has no Khzama. Its orders and revenue come from **AppsFlyer** (app purchases, per platform and campaign, on the day of purchase) and **Salla** (website orders). ROAS counts app purchases from the paid sources plus Salla orders; organic, QR and WhatsApp purchases are stored but not credited to ads.
- Accounts: Meta, TikTok (Smart+, iOS), Snapchat, Apple Search Ads and Google (spend for these two comes from AppsFlyer cost), the two AppsFlyer apps (iOS + Android), the Salla store, and the Airtable board (rows where client = ديمان). History from the first paid day, 22 Sep 2025.
- Every screen reads the same way as for ملبي; labels that say «خزامى» or «تبرع» read «AppsFlyer وسلة» and «طلب» while ديمان is selected. Per-video orders use each platform's own purchase count, because there is no per-video order source for the app.
- Data: table `conv_daily` (client_id, date, channel app/web, os, source, platform, campaign, camp_no, installs, registrations, purchases, revenue, cost — SAR). `v_daily_totals`, `v_camp_day`, `v_media_perf` and `v_media_daily` include it. `ad_daily` has two new columns, `app_installs` and `registrations`.
- Daily pull: the ديمان section of the pull runbook (`skill/gadlytics/runbooks/daily_pull.md`), scripts `platform_rows.py`, `log_results.py`, `conv_prep.py`, `conv_spend_to_ad_daily.py`, `rebuild_entries_conv.sql`.

## 22) أداء الحملات — campaign performance (November 2026)
- One page for active campaigns, split by platform, with filters for platform, project (the `PR:` code in the campaign name), date (today, yesterday, last 7 or 30 days, or any single day) and comparison (previous period or same days last week). «الشغالة بس» shows active campaigns; «كل اللي صرفت في الفترة» shows old ones too.
- Columns: spend (platform), donations and revenue (Khzama), ROAS, cost per donation, current budget. Totals on top include the current budget. Every campaign, ad set and ad gets a verdict (زوّد / راقب / وقّف / لسه بدري) against the ROAS target, and arrows versus the comparison period.
- Click a campaign for its ad sets, and an ad set for its ads. Campaign names show the code only; ads show the video ID and the influencer's Arabic name.
- Khzama matching: campaign code in the link → the link's Custom part is the ad-set name → the video ID is the ad. A Custom that doesn't match any ad-set name shows as a warning row with «اربط»; the link is remembered (`campmap/*`). A link without a Custom goes to the one ad set that holds that video; otherwise it stays on the campaign row — numbers are never split by estimate. A TikTok Smart+ link with several video IDs counts as ONE ad (one row). Platform purchases/revenue are never shown: spend from the platform, donations and revenue only from Khzama.
- Budgets: CBO campaigns are edited on the campaign row, ABO on each ad set; TikTok Target CPA, Snapchat Target cost / Max bid and Meta Cost cap / Bid cap are edited on the ad set. Edits and on/off switches (campaign, ad set, ad) are saved as a `campchg/*` request and then sent straight to the Supabase edge function **`camp-apply`** (source `supabase/functions/camp-apply/index.ts`), which changes that one field on the platform, reads it back, updates `camp_struct`, marks the request done and logs it in سجل التغييرات — about 5–10 seconds. Platforms not connected to it yet (`not_configured`) keep the request (⏳) for the scheduled task / «نفّذ طلبات الحملات» (runbook `skill/gadlytics/runbooks/camp_requests.md`), which takes minutes. «تحديث الأرقام» requests a fresh pull of only these numbers (platforms + Khzama), handled the same way.
- Data: `camp_struct` (status, CBO/ABO, daily budget, bid per active campaign/ad set), `khzama_link_daily.custom` now also reads names with digits (CPA35, Mansour_1).
- Fast path status: **Snapchat connected** (Nov 8 2026; tested 300→301→300 on a paused ad set: 8.6 s and 5.4 s). **Meta connected** (Nov 9 2026; personal 60-day user token from Mahmoud's own developer app «ADS», saved with `python3 ~/.gadlytics/push_meta_token.py <token>`; tested MG-01741 105→100 from the page in 6 s, campaign stayed PAUSED; the direct Graph API call does not force-pause like the MCP does). Renew the Meta token before **Jan 7 2027** (Graph API Explorer → app ADS → ads_management + ads_read → Generate → Access Token Debugger → Extend → run the script). TikTok not yet — they need a token (Meta: a personal user token from a developer app, renewed every 60 days, because Mahmoud isn't Business admin; TikTok: an approved Marketing API app plus Admin/Operator on the advertiser).
- Platform tokens live in table `app_secrets` (row security on, no policies — only edge functions can read it), loaded from the Mac through `ingest` (`table: app_secrets`, names SNAP_CLIENT_ID / SNAP_CLIENT_SECRET / SNAP_REFRESH_TOKEN / META_TOKEN / TIKTOK_TOKEN), e.g. `python3 ~/.gadlytics/push_snap_secrets.py`. Never put a token in the site or this repo. There is no upper budget limit (season budgets reach 1,000,000 SAR/day per campaign). The function only accepts signed-in users.
- «تحديث الأرقام» (Nov 9 2026): the button calls edge function **`camp-refresh`** (source `supabase/functions/camp-refresh/index.ts`). In ~6–10 s it pulls, read-only, Meta + Snapchat ad-level spend for **today only** (from midnight Riyadh up to the current minute; Mahmoud wants just today — yesterday is settled by the daily pull) (per account timezone), writes `ad_daily` in the same shape as the daily pull, and refreshes `camp_struct` (status, CBO/ABO, budgets, bids; ads of campaigns that spent). The page switches to «النهارده» and shows «آخر تحديث للصرف HH:MM» (Riyadh). Khzama (ملبي) and AppsFlyer + Salla (ديمان) have no server API, so the same click also queues `sys/campreq` with `parts` for the scheduled task (minutes). TikTok joins when its API app is approved. Checked against the daily pull: 2026-10-13 Molabi Meta 475.16 / Snap 138.54 and Deiman Meta 12–19 Oct, identical per day.

## 23) التطبيق على الموبايل / الآيباد (November 2026)
GADLYTICS works as an app on Mahmoud's iPhone and iPad (a home-screen web app — no App Store, no extra cost). Opened from the home screen it runs full-screen, starts on «أداء الحملات», and keeps the sign-in. Same link as desktop: on a screen ≤ 1180 px (or when installed) the plain root https://mahmoudgadmediabuyer.github.io/gadlytics/ opens straight on «أداء الحملات» in the app layout — `?app=1` still works but is not needed; `start_url` is `./`.

**Install (once per device):** open https://mahmoudgadmediabuyer.github.io/gadlytics/ in **Safari** → sign in → tap **Share** ⬆️ → **Add to Home Screen** → Add. The GADLYTICS icon appears with the other apps.

**What the app looks like** (only on screens ≤ 1180 px and only on «أداء الحملات»; desktop is unchanged):
- Phone (≤ 760 px) — Nov 9 polish: one-row nav bar (menu · «أداء الحملات» with «آخر تحديث HH:MM» under it · refresh icon that spins · client pill); date segmented control (النهارده / امبارح / يوم / 7 أيام / 30 يوم / فترة — since Nov 10 «يوم» picks any single day and «فترة» any from–to range, each opens a date sheet and then shows one chip such as «13–19 أكتوبر»; the old «مخصص» button is gone); platform tabs + «فلاتر» sheet. KPIs (Nov 10, Mahmoud's order) = **8 tiles**: الصرف · التبرعات · الإيراد · ROAS · عدد الحملات (with «N شغالة · N موقفة») · إجمالي الميزانية (active campaigns) · متوسط التبرع · تكلفة التبرع, each with ▲▼ vs the comparison period (ديمان reads الطلبات / متوسط الطلب / تكلفة الطلب); 2 columns × 4 rows on the phone (`cpKpis(m)` builds the list for every layout); «مفيش صرف على Meta النهارده» instead of empty tiles. Campaign list: sort menu (الصرف / ROAS / تكلفة التبرع / الاسم) and code search; each row = state dot, code, switch, spend · ROAS · CPA with ▲▼, verdict chip, and a **budget chip «الميزانية 350 ر.س ✎»** that opens the edit sheet right from the list (ABO campaigns show «ABO · الميزانية على الـ Ad sets»; ad-set rows carry their own budget chip for ABO and a bid chip — Cost cap / Target CPA / Target cost). Tap → campaign screen → ad set screen with a slide animation (reduced-motion respected); back button, browser back, or a swipe from the screen edge goes back with the scroll position kept. Default period «النهارده»; period, platform and sort are remembered per device (`localStorage gad.ma`); the client was already remembered (`gad.ws`). Switches flip immediately with a spinner and revert with a red toast if the platform refuses.
- 761–819 px: same navigation as the phone with bigger type, 8 KPI tiles 4×2, filters on one line.
- iPad ≥ 820 px (portrait 820/1024 and landscape 1180): two panes — 380 px campaign list (RTL: on the right) + a detail pane that scrolls on its own; 8 KPI tiles 4×2; filters on one line.
- Edits open a bottom sheet: current value, numeric keypad, quick chips −20% / −10% / +10% / +20%, big «تطبيق على المنصة». On/off asks for confirmation in a sheet. Both use the same `campchg` + `camp-apply` path as desktop (Snap/Meta in seconds, TikTok queued). No upper budget limit.
- «تحديث الأرقام» = the refresh icon in the top bar (no bottom bar any more, so nothing is covered) + pull-to-refresh at the top of the list (`camp-refresh` today-only + Khzama/conv request).
- Code: `cpModel()` is the shared data model (desktop `renderCampPerf` and the app `renderCampApp` both use it); app mode = `html.ma-on` when `S.view==="campperf"` and `(max-width:1180px)`; styles under `.ma` (8-pt spacing, type scale 28/20/17/15/13 phone, 34/22/17/16/13 tablet). Icons in `icons/`, manifest `manifest.webmanifest`.

**Updates reach the phone/iPad automatically.** There is no service worker and nothing is cached by the app. `tools/build.py` stamps every build into `<meta name="gad-build">`; whenever the app opens or comes back to the foreground (and every 5 minutes) it fetches `index.html?_b=<now>` with `cache:"no-store"`, compares the build id and, if newer, reopens itself on the new version (skipped while an edit box/sheet is open). GitHub Pages sends `cache-control: max-age=600`, so the check deliberately bypasses the cache.

**Rule — every new screen or feature ships with its phone (≤ 760 px) and iPad (761–1180 px) layout before deploy.** Test it at 390×844, 430×932, 375×667, 820×1180, 1024×1366 and 1180×820 (no horizontal scroll, no clipped Arabic, touch targets ≥ 44 px, sticky bars never covering content) — e.g. same-origin iframes of the live site inside a tab on `manifest.webmanifest` (a page without the app script) so they share the signed-in session.

Also fixed while building this: `camp_struct` (2,450 rows for ملبي) was read in unordered 1,000-row pages, so campaigns randomly lost their status/budget on desktop too — every paged query now has a stable `order(...)`.

- Rows in the app (Nov 10 2026): every campaign / ad set / ad row shows **الصرف · التبرعات · الإيراد · ROAS** in four equal columns with thin separators, the number on top and the ▲▼ comparison under it (Mahmoud's choice); the budget chip sits under them. Checked at 375 / 390 / 820 with 7-digit values — nothing clipped.

- **Every screen on phone/iPad (Nov 10 2026, `html.ap-on`)**: on screens ≤1180px (or the installed app) all screens other than «أداء الحملات» get the app shell too — the desktop rail and top header are hidden; one sticky top bar (☰ · screen title · client pill) sits under the iPhone status bar/notch with `env(safe-area-inset-*)` padding; ☰ opens the «الشاشات» sheet with the same grouped nav plus an account row (alerts · language · theme · profile). The AI button sits above the home indicator and hides while a sheet is open. Phone (≤760): card grids collapse to one column (number grids to two), the big page title is hidden (it's in the bar), secondary header buttons (manual snapshot, data entry, edit page) move out, the client strip shows only its numbers; wide tables scroll inside their own card with an edge fade. Checked all 20 nav screens at 390×844 and 820×1180: page width = viewport, nothing clipped; desktop 1440 unchanged.

## 24) Sidebar order (Nov 10 2026, Mahmoud's order — desktop sidebar and the phone/iPad menu sheet use the same list)
- **شغلي:** لوحتي · المهام · المجتمع
- **الإدارة والتحليل:** نظرة عامة · أداء الحملات · إدارة الحملات · إدارة الميديا · مكتبة الكريتيف · المحلل · الموقع والقمع
- **المتابعة:** مركز الإجراءات · اليوم المباشر · التقارير · إدخال البيانات
- **أدوات إضافية:** الميديا بلان · الموافقات · التجارب · سجل التغييرات
- **الفريق:** الفريق · تقييم الأداء — then شاشاتي (if any) and الإعدادات. Simple mode / members see the same groups minus screens they don't have.

## 25) ROAS verdicts per client + phone notifications (Nov 10 2026)
- **Verdicts, 4 levels, per client** (لوحة التحكم ← العملاء ← تعديل: «ROAS الإنذار» · «أقل ROAS مقبول» · «ROAS الكويس»). ملبي: ≥ 2.8 «زوّد» (green) · 2.1–2.8 «كويس» (teal) · 2.0–2.1 «راقب» (amber) · < 2.0 «إنذار» (red); «لسه بدري» for low data. Stored as `roasAlarm / roasMin / roasGood` on the client in `config/app`. A client without them (ديمان) shows no verdicts and a hint where to set them.
- **Push notifications** (iPhone/iPad installed app on iOS 16.4+, and Chrome on the Mac): the bell 🔔 in the menu sheet's account row (or الإعدادات ← «التنبيهات») opens the **التنبيهات screen** (view `push`, `renderPushPage` — a full screen since Nov 10, not a sheet, see §28) → «تعديل» → «فعّل التنبيهات» (needs a tap; on iPhone only from the home-screen app) → «جرّب تنبيه». `sw.js` handles only `push` + `notificationclick` — no fetch handler, no caching, so the app always loads the latest build. Edge function `push` (source `supabase/functions/push/index.ts`): VAPID keys generated once and kept in `app_secrets` (never printed), RFC 8291 encryption with WebCrypto, actions vapid / subscribe / unsubscribe / prefs / mine / test, plus a server-only `send` (x-ingest-key). Subscriptions in `push_subs` (row security: each user sees only their own). Per-device settings under «تعديل» on the same screen: delivery hours (default 8–24), quiet hours, alert types on/off, daily summary time, silent. Sound can't be customised for web push on iOS — set it in iPhone Settings ← Notifications ← GADLYTICS.
- Tables added: `camp_hourly` (intraday spend snapshots for «نفس الساعة امبارح»), `push_subs`, `alerts_sent`. The alert rules run on the server in `camp-alerts`, every 5 minutes (deployed Nov 10 — §28); bulk edit / undo / intraday stats / per-campaign log are in §26.

## 26) أداء الحملات — bulk edit, undo, spend pace, change log, alerts history (Nov 10 2026)
Where each button is:

| Feature | Desktop (>1180 px) | iPad (761–1180) | iPhone (≤760) |
|---|---|---|---|
| **«تعديل جماعي»** | toolbar above the campaigns table → checkboxes appear on CBO campaigns and on ABO ad sets with an editable budget → bar at the bottom «عدّل N» | «تعديل جماعي» chip under the list header → a select circle on each eligible row (tap the row to select) → bottom bar | same as iPad |
| **«سجل التعديلات» (whole page) / «رجّع»** | toolbar button next to «تعديل جماعي» → opens inline under the toolbar, platform filter chips, «رجّع» on each edit | chip next to «تعديل جماعي» → inline under it | same as iPad |
| **«تراجع» toast** | 10 s after any applied change (single edit, switch, bulk) | same | same |
| **«سرعة الصرف والتقييم الكامل»** | 📊 icon on the campaign's project line (modal) | campaign screen → «سرعة الصرف والتقييم الكامل» (opens inline, tap again to close) | same as iPad |
| **«سجل التعديلات» per campaign** | 🕒 icon on the campaign's project line → an inline row opens right under that campaign | campaign screen → «سجل التعديلات» (opens inline under the buttons) | same as iPad |
| **«سجل التنبيهات»** | التنبيهات screen, card under the settings | same | same |

- **Bulk edit**: options ±10 / ±20 %, a custom %, or a fixed value; the preview shows old → new for each item (rounded to whole SAR, no budget cap). Apply goes item by item through `campchg` + `camp-apply`: Meta and Snap apply instantly, TikTok is queued ⏳ (applied by the scheduled task). Each item gets ✓ / ✗.
- **Undo**: `cpUndoWhy(c)` refuses, and the list shows why, when any of these is true:
  - the change wasn't applied, or there's no previous value;
  - it was already reverted;
  - a later change touched the same platform / object / field;
  - the live value (`camp_struct`) no longer equals the applied value, meaning it changed since.
- **Spend pace** (hidden until asked):
  - today so far vs yesterday at the same Riyadh hour, from `camp_hourly`;
  - budget % used and the projected end-of-day spend;
  - «التقييم الكامل للفترة» for the selected period: spend + Khzama donations / revenue / ROAS / CPA / AOV, plus impressions, reach, clicks, CTR, CPC, CPM, link clicks, LPV, video plays, ThruPlays, ATC and checkout (never platform purchases).
  - `camp-refresh` (v4) writes `camp_hourly` on every refresh, one row per campaign per 15-minute bucket (upsert on `client_id,platform,campaign_id,ts`, plus `hour`). The same-hour comparison only works from the day after the first snapshots: «المقارنة بالساعة بتبدأ من بكره — بنسجّل من النهارده».
- **Change logs never leave the page** (Mahmoud): both logs open inline (`CP.logAll` → `cpLogAllHTML`, `CP.logCamp` → `cpLogInHTML`, the loader is `cpLogLoad(target)`). Every applied edit is still written to «سجل التغييرات» (`changes/*`, by `camp-apply`).
- **On phone/iPad** the bulk-edit panel is a full screen (`S.view="cppanel"`, `renderCpPanelPage`, «رجوع» returns to the same scroll spot), never a pop-up sheet (iOS flicker). Pace is an inline expander.
- **Alerts history** («سجل التنبيهات», `alHistHTML` / `alLoad`):
  - reads `alerts_sent` (row security: `user_id` null or = me), ordered by `sent_at` desc, the last 7 days; «أقدم» loads 7 more, up to 90.
  - each row shows the type label (تكلفة التبرع / الميزانية / ROAS إنذار / زيادة صرف / توكن ميتا / الأرقام وقفت / تجربة / ملخص يومي / ميديا جديدة), client, campaign code, relative + exact Riyadh time, and the message.
  - each row also shows the delivery status on *this* device: `deliveries[].ep` = first 16 hex of SHA-256 of the push endpoint, matched in the browser.
  - tapping a row opens that client + campaign in «أداء الحملات» (`CP.focus` → `cpFocusApply`): the campaign screen on phone/iPad, the row expanded and highlighted on desktop. A «media» row opens مكتبة الكريتيف.
  - test pushes are logged too.
- **Notifications screen layout (Mahmoud's choice)**: «سجل التنبيهات» comes first; «تعديل» opens the settings inline (enable / test / turn off, delivery hours, quiet hours, alert types, silent, save). Only four alert types are shown: roas «إنذار ROAS أقل من 2 (لكل حملة وللإجمالي)» (limit per client = `roasAlarm`), spike «زيادة مفاجئة في الصرف» (`spikePct` 40 %, `spikeMin` 150 SAR), norev «صرف من غير إيراد» (`norevWin` 15/30 min, `norevMin` 200 SAR) and media «ميديا جديدة على Airtable». cpa / bud / stale / dailySummary / meta are saved as off and hidden. The threshold boxes on this screen (`spikePct`, `spikeMin`, `norevWin`, `norevMin`) are saved per device in `push_subs.prefs` and the server engine **uses them** (camp-alerts v2, §28): what Mahmoud types here is what fires on that device. The device prefs also control each rule on/off, delivery hours, quiet hours and silent (applied by `push` when it sends). Server-only knobs (cooldowns, ROAS minimum spend, media sync interval) stay in `config/alerts`.

## 27) «أداء الحملات» on the Mac = the iPad layout (Nov 10 2026)
- On screens wider than 1180 px, «أداء الحملات» now renders the same two-pane app layout as the iPad (campaign list on one side, the tapped campaign's detail beside it with budget edit, «سرعة الصرف والتقييم الكامل» and «سجل التعديلات» inline, ad sets, toggles, verdicts; 8 KPI tiles; period control incl. «يوم»; platform tabs, فلاتر, ترتيب, بحث, «تعديل جماعي», page-level «سجل التعديلات») inside the normal desktop shell (sidebar + header stay). `html.ma-desk` + `ma-on`; the app's ☰ and client pill are hidden (the desktop header has them); edit sheets show as centred dialogs.
- A «تفاصيل | جدول» switch (top of the page) brings back the old desktop table; the choice is remembered per browser (`localStorage gad.cpView`, default تفاصيل).
- Sizes (final, Nov 10 — Mahmoud asked to use the empty space and widen the list): no max width (`html.ma-desk .ma{max-width:none;margin:0}`), so the page fills the whole content area beside the sidebar; list pane `clamp(520px, 42%, 820px)`, detail pane `minmax(0,1fr)`, gap 24 px. Bigger text in the list: campaign name 19 px, the four numbers 21 px, their labels 13.5 px. KPI tiles 4×2 below 1500 px, 8 in one row from 1500 px. Checked at 1280 / 1440 / 1920 (no horizontal scroll); 820 and 390 unchanged.
- Opening the Mac layout is automatic (> 1180 px wide and «تفاصيل» selected); nothing to install.

## 28) Server alerts engine (`camp-alerts`, Nov 10 2026)
Mahmoud picked **four alerts only** (everything else is off and hidden):

| Key | Shown as | Fires when (defaults) | Scope | Repeats |
|---|---|---|---|---|
| `roas` | «إنذار ROAS · MG-…» / «إنذار ROAS الإجمالي · ملبي» | ROAS < the client's alarm level (ملبي `roasAlarm` = **2.0**, from لوحة التحكم ← العملاء) once spend ≥ 300 SAR (`minSpend`) | every campaign code on its own **and** the client total (`total:true`) | again only if ROAS drops another 15 % (≤ 0.85× the worst already sent) |
| `spike` | «صرف مفاجئ · MG-… (ميتا)» | spend in the last 15 min (`windowMin`) is ≥ the device's «لما الصرف يعدّي» (`spikeMin`, default 150 SAR) **and** more than the device's % (`spikePct`, default 40 %) above both the same 15 min yesterday and today's average 15-min pace (each base used only when it exists; today's pace needs ≥ 1 h of data) | per campaign | 60-min cooldown, or sooner if the rate is ≥ 1.2× and ≥ 1 SAR higher than the last one sent |
| `norev` | «صرف من غير تبرعات · ملبي» / «… · MG-…» | ≥ the device's SAR (`norevMin`, default 200) spent in the device's window (`norevWin` 15 or 30, default **30**) with **zero** new Khzama revenue; checked for the client total first, then up to 3 campaigns (`campaigns:true`, same SAR floor) | client total, then campaigns | 60-min cooldown |
| `media` | «ميديا جديدة على Airtable» | new rows in `media` since the watermark `sys_kv.media_wm`; `media-sync` is called every 15 min (`everyMin`) first | one grouped push per run | never (watermark moves forward after a send/hold) |
| `meta` | «توكن ميتا هيخلص بعد N يوم» | META_TOKEN invalid or < 7 days left | — | **off** (`on:false`) unless switched on |

**How a run works** (source `supabase/functions/camp-alerts/index.ts`, deployed **v2**):
1. pg_cron job **`gad-camp-alerts`**, schedule `*/5 5-20 * * *` UTC = every 5 minutes from 08:00 to 23:55 Riyadh, does `net.http_post` to the function with the project's **public anon key** (the same key `config.js` ships) — no secret is stored in SQL. The gateway JWT check stays on.
2. Self-throttle: one real run per 4 minutes (`sys_kv.alerts_last`, epoch ms). Extra calls return immediately, so a double trigger is harmless.
3. Calls `camp-refresh` (server-to-server, service-role key that never leaves Supabase) → today's Meta + Snap spend, which also writes `camp_hourly`.
4. Writes fine snapshots to **`alert_snap`** (`client_id, scope, key, at, acct, code, spend, rev, don`; scope `acct` = an ad-account pull mark, `camp` = cumulative spend of a campaign at that pull, `rev` = Khzama cumulative revenue at each Khzama pull, key `_total` for the client). Upsert on `client_id,scope,key,at` (duplicates ignored). Pruned to 3 days.
5. Evaluates the rules above. Spend at time t = the latest pull of each ad account at or before t (≤ 12 min tolerance); if any spending account has no pull near t the rule is skipped (never guessed). A campaign missing from a pull counts as 0 spend so far.
6. **Revenue = Khzama only** (`khzama_link_daily`), never platform purchases. `roas` is skipped if Khzama is older than 180 min (`maxKzAgeMin`); `norev` is skipped unless Khzama was updated within the window. ديمان has no Khzama, so its `roas`/`norev` are skipped («no Khzama for this client»).
7. De-duplication against today's `alerts_sent` (see "Repeats" column). An alert that was **held** (quiet hours / outside delivery hours / rule off on every device) is retried at most hourly while still true.
8. Sends through the **`push`** function (`action:"send"`; `roas`/`media` go `to:"all"`, `spike`/`norev` go only to the devices of the threshold profile that fired — see below; tag = rule + campaign) and logs every alert in **`alerts_sent`** (`id, client_id, rule, obj, day, level, title, body, url, sent_at, campaign, platform, kind, status, deliveries jsonb, user_id, metric`). The push function applies each device's own prefs through `holdReason()` — rule off, outside delivery hours (default 8–24), quiet hours, silent — and records per-device deliveries (`ep` = first 16 hex of SHA-256 of the endpoint).

**Thresholds — what wins (v2):**
1. **Each device's own numbers** from the التنبيهات screen, saved in `push_subs.prefs`: `spikePct`, `spikeMin`, `norevWin` (15|30), `norevMin`. Devices with identical numbers form one *profile*; `spike`/`norev` are evaluated once per profile and pushed only to that profile's devices. With more than one profile the alert's `obj` gets the suffix `~<spikePct>/<spikeMin>/<norevWin>/<norevMin>` so each profile de-duplicates on its own (one profile → no suffix). The dry-run reply lists them under `profiles` and labels per-profile notes `spike [id]` / `norev [id]`.
2. **ROAS alarm = the client's `roasAlarm`** in `config/app` (لوحة التحكم ← العملاء; ملبي 2.0).
3. Everything else (and any value a device hasn't saved) from `docs` row **`config/alerts`**: `{defaults:{rule:{…}}, clients:{<client_id>:{rule:{…}}}}` merged over the built-in defaults:
```
roas:  {on:true, alarm:0 (→ client roasAlarm or 2.0), minSpend:300, cpaMult:2, total:true, maxKzAgeMin:180}
spike: {on:true, pct:40, minSar:150, windowMin:15 (5–60), cooldownMin:60}
norev: {on:true, minSar:200, windowMin:30 (15 or 30 — same default as the page), campaigns:true, campMinSar:200, cooldownMin:60}
media: {on:true, everyMin:15}
meta:  {on:false, days:7}
```
Current row: the defaults above (no `roas.alarm` — the client's `roasAlarm` is used) plus a `note`; overrides for `3sa3k1k` (ملبي) and `dm1n4an` (ديمان) are empty. On Nov 10 neither active device had saved threshold numbers yet, so both run on the defaults (profile `-/-/-/-`).

**Push `Topic` fix (push v5):** Apple rejects a Web Push `Topic` header that isn't valid base64url ≤ 32 chars — e.g. tag `ready` → `400 BadWebPushTopic`, which would have dropped every server alert on iPhone. `push` now sends `Topic` = first 32 hex chars of SHA-256(tag) (same tag → the newer notification still replaces the older).

**Manual run / test** (signed-in or admin): POST `camp-alerts` with `{dry:true}` → evaluate only, no refresh / snapshot / send, and the reply lists every candidate alert with its `skip` reason and an `ev` note per rule; `{force:true}` ignores the throttle and hours; `{only:["spike"]}` runs one rule. A test push from the screen («جرّب تنبيه») goes through `push` `action:"test"` and is logged as kind `test`.

**Status on Nov 10 2026:** the cron runs and succeeds every 5 minutes (last checked 14:40 Riyadh). `alerts_sent` holds 6 rows, all tests (5 sent, 1 failed on a stale subscription); `alert_snap` is still empty because neither client has spent since Oct 19 — the first real `spike`/`norev`/`roas` alerts will appear on the first day with spend. 2 active device subscriptions, both from Nov 10: an iPhone (iOS 18.7) and a Safari "Macintosh" device (the Mac's Safari or the iPad — iPadOS Safari reports itself as Macintosh).

**Open question — live revenue for `norev`/`roas`.** Khzama has no API (confirmed by Mahmoud), so "live" revenue is only as fresh as the last Khzama pull by the scheduled task. Two options are on the table, not chosen yet: (1) Mixpanel site-wide donations for the client-total `norev` only (needs a Mixpanel Service Account; per-campaign UTM attribution is unreliable — 58 % of donations lose `utm_source`); (2) the server uses a Khzama session token (needs consent; the token expires).

**Notifications screen (view `push`) — what's where:**
- Opened from the 🔔 in the menu sheet's account row (phone/iPad/Mac app layouts) or الإعدادات ← «التنبيهات». It is a full screen (it used to be a sheet; on iOS a ghost tap closed the sheet the moment it opened).
- Top: «سجل التنبيهات» (§26). Button «تعديل» opens the settings inline: «فعّل التنبيهات» / «جرّب تنبيه» / «وقّف التنبيهات», delivery hours from/to, quiet hours, the four alert types, silent, «حفظ».
- Bottom: a small diagnostics line `pushDiag()` — `build <id> · app yes/no · push yes/no · perm granted/denied/default · iOS yes/no`. Use it when "notifications don't work": `app no` on iOS = opened in Safari, not from the home-screen icon; `perm denied` = blocked in iPhone Settings ← Notifications ← GADLYTICS; `push no` = browser without Push API.
- iPhone/iPad setup: iOS 16.4+, install from Safari (Share ⬆️ ← Add to Home Screen), open GADLYTICS **from the icon**, التنبيهات ← تعديل ← «فعّل التنبيهات» ← Allow, then «جرّب تنبيه». The sound can't be chosen for web push; iOS uses the default sound (Settings ← Notifications ← GADLYTICS for banners/sounds/badges).

## 29) Connections, tokens, scheduled tasks — status and renewals (Nov 10 2026)
**Edge functions** (project `ibpwudzjwjraqhfdmzet`; sources in `supabase/functions/` except `ingest` (holds a server key) and `media-sync` (holds the board's private Airtable share link) — both kept out of the public repo):

| Function | Version | What it does | Called by |
|---|---|---|---|
| `camp-apply` | v3 | change ONE field (budget, bid, on/off) on Meta (Graph v21) / Snap (USD account `961fd033-…` budgets ×3.75 SAR↔USD) / TikTok (detects Smart+), read it back, update `camp_struct`, log to `changes/*`. No budget cap. `not_configured` → the request stays ⏳ for the scheduled task | the page (signed-in users only) |
| `camp-refresh` | v5 | today-only spend (midnight Riyadh → now, per account timezone), `ad_daily` upsert on `client_id,date,platform,level,account_id,ad_id,video_id`, `camp_struct` (paused-parent rule: a child of a paused campaign shows paused), `camp_hourly` 15-min buckets; queues `sys/campreq` with `parts` khzama / conv | the page («تحديث الأرقام»), `camp-alerts`; admin path with `x-ingest-key` checked against a SHA-256 hash (`INGEST_SHA`) |
| `push` | v5 | Web Push (VAPID keys `VAPID_PUBLIC` / `VAPID_PRIVATE_JWK` in `app_secrets`, RFC 8291 encryption); actions vapid / subscribe / unsubscribe / prefs / mine / test + server `send`; `holdReason` (rule off / outside hours / quiet hours; `force` skips) | the page, `camp-alerts` |
| `camp-alerts` | v1 | §28 | pg_cron every 5 min |
| `media-sync` | v1 | Airtable → `media` | `camp-alerts` (every 15 min), the page |
| `ai` | v1 | the AI assistant | the page |
| `ingest` | v11 | the Mac's write path for the daily pull; allowed tables include `app_secrets` (by `name`), `camp_struct`, `conv_daily` | scripts in `~/.gadlytics` |

**Platform tokens** (all in `app_secrets`, row security on with no policies → only edge functions read them; scripts never print a secret and the site never sees one):

| Platform | Fast path | Token | Renew |
|---|---|---|---|
| Snapchat | ✅ since Nov 8 | `SNAP_CLIENT_ID` / `SNAP_CLIENT_SECRET` / `SNAP_REFRESH_TOKEN` (Snap Marketing API OAuth app); access token cached in `sys_kv.snap_access` | refresh token is long-lived; re-run `python3 ~/.gadlytics/push_snap_secrets.py` only if Snap revokes it |
| Meta | ✅ since Nov 9 | `META_TOKEN` — 60-day user token from Mahmoud's own developer app «ADS» (he is not Business admin, so no system user) | **before Jan 7 2027**: Graph API Explorer → app ADS → permissions `ads_management` + `ads_read` → Generate Access Token → Access Token Debugger → «Extend Access Token» → copy the green token → in Terminal `python3 ~/.gadlytics/push_meta_token.py` (reads the clipboard, or asks with hidden input; checks `act_312559678073897`; empties the clipboard). The token was pasted in chat once on Nov 9 → rotating it early is recommended |
| TikTok | ⏳ waiting | `TIKTOK_TOKEN` — needs the Marketing API app «GADLYTICS» (created Nov 9, waiting for TikTok's approval) + Admin/Operator on the advertisers | after approval: open the app's Advertiser authorization URL → pick the Molabi/Deiman accounts → Confirm → copy `auth_code` from the address bar (valid ~1 h, once) → `python3 ~/.gadlytics/push_tiktok_token.py <App ID> <Secret> <auth_code>`. Until then TikTok edits stay ⏳ for the scheduled task and TikTok spend comes from the daily pull |

**Scheduled tasks (Claude desktop app, on the Mac):**

| Task | Schedule (Riyadh) | Job |
|---|---|---|
| `gadlytics-daily-pull` | 08:30 daily | full pull for ملبي + ديمان; catches up missed days |
| `gadlytics-camp-requests` | every minute 08–23 | applies ⏳ `campchg/*` requests that `camp-apply` can't (TikTok). Proposed to slow to every 15 min or hourly — waiting for Mahmoud |
| `gadlytics-camp-refresh` | every 2 min 08–23 | handles `sys/campreq` `parts` (Khzama for ملبي, AppsFlyer + Salla for ديمان) |
| `gadlytics-snapshots` | — | disabled |

These tasks stop on a permission prompt when they hit a tool they haven't been allowed yet — open the task in the app and press **Run now** once, approve, and later runs go through.

**Waiting on Mahmoud:** live-revenue source (§28), Khzama bookmarklet vs scheduled task, `camp-requests` frequency, ROAS levels for ديمان, Meta token rotation, Run now on the scheduled tasks, TikTok app approval.

## 30) Rules learned the hard way (Nov 8–10 2026)
- **Never let an edit change anything but the requested field.** The Meta MCP `ads_update_entity` with draft mode off **force-pauses** entities that were configured ACTIVE; re-activating "paused" ones once turned on campaigns that should have stayed off (re-paused within minutes, 0 spend). Rule: read `status` first and re-activate only what was ACTIVE before. `camp-apply` calls the Graph API directly and does not force-pause — tested: MG-01741 stayed PAUSED.
- **Testing edits:** only on paused objects, and restore the original value (Snap 300→301→300, Meta 105→100→105).
- **No budget cap**, ever (season budgets up to 1,000,000 SAR/day per campaign). The page and `camp-apply` never question the size.
- **Numbers:** spend from the platforms; donations and revenue from Khzama only; platform purchases are never shown; nothing is split by estimate.
- **Paging must be ordered.** Unordered 1,000-row pages of `camp_struct` returned overlapping/missing rows → random missing statuses. Every paged query has a stable `.order(...)`.
- **iOS ghost tap:** a sheet opened by a tap received the same tap on its backdrop and closed instantly. Guard: `window.__shAt` is stamped when a sheet opens and `ACT.maClose` / `ACT.mbg` ignore backdrop taps for 600 ms; the menu sheet's links (`.ma-menu [data-a="go"]`, `.ma-acct [data-a="go"]`, `.ma-acct [data-a="profEdit"]`) close the sheet in a capture listener before navigating. The 🔔 in the account row first pointed at «لوحتي»; fixed (Nov 10, build 20261110102900) to open the التنبيهات screen.
- **Every feature ships with phone (≤ 760), iPad (761–1180) and Mac (> 1180) layouts** and is tested at 390×844, 430×932, 375×667, 820×1180, 1024×1366, 1180×820, 1280, 1440, 1920. Same link on all devices; updates arrive by the build-id check, never by a cache.
- **GitHub web upload silently drops files** if «Commit changes» is pressed before the upload finishes. Wait until `.js-upload-progress` is hidden **and** `form.js-manifest-commit-form input[name=manifest_id]` has a value, then set `input[name=message]` (dispatch `input`) and click that form's own «Commit changes». Use the Chrome profile signed in to GitHub (other profiles show «Uploads are disabled»). Verify every file afterwards by comparing `git hash-object <file>` with the blob SHA from `api.github.com/repos/mahmoudGadMediaBuyer/gadlytics/git/trees/main?recursive=1`.
- **Tab suspender** extensions freeze background tabs mid-upload; keep the upload tab in front.
- **Never copy UTF-8 text from the Mac to the iPhone through the clipboard** (Universal Clipboard / pasting into Scriptable): the widget's Arabic arrived as mojibake. Files meant to be pasted on the phone are kept **pure ASCII**, with every Arabic string written as `\uXXXX` escapes (§33.6).
- **Several tasks at once:** when Mahmoud asks for several things together, they all run in the background in parallel; the chat continues on one of them.

## 31) Changelog
| Date (2026) | Change |
|---|---|
| Nov 8 | `camp-apply` v1–v2: fast edits from the page; Snapchat connected (300→301→300 in 8.6 s / 5.4 s). `app_secrets` + `ingest` path for tokens. |
| Nov 8 | Budget cap removed everywhere (up to 1,000,000 SAR/day). |
| Nov 9 | Meta connected (`META_TOKEN`, 60 days, renew before Jan 7 2027); `camp-apply` v3. TikTok Marketing API app «GADLYTICS» created — waiting for approval; `push_tiktok_token.py` ready. |
| Nov 9 | «تحديث الأرقام» → `camp-refresh`: today only, ~6–10 s, `ad_daily` + `camp_struct`; Khzama / AppsFlyer + Salla via `sys/campreq` parts. Matched the daily pull exactly on test days. |
| Nov 9 | Phone/iPad home-screen app (manifest, icons, safe areas, no caching service worker, build-id auto-update); same link as desktop. Budget chip on every row; edit sheets with keypad and ±10/20 % chips; pull-to-refresh. `camp_struct` paging fixed with `.order()`. |
| Nov 10 | Row metrics الصرف · التبرعات · الإيراد · ROAS under every campaign/ad set/ad. 8 KPI tiles. Period control النهارده / امبارح / يوم / 7 أيام / 30 يوم / فترة. iPhone notch / safe-area fixes. App shell (`ap-on`) for every screen on phone/iPad. |
| Nov 10 | Sidebar regrouped (شغلي · الإدارة والتحليل · المتابعة · أدوات إضافية · الفريق), same list in the phone/iPad menu. |
| Nov 10 | ROAS verdicts, 4 levels per client (ملبي 2.0 / 2.1 / 2.8). |
| Nov 10 | Bulk edit, undo («تراجع» toast + «رجّع» in the log), spend pace + full period stats, change logs inline in أداء الحملات (page-wide and per campaign). `camp-refresh` v4–v5 writes `camp_hourly`. |
| Nov 10 | Push notifications: `sw.js` (push + notificationclick only), `push` v1–v5, `push_subs`, `alerts_sent`; التنبيهات became a full screen with «سجل التنبيهات» first and «تعديل»; diagnostics line; ghost-tap guard; menu 🔔 hotfix. Enabled on Mahmoud's iPhone. |
| Nov 10 | Alerts engine `camp-alerts` v1 + `alert_snap` + cron `gad-camp-alerts` (every 5 min, 08–24 Riyadh); four alerts only (roas · spike · norev · media); new-media alerts via `media-sync`. |
| Nov 10 | Mac: «أداء الحملات» uses the iPad two-pane layout full width (list `clamp(520px,42%,820px)`, bigger text), «تفاصيل \| جدول» switch. |
| Nov 10 | README §20–§31, skill (SKILL.md + runbooks) and repo sources (`supabase/functions/*`, `tools/build.py`) brought up to date. |
| Nov 10 | `camp-alerts` v2: spike / norev use each device's own thresholds from the التنبيهات screen (`push_subs.prefs` spikePct/spikeMin/norevWin/norevMin), grouped into profiles and sent only to that profile's devices; ROAS alarm = client `roasAlarm`; norev default window 30 min (same as the page). `push` v5: `Topic` = SHA-256(tag)[0..32] (Apple returned 400 BadWebPushTopic for tag `ready`). |
| Nov 10 | `gad-api` v1 deployed (verify_jwt **on**): read-only REST + MCP for AI assistants, own SHA-256 key auth (`api_keys`), `r.html` link page for instinct; tested against 2026-05-20 (spend 190,866.44 · donations 2,122 · revenue 387,894 · ROAS 2.03). §32. |
| Nov 10 | Edits from instinct: `gad-api` v2 (1.1.0) `GET /edit/preview` + `POST /edit/apply`, new key scope `edit` (`make_api_key.py --edit`, `api_keys` check constraint + `ingest` v13), `camp-apply` v4 accepts the service role with a queued `campchg` docId, `r.html` edit mode (preview card → «تأكيد التعديل»). Tested on paused Snap MG-01380: 200→210→200 SAR, status stayed PAUSED. §32.7. |
| Nov 11 | iPhone / iPad home-screen widget (Scriptable) `widget/GADLYTICS.js`: today's / yesterday's spend · donations · revenue · ROAS from `gad-api` `/summary`, per client and per platform (widget Parameter), small / medium / large + lock-screen widgets, «تحديث» button = `POST /refresh` then redraw. Key `make_api_key.py widget --refresh` in the iOS Keychain; file is pure ASCII (Arabic as `\u` escapes) after clipboard mojibake. §33. |
| Nov 11 | Khzama live sync: Chrome extension `khzama-live/` (every 2 min, today's Khzama links → `gad-api` `POST /khzama/push`, full snapshot of the day, 50 % guard, login/error push notifications, heartbeat `sys/khzama_live` → `/summary` `data_freshness.orders.khzama_live`). `gad-api` v3 / 1.2.0, new key scope `khzama` (`make_api_key.py --khzama`; a khzama key can't read, a read key can't push), `ingest` v14 accepts `["khzama"]`. Khzama pull = screen read of `affiliateLinks` React props + `khzama_ingest.py`. |
| Nov 11 | Season mode «وضع الموسم» (§35): edge fn `season-tick` v1 (verify_jwt on) + cron `gad-season-tick` every 2 min — when `config/app.season` is active, platform spend refreshes every 2 min 24 h and `camp-alerts` also runs 00:00–07:59 Riyadh; auto start 2027-01-09 (1 Sha'ban 1448); heartbeat `sys/season`. Tested on, then left **off** (waiting for 2027-01-09). |
| Nov 11 | **Bramble look, phase 1** (§36): dark navy + violet glow, glass cards, indigo pill buttons, IBM Plex Sans Arabic; dark is the default, light still works; old Clay choice cleared once. Readability floor (12px phone / 11.5px elsewhere, no letter-spacing on Arabic, AA muted text). GSAP count-up / chart draw-in / card fade once per view open, shimmer while loading, reduced-motion respected. Bramble toasts incl. «تراجع». System health card at the end of «الإعدادات» (admins). Same content and order on every page. |
| Nov 12 | Two standing rules for parallel builds: **own tabs only** (the extension has one tab group per session — agents isolate by tab id, label tab titles, close only their own; background-tab throttling measured) and a **campaign-number lock** (`launch_numlock` + `launch_status.py number-lock`: one first Launch at a time, queue by launch order, released on the number / final state / 6 min silence). First real run of three campaigns together: Meta draft in 20 min; Snap and TikTok needed a resume. Local only. |
| Nov 12 | Launch cards: **chat with the campaign** (table `launch_msgs`, `launch-api` v3 `/say` + `draft → building`, `launch_poll` message hand-over, watcher `--msgs` + `MESSAGE` blocks, `launch_status.py say`, resume procedure and fixed rules in the skill), «حالة الحملات» shows the last message, and **build agents run on `sonnet`** (one setting at the top of `launch_dispatch.md`; `opus` if builds make setting mistakes). Local only. |
| Nov 12 | Launch cards: real progress bar «NN%» from counts (`launch_queue.progress` / `prog`, `launch-api` v2, `launch_status.py --launches/--adsets/--ads/--khzama K/N`; weights 20 / 10 / 35 / 30 + final check 5), card named by the campaign code + full name once known, picker tab «كل الحالات» (any status is selectable; nothing checks status). Local only. |
| Nov 12 | **Campaign launch from GADLYTICS** (§37, local only — not uploaded yet): new view `launch` «إطلاق الحملات» after «إدارة الحملات» (brief form for Meta / TikTok / Snapchat, validation, «قوالبي» saved templates per user, library picker with tabs by status + «حدّث المكتبة», shared launched list with live states, Mac connection state, report per campaign). Backend: table `launch_queue` (RLS + guard trigger), SQL `launch_claim` / `launch_poll`, edge fn `launch-api` (verify_jwt on), key scope `launch` (`make_api_key.py --launch` → `~/.gadlytics/launch.key`), push on draft / stopped. Mac: `launch_watcher.py`, `launch_status.py`, `launch_lib.py`, runbook `launch_dispatch.md`. Dry-run tested without a real campaign; builds run as background agents of one dispatcher chat «مراقب الإطلاق» (automatic `start_session` is refused by the app); the agent hop is proven by Mahmoud's next test (§37.9). |
| Nov 13 | Docs pass for the GitHub upload: §38 launch-system field guide (extension changelog 1.1.0 → 1.4.1, architecture, measured timings, open items, Egyptian-Arabic operating guide, token-usage lessons); table of contents now lists §34.4, §34.5, §37, §38. |

## 32) AI assistants API (instinct / MCP) — `gad-api` (Nov 10 2026)

One **read-only** edge function that lets an AI assistant (instinct, Claude, ChatGPT custom actions, any MCP client) read GADLYTICS the same way «أداء الحملات» shows it. Source: `supabase/functions/gad-api/index.ts`. Deployed as `gad-api` v1 with **verify_jwt on**.

> **Not only read-only any more:** since v2 (1.1.0) a key with the `edit` scope can change one budget / bid / on-off through the `r.html` edit flow — the link only previews, and nothing changes until «تأكيد التعديل» is clicked (§32.7). Everything else stays read-only. The iPhone / iPad widget (§33) is another client of this API (`/summary` + `POST /refresh`).

Base URL: `https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/gad-api`

**Numbers follow the site's rules:** spend from the ad platforms (`ad_daily`); donations/orders and revenue from Khzama (ملبي, `khzama_link_daily`) or AppsFlyer + Salla (ديمان, `conv_daily`) — never platform purchases. A TikTok Smart+ ad counts as one ad. Verdicts use the client's `roasGood` / `roasMin` / `roasAlarm`. SAR, Asia/Riyadh. Nothing in this function writes to the ad platforms.

### 32.1 Endpoints

| Method + path | What it returns |
|---|---|
| `GET /` | Name, version, auth hint, endpoint list |
| `GET /openapi.json` | OpenAPI 3.1 spec (for ChatGPT custom actions and similar) |
| `GET /clients` | Clients (ملبي `3sa3k1k`, ديمان `dm1n4an`), platforms, order source, ROAS rules |
| `GET /summary?client=&period=&compare=` | The 8 KPI tiles with change vs the comparison period, per-platform totals, data freshness |
| `GET /campaigns?client=&period=&compare=&platform=&status=&project=&limit=` | Every campaign: spend, donations, revenue, ROAS, CPA, previous period, on/off, daily budget, verdict |
| `GET /campaign?code=MGG-03059&client=&period=` | One campaign with ad sets (status, budget, bid) and ads |
| `GET /alerts?client=&days=7` | Alerts sent (`alerts_sent`) in the last N days (1–90) |
| `GET /changes?client=&days=7` | Change log + edit requests from «أداء الحملات» |
| `POST /refresh` `{client}` | Same as «تحديث الأرقام» (today's spend/status from Meta + Snapchat, Khzama queued). Needs the `refresh` scope |
| `GET /report?client=&period=[&format=text]` | Everything on one page (HTML, RTL, no JS, < 50 KB) or as plain text — made for browsing assistants |
| `POST /mcp` | MCP server, Streamable HTTP / JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`, `ping` |

`period` = `today` · `yesterday` (default) · `7d` · `30d` · `day:YYYY-MM-DD` · `range:YYYY-MM-DD..YYYY-MM-DD` (max 92 days). `compare` = `prev` (default, previous period of the same length) or `week` (same days last week). `client` accepts the id or the Arabic/English name (default ملبي).

MCP tools: `list_clients`, `get_summary`, `list_campaigns`, `get_campaign`, `list_alerts`, `list_changes`, `refresh_numbers` (same parameters as the REST endpoints).

### 32.2 Auth — two layers

| Header | Value | Checked by |
|---|---|---|
| `Authorization: Bearer <anon key>` | The **public** anon key from `config.js` | Supabase gateway (verify_jwt on) |
| `apikey: <anon key>` | Same anon key | Supabase gateway |
| `x-api-key: <GADLYTICS key>` | A key made with `make_api_key.py` | `gad-api` itself |

- Without the anon bearer the **gateway** rejects the call before the function runs: `401 UNAUTHORIZED_NO_AUTH_HEADER` (or `UNAUTHORIZED_INVALID_JWT_FORMAT` if the bearer is not a JWT).
- With the anon bearer but no / a wrong / a revoked `x-api-key`, the function answers `401 unauthorized` (`المفتاح غلط أو اتلغى`).
- A bearer that is a JWT (`eyJ…`) or `sb_publishable_…` is never treated as an API key.
- On GET read endpoints a **read-only** key may also go in `?key=` (the anon headers are still required). A key with the `refresh` scope is refused in a link (403).
- Keys are stored only as SHA-256 hashes in `public.api_keys` (RLS on, no policies). The function never logs or echoes a key.

**Scopes:** `read` (everything except `/refresh`) and `refresh` (adds `POST /refresh` / `refresh_numbers`; header only, never in a link).

**Rate limits:** 120 requests / minute per key → `429`; 20 failed key attempts from one IP within 10 minutes → `429` for 10 minutes; `/refresh` once a minute per key and client. A revoked key stops working within 30 s (key cache).

### 32.3 Keys — make and revoke (Mahmoud runs these in Terminal)

```
python3 ~/.gadlytics/make_api_key.py instinct            # read-only (works in r.html links)
python3 ~/.gadlytics/make_api_key.py claude --refresh    # read + «تحديث الأرقام», header only
python3 ~/.gadlytics/make_api_key.py instinct --edit     # read + edit (budget / bid / on-off) through r.html links
python3 ~/.gadlytics/revoke_api_key.py instinct
```

The key is printed **once** and copied to the clipboard; only its hash is stored (through `ingest`). Making a key with an existing name replaces the old one. Copies of both scripts are in `skill/gadlytics/scripts/`.

### 32.4 Plain link for browsing assistants (instinct) — `r.html`

A plain link cannot carry the anon header, so the direct `…/gad-api/report?key=…` URL is rejected by the gateway. Give the assistant this link instead:

```
https://mahmoudgadmediabuyer.github.io/gadlytics/r.html#key=<KEY>&client=3sa3k1k&period=today
```

- `r.html` (≈3 KB, RTL, `noindex`, no analytics) loads `config.js`, reads `key`, `client` (default `3sa3k1k`) and `period` (default `today`) from the `#hash` first, then from `?query`, calls `/report` with the anon headers + `x-api-key`, and replaces itself with the returned report.
- Put the key in the **hash** (`#key=`) — the hash is never sent to GitHub's servers. `?key=` works too but reaches GitHub's logs.
- Add `text=1` for the plain-text report (shown in a `<pre>`): `r.html#key=<KEY>&period=yesterday&text=1`.
- On failure it shows a clear Arabic message (no key, wrong/revoked key, rate limit, network).
- Read-only and **edit** keys may be used in `r.html#key=…` links (the hash never reaches a server; `r.html` sends the key in `x-api-key`). Never put a refresh or edit key in `?key=` — the API refuses it (403).

### 32.5 MCP client config

URL: `https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/gad-api/mcp` (Streamable HTTP, POST only).

```json
{
  "mcpServers": {
    "gadlytics": {
      "type": "http",
      "url": "https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/gad-api/mcp",
      "headers": {
        "Authorization": "Bearer <ANON KEY from config.js>",
        "apikey": "<ANON KEY from config.js>",
        "x-api-key": "<GADLYTICS KEY>"
      }
    }
  }
}
```

Claude Code: `claude mcp add --transport http gadlytics <URL> --header "Authorization: Bearer <ANON>" --header "apikey: <ANON>" --header "x-api-key: <KEY>"`.

ChatGPT custom action / other REST clients: import `GET /openapi.json`; it declares all three headers.

### 32.6 Test results (Nov 10 2026, temporary key `claude-test-tmp`, revoked afterwards)

`/summary?client=3sa3k1k&period=day:2026-05-20` matched the site exactly:

| | Spend | Donations | Revenue | ROAS |
|---|---|---|---|---|
| Total | 190,866.44 | 2,122 | 387,894 | 2.03 |
| Meta | 72,981.21 | 829 | 148,534 | 2.04 |
| TikTok | 98,610.68 | 1,002 | 190,339 | 1.93 |
| Snapchat | 19,274.55 | 291 | 49,021 | 2.54 |

`/campaigns` (35 campaigns, same totals), `/report` HTML and text, MCP `initialize` / `tools/list` / `tools/call get_summary` all returned correct data; `r.html` rendered the report (HTML and text) and showed the Arabic error for a wrong key.

**Timings, warm** (round trip from the Mac, 3 runs each; server time from the `x-gad-ms` header in brackets):

| Call | Round trip | Server |
|---|---|---|
| `/summary` (one day) | 1.4–2.2 s | 1.1–1.8 s |
| `/campaigns` (one day / 7d) | 1.0–1.2 s | 0.74–0.87 s |
| `/report` HTML or text | 1.4–1.6 s | 1.1–1.3 s |
| `/alerts` | 0.6–0.8 s | 0.2–0.4 s |
| `/clients`, MCP `tools/list` | 0.3–0.4 s | ~0 ms |
| MCP `tools/call get_summary` | 1.5–2.3 s | 1.1–1.9 s |

The first call to a fresh function instance (cold start) took 4.7–6.6 s. Network + gateway overhead is ≈ 0.3 s.

### 32.7 Edits from instinct (Nov 10 2026) — `/edit/preview` + `/edit/apply`

Mahmoud asks instinct on WhatsApp («خلّي ميزانية MGG-03059 ٥٠٠ ريال»); instinct opens an edit link, reads the preview card, clicks «تأكيد التعديل» and reads the result back. The edit goes through **exactly the path of «أداء الحملات»**: the same `campchg/*` doc, the same `camp-apply` call, the same change-log row, so it shows in «سجل التغييرات» and in the inline per-campaign log, and «رجّع» (undo) works on it.

**Edit link** (the key needs the `edit` scope — `make_api_key.py <name> --edit`):

```
https://mahmoudgadmediabuyer.github.io/gadlytics/r.html#key=<KEY>&client=3sa3k1k&edit=1&code=MGG-03059&field=budget&to=500
```

| Param | Values |
|---|---|
| `code` | Campaign code (`MGG-03059`) or the platform campaign id |
| `field` | `budget` (daily budget) · `bid` · `status` |
| `to` | New value in **SAR** (Arabic digits and `٥٠٠ ريال` are fine), or `on` / `off` for `status` |
| `adset` | Optional: ad-set id or name — needed for an ABO campaign with several ad sets, for `bid`, or to switch one ad set on/off |
| `platform` | Optional: `meta` · `snap` · `tiktok` when the code exists on more than one platform/campaign |

- Opening the link **never changes anything**: `r.html` calls `GET /edit/preview` and shows a card (campaign, platform, ad set or the campaign itself + CBO/ABO, current state, «من → لـ»). Only the «تأكيد التعديل» click sends `POST /edit/apply`. «إلغاء» shows «اتلغى — مفيش حاجة اتغيرت.»
- Result line (plain Arabic, `#result`): «تم ✓ … بقت X (كانت Y) — اتأكدت من المنصة · الحالة زي ما هي (موقفة)» / «مستني (تيك توك لسه مش متوصل) — …» / «مااتنفذش ✗ — …».
- Several matches → `409 choose_campaign` / `choose_adset` with the options; `r.html` lists them as links that open their own preview.

**Target resolution** (same as the page's edit cells, from `camp_struct`): CBO (or a campaign that carries a daily budget) → the campaign budget; ABO → the ad set (one ad set → picked; several → choose). `bid` → an ad set with a bid type (Meta «ROAS goal» refused). `status` → the campaign, or the ad set when `adset` is given. Lifetime budgets are refused. Budget floor 20 SAR like the page; **no upper cap** (1,000,000 SAR/day is normal). Snap USD account `961fd033-…` is converted ÷3.75 by `camp-apply` (the preview shows the USD amount).

**API**

| Call | Notes |
|---|---|
| `GET /edit/preview?client=&code=&field=&to=[&adset=&platform=]` | Read-only. Returns `from`, `to`, platform, level, `object_id`, name, state, `message_ar`, and a `confirm_token` (HMAC-SHA256 over the target + values + key id, secret derived from the service-role key, expires in 10 min). `no_change: true` (no token) when the value is already that. |
| `POST /edit/apply` `{confirm_token}` | Verifies the token (signature, expiry, same key), re-reads `camp_struct` (`409 changed` if the value moved since the preview), inserts `campchg/api<nonce>` (`status: pending`, `by: "api:<key name>"`; the nonce makes the token single-use → `409 already_used`), calls `camp-apply` with the service role, returns `result` = `applied` / `pending` / `failed` + `message_ar`, then pushes «<key name> عدّل …: من X لـ Y» to Mahmoud's devices (`push`, kind `edit`, logged in `alerts_sent`). |

- Both routes need the `edit` scope and the key in the **`x-api-key` header only** (`?key=` → 401 on these routes; an edit key in `?key=` anywhere → 403). Read key on `/edit/*` → 403.
- Limits: 30 edits / hour per key (`429`); the same object again within 15 s → `409 duplicate` (counted from the `campchg` docs, so it holds across function instances). Expired token → `410 token_expired`.
- Only the requested field is sent to the platform — a budget edit never touches status; `status: on` happens only when asked for. TikTok: `camp-apply` answers `not_configured` until the TikTok app is approved → the doc stays `pending` for the scheduled task and the answer says «مستني (تيك توك لسه مش متوصل)».
- `camp-apply` v4: besides a signed-in user it accepts the project's service-role key (server to server) — then a queued `docId` is required, and the doc's `by` is used in the change log (`api:<key name> · أداء الحملات`).

**Test (Nov 10 2026, temporary keys `claude-edit-tmp` + `claude-read-tmp`, both revoked afterwards):** paused Snap CBO campaign MG-01380 (account 828aa8bb, SAR): 200 → 210 via `r.html` (preview card → «تأكيد التعديل»), read back 210 and Snap showed `daily_budget_micro` 210,000,000 + `PAUSED`; restored 210 → 200 via the API, Snap 200,000,000 + `PAUSED`. `camp-apply` 3.5–4.5 s, apply round trip ≈ 8 s, preview 1–2.7 s warm (5.4 s cold). Duplicate within 15 s → 409; replayed token → 409; read key → 403; no key / `?key=` only → 401; tampered token → 400; expired token → 410. Push delivered to both devices. One extra edit happened by mistake during the expiry test (a token that was still valid): paused Snap ad set of YA-0013 (USD account `961fd033-…`) 187.50 → 195 SAR (50 → 52 USD) and straight back to 187.50 (read back 187.50 both times in `camp_struct`); its platform status could not be cross-checked with the Snap MCP (that account is outside the MCP's organisation), but the Snap path only re-sends the object with the new `daily_budget_micro`.

## 33) iPhone / iPad widget (Scriptable) (Nov 11 2026)

A home-screen and lock-screen widget that shows the headline numbers of «أداء الحملات» without opening the app. It is a [Scriptable](https://scriptable.app) script: `widget/GADLYTICS.js` (≈11.5 KB). It only reads `gad-api` (§32) and, when the «تحديث» button is tapped, asks `gad-api` to pull today's spend. It never edits a campaign.

### 33.1 What it shows

| Size | Content | Tap |
|---|---|---|
| **Small** | Client · platform · period, الصرف (big), the ROAS verdict pill (زوّد / كويس / راقب / إنذار) and الروز | Anywhere = refresh (a small widget has only one tap target) |
| **Medium** | «تحديث» button + `GADLYTICS · <client> · <platform> · النهارده/امبارح`, then الروز · الإيراد · التبرعات (ديمان: الطلبات) · الصرف, and a footer with «آخر تحديث h:mm» and each platform's ROAS (coloured when راقب / إنذار) | «تحديث» = refresh; anywhere else opens GADLYTICS at «أداء الحملات» (`#campperf`) |
| **Large** | Medium + a second row: تكلفة التبرع · متوسط التبرع · الميزانية · الحملات | Same as medium |
| **Lock screen** — rectangular | Client line, ROAS + spend, «اضغط للتحديث · h:mm» | Refresh |
| **Lock screen** — inline / circular | Spend + ROAS (circular: ROAS over spend) | Refresh |

Numbers follow the site's rules: spend from the ad platforms, donations / orders and revenue from Khzama (ملبي) or AppsFlyer + Salla (ديمان), ROAS colours from the client's own rules (`roas_rules`: ملبي 2.0 / 2.1 / 2.8). SAR, Asia/Riyadh. When one platform is chosen, the per-platform footer is hidden.

### 33.2 Install (what Mahmoud did, Nov 11 2026)

1. Install **Scriptable** from the App Store (free).
2. In Scriptable: **+** → new script, rename it exactly **`GADLYTICS`**, paste the whole content of `widget/GADLYTICS.js`. (The refresh links run the script by its own name — `Script.name()` — so another name also works, but keep `GADLYTICS` so all widgets point at the same script.)
3. On the Mac, make the key: `python3 ~/.gadlytics/make_api_key.py widget --refresh` (printed once and copied). Run the script once inside Scriptable (▶) — it asks «مفتاح GADLYTICS»; paste the `gad_…` key and tap «حفظ». A medium preview appears.
4. Home screen → long-press → **+** → Scriptable → **Medium** → Add Widget. Long-press it → **Edit Widget**: Script = `GADLYTICS`, **When Interacting = Run Script**, **Parameter** = see 33.3.
5. One widget per view (total, ميتا, تيك توك, سناب, ديمان…). They can be stacked on top of each other in a **Smart Stack** and swiped through.

The same steps work on the iPad (the key is per device: each device's Keychain holds its own copy).

### 33.3 Widget Parameter

| Parameter | Shows |
|---|---|
| *(empty)* | ملبي, all platforms, today |
| `meta` (or `ميتا` / `facebook`) | Meta only — `/summary?platform=meta` |
| `tiktok` (or `تيك توك`) | TikTok only |
| `snap` (or `سناب`) | Snapchat only |
| `ديمان` (or `deiman`) | The ديمان client (`dm1n4an`); the orders tile is labelled الطلبات |
| `yesterday` (or `امبارح`) | Yesterday's numbers instead of today's |

Words can be combined with a comma or a space: `ديمان,yesterday`, `meta yesterday`, `ديمان snap`. Anything not recognised is ignored (default client ملبي `3sa3k1k`, period `today`).

### 33.4 How refreshing works — and its limits

- **Automatic redraw:** the widget asks iOS to redraw it after 15 minutes (`refreshAfterDate`). **iOS decides the real timing** (it can be much later, especially in Low Power Mode or for a widget that is rarely looked at). An automatic redraw only **reads the numbers already stored** (`GET /summary`) — it never pulls from the platforms.
- **«تحديث» button (or a tap on small / lock-screen widgets):** opens Scriptable with `scriptable:///run/GADLYTICS?refresh=1&client=…&period=…[&platform=…]`. The script calls `POST /refresh {client}` — the same as «تحديث الأرقام» on the site (`camp-refresh`: **today's** spend and status from **Meta + Snapchat**), then reads `/summary` again and shows the result with «اتحدّث h:mm ✓». If the refresh fails, the error is shown in the footer instead and the stored numbers are still drawn.
- **TikTok spend is not in `camp-refresh` yet** (the TikTok Marketing API app is waiting for approval), so TikTok spend changes only with the daily pull / scheduled tasks.
- **Khzama donations and revenue come only from the Khzama pull** (scheduled task / daily pull), not from the button — right after a refresh, spend can be newer than donations, so ROAS can look low for a few minutes.
- `/refresh` is limited to once a minute per key and client; a second tap within a minute shows the API's message.
- `period=yesterday` with the button still refreshes **today's** spend on the server (that is all `camp-refresh` does); yesterday's numbers are final from the daily pull.

### 33.5 The key

- Made with `python3 ~/.gadlytics/make_api_key.py widget --refresh` → scopes **read + refresh**. It **cannot edit** anything (no `edit` scope). Making it again with the same name replaces the old one (every device then needs the new key).
- Stored only in the **iOS Keychain** (`Keychain` key `gadlytics_api_key`), never in the script file, so the file can be shared or committed safely.
- The script sends it in the `x-api-key` header (never in a URL). The **anon key** is not in the file either: on every run it is read from the site's public `config.js` (`supabaseAnonKey`) and cached in the Keychain (`gadlytics_anon`) for offline runs.
- Revoke: `python3 ~/.gadlytics/revoke_api_key.py widget` (stops working within 30 s on every device).

### 33.6 Lesson: the file is pure ASCII on purpose

The first version was copied from the Mac to the iPhone through the clipboard and every Arabic word arrived as **mojibake** (UTF-8 read as another encoding). `GADLYTICS.js` is therefore **pure ASCII**: every Arabic string is written as `\uXXXX` escapes (e.g. `"تحديث"` = «تحديث»), and JavaScript turns them back into Arabic at run time. When editing the widget:

- Write new Arabic text as `\u` escapes, never as raw Arabic letters (also inside regular expressions and comments).
- Check before publishing: `perl -ne 'print if /[^\x00-\x7F]/' widget/GADLYTICS.js` must print nothing.
- Escaping a whole file: `python3 -c "import sys;s=open(sys.argv[1],encoding='utf-8').read();open(sys.argv[1],'w').write(s.encode('ascii','backslashreplace').decode())" widget/GADLYTICS.js` (safe because Arabic only appears in string literals, regexes and comments; avoid emoji — Python writes them as `\U0001…`, which JavaScript does not read — use `\uD83D\uDD14`-style surrogate pairs instead).

### 33.7 Troubleshooting

| What you see | Why / fix |
|---|---|
| «محتاج مفتاح — اضغط هنا» | No key in this device's Keychain, or the key was revoked / replaced. **Tap the widget** → Scriptable opens and asks for the key → paste a key from `make_api_key.py widget --refresh` → «حفظ». |
| «المفتاح غلط أو اتلغى — الصق مفتاح جديد» (inside Scriptable) | The API answered 401. Paste the current key; if lost, run `make_api_key.py widget --refresh` again (replaces the old one). |
| «مش قادر أوصل للسيستم — اتأكد من النت» | No internet and no cached anon key yet. Open the script once while online. |
| Numbers look old | iOS has not redrawn the widget yet — tap «تحديث». Donations wait for the Khzama pull (33.4). |
| Tapping does nothing / opens Scriptable without refreshing | Edit Widget → When Interacting must be **Run Script**, and the script name must match. |
| Arabic shows as strange Latin characters | The file was pasted with raw Arabic in it — paste the ASCII version from the repo again (33.6). |
| Remove access from a lost phone | `python3 ~/.gadlytics/revoke_api_key.py widget`, then make a new key for the other devices. |

---

## 34) Khzama live sync (Chrome extension) (Nov 11 2026)

ملبي's donations and revenue come from Khzama only, and Khzama has no API we may call. Until Nov 11 they arrived once a day (the 08:30 pull) or when «تحديث الأرقام» queued the Khzama part. Now a small Chrome extension in Mahmoud's own Chrome keeps **today** live, every ~2 minutes.

### 34.1 How Khzama is read (the UI method)

- Page: `https://admin.molabi.sa/affiliateLinks?fromDate=D&toDate=D+1&size=1000&page=N` — `toDate` is exclusive (one day = D → D+1), dates are Riyadh. The list always shows every link (~2,435 → pages 1–3 of 1000); the date filter only changes the numbers.
- Each page gets a **full reload**; then the rows the page already loaded are read from the props of the table's React component (`memoizedProps.data` of the fiber that has `data` + `columns`) — memory only. Nothing else is touched: no network request, no cookies, localStorage, sessionStorage, tokens or headers, and no password is ever typed.
- A page counts only when the two date inputs (`DD/MM/YYYY, 03:00`) equal D and D+1, the table's `pagination.page` equals N, and the row count is 1000 / 1000 / the rest (`pagination.rows` = total links). Page id sums must differ (a stale page from an earlier URL is rejected). The «المجموع» row (`id: customRow`) is dropped.
- Rows kept: links with donations > 0 or amount > 0 → `[id, title, numberOfDonations, totalDonationAmount]`.
- From Claude in Chrome the same reader is pasted with `javascript_tool` (runbook `daily_pull.md` §2), and the rows go to **`~/.gadlytics/khzama_ingest.py DAYS.json`** (copy in `skill/gadlytics/scripts/`), which parses the titles and sends them through `ingest`.

### 34.2 The extension (`khzama-live/`)

| File | Job |
|---|---|
| `manifest.json` | MV3, «GADLYTICS · خزامى لحظي». Permissions `alarms` `tabs` `scripting` `storage`; hosts `admin.molabi.sa`, the Supabase project, `mahmoudgadmediabuyer.github.io`. |
| `background.js` | Service worker. Alarm every 2 min; keeps **one pinned tab of its own** on Khzama (re-created if closed, not auto-discarded). Loads today's pages with full reloads, runs `readKhzama` with `chrome.scripting.executeScript({world:'MAIN'})`, and only when every page validated sends `POST /khzama/push {date, complete:true, rows}`. 00:00–00:20 Riyadh: also a final pass for yesterday. Login page → `POST /khzama/status login_required`, then waits (checks every 10 min). Errors → backoff 0/2/6/14/16 min; after 3 in a row → `status error`. |
| `reader.js` | `readKhzama()` — the page reader above (the exact function that was tested on the live page). |
| `popup.html/js` | Status, today's totals as stored on the server, «سحب دلوقتي», on/off switch. |
| `options.html/js` | Paste the key (password field, «حفظ») + the same status box (last success, today's totals, last error). |
| `status.js`, `style.css` | Shared status box; Arabic RTL, no letter-spacing. |
| `key.local.json` | **Git-ignored, never uploaded.** `{"key": "gad_…"}` — read once on first run into `chrome.storage.local`; can be deleted afterwards. |

Keys: the public anon key is read from the site's `config.js`; the API key is a **khzama-scope** key: `python3 ~/.gadlytics/make_api_key.py khzama-live --khzama`. It can only call `/khzama/push` and `/khzama/status` (403 everywhere else), and read/refresh/edit keys get 403 on the Khzama routes.

Install (once): `chrome://extensions` → Developer mode → Load unpacked → `gadlytics-site/khzama-live`. Chrome must stay open and signed in to Khzama. Badge: none = OK · `!` = errors · `دخول` = Khzama needs a login · `off` = switched off.

### 34.3 Server side (`gad-api` v3 / 1.2.0)

- `POST /khzama/push` — scope `khzama`. Body `{date: today | yesterday (Riyadh), complete: true, rows: [{link_id, title, donations, amount}]}`. The server parses each title exactly like `khzama_ingest.py` (regex `^-?([A-Z]{2,4}-\d{3,6})-(?:([A-Za-z0-9_]+)-)?(\d{14}(?:~\d{14})*)-([A-Za-z]{2,3})-(.+)$` and the same fallbacks; ME→meta, TT→tiktok, SC→snap, GG→google, WhatsApp/other links null) — the parsing lives in one place. Upsert with `pulled_at = now`; `complete: true` deletes that day's links missing from the push (a full snapshot). **Guard:** refused (409 `guard`, nothing changes) when the pushed donations are < 50 % of what is stored for that day, unless stored < 5 — protects against a half-loaded page. 1 push / 30 s per key (429). Returns `before`, `stored`, `deleted`, `unchanged`.
- `POST /khzama/status` — scope `khzama`. `{state: ok | login_required | error, detail}`. login_required / error send **one** phone notification («خزامى محتاج تسجيل دخول — السحب اللحظي واقف» or the error) via `push`, at most once per state per 2 h.
- Heartbeat: `docs` `sys/khzama_live` (`last_ok_at`, `last_state`, `last_detail`, `rows`, `totals` for today, `days`, `notified`). `/summary` shows it as `data_freshness.orders.khzama_live` (`last_ok_at`, `minutes_ago`, `state`, `today`).
- Tested Nov 11 2026: 401 without a key; khzama key → 403 on `/summary`, `/mcp`, `/edit/preview`, `/report?key=`; read key → 403 on `/khzama/push`; re-push of 2026-11-10 (1 link, 1 donation, 100 SAR) → `unchanged: true`; second push within 30 s → 429; empty push over a 10-donation day → 409 guard; date outside today/yesterday → 400.

### 34.4 Campaign links «روابط الحملات» — the extension registers a build's affiliate links (v1.1.0, Nov 12 2026)

The slowest part of a campaign build was the agent filling Khzama's «إضافة» form link by link. Now `khzama-live/links.js` does it in seconds, and the agent only sends the list and reads the result.

- **Jobs:** table `launch_kz_jobs` (`launch_id`, `code`, `title` = keyword = the Parameters string, `advertiser` = TSW only, `state` queued → adding → done | failed, `error`, `link_id`, `existed`, `attempts`). RLS: signed-in users read; all writes go through two key-gated SQL functions (rpc through PostgREST with the anon key, like `launch_poll`): `launch_kz(key, id, links, takeover)` — **launch** key only; `kz_jobs(key, info)` — **khzama** key only (heartbeat + report the finished job + take the next one; one job at a time). No edge function changed for this; the khzama key is still refused by `gad-api` read/edit/refresh/mcp (403), `launch-api` (401) and `launch_poll` / `launch_numlock` / `launch_kz`.
- **Agent side:** `launch_status.py <id> khzama-links --file links.json` (a list of Parameters strings; idempotent) → `KHZAMA-LINKS QUEUED n`, or `MANUAL` when the extension is off / not updated (no heartbeat in `docs sys/khzama_links` for 100 s, or its switch is off — then nothing is queued). `launch_status.py <id> khzama-status [--wait 240] [--take-over]` → `ALL DONE`, or `MISSING <title> — reason` lines the agent registers by hand (keyword check first). `--take-over` fails whatever is still waiting so the extension can never add a title the agent is adding.
- **Extension side** (alarm every 30 s, then job after job): a **second, un-pinned tab of its own** (closed when the batch ends; the pinned donations tab is never used). Per job: load `affiliateLinks?keyword=<title>` and read the table's React props twice (same search box, «المجموع» row present) → exact title already there ⇒ done, nothing added → «إضافة» → fill `input[name=title]` + `input[name=queryValue]` (native setter + `input` + `focusout`: the form is react-hook-form and reads a field on blur) → type the advertiser in the react-select and click the option whose text is **exactly** `TSW` (`TSW-1` is listed first) → one step that checks the fields AND the form's own values (`title`, `queryValue`, `affiliateId` = the hidden input, `createCopies` false) and only then clicks «حفظ البيانات» → wait for the dialog to close → keyword search again → link id → done.
- **Guards:** title must match `^[A-Z]{2,4}-\d{3,6}-[A-Za-z0-9_~-]+$` and start with the launch's campaign number (checked on the server, in the worker and in the page step); advertiser must be TSW; never edits or deletes; no cookies/storage/tokens read. **Any failure stops the batch** (login page, missing field, no exact TSW option, form values that do not match, a save Khzama refuses): the server fails what is left and the agents take those by hand. A job taken and not reported for 2 min is re-queued once, then failed. The save click never happens later than 70 s after the job was taken.
- **Progress:** each finished job updates `launch_queue.prog.khzama` and the percentage (same 30 % weight).
- **Popup:** box «روابط الحملات» (state · last batch `MGG-… · 12/12` · last error) + its own on/off switch. Options: «وضع تجربة» — serves only is_test rows and cancels instead of saving.
- **1.4.0 (Nov 12) — campaigns side by side, and why a link took 10–15 s.** In the first run with 1.2.0 the time per link GREW inside each campaign's tab: MGG-03115's 12 links took 12.7 (with the page load) · 6.1 · 6.0 · 8.3 · 9.4 · 12.9 · 15.3 · 14.7 · 16.9 · 20.6 · 27.2 · 30.5 s, MGG-03116's 6 took 13.7 · 6.0 · 7.1 · 8.5 · 12.3 · 14.6 s, and the second campaign started fast again in its NEW tab — no reload fallback fired (every job is `done`, first attempt). So the 4–6 s target is met for the first links of a tab and lost as the background tab ages (Chrome slows a hidden tab's timers more and more as the page keeps working; a new tab starts fresh). 1.4.0: a fresh tab every `LINKS_PER_TAB = 3` links, and `LINKS_MAX_PARALLEL = 3` campaigns at once, one tab each, one link at a time inside a campaign (`kz_jobs`: `max`, `for`, `skip`, never two of one campaign). All the pre-save and no-duplicate checks are unchanged. Expected: ≈ 8–9 s per link including the extra page loads, and two campaigns no longer wait for each other.
- **Update the installed extension:** `chrome://extensions` → «GADLYTICS · خزامى لحظي» → reload (↻). The key stays (it is in `chrome.storage.local`). Version shows 1.1.0.
- **Tested Nov 12:** on the live page in a tab of mine — keyword check against MGG-03112's 12 links (exact title → 1 row, id 2545), dialog opened, both fields filled, exact `TSW` picked with `TSW-1` focused first, form values read back (`affiliateId` 4), then cancelled: **nothing was saved**. 53 automated checks (scratch `kz_ut.js`: guard, every stop, idempotency, take-over, stale job, key scopes) with a fake page + the real server and hand-made test rows (deleted). **Not tested: a real save** — the first one is the next real campaign. After Khzama was signed in again, the packaged `kzLinkStep` itself (same bytes as `links.js`, fingerprint checked in the page) was run on the live page in stub mode: read → open → fill → exact `TSW` → the pre-save check passed (and refused a wrong advertiser, a wrong title and a non-campaign title) → cancelled; the keyword search afterwards shows 0 links for the test title.

### 34.5 Launch tool «أداة الإطلاق» — the extension runs the Tamkeen launch tool for a build (v1.3.0, Nov 12 2026)

After Khzama links, the slowest part left was the agent driving `launch.tamkeen-agency.com` by hand through Claude in Chrome: about 2.4 minutes per launch (4 launches = 9.5 min). Now `khzama-live/launchtool.js` does it, and the agent only sends the inputs once and reads the results.

- **Jobs:** table `launch_tool_jobs` (`launch_id`, `seq`, `custom`, `inputs`, `state` queued → running → done | failed, `result`, `error`, `attempts`, `submit_at`) — one job per ad set (Custom). RLS: signed-in users read; writes only through key-gated SQL functions (PostgREST rpc with the anon key, like `launch_kz` / `kz_jobs`): `launch_tl(key, id, inputs, takeover)` — **launch** key; `tl_jobs(key, info)` — **khzama** key (heartbeat `docs sys/khzama_launch` with `cap: ["launch"]` + report + «may I press Launch» + take one job). Internal, not callable from outside: `launch_tl_lock` (the same number turn as `launch_numlock`, same columns, for the extension) and `launch_tl_roll` (progress: `prog.launch`, 20 %). Nothing existing was altered; an extension older than 1.3.0 never takes these jobs and the agent is told `MANUAL`.
- **Agent side:** `launch_status.py <id> tool-launch --file inputs.json` — `{"client": "Molabi", "kind": "Single|Bulk|Smart", "platform": "Meta|TikTok|Snapchat", "objective": "Conversion", "country": "SA", "creative_ids": [...], "customs": [...], "product_link": "https://…", "campaign": "New" | "Select 03114"}`; checked on the server (ملبي only, 14-digit IDs, Custom = letters / digits / underscore, platform = the request's platform, a request that already has a number cannot ask for New); taken **once** (a second call adds nothing). → `TOOL-LAUNCH QUEUED n`, or `MANUAL` / `REJECTED`. `launch_status.py <id> tool-status [--wait 180] [--take-over] [--out f.json]` → `LAUNCHED <custom>` / `RUNNING` / `WAITING` / `MISSING <custom> — reason` lines and a results file (default `~/.gadlytics/launch_queue/done/<id>.launch-results.json`): `{launch_id, campaign_no, campaign_name, complete, ad_sets: [{custom, ads: [{creative_id, ad_name, parameters, utm_url, product_link, result_id}]}], links: [every Parameters string], missing: [...], notes: [...]}` — `ad_sets` is the shape `snap/make_spec.py --results` reads, and the same file works for `khzama-links --file`.
- **Extension side** (alarm every 30 s, then job after job, one at a time): a **third tab of its own** (never the pinned donations tab, the links tab, or a tab of the user or an agent; closed when the batch ends; a tab parked by a tab-suspender is loaded again). Per job: Select launches first read the campaign's own «Campaign ads» list — an ad set that is already there is adopted, never launched twice → `/launch`, the right tab (Single / Bulk / Smart; Radix tabs switch on `mousedown`) → fill with native value setters + `input` / `change` events (Campaign ID, Platform, Objective and «Existing campaign» are Radix selects with a hidden native `<select>` — setting it and firing `change` is the path the app itself supports; Country is a popover list, clicked open and picked by its `(SA)` item) → read back that the app registered every field (the Radix select's own state, the field values, «N IDs detected», the enabled Launch button, no message in the form) → ask the server «may I press Launch?» — for Campaign = New that takes the **number lock**, held until the result is read → one page step that checks everything again and clicks Launch → wait for the result page → read every result from the page's own data (and that its rows show the same values) and compare with the inputs with `===`: Creative IDs, count, Custom (`AS:`), platform, objective, country, client, campaign, `affiliate` of the UTM = Parameters → report. Later ad sets: Campaign ID = Select → that exact number, the chosen option must start with `MGG-<n> `, and the inherited platform / objective / country must equal the brief's.
- **A submit is never repeated.** No result page and no message from the tool → the History list decides (only launches made after that submit; for New the whole campaign must be new): found → results read; not found → failed «do not launch again before reading History». A job that died after its submit mark comes back only for that History check. Any failure hands the rest of **that** campaign to the agent; an unexpected page (login, a changed form, a field that does not read back) hands **every** waiting launch to the agents. The agent's fallback is the skill's manual method, reading the tool's History first.
- **Popup:** box «أداة الإطلاق» (state · last batch `MGG-… · 4/4` · what it is doing · last error) + its own switch. Options: «وضع تجربة لأداة الإطلاق» — serves only is_test rows and never presses Launch.
- **Update the installed extension:** `chrome://extensions` → «GADLYTICS · خزامى لحظي» → reload (↻). Version shows **1.3.0**; Chrome asks nothing extra unless it disables the extension for the new site permission (`launch.tamkeen-agency.com`) — then press «Accept permission» / re-enable. No dispatcher restart: the watcher writes the new agent prompt on its next start.
- **1.3.1 (Nov 12, after the first real run — MGG-03115 Meta 4 × 3 and MGG-03116 Snapchat 2 × 3).** What worked for real: the Launch click from a background tab, the number lock (03115 then 03116), landing on the result page, the number and the name, submit → finished in 21 s and 19 s. What failed, in both: the first launch was marked «نتيجة الإطلاق مش مطابقة… الصفحة بتعرض قيم غير البيانات» for the LAST Creative ID although the tool had launched all three. Cause (measured on the live result page, read-only): for ~0.2 s after a result page first draws, its rows carry short labels — «Campaign / Ad / Product Link / Parameters / UTM» — and only then «Campaign Name / Ad Name / UTM URL», with the same values; the reader looked for the long labels only and read the landing result (the tool lands on the last launch) inside that window. Fixes: rows matched under either label; a result is accepted only when its rows agree with its data and two reads in a row are identical (rows that never agree still stop the launch, with the labels seen in the reason); the reader takes the current React tree, not the stale twin a DOM node may still point at; the pre-submit check also compares every dropdown's state with what the page itself shows (hidden `<select>` value + button text). Both real third ads pass the validation with the fix. The agents' fallback had worked (no duplicates; the `MISSING` line carried the campaign number for Select).
- **1.4.0 (Nov 12) — campaigns side by side.** `LT_MAX_PARALLEL = 4`: one loop and one tab per campaign (a fresh tab for every launch — a background tab gets slower the longer it lives), launches of ONE campaign stay one after the other (New, then Select …: the «already there» check and the result matching assume one writer per campaign, and two submits into one campaign at once cannot be shown safe without live submits). `tl_jobs` hands out one job per campaign, never two of the same (`max`, `for`, `skip`); an older extension keeps the one-at-a-time behaviour. **The number lock is held only from the New submit until the number is read** on the result page (the extension reports it at once with `num`; the ads are read and checked after that): seconds per campaign, and everything else — opening the tab, filling, the pre-submit check — runs without it. The card says «مستنية دورها في حجز رقم الحملة» only when a wait really lasts more than 5 s (`launch_queue.numlock_since`; same rule for the manual `launch_numlock`). A Select launch that follows a launch of the same loop skips its own «already there» page load (the list was read seconds ago). Two alarms half a period apart start new work within 15 s instead of 30. **Testing rule (learned the hard way, Nov 12 21:28: two real requests waited ~2 min behind 42 hidden test rows, and then ~2 min more behind a server change the installed extension could not handle):** test rows in `starting` / `building` DO count against the parallel limit and share the number turn — so the worker suites run on an in-memory server (`MOCK=1 node lt_ut.js off`, `MOCK=1 node kz_par_ut.js`), never with `building` test rows on the live table; a server change must keep the installed extension's call shape working and is applied only when no real request is queued, starting or building. Test extensions have their own heartbeat docs (`sys/khzama_launch_test`, `sys/khzama_links_test`). A guarded migration that makes hidden test rows not count and gives tests their own number turn is written but NOT applied (`mig_tests_never_count.sql` — it needs Mahmoud's approval).
- **1.4.1 + the Mac side (Nov 12, after the second real run — MGG-03117 Snapchat 2 × 3, MGG-03118 Meta 4 × 3, all 6 launches by the extension: 26 s for New, 16–19 s per Select).** What was left was waiting, not work: (1) **Khzama links are chained** — `tool-launch --wait N` / `tool-status --wait N` send each ad set's Parameters strings to `launch_kz` the moment that ad set is done (`KHZAMA-LINKS AUTO <custom>`, then `KHZAMA-LINKS QUEUED AUTO`; a title is never queued twice; `NOT-AUTO` → the agent runs `khzama-links --file` as before; `--no-chain` switches it off), so the links start while later ad sets still launch instead of after the agent's next step; (2) **one command** — `tool-launch --file f --wait 100` submits and waits (polls every 1.5 s; `khzama-status` every 2 s); (3) **the agent starts with the launch** — the watcher reads the page-written «Tamkeen Ads Manager Level» block into `launch_queue/done/<id>.inputs.json` (`tool_inputs`: strict — any line that is not the page's format, or a count that differs from the request → no file) and puts an item 0 at the top of the prompt: compare the file with the brief, submit it first, read the skill while the extension launches. The watcher itself submits nothing. (4) **Khzama tab change without a pause** — while the last link of a tab is being added, the next tab already loads the campaign list (`linksWarm`, read-only), so the fresh-tab rule costs no page load between links.
- **Tested Nov 12:** the packaged page function (same bytes, fingerprint checked in the page) on the live tool in a tab of mine, **never submitted**: Bulk / New / Snapchat with 3 IDs, Custom and link → every field registered, «3 IDs detected», Launch enabled, pre-submit check passed and refused a wrong Custom / platform / country / mode / link / ID count; Country changed to AE and back; Bulk / Select → `03112` chosen exactly, option text `MGG-03112 | …`, platform / objective / country inherited (Meta) and locked; Smart (4 IDs, TikTok) and Single (no Custom) the same; a real result page, its «Campaign ads» list (12 of 12), another result opened in place and the History list (50 rows with times) read. Worker loop: 74 checks (64 + 10) with a fake launch-tool page, the real server rpcs, a temporary khzama key and hand-made test rows (all deleted afterwards): New + number lock (waits while another build holds the turn), Select → the exact number, results validated, stop on a mismatch / login page / changed field, a dropped Creative ID, no second submit when the tool does not answer (History decides), an ad set already in the campaign adopted, a job that died after its submit, pause, take-over, switch off, a parked tab, stub mode, key scopes. **Not tested: a real submit** — the first one is Mahmoud's next campaign.

## 35) Season mode «وضع الموسم» (Nov 11 2026)

During the season (Ramadan 1448) spend moves fast and money is spent at night too, so the numbers must stay fresh around the clock. Season mode does two things, and nothing outside the season changes:

1. **Platform spend every 2 minutes, 24 hours a day**, for every client in `config/app.clients` (ملبي `3sa3k1k`, ديمان `dm1n4an`): `camp-refresh` `{client, from: today, to: today}` (Riyadh day) with the service role, one client after the other so one failing never blocks the other. Between 00:00 and 00:10 Riyadh the first tick also re-reads yesterday once (`from: yesterday`). Meta + Snap today; TikTok answers `not_configured` until the TikTok app is approved.
2. **Alerts 24 hours.** The normal cron `gad-camp-alerts` (`*/5 5-20 * * *` UTC = 08:00–23:59 Riyadh) is unchanged. In season mode `season-tick` also calls `camp-alerts` during 21:00–04:59 UTC (00:00–07:59 Riyadh) every ~5 minutes (UTC minute % 5 < 2, at most once per 3 min) with `{force: true}` — camp-alerts skips those hours otherwise. New-media (Airtable) alerts keep their 15-minute cadence (`only` without `media` on the other ticks). Each device's own delivery / quiet hours in the التنبيهات screen still apply.

Read-only on the ad accounts: the only platform traffic is the reads `camp-refresh` already does — no writes, no budget changes.

### 35.1 Switch

`docs` `config/app` key `season`:

```json
{"auto_start": "2027-01-09", "on": false, "off": false, "label": "رمضان 1448", "note": "…"}
```

Active = `!off && (on || today(Riyadh) >= auto_start)`. **Auto start: 1 Sha'ban 1448 (Umm al-Qura) = 2027-01-09.** If the key is missing, `season-tick` still uses 2027-01-09.

| Mahmoud says | SQL (always a merge — never overwrite config/app) |
|---|---|
| «فعّل وضع الموسم» | `update docs set data = data \|\| jsonb_build_object('season', (data->'season') \|\| '{"on":true,"off":false}'::jsonb), updated_at = now() where path = 'config/app';` |
| «وقّف وضع الموسم» | same with `'{"on":false,"off":true}'` — stays off even after 2027-01-09 |
| back to automatic | same with `'{"on":false,"off":false}'` |

✅ Fixed Nov 11 (season-tick v2): the season config now lives in its own doc `config/season` (coll `sys`), not inside config/app, because the site's settings save (`normalizeCfg` → `Store.setConfig`) rewrites config/app with only the keys it knows. The old `config/app.season` key is ignored.

### 35.2 `season-tick` + cron

- Edge function `season-tick` v1, `supabase/functions/season-tick/index.ts`, **verify_jwt ON**. pg_cron job `gad-season-tick` (jobid 2), `*/2 * * * *`, `net.http_post` with the anon key header — the same command as `gad-camp-alerts`, only the URL differs.
- Inactive → one small read and returns (`{active:false, why:"waiting for 2027-01-09"}`, ~0.2–0.5 s inside the function).
- Guard: skip if the last tick started < 90 s ago and is still running (`overlap`), or finished and started < 60 s ago (`throttled`) — repeated calls with the public anon key are harmless.
- Heartbeat `docs` `sys/season`: `active`, `why`, `running`, `started_at`, `last_tick_at`, `ms`, `ok`, `clients.{id}` (`ok`, `ms`, `fn_ms`, `from`, `to`, `spend` per platform, `errors`), `last_alerts_at`, `last_alerts`, `ticks`, `yesterday_done`, `last_error_at`; marked `active:false` + `stopped_at` once when the season goes off.
- Test hook: body `{"probe_alerts": true}` also calls `camp-alerts` with `dry: true` (evaluate only, nothing sent).
- Check: `select data from docs where path = 'sys/season';` and `select * from cron.job_run_details where jobid = 2 order by start_time desc limit 5;`

### 35.3 Tested Nov 11 2026

- `on: true` → one call with the anon bearer: 15.4 s total — ملبي 7.96 s (camp-refresh 7.76 s), ديمان 3.29 s (3.26 s), dry camp-alerts probe 2.76 s; `camp_struct.updated_at` moved for both clients on Meta + Snap, heartbeat written. Today's spend was 0 on Meta and Snap for both clients (no `ad_daily` rows for the day, so `pulled_at` could not move).
- Cron tick 11:30 UTC: `succeeded`; tick ran 14.9 s (ملبي 12.2 s, ديمان 2.45 s), `ticks: 2`.
- Back to `on: false` → `active:false, why:"waiting for 2027-01-09"` in 214–490 ms (function) / 0.5–0.8 s (round trip).
- Cron tick 11:32 UTC with the season off: `succeeded`, function answered 200 about 1.3 s after the cron fired (cold start); `sys/season` shows `active:false`, `stopped_at` 11:30:49 UTC.

## 36) Design system «Bramble» (Nov 11 2026 — phase 1 of 3)

Mahmoud approved the Bramble look (prototype `gadlytics-design/bramble-me.html`) for the whole system. **Rule: same content, same order as before — Bramble is a restyle only.** No section was added, removed or moved on any page (لوحتي keeps pmHead → new media → «حدّث كل حاجة» → KPI tiles → chart → platforms + «محتاج تدخلك» → campaign table → brief → عملائي النهارده → مهامي → mentions → task mentions → approvals → team).

**Where it lives.** One static block `<style id="bramble">` right before `<div class="shell">` in `mediabuyer-console.html` (moved to the end of `<body>` at start-up so it always wins), plus one JS block `/* ══ Bramble: حركة + شيمر + صحة السيستم */` right before `/* 20. الإقلاع */`. Dark selectors are scoped `html[data-theme="dark"]:not([data-skin])`, so light mode and an explicitly chosen Clay skin keep their old CSS.

**Theme.** Dark is the default (`applyTheme`: anything but `"light"` → `data-theme="dark"`, mirrored to `localStorage gad.theme` and applied by a tiny inline script before the app loads, so there is no light flash). The theme button toggles dark ↔ light. On first load after the change, an old Clay / Clay+Glass choice is cleared once (`localStorage gad.bramble` = done); picking Clay again in Settings → Display still works. Skin list: «Bramble (الافتراضي)» / Clay / Clay + Glass.

**Tokens (dark).**

| Token | Value | Use |
|---|---|---|
| `--ground-0` | `#090C1C` | page (navy) + violet glow at the bottom (`body::before`) |
| `--ground-1` / `--ground-2` | `#10152D` / `#151B38` | cards / raised controls |
| `--bm-card` | white 2.8%→0.8% gradient over `#10152D` | glass cards |
| `--line` / `--line-2` | `rgba(160,170,255,.11)` / `.18` | 1px card borders / inputs |
| `--ink` / `--ink-2` / `--ink-3` | `#EEF0FF` / `#C2C7E8` / `#9CA2CC` | text; muted `--ink-3` is ≈6.5:1 on cards (WCAG AA) |
| `--accent` / `--cyan` | `#7C78FF` / `#8B87FF` | indigo accent, active nav, focus ring, primary pills |
| `--good` / `--bad` / `--warn` | `#3DDC97` / `#FF6B6B` / `#FFC15A` | delta chips, verdicts |
| `--c-rev` / `--c-sp` | `#A3A0FF` / `#E7E9FF` | chart colours: revenue violet, spend white-blue (light mode falls back to teal / blue) |
| `--r` | `14px` | card radius |
| `--f-ui` | IBM Plex Sans Arabic → Almarai → Cairo | Arabic UI font (Google Fonts) |

**Components.** Sidebar = dark rail with icons + labels, same groups (شغلي → الإدارة والتحليل → المتابعة → أدوات إضافية → الفريق → الإعدادات), active item tinted with an accent bar. Top bar = search, client picker, bell with red count, language/theme, avatar (unchanged content). Cards = glass, 1px faint border, 14px. Primary buttons (`.btn-p`) = indigo gradient pill; other buttons = faint outline. KPI tiles = small muted label, big number, green/red delta chip, sparkline. Toasts = dark pill with a green ✓ (or red ! for errors); the «تراجع» undo toast of أداء الحملات (`#toastAct`) uses the same style. Phone/iPad app shell (`.ma`, `.ap`) gets the same tokens, borders and font; layout, breakpoints and safe areas untouched.

**Readability minimums.** Every `font-size` below 12px in the file became `max(var(--fs-min),Npx)`: `--fs-min` = 11.5px on iPad/Mac, **12px on phone (≤760)**; table cells and task/mention text ≥13px on phone. `letter-spacing: normal` on everything except the Latin «GADLYTICS» wordmark. Line-height 1.6 body / 1.65 hints / 1.35 headings. Numbers keep `.num` (LTR, isolated, tabular).

**Motion (GSAP 3.12.5 from cdnjs, `async`).** `bmMotion()` runs at the end of `render()` but animates **once per view open** (key = view + client + settings tab + app mode): cards fade/slide in, KPI numbers count up (`.pm-kv .num`, `.kpi-v`, `.ma-k b`, `.ma-strip b`, `.tv-stat b` — the original text is restored at the end), charts draw in left→right (clip-path on `.ch-p svg`), progress bars grow. Every call checks `window.gsap` first, so if the CDN fails nothing animates and nothing breaks. `prefers-reduced-motion: reduce` turns all of it (and the shimmer) off. Boot shows a shimmer skeleton (`bmSkel()`) instead of «جارِ التحميل…». Safety: if the tab is hidden nothing animates, and 2.5 s after every view open all tweens are forced to their end state (`progress(1)`) — a throttled/background tab can never leave a card faded or a number stuck at 0.

**System health (admins, end of «الإعدادات», every tab).** `sysHealthCard()` reads existing data only and never throws: Meta token days left (constant `META_TOKEN_EXP = 2027-01-07`; the token in `app_secrets` isn't readable from the browser), Khzama live last success (`sys/khzama_live.last_ok_at` + `last_state`), season mode (`config/season` + `sys/season.active`/`last_tick_at`), last platform pull (max `ad_daily.pulled_at`, falls back to the last `date`), TikTok «التطبيق اترفض — مستني تقديم جديد». Missing docs show «—». «↻ حدّث» reloads it.

**Gotchas fixed on the way.** `.sel` is also the class of the selected campaign row in أداء الحملات, so the Bramble select-arrow/background rules target `select.sel` only (a plain `.sel` rule painted giant chevrons over the selected row). The sign-in screen `#gad-login` (built by `supa-db.js`) is restyled from the source CSS (it showed dark inputs in a white card under `color-scheme: dark`). «تحديث السيستم» on the phone: `.rf-top>div:first-child{flex:1 1 260px}` so the text wraps under the buttons instead of one word per line.

**Kept exactly as before:** every view, ACT handler and data source; breakpoints phone ≤760 / iPad 761–1180 (`html.ma-on`) / Mac >1180 (`html.ma-desk`); the 600 ms ghost-tap guards (`window.__shAt`); notifications as their own view `push`; no caching service worker + the build-id auto-update; pinch zoom; notch safe areas; the «بيانات تجريبية» banner.

**Phases.** Phase 1 (this): global look + لوحتي. Phase 2: أداء الحملات (polish of `.ma-*` / desktop table in Bramble). Phase 3: other pages + polish.

## 37) Campaign launch from GADLYTICS «إطلاق الحملات» (Nov 12 2026)

Mahmoud fills the campaign brief in GADLYTICS — on the Mac, the iPad or the iPhone — and presses «اطلق». His Mac then starts building it: one background agent per campaign inside a single Claude Code chat on the Mac («مراقب الإطلاق»), which builds that campaign as a **draft** with the `tamkeen-launch` skill. The page shows every campaign's live state, and a push notification arrives when it is ready or when it stops. Rules are the skill's own and unchanged: **ملبي only, videos only, draft / paused only, never publish or activate.** The page itself never talks to an ad platform, the launch tool or Khzama.

```
page «إطلاق الحملات»  ──insert──▶  launch_queue (Supabase, behind the GADLYTICS login)
                                        ▲ state / step / campaign no / report          │ rpc launch_poll (every 2 s)
                                        │                                               ▼
        launch_status.py ──▶ launch-api /status ──▶ push          launch_watcher.py  (on the Mac, no model calls)
                 ▲                                                     │ LAUNCH block (id + agent prompt) · UPDATE lines (news)
                 │                                                     ▼
   background agent (tamkeen-launch)  ◀──── Agent tool ────  «مراقب الإطلاق» — the dispatcher chat (prints the news + reports)
```

### 37.1 The page (view `launch`)

- Sidebar group «الإدارة والتحليل», right after «إدارة الحملات»; same place in the phone / iPad menu. Deep link `?p=launch&lc=<request id>` opens the page on that campaign (the push notification uses it).
- **Form** = the skill's brief, three blocks per platform (Meta / TikTok / Snapchat): «Tamkeen Ads Manager Level (airtable)», «Campaign- Adset Level», «AD Level». Fields, defaults and mandatory marks come from `tamkeen-launch` (`SKILL.md` «The brief», `template.md`, `template-snapchat.md`). Launch kind follows the platform (TikTok = Smart, Snapchat = Bulk, Meta = Single / Bulk by the number of videos). Custom chips with quick sets (مدن · CPA25–50 · SV + Story); Snapchat chips carry the ad type (Single Video / Story).
- **Validation** blocks the launch only for the skill's mandatory fields (client must be ملبي, 14-digit Creative IDs with no duplicates, kind limits, link, Customs, performance goal, budget, age / gender, text / headline / CTA…). Everything else is a note (title vs platform, goal vs bid strategy, CPA Customs, city Customs, a video's licence — never its status).
- **«اطلق»** (also ⌘/Ctrl + Enter) inserts ONE row into `launch_queue` and clears the form, so the next brief can be filled at once. Each press starts its own campaign; there is no list to collect first. The row holds the exact brief the build works from («البريف» on the card shows it).
- **Top row:** «قوالبي» · «كرّر آخر حملة» · «قالب فاضي» · «الصق بريف جاهز» (a pasted brief fills the form).
- **«قوالبي» (saved templates).** «احفظ القالب الحالي» saves the form under a name; the chips under «يتغيّر كل مرة» mark the fields that are saved **empty** (default: campaign title + Creative IDs; any field can be ticked). Picking a template fills the form with everything else. Each template can be renamed («اسم»), updated from the current form («حدّث»), duplicated («كرّر») and deleted («احذف», two taps). Stored per user at `docs` `data/users/<auth uid>/lctpl_<id>` — the row policy of `docs` lets only that user read or write the path — so they follow him to every device.
- **Library picker** («اختار من المكتبة») reads the same `media` table as «مكتبة الكريتيف» (ملبي, `kind = Video`). Three tabs, defined by **one constant at the top of the module**:
  ```js
  const LC_PICK_TABS=[{status:"معتمد للتشغيل", …},{status:"تم التقييم", …},{all:true,label:"كل الحالات", …}];
  const LC_LICENSE_OK=["فعال","لا يتطلب"];
  ```
  «معتمد للتشغيل» is the default tab (empty state «مفيش فيديو معتمد للتشغيل دلوقتي — اعتمده من Airtable ودوس حدّث»), then «تم التقييم», then «كل الحالات» — every ملبي video with its status as a small label (first 300 shown; the search box finds the rest by ID, influencer or product). **Any video is selectable whatever its status** (Mahmoud, Nov 12: he launches on any status). The licence is shown on every row and one outside `LC_LICENSE_OK` gets a ⚠ — information only. **Nothing in the page, the watcher prompt or the skill checks or blocks on status**, and **pasted IDs are always accepted**. «حدّث المكتبة» runs the existing `media-sync` edge function (Airtable → `media`) and reloads the list.
- **«الحملات اللي اتطلقت»** = the shared queue (all devices). Each card:
  - **Name.** Until the launch tool answers, the brief's title line («Meta - Value») is the card title. As soon as the campaign number and name are known, the **campaign code** (`MGG-03xxx`) becomes the big title, the full campaign name (`MGG-… | CL:Molabi | PR:… | VR:… | OB:… | GE:…`) sits under it, and the brief title moves to a small secondary line. The dispatcher chat, «حالة الحملات» and the push title use the code the same way.
  - **Progress.** A bar + «NN%» next to the step label while «بتبدأ» / «بتتبني» (animated with `transform: scaleX`, from the last value shown to the new one); 100 % and green on «جاهزة درافت»; frozen at its last value on «وقفت». The number is `launch_queue.progress`, computed by `launch-api` from the counts the build reports (§37.5). Rows without it fall back to the step number ÷ 4.
  - **Chat with the campaign** («كلّم الحملة», under «التقرير», on cards that are «بتتبني», «وقفت» or «جاهزة درافت»): the thread in bubbles (his messages and the campaign's replies), a text box and «ابعت» (Enter sends on the Mac, Shift+Enter = new line), and on a stopped card three quick replies — «كمّل من مكان ما وقفت» · «رفعت الفيديو — كمّل» · «الغي الباقي وسيبها زي ما هي». A message is marked «مستني المراقب» until the Mac picks it up, then «وصلت للمراقب»; with the Mac off it says «الماك مش متصل — الرسالة هتستنى لحد ما يتصل», and when the connected dispatcher is an older one that does not take messages: «المراقب الشغّال مش بيسمع الرسايل — وقّفه وشغّله تاني» (the heartbeat carries `msgs`). What is being typed survives the list's live refresh (text, focus and caret).
  - State chip (في الطابور · بتبدأ · بتتبني · جاهزة درافت · وقفت · اتلغت), elapsed minutes, stop reason, «التقرير» (the build's Arabic report, loaded on demand), «البريف», «كرّر», and «إلغاء» — **queued requests only**; a claimed or running build can't be cancelled from the page («تراجع» for 8 s puts it back). «امسح السجل» hides finished rows (soft: `hidden = true`).
- **«أقصى عدد يتبني مع بعض»** 1–10 (default 7) is stored in `docs` `config/launch` and enforced by the server at claim time; extra requests stay «في الطابور» and start by themselves when a slot frees.
- **Mac connection.** The watcher's heartbeat is `docs` `sys/launch_mac` (`at` in ms, written every ~6 s). The page shows «الماك متصل» when it is younger than 30 s; otherwise **«الماك مش متصل — الحملة هتستنى لحد ما يتصل»** (amber, on the form on phones and above the list everywhere, and on each queued card). A request sent while the Mac is off is not lost — it is claimed as soon as the watcher is back.
- **Live updates** by polling, the site's usual pattern: every 2.5 s while anything is queued / starting / building, else every 8 s; paused while the tab is hidden.
- **Layouts:** Mac > 1180 two columns (form + sticky list); iPad 761–1180 two narrower columns inside the app shell; phone ≤ 760 one column with a fixed bottom bar (tabs «القالب» / «اتطلقت» + «اطلق»), modals as bottom sheets, 44 px targets, 16 px inputs. Bramble tokens only, no new font. iOS rules kept: modals stamp `window.__shAt` and ignore backdrop taps for 600 ms; no service-worker caching; safe-area insets; and while a field of the form has focus the site's `render()` leaves the page's DOM alone (so the phone keyboard never closes under a background refresh).
- Hidden helper: `?lctest=1` adds «اختبار ربط (من غير حملة)» under the list — it queues a fixed, harmless test request (no campaign) to check the whole chain.
- Code: `<style id="lc-css">` (classes `lc-…`) before `<style id="bramble">`, and the module `const LC=(function(){…})()` before `function render()` in `mediabuyer-console.html`; actions are `ACT.lc…`; `render()` calls `LC.mount()` after drawing the view.

### 37.2 Table `launch_queue` (private)

| Column | Notes |
|---|---|
| `id` | text, made by the page (`^[a-z0-9]{8,24}$`) |
| `client`, `client_id`, `platform`, `title`, `kind`, `n_videos`, `n_adsets`, `n_ads` | what the card shows |
| `brief` | the full brief text the build works from (20–20,000 chars) |
| `form` | the form as JSON («كرّر») |
| `state` | `queued` → `starting` → `building` → `draft` \| `stopped`; `cancelled` |
| `step`, `step_no` | step label + 0–5 |
| `numlock`, `numlock_at` | the campaign-number turn: `waiting` / `held` / `done` and when it last asked |
| `progress`, `prog` | percentage 0–100 and the counts it was computed from (`{launch:[k,n], adsets:[k,n], ads:[k,n], khzama:[k,n]}`) |
| `campaign_no`, `campaign_name`, `stop_reason`, `report`, `has_report` | from the build (`launch_status.py`) |
| `session_title`, `session_id` | unused since builds run as agents of the dispatcher chat (kept for a build that runs in a chat of its own) |
| `is_test`, `hidden` | test request / removed from the list |
| `created_by`, `created_by_name`, `created_at`, `claimed_at`, `started_at`, `finished_at`, `updated_at`, `notified_at` | |

**Table `launch_msgs`** (the card's chat): `id`, `launch_id` → `launch_queue` (cascade), `who` (`user` | `agent`), `body`, `created_at`, `handled_at` (when the watcher handed a user message to the dispatcher), `created_by`. RLS: `select` + `insert` for `authenticated` only, **no update and no delete policy**, no grant for `anon`; the insert policy requires `who = user`, the caller's uid and an existing request in `starting` / `building` / `draft` / `stopped`; trigger `launch_msgs_guard` forces `who = user`, `handled_at = null`, the uid, and at most 2000 characters. Agent replies are inserted by `launch-api /say` (service role). Tested from the signed-in page: forging `who: agent` → stored as a user message; update → 0 rows; delete → 0 rows; unknown or cancelled request → refused; 2500 characters → refused; anon select / insert → 401.

- **RLS:** `select` / `insert` / `update` for `authenticated` only; no policy and no grant for `anon`, no `delete` policy at all. Insert requires `state = queued` and `created_by = auth.uid()`.
- **Trigger `launch_queue_guard`** (everything that is not the service role): on insert it forces `queued`, the caller's uid and empty result fields, and refuses a brief that is not a launch template (`^اعمل الحملة دي من تمكين ادز مانجر` + «Tamkeen Ads Manager Level») or the fixed test text; on update it lets the page change **only** `state` (queued ⇄ cancelled, and only while unclaimed) and `hidden` (finished rows) — every other column is put back. Tested from the signed-in page: forging `draft` → refused; editing `brief` / `campaign_no` → ignored; a free-text brief → refused; delete → 0 rows; anon select → empty, anon insert → 401.
- **`launch_claim(p_limit)`** (service role only): advisory lock, counts `starting` + `building`, claims the oldest `queued` rows up to the free slots (`for update skip locked`).
- **`launch_poll(p_key, p_info)`** — what the watcher calls every 2 s through PostgREST (`/rest/v1/rpc/launch_poll`, anon key): checks that SHA-256(`p_key`) is a live `api_keys` row of scope `launch`, frees stuck rows (`starting` > 10 min, `building` silent > 90 min → `stopped` with the reason), claims (`launch_claim`), writes the heartbeat when `p_info.mode = "watch"`, returns `{limit, queued, active, starting[], rows[], track[], today?, msgs[], now}` — `msgs` only when the watcher asks (`p_info.msgs`, i.e. `launch_watcher.py --msgs`): unhandled user messages of claimed requests are marked `handled_at` and returned **in the same statement**, with the campaign's code, name, state, percentage, report, brief and whole thread, so each message is handed over exactly once and a dispatcher that does not know messages never swallows one; (`track` = running rows + rows finished in the last 30 min, for the dispatcher's news; `today` only when asked, for «حالة الحملات»). It is `SECURITY DEFINER` and executable by `anon` **on purpose** (the Supabase advisor flags that): without a valid launch key it only raises `unauthorized`. Polling goes to Postgres directly so 2-second polling does not burn edge-function invocations.

### 37.3 Edge function `launch-api` v4 / 1.3.0 (verify_jwt ON; 1.3.0 adds `result_kind`)

Source `supabase/functions/launch-api/index.ts`. Base `https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/launch-api`. Headers: `Authorization: Bearer <anon>` + `apikey: <anon>` (gateway) and `x-api-key: <launch key>` (header only).

| Call | What |
|---|---|
| `GET /` | info |
| `GET /next` | the same claim as `launch_poll`, over the API |
| `GET /row?id=` | one request (light columns) |
| `POST /status` `{id, state, step?, step_no?, campaign?, name?, reason?, session?, session_id?, report?, counts?, progress?}` | `counts` = `{launch, adsets, ads, khzama}` each `[done, total]`, merged call by call; progress = **20 % launches + 10 % ad sets + 35 % ads + 30 % Khzama links** (the last 5 % is the final check: 100 only at `draft`), never going back while building, kept as is on `stopped`; an explicit `progress` overrides the computed value. Allowed moves: `starting` → `building` → `draft` \| `stopped`; `stopped` → `building` and `draft` → `building` (a build resumed after a message — the percentage continues from the counts, never from 0); `draft` → `draft` (details); `cancelled` / `queued` → 409. Reaching `draft` or `stopped` sends **one** push |
| `POST /say` `{id, text, notify?}` | the campaign's reply in the card's chat (`launch_msgs`, `who = agent`); `notify: true` also pushes «MGG-… · Platform — رد من الحملة» (for a reply that is not followed by a new final state) |
| `POST /key` `{name, key_hash}` | admin only (`x-ingest-key`, SHA-256 checked like `push` / `camp-refresh`): registers a launch-scope key. Never returns a key |

- **Why a separate function and not `gad-api`:** `gad-api` is 112 KB and deploying through the Supabase MCP means re-pasting the whole file; a typo there would break the widget and Khzama live. `launch-api` is 11 KB with the same two-layer auth. `gad-api` and `ingest` were **not touched** (`ingest` is still v14): a launch key is registered by `launch-api /key`, so the `ingest` scope whitelist did not have to change; `revoke_api_key.py <name>` works for it as for any key. `api_keys_scopes_check` now also allows exactly `{launch}`.
- **Scope isolation (tested):** launch key on `gad-api /summary` → 403; no anon header → gateway 401; no / wrong key → 401; `/key` without the ingest key → 403; `launch_poll` with a wrong key → 403 `unauthorized`.
- **Push** (`notify`): `push` `action: send`, `to: "all"` (every active row of `push_subs` — the iPhone and the iPad / Mac subscriptions), `force: true` (a finished campaign is delivered even in quiet hours), `kind: "launch"`, title `«MGG-03xxx · <Platform> — جاهزة درافت»` or `«… — وقفت»` (the request title when there is no number yet; «(تجريبي)» on tests), body = **the first line of the report** (fallback: a default sentence / the stop reason), `url = <site>?p=launch&lc=<id>`, `tag = launch-<id>`. Logged in `alerts_sent`; tapping it in «سجل التنبيهات» opens the launch page on that campaign too.

### 37.4 The Mac side (`~/.gadlytics`, copies in `skill/gadlytics/scripts` and `runbooks/`)

| File | Job |
|---|---|
| `launch.key` | the launch API key, mode 600. **Never printed, never in the repo, never in the clipboard** |
| `launch_lib.py` | shared helpers: key, anon key (from the site's `config.js`), `launch-api` calls with retries (a dropped connection is retried 2 / 5 / 10 s), `launch_poll`, the local queue files |
| `launch_watcher.py` | polls every 2 s (no model calls), keeps the heartbeat, claims requests, validates each brief again (launch template for ملبي with 14-digit IDs, or the exact test text — anything else is refused and marked `stopped`), writes `launch_queue/<id>.prompt.txt` (the agent's prompt), `<id>.brief.txt` (the brief exactly as written + the id line) and `<id>.json`, and prints `LAUNCH` blocks and `UPDATE` lines. `--dispatch` exits as soon as there is one of them (what the dispatcher runs); `--msgs` also takes the messages written on the cards and prints `MESSAGE` blocks (text, files, a ready `CONTINUE` text and a ready `PROMPT`); `--fresh` (first run of a new dispatcher chat) also hands over requests claimed earlier but never started; `--status` and `--table` («حالة الحملات») read only. One instance (`launch_queue/.watcher.pid`; a second one exits 3). Log `launch_watcher.log` |
| `launch_status.py` | `<id> starting|building|draft|stopped|show [--step … --step-no n --campaign MGG-… --name "…" --reason "…" --report-file <path> --launches/--adsets/--ads/--khzama K/N]` and `<id> say --text-file <path> [--notify]` (a reply in the card's chat). Never fails a build: prints one line and exits 0 (unless `--strict`). Any successful call also moves the request's files to `launch_queue/done/`, and a final state leaves `done/<id>.final` |
| `launch_dispatch.md` | the dispatcher chat's runbook |
| `make_api_key.py <name> --launch` | makes the key, registers only its hash, writes it straight to `launch.key` |

**The mechanism — background agents inside one chat.** A plain script cannot start a Claude build, so one Claude Code chat on the Mac is the **launch dispatcher**, «مراقب الإطلاق». Mahmoud starts it by typing «شغّل مراقب الإطلاق»; it runs `launch_watcher.py --dispatch` in the background (free while idle) and is woken when the watcher exits:

- for every `LAUNCH` block it launches **one background agent** with the Agent tool (general-purpose, fresh context, description «حملة: <title> [<id>]») whose prompt is the block's text verbatim — a short instruction block (read and follow `tamkeen-launch/SKILL.md` end to end; the saved brief file wins over the typed copy; one closed Chrome tab group of its own; draft / paused only; report with `launch_status.py`; final answer = the Arabic report), then the brief exactly as on the page, then `GADLYTICS launch id: <id>` — reports `starting`, and writes «بدأت: <title> — <platform>» in the chat;
- it restarts the watcher first on every wake-up, so new clicks keep being claimed while agents build; up to the limit (7) run in parallel;
- **Build model.** One line at the top of the runbook — `Build model: sonnet` — sets the Agent tool's `model` for every build agent (new launches, continuation agents, the connection test), whatever model the dispatcher chat runs on (Mahmoud, Nov 12, to save usage). If builds make setting mistakes, change that line to `opus`. An agent continued with SendMessage keeps its own model.
- **Messages from the card.** For every `MESSAGE` block it writes «رسالة على MGG-…: <text>», then continues the campaign's **same agent** with SendMessage when that agent is still known in the chat (it keeps its context), or starts a continuation agent with the ready `PROMPT` (saved brief + last report + conversation files; «read what already exists in the launch tool, Khzama and the platform first; build only what is missing; never duplicate a launch, a link, an ad set or an ad»), and sets the row back to `building` — the bar continues from where it was. The agent ends with `draft` / `stopped` again plus an updated report and a short `say` reply; push as before. Typing about a campaign directly in the dispatcher chat works the same way.
- **What no message can change** (in every agent prompt, the runbook and the skill): draft / paused only, never publish or activate; ملبي only; nothing is deleted unless the message explicitly asks for that specific deletion, and then only inside this campaign; no other campaign is touched; no budget cap. A message about anything outside the campaign's build gets a reply saying so, and no action.
- **Tabs: one shared Chrome group, isolation by tab id** (verified Nov 12 on the three real parallel builds and a test). The Claude in Chrome extension gives **one tab group per Claude session**: all three agents of the dispatcher chat got the same `tabGroupId` and saw each other's tabs; `createIfEmpty` does nothing once the group exists; no tool creates a second window or group; a page's `window.open` is blocked; a group cannot be named (only a separate *session* gets a separate group, and automatic sessions are refused). The builds stayed apart because each used only the tab ids it opened (TikTok 2 tabs, Meta 2, Snap 4 — no cross-use found). The rule in every agent prompt and in the skill: never use a tab that already exists, open your own (2–3), pass `tabId` on every call, label the tab title with the campaign code, close only your own at the end.
- **Background-tab throttling is real** (measured in the same Chrome): a tab that is not the front tab of a visible window reports `hidden`, a 50 ms timer fired 4 times in 3.7 s (≈ once a second), `requestAnimationFrame` gave 0 frames, a screenshot did not wake it, and even the selected tab stays hidden while its window is covered. With several campaigns in one window only one tab paints at a time — the main reason the UI builds (TikTok, Snap) are slow and hit «page is busy / timed out after 45000 ms».
- **Number lock.** One build at a time may press its first Launch with Campaign = New: `launch_status.py <id> number-lock` → SQL `launch_numlock(key, id)` (PostgREST rpc, key-gated like `launch_poll`; `launch-api` was not redeployed for it, on purpose, while real builds were running). First come first served when nobody holds it; waiters queue by launch order (`created_at`); the card shows «مستنية دورها في حجز رقم الحملة (قدامها N)» and the percentage does not move. Released when the holder reports its campaign number (`--campaign`), reaches draft / stopped / cancelled, or is silent for 6 minutes; a waiter that stops asking for 90 s leaves the queue. Later launches (Select) need no lock; `campaign-claim.sh` stays the second check. The build takes the lock only after the form is filled, so the hold is seconds, not minutes.
- for every `UPDATE` line it only writes news: «<title> أخدت رقم MGG-…» (the watcher exits when a running row's campaign number first appears), or «… وقفت: <reason>» for a stop that did not come from the agent itself (the server's time-outs);
- when an agent finishes, the chat writes «MGG-… جاهزة درافت — <platform>» + the campaign's full report, or «<title> وقفت: <reason>» + what already exists;
- «حالة الحملات» typed in that chat prints today's campaigns as a table (state, step, number, elapsed minutes); «وقّف مراقب الإطلاق» stops the watcher (running agents finish).

**No double start.** A request is printed as `LAUNCH` once, when it is claimed. A watcher restarted inside the same chat never prints it again (the `.emitted` marker); only a new dispatcher chat (`--fresh`) takes over requests that were claimed but never started; `UPDATE` lines never start anything; and each piece of news is printed once (`launch_queue/.tracked.json`). Unit-tested offline with scripted poll answers (14 checks).

**Why not sessions.** The app's auto-mode classifier refuses a `start_session` that was not asked for by the user's own words in the chat: the launch-panel mod's timer on 2026-10-19 («no verdict … the request that produced this action did not ask for one», `launch-dashboard/mod.log`), «Run now» of a scheduled task from the build session («judged dangerous»), and — in the live test of Nov 12, 13:31 — the dispatcher's own `start_session` after a watcher wake-up («the request came from an automatic event, not from the user's words in the chat»). None of these was retried or worked around; Mahmoud chose in-session agents instead. The mod, `launch-dashboard/queue/` and scheduled tasks are **not** used. The skill's «Launcher mode» (Mahmoud typing «اطلق الحملات دي …» himself → one session per block) is unchanged for when he wants separate sessions by hand.

**Permission mode.** The agents inherit the dispatcher chat's permission mode. His chats run in **Auto** (the live dispatcher chat reported `permissionMode: auto`): steps are judged by the auto-mode classifier, nothing waits for a click. In the default mode every Chrome / Bash / connector step that has no allow rule in `~/.claude/settings.json` would wait for approval (the only GADLYTICS Bash rule there is `snap_update.py`), so agents would stall — the runbook makes the dispatcher check its mode once and say so. No setting was changed.

**No auto-start is installed** (no LaunchAgent, no login item, no scheduled task). What must be running: the Claude desktop app with the dispatcher chat armed (the page then shows «الماك متصل»), and Chrome signed in. After an app restart the dispatcher must be started again.

**Local only.** Everything runs in one local chat on the Mac — no cloud session, no Remote Control (the app setting «Connect new sessions to Remote Control» is Off), no `move_to_cloud`, no artifact. The queue, the reports and the templates live only in Supabase behind Mahmoud's GADLYTICS login.

### 37.5 State reporting from the build

`tamkeen-launch/SKILL.md` has one short section, «GADLYTICS launch id»: when the brief carries the id, the build (a background agent of the dispatcher chat, or a chat of its own) reads the saved brief `~/.gadlytics/launch_queue/done/<id>.brief.txt` and trusts it over the typed prompt, as an agent skips the session-rename rule, and reports with `launch_status.py <id> building …` — one cheap command each, about 12–15 per campaign, never blocking the build:

| When | Command arguments | Weight |
|---|---|---|
| start | `--step-no 1 --step "أداة الإطلاق: الأسامي وروابط UTM" --launches 0/N` | |
| after each launch result (one launch per ad set) | `--launches K/N`; **the first one also `--campaign MGG-… --name "<full campaign name>"`** (right after `campaign-claim.sh` KEEP) | 20 % |
| ad sets created on the platform | `--step-no 2 --step "بناء الحملة على <platform>" --adsets K/N` | 10 % |
| after each batch of ads | `--ads K/N` | 35 % |
| after each Khzama batch | `--step-no 3 --step "تسجيل الروابط في خزامى" --khzama K/N` | 30 % |
| final read-back check | `--step-no 4 --step "مراجعة أخيرة"` | last 5 % |
| left as a draft | `draft --campaign … --name … --report-file <file>` | 100 % |
| any stop | `stopped --reason "…" --report-file <file>` | frozen |

The percentage is a weighted sum of the counts, so it stays right when the platform build and the Khzama batches interleave (the skill's fast path) or run in another order on another platform. The **report file** sent with `draft` / `stopped` is short Egyptian Arabic: line 1 = the result in one sentence (it becomes the push body), then «اللي اتبنى» (number and name, ad sets, ads, Khzama links, where the draft is), «المشاكل», «محتاج تراجعه», «الوقت»; a stopped run says where it stopped, what already exists and why. As an agent its final answer is that report. Nothing else in the skill changed.

### 37.6 Commands

In a Claude Code chat on the Mac (Auto mode):

| Mahmoud types | What happens |
|---|---|
| «شغّل مراقب الإطلاق» | that chat becomes the dispatcher (the GADLYTICS skill maps it to `launch_dispatch.md`); the page shows «الماك متصل» |
| «حالة الحملات» | table of today's campaigns (code, state, step, percentage, minutes, last message) |
| a message on a campaign's card, or about it in this chat | the campaign continues / changes and answers in the card's chat |
| «وقّف مراقب الإطلاق» | stops the watcher; the page shows «الماك مش متصل»; running builds finish |

Only one dispatcher at a time: stop the old one before starting a new chat (a second watcher exits with «مراقب تاني شغّال فعلاً»).

In Terminal:

```
python3 ~/.gadlytics/make_api_key.py launch-mac --launch     # make / replace the Mac's launch key (saved to ~/.gadlytics/launch.key, 600)
python3 ~/.gadlytics/launch_watcher.py --status              # key ok? limit · queued · active
python3 ~/.gadlytics/launch_watcher.py --table               # today's campaigns
python3 ~/.gadlytics/revoke_api_key.py launch-mac            # revoke it (effective within 30 s)
python3 ~/.gadlytics/launch_status.py <id> show              # one request's state
```

### 37.7 Tested Nov 12 2026 — dry run, no real campaign

No launch-tool submission, no Khzama link and no platform campaign were made. Test rows were deleted afterwards (`launch_queue` 4 rows, `alerts_sent` 4 rows, test templates).

| Check | Result |
|---|---|
| The page queues a request (the fixed test text, `?lctest=1`) | row `queued`, card «في الطابور», «الماك مش متصل — هتستنى لحد ما يتصل» |
| «إلغاء» on a queued request, then «تراجع» | `cancelled` → back to `queued` |
| Watcher claims it | within ~2 s of the watcher's first poll; card «بتبدأ», Mac chip «الماك متصل» |
| `launch_status.py` building → draft with the fake number `MGG-00000` «تجريبي» | card «بتتبني 2/4» → «جاهزة درافت · MGG-00000 · رقم تجريبي», report shown under «التقرير» |
| Push | `MGG-00000 · Meta — جاهزة درافت (تجريبي)`, body = first line of the report, delivered to 2 devices (`alerts_sent.deliveries` sent / sent) |
| Limit = 1, two requests | only the oldest claimed; the second claimed by itself (< 1 s) when the first reached `draft` |
| `stopped` with a report file, then resumed `building`, then `stopped` | accepted; push «… — وقفت»; `draft` → `building` refused (409) |
| Network blip on the final `draft` call | lost once → retries added to `launch_lib.api` |
| A second watcher | exits 3 «WATCHER-ALREADY-RUNNING» |
| A real-shaped brief from the form (fake IDs, Mac off) | inserted, brief text = the template format, cancelled 3.6 s later, never claimed |
| Templates | save (title + IDs empty) → use → rename → duplicate → update → delete, all stored under `data/users/<uid>/` |
| Picker | «معتمد للتشغيل» 0 (empty state) · «تم التقييم» 246 · «كل الحالات» 562 videos with status labels; search «نايف» → 4; a «تم التقييم» video picked with no status note |
| **Live run with the dispatcher chat (13:30)** | «شغّل مراقب الإطلاق» → page «الماك متصل»; «اختبار ربط» pressed 13:30:56 → claimed 13:30:58 → dispatcher awake and watcher restarted 13:31:07 → its `start_session` **refused** 13:31:43 («the request came from an automatic event, not from the user's words in the chat») → row marked «وقفت» with that reason, push on 2 devices. Led to the agents design (§37.4) |
| Agents design, offline | watcher unit test 14 / 14 (one LAUNCH per claim, no second hand-over on restart, `--fresh` take-over, number → one UPDATE, agent-reported finals stay silent, server-side stop → UPDATE, nothing announced twice, wrong test text refused); status flow on a hand-made row (`starting` → `building` 1/4 → 2/4 + `MGG-00000`), `--table`, page wording at 1440 and 390 |
| **Live run with agents (13:47)** | click 13:47:45 → claimed 13:47:47 → agent started → `building` 13:48:07 → `draft` 13:48:20, push on 2 devices — the Agent hop works |
| Progress + naming (hand-made row, no push) | counts 0/3 → 1/3 → 3/3 launches = 0 → 7 → 20 %; + ad sets 3/3 and ads 6/12 = 48 %; + Khzama 6/12 = 63 %; a lower count later does not move it back; card title switched to `MGG-03999` with the full name under it and «Meta - Value» as the small line; an old row without progress showed 75 % from step 3/4; the running dispatcher was not woken (test rows had no `claimed_at`). Checked at 1440 and 390 |
| Chat with the campaign (hand-made stopped row at 68 %, no real platform action) | quick reply «رفعت الفيديو — كمّل» from the page → row in `launch_msgs`, bubble «المراقب الشغّال مش بيسمع الرسايل…» (the live dispatcher was the older one); `launch_poll` with `msgs` handed it over **once** (second call empty) with one `MESSAGE` block; `building` kept 68 %, new counts moved it to 86 %; the `say` reply appeared in the thread; `draft` → 100 % + push; `draft` → `building` (86 %) → `say --notify` (push «رد من الحملة») → `draft`; typed text, focus and caret survived the live refresh at 390; RLS guards as listed in §37.2. Watcher unit tests 25 / 25. The real rows (MGG-03110 / 03111 / 03112) were not touched |
| Number lock (hand-made rows, no launch-tool submission) | B asked first → held; A, C, D → waiting 1 / 2 / 3 with the card step «مستنية دورها… (قدامها N)» and unchanged percentages; B reported `--campaign` → A (oldest waiter) got the turn, C could not jump it; holder silent 7 min → released; a waiter silent 2 min → skipped; holder set to stopped → next got it; a numbered request → «مفيش قفل مطلوب»; unknown id → `NUMBER-LOCK UNAVAILABLE` (the build carries on). Rows deleted |
| UI | 1440 / 820 / 390, no console errors; لوحتي and أداء الحملات unchanged; screenshots in `gadlytics-design/launch-live-shots/` |

### 37.8 Design decisions

- Each «اطلق» starts its campaign at once; up to 7 build together (1–10), the rest wait. Builds are background agents of the dispatcher chat, and that chat carries the news of every campaign.
- History is shared (Supabase), not per device. Drafts of the form being typed stay on the device (`localStorage gad.lc.draft`).
- «إلغاء» only cancels a queued request; it never stops a running build.
- Snapchat stays a UI draft built in Snap Ads Manager through Chrome; the launch tool stays in the browser (no API key); TikTok keeps the skill's current path (Ads Manager in Chrome; the developer app was rejected). Nothing in those paths changed.

### 37.8b First real run — three campaigns launched together (Nov 12, 14:05)

All three agents ran on Opus in one dispatcher chat, sharing one Chrome window. Times are from the agents' own status calls.

| | Meta `MGG-03112` | Snapchat `MGG-03111` | TikTok `MGG-03110` |
|---|---|---|---|
| Plan | 4 ad sets × 3 videos = 12 ads, 12 Khzama links | 2 ad sets, 8 ads planned (6 after the missing video), 8 links | 6 Smart+ ad groups, 6 ads, 6 links |
| Launch tool | ≈ 6.5 min (4 launches; campaign + ad sets created in between) | ≈ 3.5 min (2 launches) | ≈ 9.5 min (6 launches, 70–145 s each) |
| Khzama | ≈ 7 min (12 links) | ≈ 5.5 min (8 links) | ≈ 4 min (6 links) |
| Platform build | ≈ 5.5 min — connector (campaign 9 s, 4 ad sets 1 min, 12 ads 2 min + video lookup) | UI: ≈ 12 min for 1 ad set + 3 ads, stopped (video not in the Snap library), ≈ 12 min more after the resume for the Story ad set + 3 ads | UI: 14 min until the first ad group + ad existed, stopped once, 6 ad groups + 3 ads by minute 40 — still building at minute 47 |
| Final check | ≈ 1 min | ≈ 1 min | — |
| Total | **20 min, draft** | ≈ 44 min incl. a 9-min stop | > 47 min |
| Model calls / tool time | 122 calls, 81 % of the time inside tools | 252 calls, 58 % | 367 calls, 57 % |

What cost time: the two UI builds are one browser step per model call (119 and 146 `browser_batch` calls) on tabs that are throttled whenever they are not in front; page-busy / 45-second timeouts (TikTok 8, Meta 6 on Khzama, Snap 4), a «Leave site?» dialog on Snap, single batches of 70–130 s; six separate launch-tool launches for TikTok; Khzama at ≈ 35–40 s per link. No campaign-number clash happened, no tab was used by the wrong campaign, no classifier refusal. The TikTok build went straight to Ads Manager in Chrome — it did not try the connector's create tools, so whether they are still rollout-gated was not re-tested.

### 37.8c Khzama links by the extension, Snap by API (Nov 12, later)

- **Khzama links** are registered by the Chrome extension (§34.4). Agent prompt item 7 and the tamkeen-launch skill: `khzama-links --file` right after the launch results, build on the platform meanwhile, `khzama-status --wait 240` at the end, by hand only for `MISSING` / `MANUAL`. Needs the extension reloaded once (v1.1.0); until then every build is told `MANUAL` and works as before. No dispatcher restart: the watcher writes the new prompt on its next start, which happens after every event.

- **Snapchat by API (Task D).** Runbook setting **«Snap build: `api` | `ui`»** next to «Build model» (the watcher reads it and writes item 10 into every Snapchat agent prompt). `api`: `adlytics-connectors/snap/make_spec.py <id> --results f.json` → `build.py spec --dry-run` → `build.py spec` → everything created **PAUSED**, read back and compared `===`; progress lines `PROGRESS adsets K/M` / `PROGRESS ads K/N` are forwarded to the bar; `--resume` after a refused create; UI draft only as the fallback for what the API cannot express (city Custom, Message Design / Discover ON). Never activates, edits or deletes; `--delete-campaign` is manual only.
- **Ad account picker.** The Snapchat form has a mandatory «الحساب الإعلاني» (no default; «قوالبي» may keep it; «كرر آخر حملة» does not). Options come from `docs config/snap_accounts` = `{list, at}`, written by `~/.gadlytics/snap_accounts_sync.py [--refresh]` (runs `snap/accounts.py`, which lists the organisation's accounts through the API and keeps ملبي's; rpc `launch_cfg_set`, launch key). Same field names as camp-refresh's hard-coded list (`account_id`, `account_name`, `currency`, `fx`). The brief carries `Ad Account: <name> (<id>)` under «Campaign Level». Amounts are typed in SAR; for the dollar account the page shows «= $53.33» under the budget and Target Cost (÷ 3.75, the camp-apply rate) and warns below Snap's minimum (5 units of the account currency per day, from Snap's docs). Pixel, public profile and the video check are resolved on the chosen account.
- **Final wording.** `launch_queue.result_kind` (`draft` | `paused`), sent by `launch_status.py … draft --result-kind paused` (`launch-api` v4 / 1.3.0, verify_jwt ON). Cards: «جاهزة — موقوفة على سناب / ميتا» for paused (Meta rows without the field count as paused), «جاهزة درافت» for UI drafts; push title «جاهزة موقوفة».
- **Not proven:** no campaign has been created through the Snap API yet (dry runs and read-only GETs only). The dollar account is blocked until its public profile is confirmed and its videos are uploaded to its own library.

### 37.8c2 The launch tool by the extension (Nov 12, later)

- The launch tool is run by the Chrome extension (§34.5, extension 1.3.0). Agent prompt item 5 and the tamkeen-launch skill: `tool-launch --file inputs.json` before opening the launch tool, `tool-status --wait 180`, then the results file gives the campaign number and name, the ad names, Parameters and UTM URLs (also the input of `khzama-links --file` and of the Snap results file). By hand only for `MISSING` / `MANUAL` — reading the tool's History first so nothing is launched twice; the manual method with `number-lock` stays in the skill as the fallback. Needs the extension reloaded once (1.3.0); until then every build is told `MANUAL` and works as before.

### 37.8d Pause and resume a build (Nov 12, later)

A safe checkpoint, not a kill. Columns `launch_queue.pause_requested`, `paused_at`; new state **`paused`** (not counted against the parallel limit, never touched by the stale rules, no push).

- **Page:** a «بتبدأ / بتتبني» card gets «إيقاف مؤقت» → the state text becomes «هتقف عند أقرب نقطة آمنة…» (it can take a minute or two) with «الغي الإيقاف المؤقت»; a queued card gets «إيقاف مؤقت» too (it keeps its place: `launch_claim` skips it) and then «كمّل»; a paused card gets «كمّل» and «الغي الباقي» (→ `stopped`, what was built stays). Above the list: «وقّف الكل مؤقتاً» / «كمّل الكل». All of them call `launch_pause_req(id, pause | resume | cancel_rest)` / `launch_pause_all(pause | resume)` — SECURITY DEFINER, signed-in users only, and they change nothing but that flag and those transitions; a direct update of the column is still refused by the table guard.
- **Agent:** every successful `launch_status.py … starting|building` call also asks `launch_pause(key, id)`; when a pause is requested it prints `PAUSE REQUESTED …`. The agent finishes the step in hand and runs `launch_status.py <id> paused --step "…" [counts]` → state `paused`, percentage kept, number lock released. No change in `launch-api` for this (a late `building` call on a paused row gets 409 and is ignored).
- **Khzama link jobs** of a pausing / paused campaign are not taken and not dropped (`kz_jobs`), and continue after the resume.
- **Resume:** «كمّل» sets the row back to `building` («بتكمّل بعد الإيقاف المؤقت», same percentage) and writes a card message, so it travels the existing MESSAGE path: the dispatcher continues the same agent (SendMessage) or starts a continuation agent that reads what exists first.
- **Dispatcher chat:** watcher lines `UPDATE <id> pause-requested | paused | resumed | pause-cancelled` → «إيقاف مؤقت: MGG-…», «اتوقفت مؤقتاً عند NN%», «كمّلت: MGG-…»; «حالة الحملات» shows «متوقفة مؤقتاً». The dispatcher must re-read the runbook once for these lines (restart it).
- **Tested** with hand-made rows (deleted): pause → `PAUSE REQUESTED` at the next status call → `paused` at 43 % → resume → `building` at 43 % with the card message; a paused queued row was not claimed by the live watcher for minutes; pause all / resume all; cancel the rest → `stopped`, no push; direct column update refused; wrong key refused. Not tested: a real agent pausing in the middle of a real build.
- **Snapchat account default:** «الحساب الإعلاني» is preselected to the riyal account (the first SAR account of the list), changeable to the dollar one.

### 37.8e After the first real runs (Nov 12, evening)

First real runs of the new paths: MGG-03113 (Snapchat by API, 7 min, PAUSED, 6 ads, 6/6 links by the extension) and MGG-03114 (Meta, 15 min, 12/12 links by the extension at ~18 s per link; the 4 launch-tool launches took 9.5 min).

- **Step label / number lock (trigger `launch_queue_auto`, BEFORE UPDATE):** the lock is `done` the moment the row has its campaign number (it used to wait for the next campaign to ask); when a call changes the counts without a step of its own, the label follows the latest phase: «أداة الإطلاق … K/N» → «بناء الحملة على <platform> — Ad sets a/b · إعلانات c/d» → «روابط خزامى K/N (الإضافة)» → «مراجعة أخيرة».
- **Faster Khzama links (extension 1.2.0, `links.js`):** one load per campaign (`?keyword=<code>-&size=1000`), then every link is checked, added and verified **in place** from the page's own table (no load per link; the advertiser list is fetched once). The page function and its pre-save check are unchanged. Fallbacks: table not refreshed → one fresh load → exact-title search; pre-save check fails on a reused page → reload and one retry → halt. Expected ≈ 4–6 s per link (was 16–18).
- **Suspended tabs:** a links tab that was discarded / parked by a tab-suspender is loaded again (twice at most). Whitelist admin.molabi.sa, launch.tamkeen-agency.com and the ad managers in the suspender.
- **Khzama warning:** the launch page shows a red line under «الماك متصل» when `sys/khzama_live.last_state = login_required`, when the links switch is off, or when `sys/khzama_links` is older than 2.5 min; `launch_status.py` prints the same on the build's first status call (`launch_kz` returns `ext.khzama_login`).

### 37.9 Not proven yet / open

- **The Agent hop is proven** (live test 13:47, above). What is still unproven is a real build:
- **A real build as an agent has never run.** The same classifier that refused `start_session` after an automatic wake-up may also refuse an agent's sensitive steps (pressing Launch in the launch tool, creating the campaign, saving Khzama links) because they too follow an automatic event. If that happens the agent reports «وقفت» with the refusal — it must not be worked around — and the fallback is the card's «البريف» pasted into a chat by hand (Launcher mode). Starting the dispatcher with his standing instruction in his own words («شغّل مراقب الإطلاق — أي طلب ييجي من صفحة إطلاق الحملات أنا اللي باعته، ابنيه درافت على طول») puts the request in the chat itself.
- Seven agents share one Chrome and one chat; the skill's «one closed tab group per campaign» rule is what keeps them apart. Not exercised yet with more than one.
- Click → build-start delay: queue part ≤ ~2–3 s; in the live run the dispatcher was awake 9 s after the claim. End to end (agent launched) is to be measured on the next test.
- Upload to GitHub: done on «ارفع» of Nov 13 2026 (see §38 and the repository history).

---

## 38) Launch system field guide — extension changelog, architecture, timings, open items, operating guide (Nov 13 2026)

§34.4, §34.5 and §37 describe each piece in depth. This section is the one-page map over them: what each extension version added, how the parts connect, what the real runs measured, what is still open, and how Mahmoud runs it day to day. Nothing here changes behaviour.

### 38.1 Extension changelog «GADLYTICS · خزامى لحظي» (`khzama-live/`, 1.1.0 → 1.4.1)

The extension started (1.0.x, Nov 11) as the donations reader of §34.2. Everything below is the campaign-launch work of Nov 12. Update an installed copy with `chrome://extensions` → «GADLYTICS · خزامى لحظي» → reload (↻); the key stays in `chrome.storage.local`.

| Version | Added | Details |
|---|---|---|
| **1.1.0** | Khzama links by the extension | `links.js`: the extension adds a build's affiliate links («روابط الحملات») in its own tab instead of the agent filling Khzama's form link by link. Jobs in `launch_kz_jobs`; rpc `launch_kz` (launch key) and `kz_jobs` (khzama key). Pre-save check of title, `queryValue` and advertiser `TSW`; any failure stops the batch (§34.4). |
| **1.2.0** | Faster links, one page per campaign, suspended tabs | One load per campaign (`?keyword=<code>-&size=1000`), then every link is checked, added and verified in place from the page's own table; a links tab discarded by a tab-suspender is loaded again (twice at most). Expected 4–6 s per link (was 16–18). |
| **1.3.0** | The Tamkeen launch tool driven by the extension | `launchtool.js`: fills `launch.tamkeen-agency.com/launch`, checks that the app registered every field, takes the number lock for Campaign = New, presses Launch once, reads and validates every result page. Jobs in `launch_tool_jobs`; rpc `launch_tl` (launch key) and `tl_jobs` (khzama key). About 20 s per ad set instead of ~2.4 min (§34.5). |
| **1.3.1** | Result-page reader fix | A result page's rows carry short labels (Campaign / Ad / Product Link / Parameters / UTM) for about 0.2 s after it first draws, then the long ones (Campaign Name / Ad Name / UTM URL). The reader looked for the long ones only and flagged a mismatch on the last Creative ID. Now both label sets match, and a result is accepted only after two identical reads in a row. |
| **1.4.0** | Campaigns in parallel, shorter number lock | Launch tool `LT_MAX_PARALLEL = 4` (one loop and one fresh tab per campaign; the ad sets of one campaign stay one after the other); Khzama `LINKS_MAX_PARALLEL = 3` with a fresh tab every `LINKS_PER_TAB = 3` links (a hidden tab slows down the longer it works). `tl_jobs` / `kz_jobs` hand out one job per campaign (`max`, `for`, `skip`). **The number lock is held only around the New submit** — from the click until the number is read on the result page — instead of the whole launch. |
| **1.4.1** | Chained Khzama jobs, warm tab, faster agent start | (1) Khzama jobs are **chained per validated ad set**: `tool-launch --wait` / `tool-status --wait` queue each ad set's Parameters strings the moment that ad set is validated (`KHZAMA-LINKS AUTO <custom>`), so links start while later ad sets still launch. (2) A **fresh Khzama tab every 3 links** with a **pre-warmed** next tab (`linksWarm`, read-only campaign-list load) so the tab change costs no page load. (3) **Faster agent start**: the watcher writes `launch_queue/done/<id>.inputs.json` from the page's «Tamkeen Ads Manager Level» block and the agent prompt gets an item 0 — compare the file with the brief and submit it as the very first command. (4) The extension **picks up a new job within 15 s**. |

### 38.2 Architecture in one picture

```
 GADLYTICS page «إطلاق الحملات» ──insert──▶ launch_queue (Supabase, behind the login)
        ▲  card: state · % · step · chat · pause              │ rpc launch_poll (2 s) — launch key
        │  push notification when ready / stopped             ▼
 launch-api /status ◀── launch_status.py          launch_watcher.py (Mac, no model calls)
        ▲                                                      │ LAUNCH / UPDATE / MESSAGE blocks
        │                                                      ▼
 background build agent (Sonnet) ◀── Agent tool ── dispatcher chat «مراقب الإطلاق»
        │ tool-launch / tool-status / khzama-links / khzama-status / number-lock
        ▼
 Supabase jobs ◀──────────── Chrome extension (khzama key, alarm 15 s) ───▶ launch.tamkeen-agency.com
   launch_tool_jobs  (rpc launch_tl · tl_jobs)                         └──▶ admin.molabi.sa (Khzama)
   launch_kz_jobs    (rpc launch_kz · kz_jobs)
 number lock: launch_numlock (manual) · launch_tl_lock (extension) — same columns on launch_queue
```

- **Page → queue → dispatcher → agents.** The page inserts a `launch_queue` row; the watcher claims it, validates the brief again and prints a `LAUNCH` block; the dispatcher chat starts one background agent per campaign (up to 7 at once) on the model named in the runbook line `Build model: sonnet`.
- **Extension jobs.** The agent never touches the launch tool or Khzama's form when the extension is on: `tool-launch --file inputs.json [--wait N]` queues one `launch_tool_jobs` row per ad set (rpc `launch_tl`); the extension takes them with `tl_jobs`. `khzama-links` queues `launch_kz_jobs` (rpc `launch_kz`); the extension takes them with `kz_jobs`. Writes go only through these key-gated functions; signed-in users can read the tables. `MANUAL` in any answer means the extension is off, outdated or Chrome is closed — the agent then does that step by hand exactly as before.
- **Number lock.** One campaign at a time may press its first Launch with Campaign = New, so two campaigns never take the same MGG number: `launch_numlock(key, id)` for a manual launch, `launch_tl_lock` for the extension. Since 1.4.0 it is held only from the New submit until the number is read. The card says «مستنية دورها في حجز رقم الحملة (قدامها N)» only when a wait lasts more than 5 s (`launch_queue.numlock_since`).
- **Snap API build (paused).** With the runbook line `Snap build: api` a Snapchat campaign is built through the Snap Marketing API by `adlytics-connectors/snap/` (`make_spec.py` → `build.py spec --dry-run` → `build.py spec`) and left **PAUSED**, read back and compared. A mandatory «الحساب الإعلاني» picker on the page (options from `docs config/snap_accounts`, written by `~/.gadlytics/snap_accounts_sync.py`) puts `Ad Account: <name> (<id>)` into the brief; the riyal account is preselected. Never activates, edits or deletes. The builder is archived in the private repo under `snap-api/`.
- **Pause / resume** (§37.8d): card buttons «إيقاف مؤقت» / «كمّل» / «الغي الباقي», «وقّف الكل مؤقتاً» / «كمّل الكل»; the agent stops at the next safe point and reports `paused`.
- **Card chat** (§37): «كلّم الحملة» writes to `launch_msgs`; the dispatcher continues the same agent with SendMessage or starts a continuation agent that reads what exists first.
- **Progress %**: weighted sum — launches 20 %, ad sets 10 %, ads 35 %, Khzama links 30 %, final check 5 % (§37.5). The extension moves its own parts (`prog.launch`, `prog.khzama`).
- **Push notifications**: a final state («جاهزة — موقوفة» / «جاهزة درافت» / «وقفت») sends a push to the phone and iPad through the `push` function; the first line of the report file is the body.

### 38.3 Measured timings

Same two briefs each time. All times are the whole campaign, from the first agent command to the draft/paused state.

| Run | Meta (4 ad sets, 12 ads) | Snap (2 ad sets, 6 ads) |
|---|---|---|
| Browser only | 21 min | 49 min |
| Snap API + Khzama extension | 15 min | 7 min |
| Launch tool by extension with the reader bug | 11.6 min | 5.5 min |
| 1.3.1 (about 4.5 min of the measured time was test interference) | 11.9 min measured, about 7 min clean | 9.6 min measured, about 5.3 min clean |

Per-step figures from the runs:

- **Launch tool, by the extension:** 26 s for a `New` launch, 16–19 s for each `Select` launch (MGG-03117 / 03118, 6 launches). By hand it was ~2.4 min per launch.
- **Khzama links:** by hand 35–40 s per link; extension 1.1.0 ≈ 16–18 s; 1.2.0 started at 4–6 s for the first links of a tab but grew inside one tab (MGG-03115: 12.7, 6.1, 6.0, 8.3, 9.4, 12.9, 15.3, 14.7, 16.9, 20.6, 27.2, 30.5 s) because Chrome slows a hidden tab the longer it works; 1.4.0/1.4.1 (fresh pre-warmed tab every 3 links) expect ≈ 8–9 s per link including the extra loads, and campaigns no longer wait for each other.
- **Snap by API:** 7 min for MGG-03113 including 6/6 links by the extension; Meta by connector: campaign 9 s, 4 ad sets ≈ 1 min, 12 ads ≈ 2 min.
- **Click → agent running:** queue part ≤ 2–3 s; dispatcher awake ≈ 9 s after the claim (live test Nov 12).

### 38.4 Known issues and open items

- **Blocked server migration `mig_tests_never_count.sql`** — makes test rows (`is_test`) stop counting against the limit of 7 parallel builds. It changes the live database, so it waits for Mahmoud's approval; until then test rows count against the limit of 7. (The file is not in the repo; it is described here so the next session can rewrite it.)
- **TikTok create tools are rollout-gated until December** (advertiser `7338783723795595266`): TikTok campaigns are still built in Ads Manager through Chrome (slow: one browser step per call, tabs throttled when hidden). Not re-tested since the first attempt.
- **The TikTok developer app was rejected**, so there is no own-app token for TikTok; the connector is the only API path.
- **The dollar Snap account** is blocked until its public profile is confirmed (Snap's Public Profile API is not readable with this token) and its videos are uploaded to its own media library; the riyal account is the default and works.
- **City Customs cannot go through the Snap API** (the builder reports `MISSING`/exit 2 and the UI draft is the fallback for exactly those ad sets).
- **Custom names must be letters, digits and `_`** — the extension and the server reject anything else (`REJECTED`), and the launch tool's Parameters string is built from it.
- **Not proven yet:** a real agent pausing in the middle of a real build (§37.8d); a Khzama login expiry in the middle of a batch is designed to stop the batch and hand the rest to the agent, but has not happened live.
- **Scheduled tasks** are listed in §38.5; the daily pull is switched off.

### 38.5 Operating guide for Mahmoud (Egyptian Arabic)

**تشغيل وإيقاف مراقب الإطلاق**
- افتح شات جديد في Claude Code على الماك واكتب بالظبط: «شغّل مراقب الإطلاق». الشات ده بيقرا `~/.gadlytics/launch_dispatch.md` ويشغّل المراقب في الخلفية (مجاني وهو واقف). الصفحة بتكتب «الماك متصل» لما يبقى شغال.
- «حالة الحملات» (في نفس الشات): جدول بحملات النهارده، الحالة والخطوة والرقم والدقايق.
- «وقّف مراقب الإطلاق»: بيوقف المراقب، والبلدرز الشغالة بتخلّص شغلها.
- بعد أي ريستارت للتطبيق لازم تشغّله تاني، مفيش تشغيل تلقائي.

**إعادة تحميل الإضافة بعد أي تحديث**
- `chrome://extensions` ← «GADLYTICS · خزامى لحظي» ← زرار التحديث (↻). المفتاح بيفضل محفوظ. لو كروم سأل عن صلاحية جديدة (`launch.tamkeen-agency.com`) اضغط «Accept permission».
- بعد التحميل افتح البوب-أب وتأكد إن رقم الإصدار 1.4.1.

**البوب-أب: كل صندوق معناه إيه**
- **الصندوق الأول (الأرقام اللحظية):** آخر سحب ناجح لتبرعات النهارده والإجمالي زي ما اتخزّن. «سحب دلوقتي» بيسحب فوراً. مفتاح «شغال» بيوقف السحب كله.
- **«روابط الحملات»:** حالة تسجيل لينكات خزامى (شغال/مستني/واقف) + آخر دفعة `MGG-… · 12/12` + آخر خطأ. مفتاحه الخاص «شغالة». لو اتقفل الوكيل بيسجّل اللينكات بإيده.
- **«أداة الإطلاق»:** حالة إطلاق أداة تمكين (بيعمل إيه دلوقتي) + آخر دفعة `MGG-… · 4/4` + آخر خطأ. مفتاحه الخاص. لو اتقفل الوكيل بيطلق بإيده.
- العلامة على أيقونة الإضافة: بدون علامة = تمام · `!` = أخطاء · `دخول` = خزامى عايز تسجيل دخول · `off` = مقفولة.

**لما خزامى يطلب تسجيل دخول**
1. افتح `admin.molabi.sa` في كروم (في التاب المثبّت بتاع الإضافة) وسجّل دخول بنفسك.
2. الإضافة بتتأكد كل 10 دقايق، وبتكمّل لوحدها. الصفحة بتظهر سطر أحمر تحت «الماك متصل» لحد ما يتحل، وبييجي إشعار على التليفون مرة كل ساعتين بالكتير.
3. الحملات اللي شغالة وقت الانقطاع: الإضافة بتقفّل الدفعة، والوكيل بيسجّل الباقي بإيده (`MISSING`)، ومفيش لينك بيتكرر.

**المهام المجدولة والموديل المقترح** (من تطبيق Claude، بتتحدّث من مهام مجدولة)

| المهمة | الموديل المقترح | التكرار |
|---|---|---|
| السحب اليومي (`gadlytics-daily-pull`) | Sonnet | يومياً 08:30 |
| تعديلات الحملات (`gadlytics-camp-requests`) | Sonnet | كل 15 دقيقة، 08:00–23:59 |
| تحديث أرقام أداء الحملات (`gadlytics-camp-refresh`) | Haiku | كل 10 دقايق، 08:00–23:59 |
| لقطات اليوم المباشر (`gadlytics-snapshots`) | Haiku | كل 15 دقيقة، 09:00–23:59 |

حالياً كلها متوقفة حسب طلب محمود، مع ملاحظة: يوم 13 نوفمبر الجدولة كانت بتعرض السحب اليومي متوقف، وباقي الثلاثة «شغالة» في قائمة المهام، فراجعهم قبل ما تعتمد على أي واحدة.

### 38.6 Token-usage lessons

- A very long chat on Fable is expensive: every new message re-reads the whole history. Start a **fresh chat** for each new job (the memory files and the skills carry what matters), and close finished ones.
- **Background agents inherit the chat's model.** If the dispatcher chat runs on Fable/Opus, every build agent does too unless you pass `model: sonnet` to the Agent tool. That is why `Build model: sonnet` sits at the top of the runbook; do the same for any execution work (builds, uploads, data pulls). Keep the big model for design, diagnosis and review.
- Execution is cheap on Sonnet because the agents mostly call fixed commands (`launch_status.py`, `tool-launch`, `khzama-links`); the extension does the repetitive browser work with zero model calls.
- The watcher, the extension and the scheduled-task checks cost nothing while idle; only a claimed request starts a model.
