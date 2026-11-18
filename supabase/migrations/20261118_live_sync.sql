-- GADLYTICS live sync (Nov 18 2026): the Chrome extension reads TikTok Ads Manager + the Deiman backend from the page
-- and the edge function live-push merges them here. Nothing on any ad account changes.

-- 1) TikTok spend from the Ads Manager page, per ad group (Smart+ shows one row per ad group).
--    Existing MCP rows (real ad ids) of that ad group are SCALED so their sum equals the page; when the ad group has no
--    MCP row yet, one row ad_id 'live:<adgroup_id>' carries it. A later MCP row for the same ad group deletes the live row (trigger).
create or replace function public.live_tiktok_merge(p_client text, p_account text, p_date date, p_currency text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; ag text; ls numeric; li bigint; lc bigint; n int; rs numeric; ri numeric; scaled int := 0; live int := 0;
  cname text; cno text; cr text;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    ag := r->>'adgroup_id'; ls := coalesce((r->>'spend')::numeric, 0); li := coalesce((r->>'impressions')::bigint, 0); lc := coalesce((r->>'clicks')::bigint, 0);
    select count(*), coalesce(sum(spend), 0), coalesce(sum(impressions), 0) into n, rs, ri from ad_daily
      where client_id = p_client and date = p_date and platform = 'tiktok' and level = 'ad' and account_id = p_account and adset_id = ag and ad_id not like 'live:%';
    if n > 0 then
      delete from ad_daily where client_id = p_client and date = p_date and platform = 'tiktok' and account_id = p_account and adset_id = ag and ad_id like 'live:%';
      update ad_daily a set spend = round(ls * w.f, 2), impressions = round(li * w.f), clicks = round(lc * w.f), pulled_at = now()
      from (select ad_id, video_id, case when rs > 0 then spend / rs when ri > 0 then impressions::numeric / ri else 1.0 / n end f
            from ad_daily where client_id = p_client and date = p_date and platform = 'tiktok' and level = 'ad' and account_id = p_account and adset_id = ag and ad_id not like 'live:%') w
      where a.client_id = p_client and a.date = p_date and a.platform = 'tiktok' and a.level = 'ad' and a.account_id = p_account and a.ad_id = w.ad_id and a.video_id = w.video_id;
      scaled := scaled + n;
    else
      cname := r->>'campaign_name'; cno := substring(cname from '([A-Z]{2,4}-\d{4,6})'); cr := substring(coalesce(r->>'ad_name', '') from '(\d{14})');
      insert into ad_daily (client_id, date, platform, level, account_id, account_name, currency, fx, campaign_id, campaign_name, adset_id, adset_name,
                            ad_id, ad_name, video_id, creative_id, camp_no, spend, impressions, clicks, pulled_at)
      values (p_client, p_date, 'tiktok', 'ad', p_account, null, p_currency, 1, r->>'campaign_id', cname, ag, r->>'adgroup_name',
              'live:' || ag, r->>'ad_name', '', cr, cno, ls, li, lc, now())
      on conflict (client_id, date, platform, level, account_id, ad_id, video_id) do update set
        spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, campaign_name = excluded.campaign_name,
        adset_name = excluded.adset_name, ad_name = excluded.ad_name, camp_no = excluded.camp_no, creative_id = excluded.creative_id, pulled_at = now();
      live := live + 1;
    end if;
  end loop;
  return jsonb_build_object('scaled_rows', scaled, 'live_rows', live,
    'stored_spend', (select round(coalesce(sum(spend), 0), 2) from ad_daily where client_id = p_client and date = p_date and platform = 'tiktok' and level = 'ad' and account_id = p_account));
end $$;

-- a real (MCP) TikTok row for an ad group removes the live placeholder of that ad group + day
create or replace function public.ad_daily_drop_live() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.platform = 'tiktok' and new.ad_id not like 'live:%' and new.adset_id is not null then
    delete from ad_daily where client_id = new.client_id and date = new.date and platform = 'tiktok' and account_id = new.account_id
      and adset_id = new.adset_id and ad_id like 'live:%';
  end if;
  return null;
end $$;
drop trigger if exists ad_daily_drop_live on public.ad_daily;
create trigger ad_daily_drop_live after insert on public.ad_daily for each row execute function public.ad_daily_drop_live();

-- 2) Molabi entries rebuild as a function (same SQL as ~/.gadlytics/rebuild_entries.sql, from p_from on)
create or replace function public.rebuild_entries_3sa3k1k(p_from date default current_date - 3)
returns void language sql security definer set search_path = public as $$
with ad as (
  select date, platform, coalesce(camp_no, campaign_name) ck, max(campaign_name) cname,
    sum(spend) spend, sum(impressions) impr, sum(coalesce(nullif(link_clicks,0),clicks)) clicks,
    sum(view_content) vc, sum(add_to_cart) atc, sum(initiate_checkout) ic
  from public.ad_daily where client_id='3sa3k1k' and level='ad' and date >= p_from group by 1,2,3),
kz as (
  select date, platform, camp_no ck, sum(donations) orders, sum(amount) revenue
  from public.khzama_link_daily where client_id='3sa3k1k' and platform in ('meta','tiktok','snap') and camp_no is not null and date >= p_from group by 1,2,3),
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
$$;

revoke all on function public.live_tiktok_merge(text, text, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.ad_daily_drop_live() from public, anon, authenticated;
revoke all on function public.rebuild_entries_3sa3k1k(date) from public, anon, authenticated;
