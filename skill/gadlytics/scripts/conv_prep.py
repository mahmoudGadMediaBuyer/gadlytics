#!/usr/bin/env python3
"""GADLYTICS — app + website conversions for clients without Khzama (ديمان) → conv_daily rows.
Input: folders written by log_results.py
  <dir>/af/*.json     AppsFlyer analytics_fetch_aggregated_data results:
                        · af_purchase, groupings [Date, App, Media source, Campaign], metrics Installs, Cost, Count+Revenue (period "activity")
                        · af_complete_registration, groupings [Date, App, Media source], metric Count (period "activity")
  <dir>/salla/*.json  Salla reports_sales_over_time (grain day) → website orders
Run: python3 ~/.gadlytics/conv_prep.py <client_id> <dir> <out.json>
AppsFlyer reports USD in UTC days → ×3.75 to SAR. Purchases/revenue are by event day (activity), not install cohort."""
import json, os, re, sys, glob, csv, io

FX = 3.75
OS = {"id6470202546": "ios", "sa.dimaan.app": "android"}
SRC = {"tiktokglobal_int": ("tiktok", "tiktok"), "Facebook Ads": ("meta", "meta"), "snapchat_int": ("snap", "snap"),
       "Apple Search Ads": ("asa", "asa"), "googleadwords_int": ("google", "google"), "organic": ("organic", None)}
CAMP = re.compile(r'\s*-?([A-Z]{2,4}-\d{4,6})')

def body(path):
    d = json.load(open(path, encoding="utf-8"))
    t = d["text"]
    try: t = json.loads(t).get("result", t)
    except Exception: pass
    return d["input"], t

def af_rows(text):
    data = text.split("## Data:", 1)[1].split("; ## Metadata", 1)[0].strip()
    rd = list(csv.reader(io.StringIO(data)))
    head = [h.strip() for h in rd[0]]
    for r in rd[1:]:
        if len(r) != len(head): continue
        yield dict(zip(head, r))

def num(v):
    try: return float(v) if v not in ("", None) else None
    except ValueError: return None

def main():
    cid, d, out = sys.argv[1], sys.argv[2], sys.argv[3]
    rows = {}
    def get(date, os_, raw, camp):
        k = (date, os_, raw, camp)
        if k not in rows:
            src, plat = SRC.get(raw, ("other", None))
            m = CAMP.match(camp or "")
            rows[k] = {"client_id": cid, "date": date, "channel": "app", "os": os_, "source_raw": raw, "source": src,
                       "platform": plat, "campaign": camp, "camp_no": m.group(1) if m else None,
                       "installs": None, "registrations": None, "purchases": None, "revenue": None, "cost": None}
        return rows[k]
    def add(o, f, v):
        if v is None: return
        o[f] = (o[f] or 0) + v
    for p in sorted(glob.glob(os.path.join(d, "af", "*.json"))):
        q, text = body(p)
        q = q.get("query", q)
        ev, groups = (q.get("in_app_event") or [""])[0], q.get("groupings") or []
        if "Date" not in groups or "Media source" not in groups or "App" not in groups: continue
        if ev == "af_purchase" and "Campaign" not in groups: continue          # summary calls overlap the campaign ones
        for r in af_rows(text):
            camp = "" if "Campaign" not in groups or r.get("Campaign") in (None, "None") else r["Campaign"]
            o = get(r["Date"], OS.get(r["App"], r["App"]), r["Media source"], camp)
            cnt = num(next((v for k, v in r.items() if k.startswith("Count") and "activity" in k), None))
            if ev == "af_purchase":
                inst = num(r.get("Installs appsflyer")); cost = num(r.get("Cost"))
                rev = num(next((v for k, v in r.items() if k.startswith("Revenue") and "activity" in k), None))
                # a later call for the same day replaces the earlier one (re-pulls)
                o["installs"] = int(inst) if inst is not None else o["installs"]
                o["cost"] = round(cost * FX, 2) if cost is not None else o["cost"]
                o["purchases"] = int(cnt) if cnt is not None else o["purchases"]
                o["revenue"] = round(rev * FX, 2) if rev is not None else o["revenue"]
            elif ev == "af_complete_registration":
                o["registrations"] = int(cnt) if cnt is not None else o["registrations"]
    for p in sorted(glob.glob(os.path.join(d, "salla", "*.json"))):
        q, text = body(p)
        try: rep = json.loads(text) if isinstance(text, str) else text
        except Exception: continue
        if rep.get("grain") != "day": continue
        for r in rep.get("rows", []):
            rows[(r["period"], "web", "salla", "")] = {"client_id": cid, "date": r["period"], "channel": "web", "os": "web",
                "source_raw": "salla", "source": "salla", "platform": None, "campaign": "", "camp_no": None,
                "installs": None, "registrations": None, "purchases": int(r.get("orders") or 0), "revenue": float(r.get("sales") or 0), "cost": None}
    keep = [o for o in rows.values() if any(o[f] for f in ("installs", "registrations", "purchases", "revenue", "cost")) or o["channel"] == "web"]
    json.dump(keep, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    from collections import defaultdict
    t = defaultdict(lambda: [0, 0, 0.0, 0.0])
    for o in keep:
        x = t[(o["channel"], o["source"])]; x[0] += o["installs"] or 0; x[1] += o["purchases"] or 0; x[2] += o["revenue"] or 0; x[3] += o["cost"] or 0
    for k, v in sorted(t.items()): print(k, "installs", v[0], "purchases", v[1], "revenue", round(v[2]), "cost", round(v[3]))
    print("rows", len(keep), "days", len({o["date"] for o in keep}))

if __name__ == "__main__": main()
