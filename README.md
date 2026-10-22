# GADLYTICS

منصة متابعة أداء الحملات (Meta · TikTok · Snapchat · Google) — موقع ثابت + Supabase.

- `index.html` — المنصة (اتبنت من `mediabuyer-console.html` بـ `python3 tools/build.py`).
- `supa-db.js` — التخزين على Supabase بنفس واجهة المنصة + شاشة الدخول.
- `config.js` — رابط مشروع Supabase والـ anon key (عام ومحمي بـ RLS).
- `schema.sql` — جدول `docs` وقواعد الصلاحيات.

**سحب الأرقام** بيتم من Claude (MCP: Meta Ads · TikTok for Business · Snapchat) ويتكتب في جدول `docs` تحت `entries/<client>__<YYYY-MM-DD>`.
