#!/usr/bin/env python3
"""GADLYTICS — turn raw ad-platform tool results into the files prep_ad_daily.py reads (meta.json / tiktok.json / snap.json).
No numbers are copied by hand: the inputs are the tool-result files (saved by the harness, or dumped with log_results.py).
  python3 ~/.gadlytics/platform_rows.py meta   <out_dir> <account_id> <account_name> <result files...>
  python3 ~/.gadlytics/platform_rows.py tiktok <out_dir> <account_id> <account_name> <result files...>
  python3 ~/.gadlytics/platform_rows.py snap   <out_dir> <account_id> <account_name> <stats files...> --names <ads.json> <squads.json> <campaigns.json>
Appends to <out_dir>/<platform>.json (dedup happens in prep_ad_daily)."""
import json, os, sys

def load(p):
    d = json.load(open(p, encoding="utf-8"))
    if isinstance(d, dict) and "text" in d and "input" in d:      # log_results.py dump
        d = d["text"]
        try: d = json.loads(d)
        except Exception: pass
    if isinstance(d, list) and d and isinstance(d[0], dict) and d[0].get("type") == "text":   # [{type:text,text:...}]
        d = json.loads(d[0]["text"])
    return d

def n(v):
    if v is None or v == "": return None
    if isinstance(v, dict): v = v.get("value")
    try: return float(v)
    except (TypeError, ValueError): return None

def meta(files, acc, accname):
    out = []
    for p in files:
        d = load(p); ents = d.get("ad_entities")
        ents = json.loads(ents) if isinstance(ents, str) else ents
        for r in ents or []:
            sp = r.get("amount_spent") or {}
            out.append({"date": r["date_start"], "platform": "meta", "level": "ad", "account_id": acc, "account_name": accname,
                "currency": (sp.get("unit") if isinstance(sp, dict) else None) or "SAR", "fx": 1,
                "campaign_id": r.get("campaign_id"), "campaign_name": r.get("campaign_name"), "adset_id": r.get("adset_id"), "adset_name": r.get("adset_name"),
                "ad_id": r.get("id"), "ad_name": r.get("name"), "video_id": "", "video_name": None,
                "spend": n(sp), "impressions": n(r.get("impressions")), "reach": n(r.get("reach")), "clicks": n(r.get("clicks")),
                "link_clicks": n(r.get("link_click")), "landing_page_views": n(r.get("omni_landing_page_view")),
                "video_plays": n(r.get("video_play_actions")), "video_2s": n(r.get("video_continuous_2_sec_watched_actions")), "video_6s": None,
                "thruplays": n(r.get("video_thruplay_watched_actions")), "video_p25": n(r.get("video_p25_watched_actions")),
                "video_p50": n(r.get("video_p50_watched_actions")), "video_p75": n(r.get("video_p75_watched_actions")), "video_p100": n(r.get("video_p100_watched_actions")),
                "view_content": n(r.get("omni_view_content")), "add_to_cart": n(r.get("omni_add_to_cart")), "initiate_checkout": n(r.get("omni_initiated_checkout")),
                "add_payment_info": None, "purchases": n(r.get("omni_purchase")), "revenue": n(r.get("omni_purchase_values")),
                "app_installs": n(r.get("omni_app_install")), "registrations": n(r.get("omni_complete_registration"))})
    return out

def tiktok(files, acc, accname):
    out = []
    for p in files:
        d = load(p)
        data = d.get("data", d) if isinstance(d, dict) else d
        rows = data.get("list") if isinstance(data, dict) else data
        for r in rows or []:
            dm, m = r.get("dimensions", {}), r.get("metrics", {})
            cp, vpc = n(m.get("complete_payment")), n(m.get("value_per_complete_payment"))
            out.append({"date": (dm.get("stat_time_day") or "")[:10], "platform": "tiktok", "level": "ad", "account_id": acc, "account_name": accname,
                "currency": m.get("currency") or "SAR", "fx": 1,
                "campaign_id": m.get("campaign_id"), "campaign_name": m.get("campaign_name"), "adset_id": m.get("adgroup_id"), "adset_name": m.get("adgroup_name"),
                "ad_id": dm.get("ad_id"), "ad_name": m.get("ad_name"), "video_id": "", "video_name": None,
                "spend": n(m.get("spend")), "impressions": n(m.get("impressions")), "reach": n(m.get("reach")), "clicks": n(m.get("clicks")),
                "link_clicks": None, "landing_page_views": n(m.get("total_landing_page_view")),
                "video_plays": n(m.get("video_play_actions")), "video_2s": n(m.get("video_watched_2s")), "video_6s": n(m.get("video_watched_6s")),
                "thruplays": None, "video_p25": n(m.get("video_views_p25")), "video_p50": n(m.get("video_views_p50")),
                "video_p75": n(m.get("video_views_p75")), "video_p100": n(m.get("video_views_p100")),
                "view_content": None, "add_to_cart": n(m.get("web_event_add_to_cart")), "initiate_checkout": n(m.get("initiate_checkout")),
                "add_payment_info": None,
                # web purchases (complete_payment) + app purchases (purchase / total_purchase_value)
                "purchases": (cp or 0) + (n(m.get("purchase")) or 0) if cp is not None or m.get("purchase") is not None else None,
                "revenue": ((cp or 0) * (vpc or 0)) + (n(m.get("total_purchase_value")) or 0) if cp is not None or m.get("total_purchase_value") is not None else None,
                "app_installs": n(m.get("app_install")), "registrations": n(m.get("registration"))})
    return out

def snap(files, acc, accname, names):
    ads, squads, camps = {}, {}, {}
    if names:
        for kind, store in zip(("ads", "adsquads", "campaigns"), (ads, squads, camps)):
            p = names.pop(0)
            for x in load(p).get(kind, []):
                o = x.get(kind[:-1]) or x.get("adsquad") or x.get("campaign") or x.get("ad") or {}
                nm = o.get("name"); nm = nm.get("value") if isinstance(nm, dict) else nm
                store[o.get("id")] = {"name": nm, "parent": o.get("ad_squad_id") or o.get("campaign_id")}
    out = []
    for p in files:
        d = load(p)
        for ts in d.get("timeseries_stats", []) or d.get("total_stats", []):
            s = ts.get("timeseries_stat") or ts.get("total_stat") or {}
            for brk in (s.get("breakdown_stats") or {}).get("ad", []):
                brk = brk.get("timeseries_stat") or brk
                ad = ads.get(brk["id"], {}); sq = squads.get(ad.get("parent"), {}); cp = camps.get(sq.get("parent"), {})
                for t in brk.get("timeseries", []):
                    st = t.get("stats", {})
                    st_t = t["start_time"]; st_t = st_t.get("value") if isinstance(st_t, dict) else st_t
                    out.append({"date": st_t[:10], "platform": "snap", "level": "ad", "account_id": acc, "account_name": accname,
                        "currency": "SAR", "fx": 1, "campaign_id": sq.get("parent"), "campaign_name": cp.get("name"),
                        "adset_id": ad.get("parent"), "adset_name": sq.get("name"), "ad_id": brk["id"], "ad_name": ad.get("name"),
                        "video_id": "", "video_name": None,
                        "spend": (n(st.get("spend")) or 0) / 1e6, "impressions": n(st.get("impressions")), "reach": None,
                        "clicks": n(st.get("swipes")), "link_clicks": n(st.get("swipes")), "landing_page_views": n(st.get("conversion_page_views")),
                        "video_plays": n(st.get("video_views")), "video_2s": None, "video_6s": None, "thruplays": None,
                        "video_p25": n(st.get("quartile_1")), "video_p50": n(st.get("quartile_2")), "video_p75": n(st.get("quartile_3")), "video_p100": n(st.get("view_completion")),
                        "view_content": n(st.get("conversion_view_content")), "add_to_cart": n(st.get("conversion_add_cart")),
                        "initiate_checkout": n(st.get("conversion_start_checkout")), "add_payment_info": n(st.get("conversion_add_billing")),
                        "purchases": n(st.get("conversion_purchases")),
                        "revenue": (n(st.get("conversion_purchases_value")) or 0) / 1e6 if st.get("conversion_purchases_value") is not None else None,
                        "app_installs": n(st.get("app_installs")) if "app_installs" in st else n(st.get("total_installs")),
                        "registrations": n(st.get("conversion_sign_ups"))})
    return out

if __name__ == "__main__":
    a = sys.argv[1:]
    plat, outdir, acc, accname = a[0], a[1], a[2], a[3]
    rest = a[4:]
    names = None
    if "--names" in rest:
        i = rest.index("--names"); names = rest[i + 1:]; rest = rest[:i]
    rows = {"meta": lambda: meta(rest, acc, accname), "tiktok": lambda: tiktok(rest, acc, accname),
            "snap": lambda: snap(rest, acc, accname, names)}[plat]()
    rows = [r for r in rows if (r.get("spend") or 0) > 0 or (r.get("impressions") or 0) > 0]
    os.makedirs(outdir, exist_ok=True)
    p = os.path.join(outdir, plat + ".json")
    old = json.load(open(p)) if os.path.exists(p) else []
    json.dump(old + rows, open(p, "w"), ensure_ascii=False)
    print(plat, "rows", len(rows), "spend", round(sum(r["spend"] or 0 for r in rows)), "→", p)
