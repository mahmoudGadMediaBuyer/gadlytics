# GADLYTICS — السحب اليومي لملبي (Molabi)

القاعدة: الصرف وباقي الأرقام من المنصات؛ الطلبات والإيراد من خزامى (أكواد ME/TT/SC + bio/com/DM بس).
Supabase project: ibpwudzjwjraqhfdmzet · client_id: 3sa3k1k · مفتاح الاستقبال: ~/.gadlytics/ingest.key (متطبعوش في أي رد)
Ingest endpoint: https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/ingest
  - من Bash: POST JSON {"table":..., "rows":[...]} مع هيدر x-ingest-key (≤ ~2 MB لكل طلب، قسّم لو أكبر)
  - من صفحة خزامى في Chrome: fetch لـ supabase.co ممنوع → استخدم form POST (حقول key/table/rows) لـ iframe مخفي
الجداول المسموحة: ad_daily, khzama_link_daily, snapshots, khzama_rev, media, mx_daily

## ⚡ تحديث سريع («تحديث سريع» أو sys/pullreq فيه mode="quick")
النهارده بس (بتوقيت الرياض)، وبأقل خطوات — الهدف دقايق مش ساعة:
1. خطوة 1 (المنصات → ad_daily) ليوم النهارده بس.
2. خطوة 2 (خزامى) ليوم النهارده بس.
3. خطوة 4 (rebuild_entries.sql) ثم خطوة 6 (اقفل الطلب).
اتخطّى: ميكس بانل، سجل نشاط Meta، الميزانيات، الكفرات، الـ video stats، والتقرير الطويل — سطر واحد بس: صرف كل منصة النهارده + طلبات وإيراد خزامى.

## الأيام
آخر 3 أيام منتهية (امبارح وقبله يومين، بتوقيت الرياض) — علشان التحويلات المتأخرة تتحدث.

## 1) المنصات → ad_daily (level=ad، يومي)
اكتب الملفات في مجلد مؤقت DIR بالشكل اللي يقراه prep_ad_daily.py (meta.json / tiktok.json / snap.json)، كل صف:
{date, platform, level, account_id, account_name, currency, fx, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, video_id, video_name, spend, impressions, reach, clicks, link_clicks, landing_page_views, video_plays, video_2s, video_6s, thruplays, video_p25, video_p50, video_p75, video_p100, view_content, add_to_cart, initiate_checkout, add_payment_info, purchases, revenue}
- Meta (ads_get_ad_entities): الحسابين 312559678073897 و 1355849785679367، level "ad", time_range للأيام، time_increment "1", filtering amount_spent GREATER_THAN 0, limit 1000,
  fields: name,campaign_id,campaign_name,adset_id,adset_name,amount_spent,impressions,reach,clicks,link_click,omni_landing_page_view,omni_view_content,omni_add_to_cart,omni_initiated_checkout,omni_purchase,omni_purchase_values,video_play_actions,video_continuous_2_sec_watched_actions,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions
  (client_model "claude-opus-5-5"، advertiser_job report_measure_or_look_up، reporting_purpose ["metric_lookup"], include_additional_context false)
- TikTok (report_integrated_get): advertiser_id 7338783723795595266, BASIC, AUCTION_AD, dimensions ["ad_id","stat_time_day"], filtering ad_status STATUS_ALL, page_size 1000,
  metrics: campaign_id,campaign_name,adgroup_id,adgroup_name,ad_name,spend,impressions,reach,clicks,video_play_actions,video_watched_2s,video_watched_6s,video_views_p25,video_views_p50,video_views_p75,video_views_p100,complete_payment,value_per_complete_payment,initiate_checkout,total_landing_page_view,web_event_add_to_cart
  revenue = value_per_complete_payment × complete_payment. view_content = null.
  فيديوهات Smart+ (level "material"): tool_execute "smart_plus_material_report_breakdown_run" لكل يوم لوحده، dimensions ["main_material_id"]، start=end=اليوم، page_size 100؛ video_id = main_material_id، video_name = main_material_name؛ اربط كل material بالإعلان اللي ad_name بيبدأ بنفس اسم الملف وفي نفس اليوم (نفس الصرف) لاستخراج ad_id/campaign.
- Snap (snap_ads_get_ad_account_stats): ad_account_id 828aa8bb-bd63-44ee-8cf8-b735981ca06f, breakdown "ad", granularity "DAY", start/end بتوقيت +03:00 (end exclusive), omit_empty true,
  fields spend,impressions,swipes,video_views,quartile_1,quartile_2,quartile_3,view_completion,conversion_page_views,conversion_view_content,conversion_add_cart,conversion_start_checkout,conversion_add_billing,conversion_purchases,conversion_purchases_value (spend و value بالـ micro ÷ 1,000,000). الأسماء من snap_ads_ad_account_get_ads / get_ad_squads / get_campaigns.
- Snap الدولار (Mulabbi [1]، بيزنس «Tamkeen» — الـ connector مش شايفه، فبيتسحب بالتوكن المحلي):
  python3 ~/.gadlytics/snap_usd_pull.py <أول يوم> <آخر يوم> DIR/snap_usd.json   (الدولار بيتحول لريال ×3.75 في الخطوة اللي بعدها)
بعدها: python3 ~/.gadlytics/prep_ad_daily.py 3sa3k1k DIR OUT.json → ابعت OUT.json لـ ingest (table ad_daily) على دفعات 1500 صف.

## 2) خزامى → khzama_link_daily (Claude in Chrome)
1. افتح تاب جديد في جروب التابات بتاعك على https://admin.molabi.sa/affiliateLinks (لو طلب تسجيل دخول: وقّف وبلّغ — متكتبش باسوردات).
2. خد هيدرز الطلب من الصفحة نفسها (متطبعهمش):
   hook على XMLHttpRequest.prototype.open/setRequestHeader يحفظ الهيدرز لأي URL فيه AdminAffiliateLink في window.__hh،
   وبعدين history.pushState لـ '/affiliateLinks?toDate=...&keyword=ME&fromDate=...' + dispatch PopStateEvent، واستنى 6 ثواني.
3. لكل يوم: XHR POST https://api.molabi.sa/api/AdminAffiliateLink/search بالهيدرز Accept/Content-Type/Authorization والبودي
   {"Page":1,"PageSize":5000,"searchKey":"","fromDate":"YYYY-MM-DDT00:00:00.000Z","toDate":"YYYY-MM-DDT23:59:59.000Z","affiliateId":null}
   (التواريخ بتوقيت الرياض ومكتوب عليها Z). الرد data[] فيه id,title,numberOfDonations,totalDonationAmount.
4. خد الصفوف اللي فيها تبرعات أو مبلغ، وحوّل كل واحد لـ:
   {client_id:'3sa3k1k', date, link_id:String(id), title, camp_no, custom, creative_id, code, platform, product, rest, donations, amount}
   بالـ regex: ^-?([A-Z]{2,4}-\d{3,6})-(?:([A-Za-z]+)-)?(\d{14}(?:~\d{14})*)-([A-Za-z]{2,3})-(.+)$  → camp, custom, creative (أول ID)، code، rest (product = أول كلمة).
   لو مطابقش: camp من ^[A-Z]{2,4}-\d{3,6}، code من -(ME|TT|SC)- أو العنوان نفسه لو bio/com/DM، creative أول 14 رقم. platform: ME→meta, TT→tiktok, SC→snap.
5. ابعت كل يوم بـ form POST (حقول key/table=khzama_link_daily/rows=JSON) لـ iframe مخفي باسم جديد لكل طلب.
6. اتأكد بـ execute_sql: select date, count(*), sum(donations), sum(amount) from public.khzama_link_daily where client_id='3sa3k1k' and date in (...) group by 1.
7. اقفل التاب بتاعك.

## 3) ميكس بانل → mx_daily (سلوك الزوار على الموقع — مش بديل لخزامى)
Mixpanel project 3769752 (Molabi)، أداة Run-Query (report_type "insights", chartType "line"). نفس الأيام (FROM = أول يوم، TO = النهارده).
فلتر المشتريات الوهمية على كل metric بتاع purchase: {"type":"string","propertyName":"$current_url","operator":"does not contain","value":"gtm-msr"}
اسم كل تقرير لازم يبقى بالظبط "GAD mx <dim>" (الاسم ده هو اللي بيتسحب بيه من اللوج):
- "GAD mx aff": unit day، breakdown affiliate، metrics: page_view, view_content, add_to_cart, begin_checkout (basic total) + purchase total (بالفلتر) + purchase aggregate-property total على value (بالفلتر) + checkout_error.
- "GAD mx dev": unit day، breakdown $device، نفس metrics اللي فوق + $session_start في الأول.
- "GAD mx src": unit day، breakdown utm_source، metric $session_start.
- "GAD mx pay": unit day، breakdown payment_method، purchase total + purchase sum value (بالفلتر).
- "GAD mx city": unit day، breakdown $city، purchase total (بالفلتر) + purchase sum value (بالفلتر) — لمختبر الاختبارات (إيقاف المدن).
- "GAD mx hour": unit hour، من غير breakdown: $session_start, view_content, begin_checkout, purchase (بالفلتر), purchase sum value (بالفلتر).
بعدها (من غير ما تنسخ الأرقام بإيدك):
  LOG=$(ls -t ~/.claude/projects/*/*.jsonl | head -1); python3 ~/.gadlytics/mx_from_log.py "$LOG" DIR/mx
  for d in aff dev src pay hour city; do python3 ~/.gadlytics/mx_prep.py $d DIR/mx/$d.json; done
(لو mx_from_log ملقاش تقرير: اكتب نتيجة Run-Query زي ما هي في DIR/mx/<dim>.json وشغّل mx_prep عليه.)
mx_prep بيحتفظ بلينكات أكوادك بس (ME/TT/SC/bio/com/DM) والباقي بيتجمّع في _other.

## 3b) سجل نشاط Meta → سجل التغييرات (أوتوماتيك)
ads_account_get_activity_logs للحسابين 312559678073897 و 1355849785679367، من أول يوم في الأيام لحد دلوقتي (start_time ISO)،
مرة بـ event_category "budget" ومرة "campaign" ومرة "status" ومرة "ad" (limit 300). متكتبش الأرقام بإيدك — بعدها:
  LOG=$(ls -t ~/.claude/projects/*/*.jsonl | head -1); python3 ~/.gadlytics/meta_changes.py "$LOG"
السكريبت بيشيل أحداث Meta نفسها (فوترة، جماهير، مراجعة إعلانات) و«Pending Process»، وبيجمّع تعديلات اليوم لكل حملة في سطر،
وبيكتبها في docs changes/auto_meta_... (إعادة التشغيل مش بتكرر).

## 3c) ميزانيات TikTok وسناب (لقطة يومية — مفيش سجل نشاط متاح ليهم)
- TikTok: tool_execute "campaign_get" و "smart_plus_campaign_get" (advertiser 7338783723795595266) — للحملات الشغالة (operation_status ENABLE) أو اللي صرفت في الأيام دي:
  الميزانية اليومية = budget لو budget_mode يومي، ولو الميزانية على مستوى الـ adgroup اجمع budgets المجموعات من "adgroup_get".
- Snap: snap_ads_ad_account_get_campaigns + get_ad_squads (828aa8bb-...) — daily_budget_micro ÷ 1,000,000 (والحساب الدولار × 3.75).
اكتب [{platform, campaign_id, name, budget, status}] في DIR/budgets.json وبعدين:
  python3 ~/.gadlytics/budget_snapshot.py DIR/budgets.json
الموقع بيقارن كل يوم باللي قبله، فأي فرق بيتحسب «تغيير ميزانية» لليوم ده (من غير ساعة). لما TikTok يفعّل الـ change log (changelog_task_create — متوقع ديسمبر) يتسحب زي Meta.

## 3d) غلاف وهوك الفيديوهات الجديدة (مكتبة الكريتيف)
الفيديوهات اللي لسه مالهاش غلاف: صورة أول لقطة + أول جملة. الفيديو بيتنزّل لفولدر مؤقت ويتمسح على طول — ممنوع يفضل أي فيديو على الجهاز.
1. execute_sql (حط الناتج في ملف من نتيجة الأداة، متكتبش الأرقام بإيدك):
   with sp as (select creative_id, sum(spend) s from public.v_media_perf group by 1)
   select json_agg(json_build_object('id',m.creative_id,'url',m.url,'h',(coalesce(m.hook,'')<>'' and m.hook not ilike 'http%') or coalesce(m.hook_auto,'')<>'' or coalesce(d.data->>'hook','')<>'','t',m.thumb is not null) order by coalesce(sp.s,0) desc) as gad_thumb_queue
   from public.media m left join sp on sp.creative_id=m.creative_id left join public.docs d on d.coll='media_notes' and d.path='media_notes/'||m.creative_id
   where m.client='ملبي' and m.kind='Video' and m.style in ('مشهور','مودل','ابداعي') and m.thumb is null;
2. اكتب الـ JSON في ~/.gadlytics/thumb_queue.json وشغّل: python3 ~/.gadlytics/media_assets.py   (في الخلفية؛ ~15–60 ث للفيديو؛ اللوج في ~/.gadlytics/media_assets.log)
3. اتأكد إن مفيش فولدرات مؤقتة فاضلة: find /var/folders -maxdepth 4 -name "gad-media-*" لازم يرجع فاضي.

## 3e) تصنيف هوكات الفيديوهات الجديدة (الأنماط والدرجة في مكتبة الكريتيف)
execute_sql: select creative_id, coalesce(nullif(hook,''),nullif(hook_full,''),nullif(hook_auto,'')) h from public.media where kind='Video' and ai_tags is null and coalesce(nullif(hook,''),nullif(hook_full,''),nullif(hook_auto,'')) is not null;
لكل واحد قيمة واحدة من كل قايمة (بالعربي بالظبط، من أول كلام في الهوك):
- hook_type: سؤال | قصة | رقم أو حقيقة | آية أو حديث أو دعاء | نداء مباشر | وصف مشهد | شهادة | أخرى
- angle: الأجر والثواب | الحاجة والمعاناة | الأثر والنتيجة | الإلحاح والموسم | سهولة التبرع | الصدقة الجارية | الإهداء عن الغير | أخرى
- emotion: تعاطف | أمل | إلحاح | روحاني | امتنان وفخر | فضول | محايد
update public.media m set ai_tags=v.t::jsonb from (values ('<id>','{"hook_type":"…","angle":"…","emotion":"…","v":1}'),…) v(id,t) where m.creative_id=v.id;
(المشاهدات والتكرار ومنحنى المشاهدة مش محتاجين خطوة: بيتحسبوا من ad_daily في v_video_stats.)

## 4) إعادة بناء التقارير
execute_sql بمحتوى ~/.gadlytics/rebuild_entries.sql (بيبني entries لكل الأيام: الصرف من ad_daily والطلبات/الإيراد من خزامى).

## 5) التقرير
سطرين بالعربي المصري: الأيام اللي اتسحبت، صرف كل منصة، وطلبات وإيراد خزامى لأكواد ME/TT/SC، وجلسات ودفع ميكس بانل، وأي حاجة فشلت.
متعدّلش أي حاجة في الحسابات الإعلانية — كله قراية بس.

## 6) اقفل طلب «حدّث كل حاجة» (لو موجود)
بعد ما السحب يخلص، execute_sql:
update public.docs set data = data || jsonb_build_object('status','done','done_at',(extract(epoch from now())*1000)::bigint) where path='sys/pullreq' and data->>'status'='pending';
(الزرار في «لوحتي» بيسجّل الطلب؛ ولو المستخدم قال «اسحب دلوقتي» نفّذ الـ runbook ده كله فوراً.)
