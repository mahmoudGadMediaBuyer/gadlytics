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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="gad-build" content="__BUILD__">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="GADLYTICS">
<meta name="theme-color" content="#0C111D">
<script>
/* تحديث تلقائي للتطبيق على الموبايل/الآيباد: مفيش service worker ولا كاش. كل ما التطبيق يتفتح أو يرجع للواجهة
   بيجيب index.html جديد (no-store) ويقارن رقم البيلد؛ لو فيه نسخة أحدث بيفتحها على طول. */
(function(){ var B="__BUILD__", last=0;
  function busy(){ return document.querySelector("#cpIn:focus, .ma-sheet, input:focus, textarea:focus"); }
  function chk(){ var n=Date.now(); if(n-last<20000) return; last=n; if(busy()) return;
    /* Nov 16 2026: reads the tiny version.txt (≈15 bytes) instead of downloading the whole 1.7 MB page every time */
    fetch(location.pathname.replace(/[^\/]*$/,"")+"version.txt?_b="+n,{cache:"no-store"}).then(function(r){ return r.ok? r.text() : ""; }).then(function(t){
      var v=String(t||"").trim(); if(/^\d{14}$/.test(v)&&v!==B&&!busy()){ var u=new URL(location.href); u.searchParams.set("_v",v); location.replace(u.toString()); } }).catch(function(){}); }
  document.addEventListener("visibilitychange",function(){ if(!document.hidden) chk(); });
  window.addEventListener("pageshow",function(){ setTimeout(chk,1500); }); window.addEventListener("focus",chk); setInterval(chk,300000); })();
</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
<script src="config.js"></script>
<script src="supa-db.js"></script>
</head>
<body>
"""
import time
BUILD = time.strftime("%Y%m%d%H%M%S", time.gmtime())
head = head.replace("__BUILD__", BUILD)
open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(head + app + "\n</body>\n</html>\n")
open(os.path.join(ROOT, "version.txt"), "w", encoding="utf-8").write(BUILD + "\n")   # upload together with index.html
print("build", BUILD, "· index.html", os.path.getsize(os.path.join(ROOT, "index.html")), "bytes from", SRC)
