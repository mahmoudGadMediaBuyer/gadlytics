-- GADLYTICS: جدول واحد للمستندات بنفس مسارات المنصة (config/app, entries/<client>__<date>, ...)
create table if not exists public.docs (
  path       text primary key,
  coll       text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists docs_coll_idx on public.docs (coll);
create index if not exists docs_entries_date_idx on public.docs ((data->>'date')) where coll = 'entries';

alter table public.docs enable row level security;

-- اللي مسجّل دخول بس يقرا ويكتب؛ والمهام الخاصة (data/users/<id>/...) لصاحبها بس
drop policy if exists docs_select on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_select on public.docs for select to authenticated
  using (path not like 'data/users/%' or path like 'data/users/' || (select auth.uid())::text || '/%');
create policy docs_insert on public.docs for insert to authenticated
  with check (path not like 'data/users/%' or path like 'data/users/' || (select auth.uid())::text || '/%');
create policy docs_update on public.docs for update to authenticated
  using (path not like 'data/users/%' or path like 'data/users/' || (select auth.uid())::text || '/%')
  with check (path not like 'data/users/%' or path like 'data/users/' || (select auth.uid())::text || '/%');
create policy docs_delete on public.docs for delete to authenticated
  using (path not like 'data/users/%' or path like 'data/users/' || (select auth.uid())::text || '/%');
