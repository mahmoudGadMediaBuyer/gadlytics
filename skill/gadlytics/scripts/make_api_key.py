#!/usr/bin/env python3
"""GADLYTICS — create an API key for an AI assistant (instinct, Claude, ChatGPT…) to read the system through gad-api.
Run it yourself in Terminal.app:
  python3 ~/.gadlytics/make_api_key.py instinct            # read-only key (also works inside r.html links: #key=…)
  python3 ~/.gadlytics/make_api_key.py claude --refresh    # read + «تحديث الأرقام» (header only, never in links)
  python3 ~/.gadlytics/make_api_key.py instinct --edit     # read + edit budget/bid/on-off (r.html#key=… links: the key stays
                                                           #   in the URL hash and goes in the x-api-key header — never ?key=)
  python3 ~/.gadlytics/make_api_key.py khzama-live --khzama  # ONLY POST /khzama/push + /khzama/status (the Chrome extension
                                                           #   gadlytics-site/khzama-live) — can't read anything else
The key is printed ONCE and copied to the clipboard. Only its SHA-256 hash is stored (Supabase public.api_keys, through
the ingest function). Same name again = the old key with that name stops working and the new one replaces it.
Revoke: python3 ~/.gadlytics/revoke_api_key.py <name>"""
import hashlib, json, os, re, secrets, subprocess, sys, urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--")]
refresh = "--refresh" in sys.argv[1:]
edit = "--edit" in sys.argv[1:]
khzama = "--khzama" in sys.argv[1:]
if khzama and (refresh or edit):
    raise SystemExit("--khzama مينفعش مع --refresh أو --edit (مفتاح خزامى بيبعت صفوف خزامى بس)")
if len(args) != 1 or not re.fullmatch(r"[A-Za-z0-9 _.-]{1,60}", args[0]):
    raise SystemExit("الصيغة: python3 ~/.gadlytics/make_api_key.py <اسم بالإنجليزي زي instinct> [--refresh] [--edit] | --khzama")
name = args[0].strip()
key = "gad_" + secrets.token_urlsafe(32)
row = {"name": name, "key_hash": hashlib.sha256(key.encode()).hexdigest(), "scopes": ["khzama"] if khzama else ["read"] + (["refresh"] if refresh else []) + (["edit"] if edit else [])}

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
if khzama:
    print("تمام ✓ مفتاح خزامى «%s» اتعمل (بعت صفوف خزامى بس — مبيقراش حاجة) واتنسخ في الحافظة — احفظه دلوقتي، مش هيظهر تاني:\n\n  %s\n" % (name, key))
    print("حطه في إعدادات إضافة «GADLYTICS · خزامى لحظي» (أو في gadlytics-site/khzama-live/key.local.json: {\"key\": \"...\"}).")
    print("Endpoints: %s/khzama/push · %s/khzama/status" % (base, base))
    raise SystemExit(0)
what = " + ".join(["قراية"] + (["تحديث الأرقام"] if refresh else []) + (["تعديل الحملات"] if edit else [])) if (refresh or edit) else "قراية بس"
print("تمام ✓ المفتاح «%s» اتعمل (%s) واتنسخ في الحافظة — احفظه دلوقتي، مش هيظهر تاني:\n\n  %s\n" % (name, what, key))
print("MCP:     %s/mcp      (هيدر x-api-key + Authorization: Bearer <anon> + apikey: <anon> — الـ anon من config.js)" % base)
print("OpenAPI: %s/openapi.json" % base)
r = "https://mahmoudgadmediabuyer.github.io/gadlytics/r.html#key=<المفتاح>&client=3sa3k1k"
if refresh:
    print("المفتاح ده فيه صلاحية تحديث — يتبعت في الهيدر بس، مينفعش يتحط في لينك.")
else:
    print("لينك التقرير لـ instinct: %s&period=today" % r)
if edit and not refresh:
    print("لينك تعديل:          %s&edit=1&code=MGG-03059&field=budget&to=500   (field: budget | bid | status · to: رقم بالريال أو on/off · ABO: &adset=<id>)" % r)
    print("اللينك بيعرض معاينة بس — التعديل بيحصل لما تدوس «تأكيد التعديل». مفتاح التعديل مينفعش في ?key= (r.html بيبعته في الهيدر).")
