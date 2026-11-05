-- يبني مستندات entries لعميل من غير خزامى (ديمان dm1n4an: تطبيق + متجر سلة).
-- الصرف والظهور والنقرات والقمع من المنصات (ad_daily — وApple Search Ads/جوجل من تكلفة AppsFlyer).
-- الطلبات والإيراد والتثبيتات والتسجيلات من conv_daily: AppsFlyer للتطبيق (المنصات المدفوعة بس، لكل حملة) + طلبات سلة (منصة "salla").
-- العضوي وQR وواتساب مش داخلين هنا (مش إعلانات). شغّله بـ execute_sql بعد كل سحب لديمان.
with ad as (
  select date, platform, coalesce(camp_no, campaign_name) ck, max(campaign_name) cname,
    sum(spend) spend, sum(impressions) impr, sum(coalesce(nullif(link_clicks,0),clicks)) clicks,
    sum(view_content) vc, sum(add_to_cart) atc, sum(initiate_checkout) ic
  from public.ad_daily where client_id='dm1n4an' and level='ad' group by 1,2,3),
cv as (
  select date, coalesce(platform,'salla') platform, case when channel='web' then 'المتجر (سلة)' else coalesce(camp_no, nullif(campaign,'')) end ck,
    sum(purchases) orders, sum(revenue) revenue, sum(installs) installs, sum(registrations) regs
  from public.conv_daily where client_id='dm1n4an' and (platform is not null or channel='web') group by 1,2,3),
names as (select platform, coalesce(camp_no, campaign_name) ck, max(campaign_name) cname from public.ad_daily where client_id='dm1n4an' group by 1,2),
j as (
  select coalesce(a.date,c.date) date, coalesce(a.platform,c.platform) platform,
    coalesce(a.cname, n.cname, c.ck, '—') campaign,
    a.spend, a.impr, a.clicks, a.vc, a.atc, a.ic,
    coalesce(c.orders,0) orders, coalesce(c.revenue,0) revenue, c.installs, c.regs
  from ad a full join cv c on a.date=c.date and a.platform=c.platform and a.ck=c.ck
  left join names n on n.platform=c.platform and n.ck=c.ck),
docs_new as (
  select date, jsonb_object_agg(platform||'|'||campaign, jsonb_build_object('platformId',platform,'campaign',campaign,
    'snaps', jsonb_build_array(jsonb_build_object(
      'ts', (extract(epoch from ((date::timestamp + interval '23 hours 59 minutes') at time zone 'Asia/Riyadh'))*1000)::bigint,
      'v', jsonb_strip_nulls(jsonb_build_object('spend',round(coalesce(spend,0),2),'impressions',impr,'clicks',clicks,'view_content',vc,'add_to_cart',atc,'checkouts',ic,
             'orders',orders,'revenue',round(revenue,2),'installs',installs,'registrations',regs)))))) as rows
  from (select date, platform, campaign, sum(spend) spend, sum(impr) impr, sum(clicks) clicks, sum(vc) vc, sum(atc) atc, sum(ic) ic,
          sum(orders) orders, sum(revenue) revenue, sum(installs) installs, sum(regs) regs from j group by 1,2,3) x
  group by date)
insert into public.docs (path, coll, data, updated_at)
select 'entries/dm1n4an__'||to_char(date,'YYYY-MM-DD'), 'entries',
  jsonb_build_object('clientId','dm1n4an','date',to_char(date,'YYYY-MM-DD'),'source','mcp+appsflyer+salla','updatedAt',(extract(epoch from now())*1000)::bigint,'rows',rows), now()
from docs_new
on conflict (path) do update set data = excluded.data, updated_at = now();
