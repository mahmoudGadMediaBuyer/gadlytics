#!/usr/bin/env python3
"""GADLYTICS — cover image + hook for each library video, on this Mac. Nothing stays on disk.
Usage: python3 ~/.gadlytics/media_assets.py [QUEUE.json] [--limit N]
QUEUE = [{"id": creative_id, "url": drive folder/file url, "h": has_hook, "t": has_thumb}] (default ~/.gadlytics/thumb_queue.json)
For each video: list its public Drive folder → stream ONE video file into a temp dir → opening frame (bin/frame, JPEG 360px)
→ audio (afconvert) → DELETE the video → Whisper on the first 12 s (only when it has no hook yet) → delete the audio
→ push the cover to the ingest endpoint (table media_thumbs → Storage thumbs/<id>.jpg + media.thumb) and the hook (media.hook_auto).
Progress goes to ~/.gadlytics/media_assets.log; re-running skips videos that already have a cover."""
import base64, json, os, shutil, subprocess, sys, tempfile, time, urllib.request, wave
from datetime import datetime, timezone
sys.path.insert(0, os.path.expanduser("~/.gadlytics"))
from hooks import UA, MODEL, INGEST, KEY, folder_videos, first_sentence

FRAME = os.path.expanduser("~/.gadlytics/bin/frame")
FRAMES = os.path.expanduser("~/.gadlytics/frames")          # opening frames only (JPEG) — never videos
LOG = os.path.expanduser("~/.gadlytics/media_assets.log")
DONE = os.path.expanduser("~/.gadlytics/media_assets.done")

def log(s):
    line = time.strftime("%H:%M:%S ") + s
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f: f.write(line + "\n")

def push(table, rows):
    req = urllib.request.Request(INGEST, data=json.dumps({"table": table, "rows": rows}).encode(), method="POST",
                                 headers={"content-type": "application/json", "x-ingest-key": KEY})
    return urllib.request.urlopen(req, timeout=120).read().decode()

def download(file_id, path):
    req = urllib.request.Request("https://drive.usercontent.google.com/download?id=%s&export=download&confirm=t" % file_id, headers={"User-Agent": UA})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
        if "text/html" in (r.headers.get("content-type") or ""): raise RuntimeError("Drive returned a page, not the video")
        while True:                                       # a stalled download gives up instead of hanging the run
            chunk = r.read(1 << 20)
            if not chunk: break
            f.write(chunk)
            if time.time() - t0 > 600: raise RuntimeError("download took over 10 minutes")

def cover_and_hook(mp4, tmp, whisper, need_hook=True):
    """Opening frame (JPEG bytes) and the first spoken sentence. Leaves the video where it is; cleans its own files."""
    jpg, wav = os.path.join(tmp, "c.jpg"), os.path.join(tmp, "a.wav")
    subprocess.run([FRAME, mp4, jpg, "540"], capture_output=True, timeout=60)
    cover = open(jpg, "rb").read() if os.path.exists(jpg) else None
    if os.path.exists(jpg): os.remove(jpg)
    if cover and getattr(whisper, "cid", None):                      # keep the opening frame (an image, not the video) to write the hook on it
        open(os.path.join(FRAMES, whisper.cid + ".jpg"), "wb").write(cover)
    hook = None
    if need_hook:
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", mp4, wav], capture_output=True, timeout=120)
        if os.path.exists(wav):
            import numpy as np
            w = wave.open(wav); a = np.frombuffer(w.readframes(min(w.getnframes(), 16000 * 12)), dtype=np.int16).astype(np.float32) / 32768.0; w.close()
            os.remove(wav)
            res = whisper.transcribe(a, path_or_hf_repo=MODEL, language="ar", condition_on_previous_text=False)
            segs = res.get("segments") or []
            hook = first_sentence(segs) or None
            full = " ".join(x["text"].strip() for x in segs if x["text"].strip()).strip()
            if hook and full: hook = Hook(hook); hook.full = full   # the whole first 12 s, for telling look-alike hooks apart
    return cover, hook

class Hook(str):
    full = ""

def push_hook(cid, hook):
    row = {"creative_id": cid, "hook_auto": str(hook), "hook_auto_at": datetime.now(timezone.utc).isoformat()}
    if getattr(hook, "full", ""): row["hook_full"] = hook.full
    return push("media", [row])

class _OneAtATime:
    """Downloads overlap; Whisper (one GPU) transcribes one video at a time."""
    def __init__(self, w): self.w, self.lock = w, __import__("threading").Lock()
    def transcribe(self, *a, **k):
        with self.lock: return self.w.transcribe(*a, **k)

def one(item, whisper, need_cover=True):
    vids = folder_videos(item["url"])
    if not vids: return None, None, "no video in the Drive folder"
    tmp = tempfile.mkdtemp(prefix="gad-media-")
    try:
        mp4 = os.path.join(tmp, "v.mp4")
        download(vids[0][0], mp4)
        class _W:                                                      # the same Whisper, tagged with this video's id
            def __init__(s, w, cid): s.w, s.cid = w, cid
            def transcribe(s, *a, **k): return s.w.transcribe(*a, **k)
        cover, hook = cover_and_hook(mp4, tmp, _W(whisper, item["id"]), need_hook=not item.get("h"))
        os.remove(mp4)                                   # the video never stays on the Mac
        return (cover if need_cover else None), hook, None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def todo_ids_skip():
    """Videos with no video on Drive (logged) — nothing to fetch."""
    return {l.split()[1] for l in open(LOG, encoding="utf-8") if "no video in the Drive folder" in l and len(l.split()) > 1}

def main():
    from concurrent.futures import ThreadPoolExecutor
    import threading
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    q = json.load(open(args[0] if args else os.path.expanduser("~/.gadlytics/thumb_queue.json"), encoding="utf-8"))
    done = set(open(DONE).read().split()) if os.path.exists(DONE) else set()
    rehooked = set(open(DONE + ".hook").read().split()) if os.path.exists(DONE + ".hook") else set()
    # new videos: cover + hook. Videos that already have a cover: the hook again with the first-sentence rule (manual hooks stay).
    todo = [dict(x, cover=x["id"] not in done) for x in q if x.get("url") and (x["id"] not in done or (not x.get("h") and x["id"] not in rehooked))]
    if "--frames" in sys.argv:   # just the opening frame for videos that have none saved yet (no Whisper)
        have = {f[:-4] for f in os.listdir(FRAMES)}
        todo = [dict(x, cover=True, h=True) for x in q if x.get("url") and x["id"] not in have and x["id"] not in todo_ids_skip()]
    import mlx_whisper
    whisper = _OneAtATime(mlx_whisper)
    log("start: %d videos (%d new, %d hook only)" % (len(todo), sum(1 for x in todo if x["cover"]), sum(1 for x in todo if not x["cover"])))
    cnt = {"c": 0, "h": 0, "n": 0}; lk = threading.Lock()
    def run(it):
        t0 = time.time()
        try:
            cover, hook, err = one(it, whisper, need_cover=it["cover"])
            if cover: push("media_thumbs", [{"creative_id": it["id"], "jpg": base64.b64encode(cover).decode()}])
            if hook: push_hook(it["id"], hook)
            with lk:
                cnt["n"] += 1; cnt["c"] += bool(cover); cnt["h"] += bool(hook)
                log("%d/%d %s | %s | %s | %.0fs" % (cnt["n"], len(todo), it["id"], "cover" if cover else ("hook only" if not it["cover"] else "no cover"), hook or (err or ("had hook" if it.get("h") else "no speech")), time.time() - t0))
                if it["cover"] and (cover or err): open(DONE, "a").write(it["id"] + "\n")
                if hook or not it["cover"]: open(DONE + ".hook", "a").write(it["id"] + "\n")   # hook done with the first-sentence rule + full text
        except Exception as e:
            with lk: cnt["n"] += 1; log("%d/%d %s | error: %s" % (cnt["n"], len(todo), it["id"], str(e)[:140]))
    with ThreadPoolExecutor(max_workers=4) as ex: list(ex.map(run, todo))
    log("finished: %d covers, %d hooks" % (cnt["c"], cnt["h"]))

if __name__ == "__main__":
    main()
