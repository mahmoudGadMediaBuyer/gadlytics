#!/usr/bin/env python3
"""GADLYTICS — make every auto hook tell its video apart from the others.
Usage: python3 ~/.gadlytics/hooks_dedupe.py HOOKS.json [--push]
HOOKS.json = [{"id", "hook" (hook_auto), "full" (hook_full = all speech in the first 12 s), "manual" (bool)}]
Hooks that read the same (same words, or one starts with the other, or ≥85% alike) form a group. Inside a group each auto hook
grows word by word from its full text until no other hook in the group reads the same. Manual hooks are never changed.
Prints what changed, and the ids that still clash but have no full text (re-run media_assets for those to get it).
--push sends the new hook_auto values to the system."""
import difflib, json, os, re, sys, urllib.request
sys.path.insert(0, os.path.expanduser("~/.gadlytics"))
from hooks import INGEST, KEY

CAP = 200

def norm(s):
    s = re.sub(r"[ً-ْـ]", "", s or "")                  # tashkeel + tatweel
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"[^\w\s]", " ", s).split()

def alike(a, b):
    x, y = " ".join(norm(a)), " ".join(norm(b))
    if not x or not y: return False
    if x == y or x.startswith(y) or y.startswith(x): return True
    return difflib.SequenceMatcher(None, x, y).ratio() >= 0.85

def groups(rows):
    seen, out = set(), []
    for i, r in enumerate(rows):
        if i in seen or not r["hook"]: continue
        g = [i]
        for j in range(i + 1, len(rows)):
            if j not in seen and rows[j]["hook"] and alike(r["hook"], rows[j]["hook"]): g.append(j)
        if len(g) > 1: seen.update(g); out.append(g)
    return out

def grow(rows, g):
    """Each auto hook in the group grows from its own full text to one word past the first word where it differs from
    every other member (manual hooks and hooks without full text are compared by what they have)."""
    changed, need_full = [], []
    words = {i: (rows[i].get("full") or "").split() or rows[i]["hook"].rstrip("…").split() for i in g}
    nw = {i: [" ".join(norm(w)) for w in words[i]] for i in g}
    for i in g:
        r = rows[i]
        if r.get("manual"): continue
        if not r.get("full"): need_full.append(r["id"]); continue
        n = len(r["hook"].rstrip("…").split())
        for j in g:
            if j == i: continue
            d = next((k for k in range(min(len(nw[i]), len(nw[j]))) if nw[i][k] != nw[j][k]), min(len(nw[i]), len(nw[j])))
            if d < 14: n = max(n, d + 2)                                 # the first differing word + one for context
            # same words for 14+ words = the same script (a variation of one video): growing wouldn't help — the ID tells them apart
        cand = " ".join(words[i][:n])
        while len(cand) > CAP and n > 1: n -= 1; cand = " ".join(words[i][:n])
        if cand != r["hook"]: changed.append((r["id"], r["hook"], cand)); r["hook"] = cand
    return changed, need_full

def main():
    rows = json.load(open(sys.argv[1], encoding="utf-8"))
    allc, alln = [], []
    for g in groups(rows):
        c, n = grow(rows, g); allc += c; alln += n
    for cid, old, new in allc: print(cid, "|", old, "→", new)
    seenh = {}; [seenh.setdefault(" ".join(norm(r["hook"])), []).append(r["id"]) for r in rows if r["hook"]]
    left = [v for v in seenh.values() if len(v) > 1]                    # hooks that still read exactly the same
    print("changed: %d · still identical: %d · need full text: %s" % (len(allc), len(left), " ".join(sorted(set(alln))) or "none"))
    if "--push" in sys.argv and allc:
        body = json.dumps({"table": "media", "rows": [{"creative_id": c, "hook_auto": n} for c, o, n in allc]}).encode()
        req = urllib.request.Request(INGEST, data=body, method="POST", headers={"content-type": "application/json", "x-ingest-key": KEY})
        print(urllib.request.urlopen(req, timeout=60).read().decode())

if __name__ == "__main__":
    main()
