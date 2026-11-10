#!/usr/bin/env python3
"""GADLYTICS — create an API key for an AI assistant (instinct, Claude, ChatGPT…) to read the system through gad-api.
Run it yourself in Terminal.app:
  python3 ~/.gadlytics/make_api_key.py instinct            # read-only key (also works inside r.html links: #key=…)
  python3 ~/.gadlytics/make_api_key.py claude --refresh    # read + «تحديث الأرقام» (header only, never in links)
The key is printed ONCE and copied to the clipboard. Only its SHA-256 hash is stored (Supabase public.api_keys, through
the ingest function). Same name again = the old key with that name stops working and the new one replaces it.
Revoke: python3 ~/.gadlytics/revoke_api_key.py <name>"""
import hashlib, json, os, re, secrets, subprocess, sys, urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--")]
refresh = "--refresh" in sys.argv[1:]
if len(args) != 1 or not re.fullmatch(r"[A-Za-z0-9 _.-]{1,60}", args[0]):
    raise SystemExit("الصيغة: python3 ~/.gadlytics/make_api_key.py <اسم بالإنجليزي زي instinct> [--refresh]")
name = args[0].strip()
key = "gad_" + secrets.token_urlsafe(32)
row = {"name": name, "key_hash": hashlib.sha256(key.encode()).hexdigest(), "scopes": ["read", "refresh"] if refresh else ["read"]}

ingest = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
req = urllib.request.Request("https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest", method="POST",
      data=json.dumps({"table": "api_keys", "rows": [row]}).encode(),
      headers={"content-type": "application/json", "x-ingest-key": ingest})
try:
    res = json.load(urllib.request.urlopen(req, timeout=30))
except urllib.error.HTTPError as e:
    raise SystemExit("السيرفر رفض (HTTP %s): %s" % (e.code, e.read().decode()[:200]))
if not res.get("ok"):
    raise SystemExit("مااتحفظش: %s" % res)

subprocess.run(["pbcopy"], input=key, text=True)
base = "https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/gad-api"
print("تمام ✓ المفتاح «%s» اتعمل (%s) واتنسخ في الحافظة — احفظه دلوقتي، مش هيظهر تاني:\n\n  %s\n" %
      (name, "قراية + تحديث الأرقام" if refresh else "قراية بس", key))
print("MCP:     %s/mcp      (هيدر x-api-key + Authorization: Bearer <anon> + apikey: <anon> — الـ anon من config.js)" % base)
print("OpenAPI: %s/openapi.json" % base)
if not refresh:
    print("لينك لـ instinct: https://mahmoudgadmediabuyer.github.io/gadlytics/r.html#key=<المفتاح>&client=3sa3k1k&period=today")
else:
    print("المفتاح ده فيه صلاحية تحديث — يتبعت في الهيدر بس، مينفعش يتحط في لينك.")
