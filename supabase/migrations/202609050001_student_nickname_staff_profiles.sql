begin;

alter table public.students add column if not exists nickname text;
alter table public.students add constraint students_nickname_shape
  check (nickname is null or (length(btrim(nickname)) between 1 and 40));

create or replace function public.update_my_student_nickname(p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_value text := nullif(pg_catalog.btrim(p_nickname), '');
begin
  if (select private.current_role()) is distinct from 'student'::public.app_role then raise exception 'Active student session required' using errcode='42501'; end if;
  if v_value is not null and length(v_value) > 40 then raise exception 'Nickname is too long' using errcode='22023'; end if;
  update public.students set nickname=v_value where user_id=v_uid and status='active';
  if not found then raise exception 'Student profile not found' using errcode='P0002'; end if;
  return jsonb_build_object('ok', true, 'nickname', v_value);
end; $$;
revoke all on function public.update_my_student_nickname(text) from public, anon, authenticated, service_role;
grant execute on function public.update_my_student_nickname(text) to authenticated;

create or replace function public.get_staff_student_profile_cards(p_student_ids bigint[])
returns table(student_id bigint, nickname text, avatar_preset text, avatar_path text, avatar_updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_role public.app_role := (select private.current_role());
begin
  if v_role not in ('teacher'::public.app_role, 'admin'::public.app_role) then
    raise exception 'Staff session required' using errcode='42501';
  end if;
  return query
  select s.id, s.nickname, p.avatar_preset, p.avatar_path, p.avatar_updated_at
  from public.students s
  left join public.profiles p on p.user_id = s.user_id
  where s.id = any(coalesce(p_student_ids, '{}'::bigint[]))
    and s.status = 'active'
    and (v_role = 'admin'::public.app_role or private.teacher_has_student(s.id, null));
end; $$;
revoke all on function public.get_staff_student_profile_cards(bigint[]) from public, anon, authenticated, service_role;
grant execute on function public.get_staff_student_profile_cards(bigint[]) to authenticated;

drop policy if exists student_profile_images_select_staff on storage.objects;
create policy student_profile_images_select_staff
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-profile-images'
  and (select private.current_role()) in ('teacher'::public.app_role, 'admin'::public.app_role)
  and exists (
    select 1
    from public.students student
    where student.user_id::text = (storage.foldername(name))[1]
      and name = student.user_id::text || '/profile.webp'
      and student.status = 'active'
      and (
        (select private.current_role()) = 'admin'::public.app_role
        or private.teacher_has_student(student.id, null)
      )
  )
);
commit;
