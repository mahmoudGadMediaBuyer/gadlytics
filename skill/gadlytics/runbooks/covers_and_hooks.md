# Covers + hooks for library videos («اكتب الهوكات» / «جهّز الأغلفة»)

Goal: every Molabi library video (styles مشهور/مودل/ابداعي) has a cover = its opening frame **with its hook written on the image**, and a hook = the first sentence the speaker says — distinct enough to tell videos apart. Videos never stay on the Mac.

1. **Queue** (Supabase execute_sql; the result is big → read it from the saved tool-result file with python, never retype):
   with sp as (select creative_id, sum(spend) s from public.v_media_perf group by 1)
   select json_agg(json_build_object('id',m.creative_id,'url',m.url,'h',(coalesce(m.hook,'')<>'' and m.hook not ilike 'http%') or coalesce(m.hook_auto,'')<>'' or coalesce(d.data->>'hook','')<>'','t',m.thumb is not null) order by coalesce(sp.s,0) desc) as gad_thumb_queue
   from public.media m left join sp on sp.creative_id=m.creative_id left join public.docs d on d.coll='media_notes' and d.path='media_notes/'||m.creative_id
   where m.client='ملبي' and m.kind='Video' and m.style in ('مشهور','مودل','ابداعي');
   → write the array to ~/.gadlytics/thumb_queue.json.
2. **Frames + hooks:** `python3 ~/.gadlytics/media_assets.py` (background; 4 at a time; log ~/.gadlytics/media_assets.log; resumable via media_assets.done / .done.hook).
   Videos that already have a cover but no saved frame: `python3 ~/.gadlytics/media_assets.py --frames`.
   Folders with no video (even in subfolders) or broken links: `update public.media set asset_note='no_video' where creative_id in (...)`.
3. **Distinct hooks:** export id/manual/auto/full (select … hook, hook_auto, hook_full, docs media_notes hook …) → rows {id, hook, full, manual} →
   `python3 ~/.gadlytics/hooks_dedupe.py rows.json` (dry run) → `--push`. Manual hooks are never changed; same-script copies keep the short hook.
4. **Hook on the image:** final list [{id, hook}] (manual hook first, else hook_auto) → `python3 ~/.gadlytics/hook_covers.py final_hooks.json` (6 at a time, retries).
5. **Check:** select count(*), count(thumb), count(thumb_hook), count(asset_note='no_video') … for the 409 — every video must have a cover with its hook, or be marked no_video.
   `find /var/folders -maxdepth 4 -name "gad-media-*"` and `"gad-hc-*"` must be empty.
