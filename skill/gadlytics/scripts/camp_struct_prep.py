#!/usr/bin/env python3
"""GADLYTICS — «أداء الحملات»: status, CBO/ABO, daily budget and bid of every ACTIVE campaign / ad set → camp_struct rows.
Inputs are tool-result files (harness tool-results/*.txt or log_results.py dumps), never hand-copied numbers:
  python3 ~/.gadlytics/camp_struct_prep.py <client_id> <out.json> \
     meta:<account_id>:campaign=<file> meta:<account_id>:adset=<file> \
     tiktok:<advertiser_id>:campaign=<file> tiktok:<advertiser_id>:adgroup=<file> \
     snap:<ad_account_id>:campaign=<file> snap:<ad_account_id>:adsquad=<file> [snapusd:...]
Meta: ads_get_ad_entities level campaign (name, effective_status, daily_budget, lifetime_budget, bid_strategy) and level adset
      (name, campaign_id, effective_status, daily_budget, lifetime_budget, bid_strategy, bid_amount), effective_status IN [ACTIVE].
TikTok: smart_plus_campaign_get / smart_plus_adgroup_get (effective_statuses ACTIVE) or tool_execute campaign_get / adgroup_get.
Snap: snap_ads_ad_account_get_campaigns / get_ad_squads (only status ACTIVE is kept). USD accounts: prefix snapusd (×3.75).
Before ingesting, mark the client's old rows stale (SQL): update camp_struct set status='stale' where client_id='<id>';"""
import json, re, sys

def load(p):
    d = json.load(open(p, encoding="utf-8"))
    if isinstance(d, dict) and "text" in d and "input" in d:
        d = d["text"]
        try: d = json.loads(d)
        except Exception: pass
    if isinstance(d, list) and d and isinstance(d[0], dict) and d[0].get("type") == "text":
        d = json.loads(d[0]["text"])
    return d

def v(x):
    if isinstance(x, dict): x = x.get("value")
    try: return float(x) if x not in (None, "") else None
    except (TypeError, ValueError): return None

def s(x): return x.get("value") if isinstance(x, dict) else x
CAMP = re.compile(r'\s*-?(?:Copy \d+ of )?([A-Z]{2,4}-\d{3,6})')
def code(n): m = CAMP.match(n or ""); return m.group(1) if m else None
META_BID = {"highest volume": None, "lowest_cost_without_cap": None, "cost per result goal": "Cost cap", "cost_cap": "Cost cap",
            "bid cap": "Bid cap", "lowest_cost_with_bid_cap": "Bid cap", "roas goal": "ROAS goal", "lowest_cost_with_min_roas": "ROAS goal"}

def main():
    cid, out = sys.argv[1], sys.argv[2]
    rows, camp_bid = [], {}
    def row(pl, lvl, id_, parent, acc, name, status, mode, daily, life, bt, bid):
        rows.append({"client_id": cid, "platform": pl, "level": lvl, "id": str(id_), "parent_id": str(parent) if parent else None,
                     "account_id": str(acc), "name": name, "camp_no": code(name), "status": status, "budget_mode": mode,
                     "daily_budget": daily, "lifetime_budget": life, "bid_type": bt, "bid": bid})
    specs = sys.argv[3:]
    # campaigns first so ad sets can inherit the campaign bid strategy (Meta CBO cost caps)
    specs.sort(key=lambda a: 0 if ":campaign=" in a else 1)
    for a in specs:
        head, path = a.split("=", 1); pl, acc, lvl = head.split(":")
        d = load(path); fx = 3.75 if pl == "snapusd" else 1
        if pl == "meta":
            ents = d.get("ad_entities"); ents = json.loads(ents) if isinstance(ents, str) else ents
            for e in ents or []:
                if str(e.get("effective_status", "")).upper() != "ACTIVE": continue
                daily = v(e.get("daily_budget")); life = v(e.get("lifetime_budget")); daily = daily if daily else None; life = life if life else None
                bt = META_BID.get(str(e.get("bid_strategy") or "").lower())
                if lvl == "campaign":
                    camp_bid[e["id"]] = bt
                    row("meta", "campaign", e["id"], None, acc, e.get("name"), "active", "CBO" if (daily or life) else "ABO", daily, life, bt, None)
                else:
                    bt = bt or camp_bid.get(e.get("campaign_id"))
                    row("meta", "adset", e["id"], e.get("campaign_id"), acc, e.get("name"), "active", None, daily, life, bt, v(e.get("bid_amount")) if bt else None)
        elif pl == "tiktok":
            lst = (d.get("data") or {}).get("list") or []
            for e in lst:
                if lvl == "campaign":
                    if e.get("operation_status") not in (None, "ENABLE"): continue
                    cbo = bool(e.get("budget_optimize_on")) or (e.get("budget_mode") not in (None, "BUDGET_MODE_INFINITE") and (e.get("budget") or 0) > 0)
                    row("tiktok", "campaign", e["campaign_id"], None, acc, e.get("campaign_name"), "active", "CBO" if cbo else "ABO",
                        float(e["budget"]) if cbo and e.get("budget") else None, None, None, None)
                else:
                    if e.get("operation_status") not in (None, "ENABLE"): continue
                    bt, bid = None, None
                    if (e.get("conversion_bid_price") or 0) > 0: bt, bid = "Target CPA", float(e["conversion_bid_price"])
                    elif (e.get("roas_bid") or 0) > 0: bt, bid = "Target ROAS", float(e["roas_bid"])
                    elif e.get("bid_type") == "BID_TYPE_CUSTOM" and (e.get("bid_price") or 0) > 0: bt, bid = "Bid cap", float(e["bid_price"])
                    b = e.get("budget")
                    row("tiktok", "adset", e["adgroup_id"], e.get("campaign_id"), acc, e.get("adgroup_name"), "active", None,
                        float(b) if b else None, None, bt, bid)
        elif pl in ("snap", "snapusd"):
            key = "campaigns" if lvl == "campaign" else "adsquads"
            for x in d.get(key) or []:
                e = x.get(key[:-1]) or x.get("adsquad") or x
                if str(s(e.get("status"))).upper() != "ACTIVE": continue
                daily = (e.get("daily_budget_micro") or 0) / 1e6 * fx or None
                if lvl == "campaign":
                    cbo = str(s(e.get("pacing_level"))).upper() == "CAMPAIGN" and daily
                    row("snap", "campaign", e["id"], None, acc, s(e.get("name")), "active", "CBO" if cbo else "ABO", daily if cbo else None, None, None, None)
                else:
                    bs = str(s(e.get("bid_strategy")) or "").upper()
                    bt = "Target cost" if bs == "TARGET_COST" else "Max bid" if bs == "LOWEST_COST_WITH_MAX_BID" else None
                    bid = (e.get("bid_micro") or 0) / 1e6 * fx if bt else None
                    row("snap", "adset", e["id"], e.get("campaign_id"), acc, s(e.get("name")), "active", None, daily, None, bt, bid or None)
    json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    from collections import Counter
    print(Counter((r["platform"], r["level"]) for r in rows), "rows", len(rows))

if __name__ == "__main__": main()
