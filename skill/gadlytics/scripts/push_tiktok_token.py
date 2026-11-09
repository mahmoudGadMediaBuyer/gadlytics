#!/usr/bin/env python3
"""GADLYTICS — turn a TikTok Marketing API auth_code into a long-term access token and save it for camp-apply.
After TikTok approves the app «GADLYTICS»: open its Advertiser authorization URL, pick the Molabi/Deiman ad
accounts, Confirm → the browser lands on the site with ?auth_code=… in the address bar. Then in Terminal.app:
  python3 ~/.gadlytics/push_tiktok_token.py <App ID> <Secret> <auth_code>
App ID and Secret are on the app's page (My Apps → GADLYTICS → View). The auth_code works once, for ~1 hour.
Stores TIKTOK_TOKEN in Supabase public.app_secrets through the ingest function. Never prints a secret."""
import json, os, sys, urllib.request

if len(sys.argv) != 4:
    raise SystemExit("الصيغة: python3 ~/.gadlytics/push_tiktok_token.py <App ID> <Secret> <auth_code>")
app_id, secret, code = (a.strip() for a in sys.argv[1:4])
API = "https://business-api.tiktok.com/open_api/v1.3/"

def post(path, body, tok=None):
    h = {"content-type": "application/json"}
    if tok: h["Access-Token"] = tok
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers=h, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=30))

r = post("oauth2/access_token/", {"app_id": app_id, "secret": secret, "auth_code": code})
if r.get("code") != 0:
    raise SystemExit("تيك توك رفض: %s — اطلب auth_code جديد (بيستخدم مرة واحدة وبيخلص بعد ساعة)" % r.get("message"))
tok = r["data"]["access_token"]
advs = r["data"].get("advertiser_ids") or []

import urllib.parse
info = json.load(urllib.request.urlopen(urllib.request.Request(
    API + "oauth2/advertiser/get/?" + urllib.parse.urlencode({"app_id": app_id, "secret": secret}),
    headers={"Access-Token": tok}), timeout=30))
names = [a.get("advertiser_name") for a in (info.get("data") or {}).get("list", [])]

key = open(os.path.expanduser("~/.gadlytics/ingest.key")).read().strip()
req = urllib.request.Request("https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest", method="POST",
      data=json.dumps({"table": "app_secrets", "rows": [{"name": "TIKTOK_TOKEN", "value": tok}]}).encode(),
      headers={"content-type": "application/json", "x-ingest-key": key})
res = json.load(urllib.request.urlopen(req, timeout=30))
print("تمام ✓ اتحفظ — الحسابات اللي التوكن شايفها (%d): %s" % (len(advs), ", ".join(n for n in names if n)), res)
