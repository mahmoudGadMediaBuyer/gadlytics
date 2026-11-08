#!/usr/bin/env python3
"""GADLYTICS «أداء الحملات» — change ONE Snapchat budget or bid with the local Snap OAuth token
(the Snap MCP connector is read-only). Only the one field is changed; everything else is sent back as it was.
  python3 ~/.gadlytics/snap_update.py campaign <campaign_id> budget <SAR per day>
  python3 ~/.gadlytics/snap_update.py adsquad  <ad_squad_id> budget <SAR per day>
  python3 ~/.gadlytics/snap_update.py adsquad  <ad_squad_id> bid    <SAR>
  python3 ~/.gadlytics/snap_update.py campaign|adsquad|ad <id> status ACTIVE|PAUSED
Add --usd for the USD account (amount is converted ÷3.75). Prints the value read back after the update."""
import json, os, sys
sys.path.insert(0, os.path.expanduser("~/Desktop/claude/adlytics-connectors/snap"))
from common import api

lvl, oid, field, val = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
if field == "status":
    if val not in ("ACTIVE", "PAUSED"): raise SystemExit("status must be ACTIVE or PAUSED")
    path = {"campaign": ("/campaigns/%s", "campaigns", "campaign", lambda o: "/adaccounts/%s/campaigns" % o["ad_account_id"]),
            "adsquad": ("/adsquads/%s", "adsquads", "adsquad", lambda o: "/campaigns/%s/adsquads" % o["campaign_id"]),
            "ad": ("/ads/%s", "ads", "ad", lambda o: "/adsquads/%s/ads" % o["ad_squad_id"])}[lvl]
    obj = api("GET", path[0] % oid)[path[1]][0][path[2]]
    obj["status"] = val
    r = api("PUT", path[3](obj), body={path[1]: [obj]})
    back = api("GET", path[0] % oid)[path[1]][0][path[2]].get("status")
    print(json.dumps({"request_status": (r.get("request_status") or "").upper(), "read_back_status": back}))
    raise SystemExit(0 if back == val else 1)
amount = float(val)
fx = 3.75 if "--usd" in sys.argv else 1.0
micro = int(round(amount / fx * 1_000_000))
if lvl == "campaign":
    obj = api("GET", f"/campaigns/{oid}")["campaigns"][0]["campaign"]
    if field != "budget": raise SystemExit("campaign: only budget can be changed")
    obj["daily_budget_micro"] = micro
    r = api("PUT", f"/adaccounts/{obj['ad_account_id']}/campaigns", body={"campaigns": [obj]})
    back = api("GET", f"/campaigns/{oid}")["campaigns"][0]["campaign"].get("daily_budget_micro")
else:
    obj = api("GET", f"/adsquads/{oid}")["adsquads"][0]["adsquad"]
    if field == "budget": obj["daily_budget_micro"] = micro; key = "daily_budget_micro"
    elif field == "bid": obj["bid_micro"] = micro; key = "bid_micro"
    else: raise SystemExit("field must be budget or bid")
    r = api("PUT", f"/campaigns/{obj['campaign_id']}/adsquads", body={"adsquads": [obj]})
    back = api("GET", f"/adsquads/{oid}")["adsquads"][0]["adsquad"].get(key)
status = (r.get("request_status") or "").upper()
print(json.dumps({"request_status": status, "read_back_SAR": round((back or 0) / 1_000_000 * fx, 2)}))
if status != "SUCCESS": raise SystemExit(1)
