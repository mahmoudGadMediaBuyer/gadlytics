#!/usr/bin/env python3
"""GADLYTICS — turn Mixpanel Run-Query results (insights, chartType line) into mx_daily rows and push them.
Usage: python3 ~/.gadlytics/mx_prep.py DIM FILE.json [--dry]
  DIM  aff  = breakdown by `affiliate` (Khzama link name), unit day
       dev  = breakdown by `$device`, unit day
       src  = breakdown by `utm_source`, unit day
       pay  = breakdown by `payment_method`, unit day
       hour = no breakdown, unit hour
  FILE the Run-Query JSON ({"result":{"results":{...}}} or just the {"results":{...}} part).

Metric names map to events: "$session_start"/"Session Start" → session, "[Sum of value]" → revenue, others keep their name.
For DIM=aff only our link codes (ME/TT/SC/bio/com/DM) are kept by name; "undefined" → _none, "$overall" → _all,
and _other = _all − ours − _none (so rows of other departments may be left out of FILE)."""
import json, os, re, sys, urllib.request

CLIENT = "3sa3k1k"
INGEST = "https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest"
OURS = {"ME", "TT", "SC"}
ORGANIC = {"bio": "bio", "com": "com", "dm": "DM"}

def code_of(aff):
    a = (aff or "").strip()
    if a.lower() in ORGANIC: return ORGANIC[a.lower()]
    for t in a.split("-"):
        if t in OURS: return t
    return None

def event_of(key):
    k = re.sub(r"^[A-Z]\.\s*", "", key)
    if "[Sum of value]" in k: return "revenue"
    name = k.split(" [")[0].strip()
    return {"Session Start": "session", "$session_start": "session"}.get(name, name)

def rows_for(dim, results):
    out = {}
    def add(date, val, ev, n):
        if not n: return
        k = (date, val, ev); out[k] = out.get(k, 0) + n
    for key, block in results.items():
        ev = event_of(key); hd = block["headers"]
        if dim == "hour":
            for d, v in block["rows"]:
                date, hh = (d.split("T") + ["00:00"])[:2]
                add(date, hh[:2], ev, v)
            continue
        dates = hd[1:]
        sums = {}
        for r in block["rows"]:
            name, vals = r[0], r[1:]
            if dim == "aff":
                if name == "$overall": val = "_all"
                elif name in ("undefined", None, ""): val = "_none"
                else:
                    if not code_of(name): continue
                    val = name
            else:
                val = "_all" if name == "$overall" else ("" if name in ("undefined", None) else name)
            for d, v in zip(dates, vals):
                add(d, val, ev, v)
                if dim == "aff" and val != "_all": sums[d] = sums.get(d, 0) + (v or 0)
        if dim == "aff":
            for d in dates:
                tot = out.get((d, "_all", ev), 0)
                add(d, "_other", ev, max(0, tot - sums.get(d, 0)))
    return [{"client_id": CLIENT, "date": d, "dim": dim, "val": v, "device": "", "event": e, "cnt": n}
            for (d, v, e), n in sorted(out.items())]

def main():
    dim, path = sys.argv[1], sys.argv[2]
    data = json.load(open(path))
    res = (data.get("result") or data).get("results") or data
    rows = rows_for(dim, res)
    print(f"mx {dim}: {len(rows)} rows · dates {min(r['date'] for r in rows) if rows else '-'}…{max(r['date'] for r in rows) if rows else '-'}")
    if "--dry" in sys.argv: print(json.dumps(rows[:8], ensure_ascii=False)); return
    key = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
    for i in range(0, len(rows), 800):
        req = urllib.request.Request(INGEST, data=json.dumps({"table": "mx_daily", "rows": rows[i:i+800]}).encode(),
                                     method="POST", headers={"content-type": "application/json", "x-ingest-key": key})
        print(urllib.request.urlopen(req, timeout=60).read().decode())

if __name__ == "__main__":
    main()
