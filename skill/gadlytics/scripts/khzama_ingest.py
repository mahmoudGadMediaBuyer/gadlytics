#!/usr/bin/env python3
"""خزامى → khzama_link_daily من الصفوف اللي اتقرت من شاشة admin.molabi.sa/affiliateLinks.
الاستخدام: python3 ~/.gadlytics/khzama_ingest.py DAYS.json [--dry]
DAYS.json = {"YYYY-MM-DD": [[id, title, donations, amount], ...], ...}  (يوم فاضي = [])
بيحوّل بالـ regex بتاع runbook daily_pull §2 ويبعت كل يوم لـ ingest (x-ingest-key + Bearer anon). مبيطبعش أي مفتاح."""
import json, re, sys, os, hashlib, urllib.request, urllib.error
RX = re.compile(r'^-?([A-Z]{2,4}-\d{3,6})-(?:([A-Za-z0-9_]+)-)?(\d{14}(?:~\d{14})*)-([A-Za-z]{2,3})-(.+)$')
PLAT = {'ME': 'meta', 'TT': 'tiktok', 'SC': 'snap', 'GG': 'google'}

def conv(date, lid, title, d, a):
    t = (title or '').strip()
    if lid in (None, ''):
        lid = 't:' + hashlib.sha1(t.encode()).hexdigest()[:16]
    row = dict(client_id='3sa3k1k', date=date, link_id=str(lid), title=title, camp_no=None, custom=None,
               creative_id=None, code=None, platform=None, product=None, rest=None, donations=int(d or 0), amount=a or 0)
    m = RX.match(t)
    if m:
        camp, custom, cr, code, rest = m.groups()
        row.update(camp_no=camp, custom=custom, creative_id=cr.split('~')[0], code=code,
                   platform=PLAT.get(code, code), rest=rest, product=rest.split('-')[0])
    else:
        mc = re.match(r'^-?([A-Z]{2,4}-\d{3,6})', t)
        if mc: row['camp_no'] = mc.group(1)
        mk = re.search(r'-(ME|TT|SC)-', t)
        if mk: row['code'] = mk.group(1)
        elif t in ('bio', 'com', 'DM'): row['code'] = t
        if row['code']: row['platform'] = PLAT.get(row['code'], row['code'])
        mi = re.search(r'\d{14}', t)
        if mi: row['creative_id'] = mi.group(0)
    return row

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry' in sys.argv
    days = json.load(open(args[0]))
    key = open(os.path.expanduser('~/.gadlytics/ingest.key')).read().strip()
    cfg = open('/Users/mahmoudgad/Desktop/claude/gadlytics-site/config.js').read()
    m = re.search(r'supabaseAnonKey\s*:\s*["\']([^"\']+)', cfg)
    anon = m.group(1) if m else None
    for day in sorted(days):
        rows = [conv(day, *r) for r in days[day]]
        ads = [r for r in rows if r['code'] in ('ME', 'TT', 'SC')]
        own = [r for r in rows if r['code'] in ('bio', 'com', 'DM')]
        s = lambda rs, k: sum(r[k] for r in rs)
        msg = f"{day} links={len(rows)} don={s(rows,'donations')} amt={s(rows,'amount')} | ME/TT/SC {s(ads,'donations')}/{s(ads,'amount')} | bio/com/DM {s(own,'donations')}/{s(own,'amount')}"
        if dry or not rows:
            print(msg, '(dry)' if dry else '(empty, nothing sent)'); continue
        h = {'Content-Type': 'application/json', 'x-ingest-key': key}
        if anon: h['Authorization'] = 'Bearer ' + anon; h['apikey'] = anon
        req = urllib.request.Request('https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest',
                                     data=json.dumps({'table': 'khzama_link_daily', 'rows': rows}).encode(), headers=h, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=60) as r: print(msg, '->', r.status, r.read()[:80].decode())
        except urllib.error.HTTPError as e: print(msg, '-> HTTP', e.code, e.read()[:200].decode())

if __name__ == '__main__':
    main()
