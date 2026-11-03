#!/usr/bin/env python3
"""GADLYTICS — write each video's hook onto its cover image and upload it as the cover.
Usage: python3 ~/.gadlytics/hook_covers.py HOOKS.json
HOOKS.json = [{"id": creative_id, "hook": the hook to write (manual hook first, else the auto hook)}]
Needs the opening frame in ~/.gadlytics/frames/<id>.jpg (saved by media_assets.py — images only, never videos).
The upload records the written text in media.thumb_hook, so the site doesn't draw the hook a second time."""
import base64, json, os, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.expanduser("~/.gadlytics"))
import media_assets

FRAMES = os.path.expanduser("~/.gadlytics/frames")
TOOL = os.path.expanduser("~/.gadlytics/bin/hookcover")

def one(r):
    src = os.path.join(FRAMES, r["id"] + ".jpg")
    if not os.path.exists(src): return r["id"], "no frame"
    hook = (r.get("hook") or "").strip()
    if not hook or hook.lower().startswith("http"): return r["id"], "no hook"
    fd, out = tempfile.mkstemp(suffix=".jpg", prefix="gad-hc-"); os.close(fd)
    try:
        p = subprocess.run([TOOL, src, out, hook], capture_output=True, timeout=60)
        if p.returncode: return r["id"], "render failed"
        body = [{"creative_id": r["id"], "jpg": base64.b64encode(open(out, "rb").read()).decode(), "hook": hook}]
        for attempt in range(3):                                   # a busy server answers 500 now and then — try again
            try: media_assets.push("media_thumbs", body); return r["id"], "ok"
            except Exception as e: err = str(e)[:80]; __import__("time").sleep(2 + attempt * 3)
        return r["id"], "upload failed: " + err
    finally:
        os.remove(out)

def main():
    rows = json.load(open(sys.argv[1], encoding="utf-8"))
    res = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for cid, st in ex.map(one, rows): res.setdefault(st, []).append(cid)
    for st, ids in res.items(): print(st, len(ids), "" if st == "ok" else " ".join(ids[:40]))

if __name__ == "__main__":
    main()
