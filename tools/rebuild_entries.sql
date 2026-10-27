-- يبني مستندات entries (اللي التقارير ومركز الإجراءات بيقروها) لعميل واحد:
-- الصرف والظهور والنقرات والقمع من المنصات (ad_daily) — والطلبات والإيراد من خزامى (khzama_link_daily)
with ad as (
  select date, platform, coalesce(camp_no, campaign_name) ck, max(campaign_name) cname,
    sum(spend) spend, sum(impressions) impr, sum(coalesce(nullif(link_clicks,0),clicks)) clicks,
    sum(view_content) vc, sum(add_to_cart) atc, sum(initiate_checkout) ic
  from public.ad_daily where client_id='3sa3k1k' and level='ad' group by 1,2,3),
kz as (
  select date, platform, camp_no ck, sum(donations) orders, sum(amount) revenue
  from public.khzama_link_daily where client_id='3sa3k1k' and platform in ('meta','tiktok','snap') and camp_no is not null group by 1,2,3),
names as (select platform, camp_no ck, max(campaign_name) cname from public.ad_daily where client_id='3sa3k1k' and camp_no is not null group by 1,2),
j as (
  select coalesce(a.date,k.date) date, coalesce(a.platform,k.platform) platform,
    coalesce(a.cname, n.cname, k.ck, '—') campaign,
    a.spend, a.impr, a.clicks, a.vc, a.atc, a.ic, coalesce(k.orders,0) orders, coalesce(k.revenue,0) revenue
  from ad a full join kz k on a.date=k.date and a.platform=k.platform and a.ck=k.ck
  left join names n on n.platform=k.platform and n.ck=k.ck),
docs_new as (
  select date, jsonb_object_agg(platform||'|'||campaign, jsonb_build_object('platformId',platform,'campaign',campaign,
    'snaps', jsonb_build_array(jsonb_build_object(
      'ts', (extract(epoch from ((date::timestamp + interval '23 hours 59 minutes') at time zone 'Asia/Riyadh'))*1000)::bigint,
      'v', jsonb_strip_nulls(jsonb_build_object('spend',round(coalesce(spend,0),2),'impressions',impr,'clicks',clicks,'view_content',vc,'add_to_cart',atc,'checkouts',ic,'orders',orders,'revenue',round(revenue,2))))))) as rows
  from (select date, platform, campaign, sum(spend) spend, sum(impr) impr, sum(clicks) clicks, sum(vc) vc, sum(atc) atc, sum(ic) ic, sum(orders) orders, sum(revenue) revenue from j group by 1,2,3) x
  group by date)
insert into public.docs (path, coll, data, updated_at)
select 'entries/3sa3k1k__'||to_char(date,'YYYY-MM-DD'), 'entries',
  jsonb_build_object('clientId','3sa3k1k','date',to_char(date,'YYYY-MM-DD'),'source','mcp+khzama','updatedAt',(extract(epoch from now())*1000)::bigint,'rows',rows), now()
from docs_new
on conflict (path) do update set data = excluded.data, updated_at = now();
