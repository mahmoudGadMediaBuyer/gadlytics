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

## Learned on the first run (2026-11-04)
- **TikTok:** `file_video_ad_upload` answers NOT_AVAILABLE / IN_ROLL_OUT for advertiser 7338783723795595266 ("estimated December"). Call shape: `tool_execute` with `params` (not `arguments`). Until it opens, skip TikTok and say so.
- **Snap:** the API accepts only 9:16 **and at least 1080×1920**. Most Snap.mp4 files are 607–617×1080 → Snap rejects them (E2601). The script now uploads to Snap only when the file qualifies and returns `needs_canva` otherwise — don't create a Snap media item first (a failed upload leaves an empty PENDING_UPLOAD item).
- **Meta:** URL upload of the Drive direct link works; status goes uploading → processing → ready within minutes.
- Use `prep --keep=ID,ID` for videos that already have a hooked cover, so their cover isn't replaced by a plain frame.

## Snap resize via Canva — the working recipe (2026-11-04)
1. `upload-asset-from-url` each Snap.mp4 direct link (name = Creative ID) → video asset ids.
2. `create-design` (format "Instagram Story") gives a 1080×1920 page (it comes with a template — that's fine).
3. `read-design` with open_transaction → `edit-design` keep_open: delete every element on page 1, `insert_fill` video at top 0 / left 0 / 1080×1920; `add_page` 1080×1920 for each further video and `insert_fill` the next video on it. One video per page, nothing else.
4. Show Mahmoud the page thumbnails and get his OK → `edit-design` commit (Canva requires approval before saving).
5. `export-design` mp4, quality `vertical_1080p`, one call per page (`pages: [n]`).
6. Download each export to a temp folder, check 1080×1920 and the same length as the original, upload to Snap (reuse an empty PENDING_UPLOAD item of the same name if one exists), delete the file.

## TikTok via Chrome (until the API opens)
- **Check first:** `tool_execute file_video_ad_search` (params advertiser_id, page_size 100) and look for `file_name` starting with the Creative ID — most videos are already in the TikTok library; don't upload duplicates.
- Creative Library → Upload or import → «Upload from computer». Before clicking, patch `HTMLInputElement.prototype.click` for type=file in the page so the Mac file picker doesn't open; then `file_upload` to the input (≤10 MB per call — one file at a time). TikTok rejects non-9:16 files (e.g. 720×1260) — use the Canva 1080×1920 export for those.
- Files over 10 MB can't go through Chrome. «Import from Meta» (Meta account Molabi [2] 312559678073897, linked 2026-11-04) shows Meta's videos newest first, but the imported file has no `.mp4` extension and TikTok rejects it with a format error — not usable. Ask Mahmoud to upload those himself.
