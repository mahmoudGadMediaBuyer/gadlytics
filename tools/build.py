"""يبني index.html للموقع من ملف المنصة (mediabuyer-console.html).
تشغيل:  python3 tools/build.py   (من جوه فولدر gadlytics-site)"""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("GAD_SRC", os.path.join(os.path.dirname(ROOT), "mediabuyer-console.html"))
app = open(SRC, encoding="utf-8").read()
head = """<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
<script src="config.js"></script>
<script src="supa-db.js"></script>
</head>
<body>
"""
open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(head + app + "\n</body>\n</html>\n")
print("index.html", os.path.getsize(os.path.join(ROOT, "index.html")), "bytes from", SRC)
