# «اكتب الهوكات» — runbook
1. Queue (execute_sql, project ibpwudzjwjraqhfdmzet):
   select m.creative_id, m.url from public.docs d join public.media m on m.creative_id=split_part(d.path,'/',2)
   where d.coll='media_notes' and (d.data->>'hookWanted')='true' and m.hook_auto is null and coalesce(d.data->>'hook','')='';
2. python3 ~/.gadlytics/hooks.py ID=URL ID=URL ...   (batches of ~15; ~14 s per video; temp files deleted)
3. Clear the flag for the done ones:
   update public.docs set data = data - 'hookWanted', updated_at=now() where coll='media_notes' and split_part(path,'/',2) in (...ids with hook_auto now set...);
