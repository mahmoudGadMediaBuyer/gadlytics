#!/usr/bin/env python3
"""GADLYTICS — upload new Airtable videos to the ad platforms (the «ارفع على المنصات» button). Runbook: ~/.gadlytics/upload_media.md
  python3 ~/.gadlytics/upload_media.py prep ID=DRIVE_URL ...   → per video: the Snap/story version (never the TikTok one), named <ID>.mp4,
        cover + hook pushed to the system, uploaded to Snap as-is when it is already 9:16, then DELETED from the Mac.
        Prints one JSON line per video: {id, name, direct_url, w, h, snap_media_id | snap: "needs_canva"} — Meta and TikTok take direct_url.
  python3 ~/.gadlytics/upload_media.py snapfile ID PATH         → uploads a resized file (Canva export) to Snap, then deletes it.
  python3 ~/.gadlytics/upload_media.py urls ID=DRIVE_URL ...    → just the direct links (seconds), so Meta + TikTok uploads can start at once.
Videos run in parallel (5 at a time); only Whisper takes turns (one GPU).
Nothing is edited in the video. Every temp file is removed even when a step fails."""
import json, math, os, shutil, subprocess, sys, tempfile, threading, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.expanduser("~/.gadlytics"))
sys.path.insert(0, os.path.expanduser("~/Desktop/claude/adlytics-connectors/snap"))
from hooks import UA, folder_videos
import media_assets

SNAP_ACCOUNT = "828aa8bb-bd63-44ee-8cf8-b735981ca06f"
FRAME = os.path.expanduser("~/.gadlytics/bin/frame")
SNAP_HOST = "https://adsapi.snapchat.com"

def pick(url):
    """The Snap / story version — never the TikTok one."""
    vids = folder_videos(url)
    ok = [v for v in vids if not any(t in v[1].lower() for t in ("tiktok", "tik tok", "تيك"))]
    for want in ("snap", "سناب", "story", "ستوري", "9x16", "9-16", "reel"):
        for v in ok:
            if want in v[1].lower(): return v
    return ok[0] if ok else None

def direct(file_id):
    return "https://drive.usercontent.google.com/download?id=%s&export=download&confirm=t" % file_id

def info(path):
    out = subprocess.run([FRAME, path, "--info"], capture_output=True, text=True, timeout=60).stdout.split()
    return (int(out[0]), int(out[1]), float(out[2])) if len(out) == 3 else (0, 0, 0)

def is_916(w, h):
    return w and h and abs(w / h - 9 / 16) < 0.01

def _multipart(fields, file_field=None, file_name=None, data=None):
    b = uuid.uuid4().hex; body = bytearray()
    for k, v in fields.items():
        body += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (b, k, v)).encode()
    if file_field:
        body += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\nContent-Type: video/mp4\r\n\r\n" % (b, file_field, file_name)).encode() + data + b"\r\n"
    body += ("--%s--\r\n" % b).encode()
    return bytes(body), "multipart/form-data; boundary=" + b

def snap_post(url, fields, file_field=None, file_name=None, data=None):
    from common import access_token
    body, ct = _multipart(fields, file_field, file_name, data)
    req = urllib.request.Request(url, data=body, method="POST", headers={"Authorization": "Bearer " + access_token(), "Content-Type": ct})
    with urllib.request.urlopen(req, timeout=600) as r: return json.load(r)

def snap_upload(cid, path):
    """Snap media library: create the media item named by the creative ID, then upload the file (chunked above 31 MB)."""
    from common import api
    r = api("POST", "/adaccounts/%s/media" % SNAP_ACCOUNT, {"media": [{"name": cid, "type": "VIDEO", "ad_account_id": SNAP_ACCOUNT}]})
    mid = r["media"][0]["media"]["id"]
    size, name = os.path.getsize(path), cid + ".mp4"
    if size <= 31 * 1024 * 1024:
        snap_post("%s/v1/media/%s/upload" % (SNAP_HOST, mid), {}, "file", name, open(path, "rb").read())
    else:
        part = 31 * 1024 * 1024; n = math.ceil(size / part)
        init = snap_post("%s/us/v1/media/%s/multipart-upload-v2?action=INIT" % (SNAP_HOST, mid), {"file_name": name, "file_size": size, "number_of_parts": n})
        with open(path, "rb") as f:
            for i in range(1, n + 1):
                snap_post(SNAP_HOST + "/us/v1" + init["add_path"], {"upload_id": init["upload_id"], "part_number": i}, "file", name, f.read(part))
        snap_post(SNAP_HOST + "/us/v1" + init["finalize_path"], {"upload_id": init["upload_id"]})
    return mid

WHISPER_LOCK, PRINT_LOCK = threading.Lock(), threading.Lock()

class _OneAtATime:
    """Whisper (MLX) runs on the GPU — let the downloads/uploads overlap, but transcribe one video at a time."""
    def __init__(self, w): self.w = w
    def transcribe(self, *a, **k):
        with WHISPER_LOCK: return self.w.transcribe(*a, **k)

def emit(o):
    with PRINT_LOCK: print(json.dumps(o, ensure_ascii=False), flush=True)

def prep_one(cid, url, whisper):
    out = {"id": cid}; tmp = tempfile.mkdtemp(prefix="gad-up-")
    try:
        v = pick(url)
        if not v: out["error"] = "no Snap/story video in the Drive folder"; return
        out.update(name=cid, drive_file=v[1], direct_url=direct(v[0]))
        path = os.path.join(tmp, cid + ".mp4")                          # named by the Airtable creative ID
        media_assets.download(v[0], path)
        out["w"], out["h"], out["sec"] = info(path)
        snap = None
        if is_916(out["w"], out["h"]):                                   # Snap upload overlaps with the cover/hook work
            snap = threading.Thread(target=lambda: out.__setitem__("snap_media_id", snap_upload(cid, path)))
            snap.start()
        else: out["snap"] = "needs_canva"
        cover, hook = media_assets.cover_and_hook(path, tmp, whisper)    # the system's cover + hook, same pass
        if cover: media_assets.push("media_thumbs", [{"creative_id": cid, "jpg": __import__("base64").b64encode(cover).decode()}])
        if hook: media_assets.push_hook(cid, hook)
        out["cover"], out["hook"] = bool(cover), hook
        if snap: snap.join()
    except SystemExit as e: out["error"] = str(e)[:200]
    except Exception as e: out["error"] = str(e)[:200]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)                           # the video never stays on the Mac
        emit(out)

def prep(items, workers=5):
    import mlx_whisper
    w = _OneAtATime(mlx_whisper)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(lambda it: prep_one(it[0], it[1], w), items))

def urls(items):
    def one(it):
        v = pick(it[1]); emit({"id": it[0], "drive_file": v and v[1], "direct_url": v and direct(v[0])} if v else {"id": it[0], "error": "no Snap/story video"})
    with ThreadPoolExecutor(max_workers=10) as ex: list(ex.map(one, items))

def snapfile(cid, path):
    try: print(json.dumps({"id": cid, "snap_media_id": snap_upload(cid, path)}))
    finally:
        if os.path.exists(path): os.remove(path)

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "prep": prep([a.split("=", 1) for a in sys.argv[2:]])
    elif len(sys.argv) == 4 and sys.argv[1] == "snapfile": snapfile(sys.argv[2], sys.argv[3])
    elif len(sys.argv) > 2 and sys.argv[1] == "urls": urls([a.split("=", 1) for a in sys.argv[2:]])
    else: sys.exit(__doc__)
