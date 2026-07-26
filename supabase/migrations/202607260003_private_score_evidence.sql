begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'score-evidence',
  'score-evidence',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists score_evidence_upload on storage.objects;
drop policy if exists score_evidence_read on storage.objects;
drop policy if exists score_evidence_delete on storage.objects;

create policy score_evidence_upload
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'score-evidence'
  and (select private.current_role()) in (
    'teacher'::public.app_role,
    'admin'::public.app_role
  )
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy score_evidence_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'score-evidence'
  and (select private.current_role()) in (
    'teacher'::public.app_role,
    'admin'::public.app_role
  )
  and (
    owner_id = (select auth.uid())::text
    or (select private.is_admin())
  )
);

create policy score_evidence_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'score-evidence'
  and (select private.current_role()) in (
    'teacher'::public.app_role,
    'admin'::public.app_role
  )
  and (
    owner_id = (select auth.uid())::text
    or (select private.is_admin())
  )
);

commit;
