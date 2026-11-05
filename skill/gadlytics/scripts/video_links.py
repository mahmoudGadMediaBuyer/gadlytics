#!/usr/bin/env python3
"""GADLYTICS — give every video a direct Drive link to the video FILE (not its folder).
Airtable's URL column points to a Drive folder per creative. This lists each public folder (no download, no login),
picks the video the same way the uploads do (Snap/story version first, never TikTok when another exists), and stores
https://drive.google.com/file/d/<id>/view in Supabase media.video_file. The site opens that link on «▶ الفيديو».
  python3 ~/.gadlytics/video_links.py              → only creatives not resolved yet (cache: ~/.gadlytics/video_links.json)
  python3 ~/.gadlytics/video_links.py --all        → re-check every folder
media_sync.py calls resolve() after every Airtable sync, so new videos get their link in the daily pull."""
import json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.expanduser("~/.gadlytics"))
from hooks import folder_videos

INGEST = "https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest"
KEY = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
CACHE = os.path.expanduser("~/.gadlytics/video_links.json")
RECHECK_EMPTY = 24 * 3600   # a folder with no video yet is looked at again after a day

def pick(url):
    vids = folder_videos(url)
    ok = [v for v in vids if not any(t in v[1].lower() for t in ("tiktok", "tik tok", "تيك"))] or vids
    for want in ("snap", "سناب", "story", "ستوري", "9x16", "9-16", "reel"):
        for v in ok:
            if want in v[1].lower(): return v
    return ok[0] if ok else None

def file_link(fid): return "https://drive.google.com/file/d/%s/view" % fid

def push(rows):
    for i in range(0, len(rows), 400):
        req = urllib.request.Request(INGEST, data=json.dumps({"table": "media", "rows": rows[i:i+400]}).encode(), method="POST",
                                     headers={"content-type": "application/json", "x-ingest-key": KEY})
        urllib.request.urlopen(req, timeout=120).read()

def load():
    try: return json.load(open(CACHE, encoding="utf-8"))
    except Exception: return {}

def resolve(items, force=False, workers=8):
    """items: [(creative_id, drive_url)]. Returns (resolved, empty, failed). Pushes only links that changed."""
    cache, now = load(), time.time()
    todo = []
    for cid, url in items:
        if not url or "drive.google" not in url: continue
        c = cache.get(cid)
        if force or not c or c.get("url") != url or (not c.get("file") and now - c.get("at", 0) > RECHECK_EMPTY): todo.append((cid, url))
    out, empty, failed = [], 0, 0
    def one(it):
        cid, url = it
        try: return cid, url, pick(url), None
        except Exception as e: return cid, url, None, str(e)[:120]
    with ThreadPoolExecutor(workers) as ex:
        for cid, url, v, err in ex.map(one, todo):
            if err: failed += 1; continue
            link = file_link(v[0]) if v else None
            if not v: empty += 1
            if (cache.get(cid) or {}).get("file") != link or force: out.append({"creative_id": cid, "video_file": link})
            cache[cid] = {"url": url, "file": link, "name": v and v[1], "at": now}
    if out: push(out)
    tmp = CACHE + ".tmp"; json.dump(cache, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, CACHE)
    return len(out), empty, failed, len(todo)

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = args[0] if args else os.path.expanduser("~/.gadlytics/video_links_in.json")
    items = [tuple(x) for x in json.load(open(src, encoding="utf-8"))]
    n, empty, failed, checked = resolve(items, force="--all" in sys.argv)
    print(f"video_links: {checked} folders checked · {n} links saved · {empty} folders with no video · {failed} failed")
