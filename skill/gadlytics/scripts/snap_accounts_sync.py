#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ملبي's Snap ad accounts → the config doc the page «إطلاق الحملات» reads (docs config/snap_accounts).

  python3 ~/.gadlytics/snap_accounts_sync.py            saved list (adlytics-connectors/snap/accounts.json), no Snap call
  python3 ~/.gadlytics/snap_accounts_sync.py --refresh  ask Snap first (accounts.py --refresh: names, currency, pixels, profiles)

The list itself is made by ~/Desktop/claude/adlytics-connectors/snap/accounts.py (one line `ACCOUNTS_JSON [...]`, no secrets);
this script only stores it with the launch key (rpc launch_cfg_set). Never fails a build: it prints one line and exits 0.
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import launch_lib as L

ACC = os.path.expanduser("~/Desktop/claude/adlytics-connectors/snap/accounts.py")
KEEP = ("platform", "client_id", "account_id", "account_name", "currency", "fx", "status", "min_daily_budget", "min_bid",
        "min_daily_budget_sar", "min_bid_sar", "pixels", "public_profiles", "buildable", "blocked_reason")
try:
    r = subprocess.run([sys.executable, ACC] + (["--refresh"] if "--refresh" in sys.argv else []), capture_output=True, text=True, timeout=120)
    line = next((x for x in r.stdout.splitlines() if x.startswith("ACCOUNTS_JSON ")), None)
    if not line:
        print("snap-accounts ✗ accounts.py ما طلّعش القائمة (exit %s): %s" % (r.returncode, (r.stdout + r.stderr).strip()[-200:])); sys.exit(0)
    rows = [{k: a.get(k) for k in KEEP} for a in json.loads(line[len("ACCOUNTS_JSON "):]) if a.get("account_id")]
    out = L._call(L.SUPA + "/rest/v1/rpc/launch_cfg_set", "POST", {"p_key": L.key(), "p_name": "snap_accounts", "p_value": rows}, with_key=False, timeout=20)
    print("snap-accounts %s: %s" % ("✓" if out.get("ok") else "✗ " + str(out.get("error")),
          " · ".join("%s (%s)%s" % (a["account_name"], a["currency"], "" if a.get("buildable") else " — موقوف: " + str(a.get("blocked_reason"))) for a in rows)))
    L.log("snap accounts synced: %s" % len(rows))
except Exception as e:                                             # never break a build because of this list
    print("snap-accounts ✗ %s" % str(e)[:200])
sys.exit(0)
