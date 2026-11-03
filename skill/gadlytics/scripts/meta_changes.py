#!/usr/bin/env python3
"""GADLYTICS — turn Meta activity-log results into automatic change-log entries (site screen «سجل التغييرات»).
Usage: python3 ~/.gadlytics/meta_changes.py SESSION.jsonl [--dry]
Reads every `ads_account_get_activity_logs` result found in the Claude session log (so nothing is retyped),
keeps the user's own edits, merges each day's edits per object into one entry, and pushes them to the
ingest endpoint as table auto_changes (stored as docs changes/auto_meta_...; re-running is idempotent).

Kept:   budget changes (halalas → SAR, first old → last new value of the day), real pause/resume
        (the «Pending Process» flips Meta logs around every budget edit are ignored), new campaigns/ad sets/ads,
        creative, targeting and bid changes.
Ignored: anything done by «Meta» itself (billing, auto audiences, ad review), and account-level events."""
import json, os, re, sys, urllib.request
from datetime import datetime

CLIENT = "3sa3k1k"
INGEST = "https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest"
CAMP = re.compile(r"\b([A-Z]{2,4}-\d{3,6})\b")
LIVE = {"Active", "Paused", "Inactive", "Archived", "Deleted"}

def results_from_log(path):
    found = []
    def walk(x):
        if isinstance(x, str):
            if 'event_type' in x and 'actor_name' in x and x.lstrip()[:1] in "{[":
                try:
                    d = json.loads(x); r = d.get("result", d) if isinstance(d, dict) else d
                    if isinstance(r, str): r = json.loads(r)
                    if isinstance(r, list): found.extend(e for e in r if isinstance(e, dict) and "event_type" in e)
                except Exception: pass
        elif isinstance(x, dict): [walk(v) for v in x.values()]
        elif isinstance(x, list): [walk(v) for v in x]
    for line in open(path, encoding="utf-8"):
        if "event_type" in line and "actor_name" in line:
            try: walk(json.loads(line))
            except Exception: pass
    return found

def when(s):
    s = s.replace(" ", " ").replace(" at ", " ")
    return datetime.strptime(s, "%m/%d/%Y %I:%M %p")

def classify(ev, ex):
    t = ev.get("event_type", "").lower()
    if "budget" in t: return "budget"
    if "status" in t:
        o, n = ex.get("old_value"), ex.get("new_value")
        if isinstance(o, str) and isinstance(n, str) and o in LIVE and n in LIVE and o != n:
            return "resume" if n == "Active" else "pause"
        return None
    if "created" in t or t.startswith("create"): return "structure" if ("campaign" in t or "ad set" in t) else "creative"
    if "creative" in t or "image" in t: return "creative"
    if "target" in t: return "audience"
    if "bid" in t: return "bid"
    return None

def money(v):
    if isinstance(v, dict): v = v.get("old_value", v.get("new_value"))
    try: return float(v) / 100
    except Exception: return None

def main():
    log = sys.argv[1]; evs = results_from_log(log); seen = set(); groups = {}
    for ev in evs:
        k = (ev.get("datetime"), ev.get("object_id"), ev.get("event_type"), ev.get("extra_data"))
        if k in seen: continue
        seen.add(k)
        if ev.get("actor_name") == "Meta" or ev.get("actor_id") == "0": continue
        try: ex = json.loads(ev.get("extra_data") or "{}")
        except Exception: ex = {}
        kind = classify(ev, ex)
        if not kind: continue
        dt = when(ev["datetime"]); day = dt.strftime("%Y-%m-%d")
        g = groups.setdefault((day, ev["object_id"], kind), {"ev": [], "name": ev.get("object_name", ""), "by": ev.get("actor_name", "")})
        g["ev"].append((dt, ex, ev.get("event_type", "")))
    rows = []
    for (day, oid, kind), g in groups.items():
        g["ev"].sort(key=lambda x: x[0]); n = len(g["ev"]); name = g["name"]
        m = CAMP.search(name); camp = m.group(1) if m else None
        lvl = "الحملة" if "campaign" in g["ev"][0][2].lower() else ("المجموعة" if "ad set" in g["ev"][0][2].lower() else "الإعلان")
        if kind == "budget":
            first, last = g["ev"][0][1], g["ev"][-1][1]
            o = money((first.get("old_value") or {})); nv = (last.get("new_value") or {})
            nn = money(nv.get("new_value") if isinstance(nv, dict) else nv)
            per = (nv.get("additional_value") if isinstance(nv, dict) else "") or ""
            lab = "اليومية" if "day" in per.lower() else ("الإجمالية" if per else "")
            field = "ميزانية %s %s: %s ← %s ريال" % (lvl, lab, "%g" % o if o is not None else "?", "%g" % nn if nn is not None else "?")
            if n > 1: field += " (%d تعديلات في اليوم)" % n
        elif kind in ("pause", "resume"):
            field = ("إيقاف " if kind == "pause" else "تشغيل ") + lvl
        elif kind == "structure":
            field = {"الحملة": "إنشاء حملة جديدة", "المجموعة": "إنشاء مجموعة إعلانية جديدة"}.get(lvl, "إنشاء إعلان جديد")
        elif kind == "creative":
            field = ("إعلان جديد" if "creat" in g["ev"][0][2].lower() else "تعديل الكريتيف") + (" (%d)" % n if n > 1 else "")
        elif kind == "audience":
            field = "تعديل الاستهداف"
        else:
            field = "تعديل المزايدة"
        edits = []
        for dt, ex, et in g["ev"]:
            e = {"t": dt.strftime("%H:%M")}
            if kind == "budget":
                ov, nv2 = ex.get("old_value") or {}, ex.get("new_value") or {}
                e["old"] = money(ov); e["new"] = money(nv2.get("new_value") if isinstance(nv2, dict) else nv2)
            edits.append(e)
        o = {"id": "auto_meta_%s_%s_%s" % (day, oid, kind), "ts": int(g["ev"][-1][0].timestamp() * 1000), "date": day,
             "type": kind, "by": g["by"] + " · Meta", "field": field, "note": name[:160], "metric": "roas", "win": 3,
             "clientId": CLIENT, "platformId": "meta", "auto": True, "src": "meta", "edits": edits, "objectId": oid,
             "level": "campaign" if lvl == "الحملة" else ("adset" if lvl == "المجموعة" else "ad")}
        if camp: o["campaign"] = camp
        rows.append(o)
    rows.sort(key=lambda r: r["ts"])
    budget_rows = budget_days(groups)
    print("meta changes: %d events read → %d entries" % (len(evs), len(rows)))
    for r in rows[-6:]: print(" ", r["date"], r["type"], r.get("campaign", "-"), "|", r["field"])
    print("budget days: %d rows for %d campaigns" % (len(budget_rows), len({b["campaign_id"] for b in budget_rows})))
    if "--dry" in sys.argv or not rows: return
    key = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
    for table, data in (("auto_changes", rows), ("camp_budget_daily", budget_rows)):
        if not data: continue
        req = urllib.request.Request(INGEST, data=json.dumps({"table": table, "rows": data}).encode(), method="POST",
                                     headers={"content-type": "application/json", "x-ingest-key": key})
        print(table, urllib.request.urlopen(req, timeout=60).read().decode())

def budget_days(groups):
    """One row per campaign per day: budget at the start and end of the day, edits that day, status.
    Starts on the first logged change (its old value is the starting budget) and carries forward to today."""
    from datetime import date, timedelta
    per = {}
    for (day, oid, kind), g in groups.items():
        if not g["ev"] or not g["ev"][0][2].lower().startswith("campaign"): continue
        m = CAMP.search(g["name"])
        if not m: continue
        c = per.setdefault(oid, {"camp": m.group(1), "name": g["name"], "ev": []})
        for dt, ex, et in g["ev"]: c["ev"].append((dt, kind, ex))
    today = datetime.now().date(); out = []
    for oid, c in per.items():
        ev = sorted(c["ev"], key=lambda x: x[0]); bud = None; status = None
        firstb = next((x for x in ev if x[1] == "budget"), None)
        if firstb: bud = money((firstb[2].get("old_value") or {}))
        d = ev[0][0].date()
        while d <= today:
            todays = [x for x in ev if x[0].date() == d]; start = bud
            for dt, kind, ex in todays:
                if kind == "budget":
                    nv = ex.get("new_value") or {}; v = money(nv.get("new_value") if isinstance(nv, dict) else nv)
                    if v is not None: bud = v
                elif kind in ("pause", "resume"): status = "paused" if kind == "pause" else "active"
                elif kind == "structure": status = status or "active"
            out.append({"client_id": CLIENT, "date": d.isoformat(), "platform": "meta", "campaign_id": oid, "camp_no": c["camp"],
                        "name": c["name"][:160], "budget_start": start, "budget_end": bud, "edits": len(todays), "status": status, "source": "meta_log"})
            d += timedelta(days=1)
    return out

if __name__ == "__main__":
    main()
