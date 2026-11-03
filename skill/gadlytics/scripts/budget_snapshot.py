#!/usr/bin/env python3
"""GADLYTICS — daily budget snapshot for platforms without an activity log (TikTok until its change log rolls out, Snap).
Usage: python3 ~/.gadlytics/budget_snapshot.py FILE.json [YYYY-MM-DD]
FILE = [{"platform":"tiktok"|"snap","campaign_id":"...","name":"MGG-03041 | ...","budget":350,"status":"active"|"paused"}, ...]
       (daily budget in SAR — Snap micro-currency ÷ 1,000,000 and USD × 3.75 before writing; campaign-level budget, or the
        sum of its ad groups' daily budgets when the budget lives on the ad group).
Writes one camp_budget_daily row per campaign for the date (default: today, Riyadh). The site compares each day with the
day before, so a different budget shows up as a budget change for that day."""
import json, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone
CLIENT = "3sa3k1k"; INGEST = "https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest"
CAMP = re.compile(r"\b([A-Z]{2,4}-\d{3,6})\b")
items = json.load(open(sys.argv[1]))
day = sys.argv[2] if len(sys.argv) > 2 else (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%Y-%m-%d")
rows = []
for it in items:
    if it.get("platform") == "meta": continue          # Meta comes from its activity log with exact times
    m = CAMP.search(it.get("name") or "")
    rows.append({"client_id": CLIENT, "date": day, "platform": it["platform"], "campaign_id": str(it["campaign_id"]),
                 "camp_no": m.group(1) if m else None, "name": (it.get("name") or "")[:160], "budget_start": None,
                 "budget_end": float(it["budget"]) if it.get("budget") is not None else None, "edits": 0,
                 "status": it.get("status"), "source": "snapshot"})
print("budget snapshot %s: %d campaigns" % (day, len(rows)))
if rows and "--dry" not in sys.argv:
    key = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
    req = urllib.request.Request(INGEST, data=json.dumps({"table": "camp_budget_daily", "rows": rows}).encode(), method="POST",
                                 headers={"content-type": "application/json", "x-ingest-key": key})
    print(urllib.request.urlopen(req, timeout=60).read().decode())
