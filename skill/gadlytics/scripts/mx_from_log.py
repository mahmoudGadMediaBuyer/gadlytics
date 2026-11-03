#!/usr/bin/env python3
"""Pull the latest "GAD mx <dim>" Mixpanel Run-Query results out of a Claude session log (.jsonl) into OUTDIR/<dim>.json,
so they don't have to be retyped. Usage: python3 ~/.gadlytics/mx_from_log.py SESSION.jsonl OUTDIR"""
import json, os, sys
F, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True); found = {}
def walk(x):
    if isinstance(x, str):
        if '"report_name":"GAD mx' in x:
            try: d = json.loads(x); found[d["result"]["report_name"]] = d
            except Exception: pass
    elif isinstance(x, dict): [walk(v) for v in x.values()]
    elif isinstance(x, list): [walk(v) for v in x]
for line in open(F):
    if "GAD mx" in line:
        try: walk(json.loads(line))
        except Exception: pass
for n, d in found.items():
    p = os.path.join(OUT, n.split()[-1] + ".json"); json.dump(d, open(p, "w")); print(p)
