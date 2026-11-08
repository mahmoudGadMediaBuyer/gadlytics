# «أداء الحملات» — تنفيذ الطلبات اللي جاية من الصفحة

الموقع مبيكلمش المنصات ولا خزامى. الصفحة بتكتب طلبات في docs، وClaude بينفّذها لما Mahmoud يقول «نفّذ طلبات الحملات».
(مهمة مجدولة تنفّذ تعديلات الميزانية لوحدها اترفضت من صلاحيات الأوتو مود في 2026-11-08 — متعملهاش من غير ما Mahmoud يوافق صراحة.)
Supabase ibpwudzjwjraqhfdmzet · العملاء: ملبي 3sa3k1k (خزامى) · ديمان dm1n4an (AppsFlyer + سلة) · المفتاح ~/.gadlytics/ingest.key (متطبعوش).

## 0) فيه طلبات؟ (لو لأ: اقفل فوراً من غير أي نداء تاني)
execute_sql:
select path, data from public.docs where (path='sys/campreq' and data->>'status'='pending') or (coll='campchg' and data->>'status'='pending') order by updated_at;

## 1) تعديل ميزانية / مزايدة — docs campchg/<id>
data: {client, platform, level ("campaign"|"adset"), objId, name, field ("budget"|"bid"), bidType, from, to, status, at, by}
قبل التنفيذ: تأكد إن الكيان ده موجود في camp_struct لنفس العميل والمنصة (select * from camp_struct where id='<objId>' and client_id='<client>') ومنها خد account_id.
عدّل الحقل ده بس — ممنوع تلمس أي إعداد تاني (استهداف، حالة، إعلانات). ميزانية = يومية بالريال.
- Meta (ads_update_entity، entity_type campaign أو ad_set، ad_account_id = account_id):
  budget → fields {"daily_budget": <to×100>} (بالهللة) · bid → fields {"bid_amount": <to×100>} على الـ ad set.
  الـ MCP فيه Draft mode: لو الرد is_draft=true انشر التعديل ده بس بـ ads_activate_entity على نفس الكيان. لو status_forced_to_paused=true أو الحالة بقت PAUSED: اعتبره فشل وبلّغ.
  اتأكد بـ ads_get_ad_entities (object_ids=[id]) إن daily_budget/bid_amount = to والحالة لسه ACTIVE.
- TikTok (advertiser من account_id):
  Ad group Smart+ budget → smart_plus_adgroup_budget_update {"budget":[{"adgroup_id":id,"budget":to}]}.
  Campaign CBO budget → smart_plus_campaign_update (budget) أو tool_execute "campaign_update" للحملات العادية.
  Target CPA → smart_plus_adgroup_update بـ conversion_bid_price=to (أو tool_execute "adgroup_update" للعادية). اقرا schema الأداة بـ tool_get قبل أول استخدام.
  اتأكد بـ smart_plus_adgroup_get / smart_plus_campaign_get.
- Snap (الـ MCP قراية بس): python3 ~/.gadlytics/snap_update.py campaign|adsquad <id> budget|bid <to>  (--usd لحساب الدولار). بيطبع القيمة بعد التعديل.
بعد النجاح:
  update public.docs set data=data||jsonb_build_object('status','done','done_at',(extract(epoch from now())*1000)::bigint,'applied',<to>) where path='campchg/<id>';
  update public.camp_struct set daily_budget=<to> (أو bid=<to>), updated_at=now() where client_id='<client>' and platform='<pl>' and id='<objId>';
  وسجّله في سجل التغييرات — ingest table auto_changes بنفس شكل meta_changes.py:
  {id:"auto_cp_<docid>", ts:<now ms>, date:<اليوم>, type:"budget"|"bid", by:"<by> · أداء الحملات", field:"الميزانية اليومية"|"<bidType>", note:<name>,
   metric:"roas", win:3, clientId:<client>, platformId:<platform>, auto:true, src:"campperf", edits:[{t:"HH:MM", old:<from>, new:<to>}],
   objectId:<objId>, level:<level>, campaign:<camp_no من camp_struct>}
لو فشل: status 'failed' + 'error' (جملة عربي قصيرة)، ومتعيدش المحاولة لوحدك.

## 2) تحديث الأرقام — docs sys/campreq {client, from, to}
الأرقام اللي في الصفحة بس — مش Airtable ولا الكفرات ولا ميكس بانل.
1. المنصات → ad_daily للأيام from..to للعميل ده بس (نفس خطوة 1 في daily_pull.md؛ ديمان: قسم ديمان).
2. ملبي: خزامى → khzama_link_daily لنفس الأيام (خطوة 2 في daily_pull.md). ديمان: AppsFlyer + سلة → conv_daily.
3. الحالة والميزانيات (camp_struct):
   - Meta: ads_get_ad_entities level campaign (name, effective_status, daily_budget, lifetime_budget, bid_strategy) و level adset (name, campaign_id, effective_status, daily_budget, lifetime_budget, bid_strategy, bid_amount)، filtering effective_status IN [ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, WITH_ISSUES, IN_PROCESS]، date_preset maximum، limit 1000، لكل حساب (الصفحة بتعدّل ميزانيات الموقفة كمان).
   - TikTok: tool_execute "campaign_get" و "adgroup_get" (page_size 1000، من غير فلتر حالة) — بيرجّعوا Smart+ كمان ومعاهم operation_status (smart_plus_adgroup_get مفيهوش حالة).
   - Snap: snap_ads_ad_account_get_campaigns + snap_ads_ad_account_get_ad_squads (والدولار بالتوكن المحلي).
   LOG=$(ls -t ~/.claude/projects/*/*.jsonl | head -1); log_results.py لكل أداة → python3 ~/.gadlytics/camp_struct_prep.py <client> OUT.json meta:<acc>:campaign=… …
   SQL: update public.camp_struct set status='stale' where client_id='<client>';  ثم ingest table camp_struct.
4. rebuild_entries.sql (ملبي) أو rebuild_entries_conv.sql (ديمان).
5. update public.docs set data=data||jsonb_build_object('status','done','done_at',(extract(epoch from now())*1000)::bigint) where path='sys/campreq';

حسابات ملبي: Meta 312559678073897 + 1355849785679367 · TikTok 7338783723795595266 · Snap 828aa8bb-bd63-44ee-8cf8-b735981ca06f (+ Mulabbi [1] دولار 961fd033-… بالتوكن).
حسابات ديمان: Meta 7804393009576374 · TikTok 7267941711098494977 · Snap 6a32423a-eeb3-46e3-92f6-e9db866afc4d.
