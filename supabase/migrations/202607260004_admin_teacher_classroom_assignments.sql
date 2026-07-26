begin;

create or replace function public.admin_set_teacher_classrooms(
  p_term_id bigint,
  p_teacher_id bigint,
  p_classroom_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_ids bigint[];
  v_selected_ids bigint[];
  v_teacher_name text;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_term_id is null or p_teacher_id is null or p_classroom_ids is null then
    raise exception 'Term, teacher, and classroom list are required'
      using errcode = '22023';
  end if;

  select pg_catalog.concat_ws(' ', teacher.title, teacher.given_name, teacher.family_name)
  into v_teacher_name
  from public.teachers teacher
  where teacher.id = p_teacher_id
    and teacher.status = 'active'
  for update;

  if not found then
    raise exception 'Active teacher not found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.academic_terms term
    where term.id = p_term_id
      and term.status in ('planned', 'active')
  ) then
    raise exception 'Editable academic term not found'
      using errcode = 'P0002';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct selected.classroom_id order by selected.classroom_id),
    array[]::bigint[]
  )
  into v_selected_ids
  from pg_catalog.unnest(p_classroom_ids) selected(classroom_id)
  where selected.classroom_id is not null;

  if exists (
    select 1
    from pg_catalog.unnest(v_selected_ids) selected(classroom_id)
    left join public.classrooms classroom
      on classroom.id = selected.classroom_id
     and classroom.term_id = p_term_id
     and classroom.is_active
    where classroom.id is null
  ) then
    raise exception 'Every classroom must be active in the selected term'
      using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct assignment.classroom_id order by assignment.classroom_id),
    array[]::bigint[]
  )
  into v_before_ids
  from public.teacher_classroom_assignments assignment
  where assignment.term_id = p_term_id
    and assignment.teacher_id = p_teacher_id
    and assignment.is_active;

  if v_before_ids = v_selected_ids then
    return jsonb_build_object(
      'ok', true,
      'updated', false,
      'term_id', p_term_id,
      'teacher_id', p_teacher_id,
      'classroom_ids', to_jsonb(v_selected_ids)
    );
  end if;

  update public.teacher_classroom_assignments
  set is_active = false
  where term_id = p_term_id
    and teacher_id = p_teacher_id
    and is_active;

  insert into public.teacher_classroom_assignments(
    term_id,
    classroom_id,
    teacher_id,
    subject_name,
    is_active
  )
  select
    p_term_id,
    selected.classroom_id,
    p_teacher_id,
    'ประจำชั้น',
    true
  from pg_catalog.unnest(v_selected_ids) selected(classroom_id)
  on conflict (term_id, classroom_id, teacher_id, subject_name)
  do update set is_active = true;

  perform private.write_audit(
    'admin_set_teacher_classrooms',
    'teacher',
    p_teacher_id::text,
    jsonb_build_object(
      'term_id', p_term_id,
      'teacher_name', v_teacher_name,
      'classroom_ids', to_jsonb(v_before_ids)
    ),
    jsonb_build_object(
      'term_id', p_term_id,
      'teacher_name', v_teacher_name,
      'classroom_ids', to_jsonb(v_selected_ids)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'updated', true,
    'term_id', p_term_id,
    'teacher_id', p_teacher_id,
    'classroom_ids', to_jsonb(v_selected_ids),
    'classroom_count', pg_catalog.cardinality(v_selected_ids)
  );
end;
$$;

comment on function public.admin_set_teacher_classrooms(bigint, bigint, bigint[]) is
  'Replace one active teacher classroom access set for a planned or active term; requires an active password-AMR administrator and records an audit event.';

revoke all on function public.admin_set_teacher_classrooms(bigint, bigint, bigint[])
from public, anon, authenticated, service_role;
grant execute on function public.admin_set_teacher_classrooms(bigint, bigint, bigint[])
to authenticated;

commit;
