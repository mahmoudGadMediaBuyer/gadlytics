# GADLYTICS

منصة متابعة أداء الحملات (Meta · TikTok · Snapchat) لملبي — موقع ثابت على GitHub Pages + Supabase.
القاعدة: **كل الميتركس من المنصات الإعلانية، والطلبات والإيراد (ومعاهم ROAS/CPA/AOV) من خزامى.**

## الملفات
- `index.html` — المنصة كلها (بتتبني من `mediabuyer-console.html` بـ `python3 tools/build.py`).
- `supa-db.js` — التخزين على Supabase بنفس واجهة المنصة + شاشة الدخول.
- `config.js` — رابط مشروع Supabase والـ anon key (عام ومحمي بـ RLS).
- `schema.sql` — جدول `docs` وقواعد الصلاحيات.
- `tools/build.py` — يبني `index.html`.
- `tools/prep_ad_daily.py` — يجهّز سحب المنصات لجدول `ad_daily` (الدولار ×3.75).
- `tools/rebuild_entries.sql` — يبني التقارير اليومية (الصرف من `ad_daily` والطلبات/الإيراد من خزامى).
- `supabase/functions/ai` — المساعد الذكي (Claude API — المفتاح سر في Supabase).
- دالتين شغالين على Supabase ومصدرهم **مش هنا عمداً** لأن الريبو عام:
  - `ingest` (استقبال البيانات) — فيها مفتاح.
  - `media-sync` («تحديث المكتبة» من Airtable) — فيها لينك المشاركة الخاص ببورد Airtable.

## قاعدة البيانات (Supabase)
| الجدول / العرض | فيه إيه |
|---|---|
| `docs` | إعدادات المنصة والتقارير اليومية `entries/…` واللقطات والملاحظات (`media_notes/…`) |
| `ad_daily` | أرقام المنصات يوم بيوم لكل إعلان وفيديو (Meta · TikTok · Snap الريال والدولار) |
| `khzama_link_daily` | طلبات وإيراد خزامى لكل رابط يوم بيوم (أكواد ME/TT/SC/bio/com/DM) |
| `snapshots` | لقطات «اليوم مباشر» التراكمية |
| `media` | فيديوهات بورد Airtable بكل أعمدته + الهوك المكتوب أوتوماتيك |
| `v_media_perf` / `v_media_daily` | أداء كل فيديو (صرف المنصات + خزامى) — من غير تكرار Smart+ |

## السحب
السحب بيتم من Claude (MCP: Meta Ads · TikTok for Business · Snapchat، وخزامى من Chrome)، والموقع بيعرض بس.
