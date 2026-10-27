"""يجهّز ملفات السحب (meta/tiktok/snap.json) لجدول ad_daily على Supabase.
- يحوّل أي عملة غير الريال بسعر fx (الدولار = 3.75)
- يفك اسم الحملة والإعلان (MGG-… | PR: | VR: | SE: | OB: … و ID: | CT: | IN: | AS:)
تشغيل: python3 tools/prep_ad_daily.py <client_id> <in_dir> <out_file>"""
import json, re, sys, os
CID, IN, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
MONEY = ["spend", "revenue"]
NUM = ["impressions","reach","clicks","link_clicks","landing_page_views","video_plays","video_2s","video_6s","thruplays",
       "video_p25","video_p50","video_p75","video_p100","view_content","add_to_cart","initiate_checkout","add_payment_info","purchases"]
def tag(s, k):
    m = re.search(r'(?:^|\|)\s*' + k + r'\s*:\s*([^|]+)', s or "")
    return re.sub(r'\s*-\s*Copy(\s*\d+)?\s*$', '', m.group(1).strip(), flags=re.I) if m else None
rows = []
for f in ["meta.json", "tiktok.json", "snap.json", "snap_usd.json"]:
    p = os.path.join(IN, f)
    if not os.path.exists(p): continue
    for r in json.load(open(p)):
        fx = float(r.get("fx") or 1)
        if (r.get("currency") or "SAR").upper() == "USD" and fx == 1: fx = 3.75
        cn, an, vn = r.get("campaign_name") or "", r.get("ad_name") or "", r.get("video_name") or ""
        m14 = re.search(r'(?<!\d)(20\d{12})(?!\d)', vn) or re.search(r'(?<!\d)(20\d{12})(?!\d)', an)
        cr = tag(an, "ID") or (m14.group(1) if m14 else None)
        if cr and "~" in cr: cr = cr.split("~")[0]
        o = {"client_id": CID, "date": r["date"], "platform": r["platform"], "level": r.get("level") or "ad",
             "account_id": str(r["account_id"]), "account_name": r.get("account_name"), "currency": r.get("currency") or "SAR", "fx": fx,
             "campaign_id": str(r.get("campaign_id") or "") or None, "campaign_name": cn or None,
             "adset_id": str(r.get("adset_id") or "") or None, "adset_name": r.get("adset_name"),
             "ad_id": str(r.get("ad_id") or ""), "ad_name": an or None,
             "video_id": str(r.get("video_id") or ""), "video_name": vn or None,
             "creative_id": cr, "product": tag(an, "PR") or tag(cn, "PR"), "variation": tag(an, "VR") or tag(cn, "VR"),
             "season": tag(cn, "SE"), "objective": tag(cn, "OB"), "content_type": tag(an, "CT"), "influencer": tag(an, "IN"),
             "ad_size": tag(an, "AS"), "camp_no": (re.match(r'\s*-?([A-Z]{2,4}-\d{4,6})', cn).group(1) if re.match(r'\s*-?[A-Z]{2,4}-\d{4,6}', cn) else None)}
        for k in MONEY:
            v = r.get(k); o[k] = None if v is None else round(float(v) * fx, 2)
        for k in NUM:
            v = r.get(k); o[k] = None if v is None else int(round(float(v)))
        rows.append(o)
# دمج أي صفوف مكررة على نفس المفتاح
key = lambda o: (o["date"], o["platform"], o["level"], o["account_id"], o["ad_id"], o["video_id"])
merged = {}
for o in rows:
    k = key(o)
    if k in merged:
        m = merged[k]
        for f in MONEY + NUM:
            if o[f] is not None: m[f] = (m[f] or 0) + o[f]
    else: merged[k] = o
out = list(merged.values())
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
from collections import defaultdict
t = defaultdict(lambda: [0, 0, 0.0, 0])
for o in out:
    x = t[(o["platform"], o["level"])]; x[0] += 1; x[1] += o["purchases"] or 0; x[2] += o["revenue"] or 0; x[3] += o["spend"] or 0
for k, v in sorted(t.items()): print(k, "rows", v[0], "spend", round(v[3]), "purchases", v[1], "revenue", round(v[2]))
print("total rows", len(out), "bytes", os.path.getsize(OUT))
