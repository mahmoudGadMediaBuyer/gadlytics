# «ارفع الميديا» — رفع الفيديوهات الجديدة على المنصات

اللي بيطلب: زرار «⇪ ارفعها على المنصات» في لوحتي (الميديا الجديدة) أو «⇪ ارفع على المنصات» في مكتبة الكريتيف للفيديوهات المتحددة.
الطلب محفوظ في docs `sys/uploadreq` = {ids, at, by, status:"pending"}.

## القواعد (من محمود)
- النسخة: نسخة **سناب / الاستوري** من فولدر Drive — **مش نسخة تيك توك** أبداً. اسم الملف = رقم الكريتيف (Creative ID) زي Airtable.
- الفيديو بيترفع **زي ما هو** — من غير أي تعديل أو إضافات، على المنصات التلاتة.
- Meta: الحساب **312559678073897 بس**. TikTok: advertiser 7338783723795595266. Snap: 828aa8bb-bd63-44ee-8cf8-b735981ca06f.
- سناب: لو الفيديو مش 9:16 → يتظبط المقاس **عن طريق كانفا** (1080×1920) قبل الرفع. وقت الرفع **الميوزيك مقفولة** (أي اختيار ميوزيك/صوت أوتوماتيك في سناب = OFF).
- بعد ما يترفع على كل المنصات: **الفيديو يتمسح من الجهاز من كل الأماكن** (الفولدر المؤقت + أي تصدير من كانفا).
- في نفس الخطوة: غلاف الفيديو (أول لقطة) والهوك بيتعملوا ويتسجلوا في السيستم.
- ده رفع للمكتبة بس — **ممنوع** إنشاء أو تشغيل حملات أو إعلانات.

## الخطوات
1. الطلب: `select data from public.docs where path='sys/uploadreq'` (status لازم pending). هات الروابط:
   `select creative_id, url from public.media where creative_id in (...)`.
2. **كله بالتوازي — ممنوع فيديو فيديو:**
   أ) `python3 ~/.gadlytics/upload_media.py urls ID=URL ...` (ثانيتين) → direct_url لكل فيديو.
   ب) في نفس اللحظة شغّل في الخلفية: `python3 ~/.gadlytics/upload_media.py prep ID=URL ...` (٥ فيديوهات مع بعض: تنزيل + غلاف + هوك + رفع سناب + مسح).
   ج) وإنت مستني، ابعت كل رفعات Meta وكل رفعات TikTok **في رسالة واحدة** (كل النداءات مع بعض):
3. Meta: `ads_creative_upload_media` — ad_account_id=312559678073897، upload_source=URL، media_type=VIDEO، media_url=direct_url، name=ID.
   بعدها `ads_get_ad_videos` بكل الـ video_ids مرة واحدة لحد ما الحالة تبقى ready.
4. TikTok: `tool_get file_video_ad_upload` مرة واحدة للـ schema، وبعدين كل `tool_execute` بالتوازي: upload_type=UPLOAD_BY_URL، video_url=direct_url، file_name=ID
   (لو الاسم مستخدم: `file_name_check`). من غير أي auto-generated assets أو ميوزيك.
5. Snap لو needs_canva: `upload-asset-from-url` (direct_url) → design 1080×1920 فيه الفيديو بالمقاس → `export-design` mp4 →
   نزّل التصدير لفولدر مؤقت باسم ID.mp4 → `python3 ~/.gadlytics/upload_media.py snapfile ID PATH` (بيرفع ويمسح الملف).
   اتأكد في Snap Ads Manager إن الميديا من غير ميوزيك.
6. سجّل النتيجة لكل فيديو في `media_notes/<ID>` (execute_sql، merge):
   `update public.docs set data = coalesce(data,'{}') || jsonb_build_object('uploads', jsonb_build_object('meta', jsonb_build_object('id','…','at',now()), 'tiktok', …, 'snap', …)), updated_at=now() where path='media_notes/<ID>'`
   (ولو مفيش مستند: insert path='media_notes/<ID>', coll='media_notes').
7. اقفل الطلب: `update public.docs set data = data || jsonb_build_object('status','done','done_at',extract(epoch from now())*1000) where path='sys/uploadreq'`.
8. تأكد إن مفيش أي فيديو فاضل: `find /var/folders -maxdepth 4 -name "gad-up-*"` فاضي، ومفيش ملفات ID.mp4 في Downloads أو أي فولدر اشتغلنا فيه.
9. لخّص لمحمود: كام فيديو اترفع على كل منصة، والـ IDs، وأي حاجة فشلت.
