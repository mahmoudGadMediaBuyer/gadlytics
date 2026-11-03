#!/usr/bin/env python3
"""GADLYTICS — write the hook (first spoken sentence) for videos, on this Mac, with Whisper.
Usage: python3 ~/.gadlytics/hooks.py CREATIVE_ID[=DRIVE_FOLDER_URL] ...
For each video: list its public Drive folder → download ONE video file to a temp dir → extract audio
(afconvert) → delete the video right away → Whisper on the first 12 s → delete the audio → save the
first sentence to Supabase media.hook_auto (via the ingest function). Nothing stays on disk."""
import json, os, re, shutil, subprocess, sys, tempfile, urllib.request, wave
from datetime import datetime, timezone

INGEST = "https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest"
KEY = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
MODEL = "mlx-community/whisper-large-v3-turbo"
PREFER = ("snap", "tiktok", "story", "reel", "9x16", "square", "youtube", "post")

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read()

def folder_videos(url, _depth=0):
    m = re.search(r"/folders/([A-Za-z0-9_-]+)", url or "")
    if not m:  # a direct file link
        f = re.search(r"/file/d/([A-Za-z0-9_-]+)", url or "") or re.search(r"[?&]id=([A-Za-z0-9_-]+)", url or "")
        return [(f.group(1), "video")] if f else []
    fid = m.group(1)
    s = get("https://drive.google.com/drive/folders/" + fid).decode("utf-8", "ignore")
    s = s.replace("\\x22", '"').replace("\\x5b", "[").replace("\\x5d", "]").replace("\\/", "/")
    out = []
    for g in re.finditer(r'"([A-Za-z0-9_-]{25,45})",\["' + re.escape(fid) + r'"\],"([^"]+)","(video/[^"]+)"', s):
        if g.group(1) not in [x[0] for x in out]: out.append((g.group(1), g.group(2)))
    if not out and _depth < 2:   # the videos can sit one or two folders deeper (e.g. a «Final» or «Snap» subfolder)
        subs = re.findall(r'"([A-Za-z0-9_-]{25,45})",\["' + re.escape(fid) + r'"\],"([^"]+)","application/vnd\.google-apps\.folder"', s)
        for sid, sname in sorted(subs, key=lambda x: next((i for i, p in enumerate(PREFER) if p in x[1].lower()), 99)):
            out += folder_videos("https://drive.google.com/drive/folders/" + sid, _depth + 1)
            if out: break
    out.sort(key=lambda x: next((i for i, p in enumerate(PREFER) if p in x[1].lower()), 99))
    return out

def first_sentence(segs):
    """The first sentence the speaker says: Whisper's first segment (it breaks at the first pause), cut at a sentence mark if one
    appears, joined with the next segment only when it is too short to stand alone, capped at ~120 characters on a word boundary."""
    segs = [x for x in segs if x["text"].strip() and x["start"] < 9]
    if not segs: return ""
    txt = segs[0]["text"].strip()
    if len(txt) < 15 and len(segs) > 1: txt += " " + segs[1]["text"].strip()
    txt = re.sub(r"\s+", " ", txt)
    m = re.search(r"[.!؟?]", txt[12:])
    if m: txt = txt[:12 + m.start() + 1]
    if len(txt) > 120: txt = txt[:120].rsplit(" ", 1)[0] + "…"
    return txt.strip()

def hook_for(cid, url, whisper):
    vids = folder_videos(url)
    if not vids: return None, "no video in the Drive folder"
    tmp = tempfile.mkdtemp(prefix="gad-hook-")
    try:
        mp4, wav = os.path.join(tmp, "v.mp4"), os.path.join(tmp, "a.wav")
        with open(mp4, "wb") as f:
            f.write(get("https://drive.usercontent.google.com/download?id=%s&export=download&confirm=t" % vids[0][0]))
        r = subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", mp4, wav], capture_output=True)
        os.remove(mp4)                                   # the video never stays on the Mac
        if r.returncode or not os.path.exists(wav): return None, "couldn't read the audio"
        import numpy as np
        w = wave.open(wav); a = np.frombuffer(w.readframes(min(w.getnframes(), 16000 * 12)), dtype=np.int16).astype(np.float32) / 32768.0; w.close()
        os.remove(wav)
        res = whisper.transcribe(a, path_or_hf_repo=MODEL, language="ar", condition_on_previous_text=False)
        hook = first_sentence(res.get("segments") or [])
        return (hook or None), (None if hook else "no speech in the first seconds")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def main():
    items = [a.split("=", 1) if "=" in a else [a, None] for a in sys.argv[1:]]
    if not items: sys.exit("usage: hooks.py CREATIVE_ID[=DRIVE_URL] ...")
    import mlx_whisper as whisper
    rows, report = [], []
    for cid, url in items:
        try:
            hook, err = hook_for(cid, url, whisper)
        except Exception as e:
            hook, err = None, str(e)[:120]
        report.append((cid, hook or ("— " + (err or "?"))))
        if hook: rows.append({"creative_id": cid, "hook_auto": hook, "hook_auto_at": datetime.now(timezone.utc).isoformat()})
    if rows:
        req = urllib.request.Request(INGEST, data=json.dumps({"table": "media", "rows": rows}).encode(), method="POST",
                                     headers={"content-type": "application/json", "x-ingest-key": KEY})
        urllib.request.urlopen(req, timeout=60).read()
    for cid, h in report: print(cid, "|", h)
    print("hooks: %d/%d saved" % (len(rows), len(items)))

if __name__ == "__main__":
    main()
