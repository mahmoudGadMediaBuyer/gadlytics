#!/usr/bin/env python3
"""GADLYTICS — spend for channels with no ad-platform connector (Apple Search Ads, Google) taken from AppsFlyer cost.
Reads conv_daily-style rows (conv_prep.py output) and writes ad_daily rows, one per (date, platform, campaign),
with iOS + Android merged.
  python3 ~/.gadlytics/conv_spend_to_ad_daily.py <out.json> <conv.json> [<conv.json> ...]
Upload <out.json> to table ad_daily. Cost is already SAR (conv_prep converts AppsFlyer USD ×3.75)."""
import json, sys

PLATS = ("asa", "google")

def add(a, b):
    if b is None: return a
    return (a or 0) + b

def main():
    out, files = sys.argv[1], sys.argv[2:]
    merged = {}
    for p in files:
        for r in json.load(open(p, encoding="utf-8")):
            plat = r.get("platform")
            if plat not in PLATS or not (r.get("cost") or 0) > 0: continue
            camp = r.get("campaign") or ""
            k = (r["client_id"], r["date"], plat, camp)
            o = merged.get(k)
            if o is None:
                o = merged[k] = {"client_id": r["client_id"], "date": r["date"], "platform": plat, "level": "ad",
                    "account_id": "appsflyer-" + plat, "account_name": "AppsFlyer cost (" + plat + ")",
                    "currency": "SAR", "fx": 1, "campaign_id": camp or None, "campaign_name": camp or None,
                    "ad_id": camp or plat, "ad_name": camp or None, "video_id": "",
                    "spend": 0.0, "impressions": None, "clicks": None,
                    "app_installs": None, "purchases": None, "revenue": None, "camp_no": r.get("camp_no")}
            o["spend"] = round(o["spend"] + r["cost"], 2)
            o["app_installs"] = add(o["app_installs"], r.get("installs"))
            o["purchases"] = add(o["purchases"], r.get("purchases"))
            o["revenue"] = add(o["revenue"], r.get("revenue"))
            o["camp_no"] = o["camp_no"] or r.get("camp_no")
    rows = sorted(merged.values(), key=lambda o: (o["date"], o["platform"], o["ad_id"]))
    for o in rows:
        if o["revenue"] is not None: o["revenue"] = round(o["revenue"], 2)
    json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    from collections import defaultdict
    t = defaultdict(float)
    for o in rows: t[(o["platform"], o["date"][:7])] += o["spend"]
    for k, v in sorted(t.items(), key=lambda kv: (kv[0][1], kv[0][0])): print(k[0], k[1], round(v))
    print("rows", len(rows), "spend", round(sum(o["spend"] for o in rows)))

if __name__ == "__main__": main()
