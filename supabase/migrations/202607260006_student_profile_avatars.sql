begin;

alter table public.profiles
  add column if not exists avatar_preset text,
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_avatar_preset_allowed'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_preset_allowed
      check (
        avatar_preset is null
        or avatar_preset in (
          'student-boy-1',
          'student-boy-2',
          'student-boy-3',
          'student-boy-4',
          'student-boy-5',
          'student-girl-1',
          'student-girl-2',
          'student-girl-3',
          'student-girl-4',
          'student-girl-5'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_avatar_path_shape'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_path_shape
      check (
        avatar_path is null
        or avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/profile[.]webp$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_one_avatar_source'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_one_avatar_source
      check (
        (avatar_preset is null and avatar_path is null)
        or ((avatar_preset is null) <> (avatar_path is null))
      );
  end if;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'student-profile-images',
  'student-profile-images',
  false,
  2097152,
  array['image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists student_profile_images_insert on storage.objects;
drop policy if exists student_profile_images_select on storage.objects;
drop policy if exists student_profile_images_update on storage.objects;
drop policy if exists student_profile_images_delete on storage.objects;

create policy student_profile_images_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'student-profile-images'
  and (select private.current_role()) = 'student'::public.app_role
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name = (select auth.uid())::text || '/profile.webp'
  and storage.extension(name) = 'webp'
);

create policy student_profile_images_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-profile-images'
  and (select private.current_role()) = 'student'::public.app_role
  and owner_id = (select auth.uid())::text
  and name = (select auth.uid())::text || '/profile.webp'
);

create policy student_profile_images_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'student-profile-images'
  and (select private.current_role()) = 'student'::public.app_role
  and owner_id = (select auth.uid())::text
  and name = (select auth.uid())::text || '/profile.webp'
)
with check (
  bucket_id = 'student-profile-images'
  and (select private.current_role()) = 'student'::public.app_role
  and owner_id = (select auth.uid())::text
  and name = (select auth.uid())::text || '/profile.webp'
  and storage.extension(name) = 'webp'
);

create policy student_profile_images_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'student-profile-images'
  and (select private.current_role()) = 'student'::public.app_role
  and owner_id = (select auth.uid())::text
  and name = (select auth.uid())::text || '/profile.webp'
);

create or replace function public.update_my_profile_avatar(
  p_preset text,
  p_avatar_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_preset text := nullif(pg_catalog.btrim(p_preset), '');
  v_path text := nullif(pg_catalog.btrim(p_avatar_path), '');
  v_before public.profiles%rowtype;
begin
  if (select private.current_role()) <> 'student'::public.app_role then
    raise exception 'Active student password session required'
      using errcode = '42501';
  end if;

  if (v_preset is null) = (v_path is null) then
    raise exception 'Choose exactly one avatar source'
      using errcode = '22023';
  end if;

  if v_preset is not null and v_preset not in (
    'student-boy-1',
    'student-boy-2',
    'student-boy-3',
    'student-boy-4',
    'student-boy-5',
    'student-girl-1',
    'student-girl-2',
    'student-girl-3',
    'student-girl-4',
    'student-girl-5'
  ) then
    raise exception 'Unknown avatar preset'
      using errcode = '22023';
  end if;

  if v_path is not null then
    if v_path <> (v_uid::text || '/profile.webp') then
      raise exception 'Avatar path does not belong to the current student'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from storage.objects object_row
      where object_row.bucket_id = 'student-profile-images'
        and object_row.name = v_path
        and object_row.owner_id = v_uid::text
    ) then
      raise exception 'Uploaded avatar was not found'
        using errcode = 'P0002';
    end if;
  end if;

  select profile_row.*
  into v_before
  from public.profiles profile_row
  where profile_row.user_id = v_uid
    and profile_row.role = 'student'::public.app_role
    and profile_row.is_active
    and not profile_row.activation_required
  for update;

  if not found then
    raise exception 'Student profile not found'
      using errcode = 'P0002';
  end if;

  update public.profiles
  set avatar_preset = v_preset,
      avatar_path = v_path,
      avatar_updated_at = now()
  where user_id = v_uid;

  perform private.write_audit(
    'update_my_profile_avatar',
    'profile',
    v_uid::text,
    jsonb_build_object(
      'avatar_preset', v_before.avatar_preset,
      'avatar_path', v_before.avatar_path
    ),
    jsonb_build_object(
      'avatar_preset', v_preset,
      'avatar_path', v_path
    )
  );

  return jsonb_build_object(
    'ok', true,
    'preset', v_preset,
    'path', v_path,
    'previousPath', v_before.avatar_path
  );
end;
$$;

comment on function public.update_my_profile_avatar(text, text) is
  'Lets an active password-authenticated student choose one approved preset or their own private profile image and writes an audit event.';

revoke all on function public.update_my_profile_avatar(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.update_my_profile_avatar(text, text)
to authenticated;

commit;
