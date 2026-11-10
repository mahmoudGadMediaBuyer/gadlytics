#!/usr/bin/env python3
"""GADLYTICS — revoke a gad-api key by name (it stops working within 30 seconds).
  python3 ~/.gadlytics/revoke_api_key.py instinct
Goes through the ingest function (sets revoked_at on public.api_keys). Never prints any key."""
import json, os, re, sys, urllib.request

if len(sys.argv) != 2 or not re.fullmatch(r"[A-Za-z0-9 _.-]{1,60}", sys.argv[1]):
    raise SystemExit("الصيغة: python3 ~/.gadlytics/revoke_api_key.py <اسم المفتاح>")
ingest = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
req = urllib.request.Request("https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest", method="POST",
      data=json.dumps({"table": "api_keys", "rows": [{"name": sys.argv[1].strip(), "revoke": True}]}).encode(),
      headers={"content-type": "application/json", "x-ingest-key": ingest})
try:
    res = json.load(urllib.request.urlopen(req, timeout=30))
except urllib.error.HTTPError as e:
    raise SystemExit("السيرفر رفض (HTTP %s): %s" % (e.code, e.read().decode()[:200]))
n = res.get("revoked", 0)
print("تمام ✓ المفتاح «%s» اتلغى — بيبطل خلال 30 ثانية." % sys.argv[1] if n else "مفيش مفتاح شغال بالاسم ده: %s" % sys.argv[1])
