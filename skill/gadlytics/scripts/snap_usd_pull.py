#!/usr/bin/env python3
"""Pull ad-level daily stats for Molabi's USD Snap account (Mulabbi [1], business «Tamkeen») with the local
Snap OAuth token (the Claude Snap connector is consented to «Tamkeen SAR» only, so it can't see this account).
Writes rows in the shape prep_ad_daily.py reads (currency USD → converted ×3.75 there).
Usage: python3 ~/.gadlytics/snap_usd_pull.py FROM TO OUT.json   (dates YYYY-MM-DD, TO inclusive, ≤31 days)"""
import json, os, sys
from datetime import date, timedelta
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, os.path.expanduser("~/Desktop/claude/adlytics-connectors/snap"))
from common import api

ACC, ACC_NAME = "961fd033-2f79-4acc-88ba-0b546464d2b2", "Mulabbi [1]"
FROM, TO, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
END = (date.fromisoformat(TO) + timedelta(days=1)).isoformat()

def pages(path, key):
    out, params = [], {"limit": 1000}
    while True:
        r = api("GET", path, params=params)
        out += [x[key[:-1]] for x in r.get(key, [])]
        nl = (r.get("paging") or {}).get("next_link")
        if not nl: return out
        params = {"limit": 1000, "cursor": parse_qs(urlparse(nl).query)["cursor"][0]}

camps = {c["id"]: c["name"] for c in pages(f"/adaccounts/{ACC}/campaigns", "campaigns")}
squads = {s["id"]: s for s in pages(f"/adaccounts/{ACC}/adsquads", "adsquads")}
ads = {a["id"]: a for a in pages(f"/adaccounts/{ACC}/ads", "ads")}

F = ("spend,impressions,swipes,video_views,quartile_1,quartile_2,quartile_3,view_completion,"
     "conversion_page_views,conversion_view_content,conversion_add_cart,conversion_start_checkout,"
     "conversion_add_billing,conversion_purchases,conversion_purchases_value")
r = api("GET", f"/adaccounts/{ACC}/stats", params={"breakdown": "ad", "granularity": "DAY", "fields": F,
        "start_time": FROM + "T00:00:00+03:00", "end_time": END + "T00:00:00+03:00", "omit_empty": "true"})
rows = []
for ts in r.get("timeseries_stats", []):
    for b in ts["timeseries_stat"].get("breakdown_stats", {}).get("ad", []):
        ad = ads.get(b["id"], {}); sq = squads.get(ad.get("ad_squad_id"), {})
        for t in b.get("timeseries", []):
            s = t.get("stats", {})
            if not s.get("spend") and not s.get("impressions"): continue
            rows.append({"date": t["start_time"][:10], "platform": "snap", "level": "ad", "account_id": ACC,
                "account_name": ACC_NAME, "currency": "USD", "fx": 3.75,
                "campaign_id": sq.get("campaign_id"), "campaign_name": camps.get(sq.get("campaign_id")),
                "adset_id": ad.get("ad_squad_id"), "adset_name": sq.get("name"),
                "ad_id": b["id"], "ad_name": ad.get("name"), "video_id": "", "video_name": None,
                "spend": (s.get("spend") or 0) / 1e6, "impressions": s.get("impressions"), "clicks": s.get("swipes"),
                "link_clicks": s.get("swipes"), "landing_page_views": s.get("conversion_page_views"),
                "video_plays": s.get("video_views"), "video_p25": s.get("quartile_1"), "video_p50": s.get("quartile_2"),
                "video_p75": s.get("quartile_3"), "video_p100": s.get("view_completion"),
                "view_content": s.get("conversion_view_content"), "add_to_cart": s.get("conversion_add_cart"),
                "initiate_checkout": s.get("conversion_start_checkout"), "add_payment_info": s.get("conversion_add_billing"),
                "purchases": s.get("conversion_purchases"), "revenue": (s.get("conversion_purchases_value") or 0) / 1e6})
json.dump(rows, open(OUT, "w"), ensure_ascii=False)
print(f"snap_usd: {len(rows)} ad-days · spend ${sum(x['spend'] for x in rows):,.2f} · {len({x['ad_id'] for x in rows})} ads · {len({x['campaign_id'] for x in rows})} campaigns")
