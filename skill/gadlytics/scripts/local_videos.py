#!/usr/bin/env python3
"""GADLYTICS — mark which library videos are already on this Mac (the «💾 على الجهاز» filter).
Usage: python3 ~/.gadlytics/local_videos.py [FOLDER ...]   (default: ~/Downloads)
Reads video file names (.mp4/.mov/.m4v), takes the 14-digit Creative ID from each name (typos like «20260727084902..mp4» or
a stray letter inside the digits are tolerated) and prints ONE SQL statement for the Supabase connector (execute_sql): it clears the
old marks and sets media.local_file for the videos that exist — names that aren't in the system are simply ignored (no new rows).
Only names are read — the files are never opened, moved or deleted."""
import os, re, sys

def scan(folders):
    out = {}
    for d in folders:
        for f in sorted(os.listdir(d)):
            if not f.lower().endswith((".mp4", ".mov", ".m4v")): continue
            m = re.search(r"(20\d{12})", re.sub(r"\D", "", os.path.splitext(f)[0]))
            if m: out.setdefault(m.group(1), f)
    return out

def main():
    folders = sys.argv[1:] or [os.path.expanduser("~/Downloads")]
    found = scan(folders)
    q = lambda x: "'" + x.replace("'", "''") + "'"
    vals = ",".join("(%s,%s)" % (q(c), q(f)) for c, f in sorted(found.items()))
    print("-- %d videos named with a Creative ID" % len(found))
    print("with v(id,f) as (values %s), clr as (update public.media set local_file=null, local_at=null where local_file is not null and creative_id not in (select id from v)) "
          "update public.media m set local_file=v.f, local_at=now() from v where m.creative_id=v.id returning m.creative_id, m.client;" % (vals or "(null,null)"))

if __name__ == "__main__":
    main()
