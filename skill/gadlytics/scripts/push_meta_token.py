#!/usr/bin/env python3
"""GADLYTICS — save the Meta long-lived user token for the camp-apply fast path.
Copy the token (Access Token Debugger → green token after «Extend Access Token»), then run in Terminal:
  python3 ~/.gadlytics/push_meta_token.py
It reads the clipboard, checks the token with Meta, stores it in Supabase public.app_secrets (META_TOKEN)
through the ingest function, then empties the clipboard. It never prints the token."""
import json, os, subprocess, urllib.parse, urllib.request

import getpass
ok = lambda t: t.startswith("EAA") and len(t) >= 100 and not any(c.isspace() for c in t)
import sys
tok = sys.argv[1].strip() if len(sys.argv) > 1 else subprocess.run(["pbpaste"], capture_output=True, text=True).stdout.strip()
if not ok(tok):
    # clipboard was replaced (e.g. a screenshot) — ask for it instead; the input is hidden, nothing shows on screen
    tok = "".join(getpass.getpass("الصق التوكن هنا (Cmd+V) ودوس Enter — مش هيظهر على الشاشة: ").split())
if not ok(tok):
    raise SystemExit("ده مش توكن ميتا — انسخ التوكن الأخضر الطويل من Access Token Debugger وجرّب تاني")

q = urllib.parse.urlencode({"fields": "name", "access_token": tok})
try:
    me = json.load(urllib.request.urlopen("https://graph.facebook.com/v21.0/me?" + q, timeout=30))
    acc = json.load(urllib.request.urlopen("https://graph.facebook.com/v21.0/act_312559678073897?" +
                                           urllib.parse.urlencode({"fields": "name", "access_token": tok}), timeout=30))
except urllib.error.HTTPError as e:
    raise SystemExit("ميتا رفضت التوكن (HTTP %s) — طلّعه تاني" % e.code)

key = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
req = urllib.request.Request("https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest", method="POST",
      data=json.dumps({"table": "app_secrets", "rows": [{"name": "META_TOKEN", "value": tok}]}).encode(),
      headers={"content-type": "application/json", "x-ingest-key": key})
r = json.load(urllib.request.urlopen(req, timeout=30))
subprocess.run(["pbcopy"], input="", text=True)   # don't leave the token on the clipboard
print("تمام ✓  اتحفظ — الحساب: %s · بيشوف: %s · طول التوكن %d" % (me.get("name"), acc.get("name"), len(tok)), r)
