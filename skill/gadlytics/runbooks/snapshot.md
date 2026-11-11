# GADLYTICS — لقطة اليوم المباشر لملبي (كل ربع ساعة)

Supabase project: ibpwudzjwjraqhfdmzet · client_id: 3sa3k1k · كله قراية بس من الحسابات الإعلانية وخزامى.
القاعدة: الصرف من المنصات؛ الطلبات والإيراد من خزامى (أكواد ME/TT/SC/bio/com/DM بس). كل الأرقام تراكمية من أول اليوم (بتوقيت الرياض) لحد اللحظة.

## 0) هل فيه لقطة مستحقة؟ (لو لأ اقفل فوراً من غير أي حاجة تانية)
execute_sql:
  insert into public.docs(path,coll,data) values('config/snapsched','config','{"every":30,"start":"09:00","on":true}') on conflict (path) do nothing;
  select data, now() at time zone 'Asia/Riyadh' as now_riyadh from public.docs where path='config/snapsched';
مستحقة لو: data.requested مش null، أو (data.on مش false و الساعة في الرياض ≥ data.start و (data.nextAt null أو now ≥ nextAt − دقيقتين)).
لو مش مستحقة: خلّص بسطر واحد "مفيش لقطة مستحقة" ومتعملش أي حاجة تانية.

## 1) الصرف من المنصات (النهارده لحد دلوقتي)
- Meta: ads_get_ad_entities لكل حساب (312559678073897 و 1355849785679367)، level "account"، time_range {since: النهارده, until: النهارده}، fields ["amount_spent"]
  (client_model "claude-opus-5-5"، advertiser_job report_measure_or_look_up، reporting_purpose ["metric_lookup"]، include_additional_context false). اجمع الحسابين.
- TikTok: report_integrated_get advertiser_id 7338783723795595266، report_type BASIC، data_level AUCTION_ADVERTISER، dimensions ["advertiser_id"]، start_date=end_date=النهارده، metrics ["spend"].
- Snap: snap_ads_get_ad_account_stats ad_account_id 828aa8bb-bd63-44ee-8cf8-b735981ca06f، granularity "DAY"، start_time النهارده T00:00:00+03:00، end_time بكره T00:00:00+03:00، fields "spend" (micro ÷ 1,000,000).
لو منصة فشلت: سجّل spend = null للمنصة دي وكمّل.

## 2) خزامى (Claude in Chrome)
1. افتح تاب جديد على https://admin.molabi.sa/affiliateLinks (لو طلب تسجيل دخول: وقّف وبلّغ — متكتبش باسوردات).
2. ⛔ متاخدش هيدرز/توكن ومتعملش XHR لـ api.molabi.sa (مصنّف الأمان بيوقفه). اقرا الصفحة زي daily_pull.md §2 بالظبط:
   navigate لـ /affiliateLinks?fromDate=<النهارده>&toDate=<بكره>&size=1000&page=N (الـ 3 صفحات) + wait 7 + كود JS بتاع §2 خطوة 3.
3. (اتشال — مفيش نداء API مباشر.)
4. من الصفوف اللي رجعت ([id,title,donations,amount]) اجمع التبرعات والمبلغ حسب الكود (6 أرقام × 2):
   الكود = المجموعة الرابعة من ^-?([A-Z]{2,4}-\d{3,6})-(?:([A-Za-z]+)-)?(\d{14}(?:~\d{14})*)-([A-Za-z]{2,3})-(.+)$ ،
   ولو مطابقش: -(ME|TT|SC)- من العنوان، أو العنوان نفسه لو (بعد trim) bio أو com أو DM (case-insensitive، سجّله bio/com/DM).
   أي كود تاني يتجاهل (تبع أقسام تانية).
5. اقفل التاب.

## 3) التسجيل
execute_sql (taken_at = الوقت الحالي مقرّب للدقيقة، date = تاريخ النهارده بتوقيت الرياض):
  insert into public.snapshots (client_id,date,taken_at,source,spend,revenue,donations) values
   ('3sa3k1k',D,T,'meta',<meta spend>,<ME amount>,<ME n>), ('3sa3k1k',D,T,'tiktok',..TT..), ('3sa3k1k',D,T,'snap',..SC..),
   ('3sa3k1k',D,T,'bio',null,..), ('3sa3k1k',D,T,'com',null,..), ('3sa3k1k',D,T,'DM',null,..)
  on conflict (client_id,taken_at,source) do update set spend=excluded.spend, revenue=excluded.revenue, donations=excluded.donations;
وبعدها حدّث المواعيد (nextAt = T + every دقيقة):
  update public.docs set data = data || jsonb_build_object('nextAt', <nextAt ISO>, 'requested', null, 'last', <T ISO>), updated_at=now() where path='config/snapsched';

## 4) التقرير
سطر واحد بالعربي المصري: وقت اللقطة، صرف كل منصة، وطلبات وإيراد خزامى، وأي حاجة فشلت.
