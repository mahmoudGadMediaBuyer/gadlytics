#!/usr/bin/env python3
"""GADLYTICS — load the Snap OAuth secrets from ~/.claude/secrets into Supabase public.app_secrets
(via the ingest function) for the camp-apply fast path. Prints only names and lengths, never a value.
  python3 ~/.gadlytics/push_snap_secrets.py"""
import json, os, urllib.request
S = os.path.expanduser("~/.claude/secrets")
env = dict(l.strip().split("=", 1) for l in open(f"{S}/snap.env") if "=" in l and not l.startswith("#"))
tok = json.load(open(f"{S}/snap_token.json"))
rows = [{"name": "SNAP_CLIENT_ID", "value": env["CLIENT_ID"]},
        {"name": "SNAP_CLIENT_SECRET", "value": env["CLIENT_SECRET"]},
        {"name": "SNAP_REFRESH_TOKEN", "value": tok["refresh_token"]}]
key = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
req = urllib.request.Request("https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest", method="POST",
      data=json.dumps({"table": "app_secrets", "rows": rows}).encode(),
      headers={"content-type": "application/json", "x-ingest-key": key})
print(json.load(urllib.request.urlopen(req, timeout=30)), [(r["name"], len(r["value"])) for r in rows])
