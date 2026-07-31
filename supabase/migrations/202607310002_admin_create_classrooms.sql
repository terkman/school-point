begin;

create or replace function public.service_create_school_classroom(
  p_actor_user_id uuid,
  p_term_id bigint,
  p_grade_level text,
  p_room_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grade_level text := upper(btrim(coalesce(p_grade_level, '')));
  v_room_number text := private.normalize_room_number(p_room_number);
  v_display_name text;
  v_classroom_id bigint;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if v_grade_level not in ('P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'M1', 'M2', 'M3') then
    raise exception 'Grade level is invalid'
      using errcode = '22023';
  end if;
  if char_length(v_room_number) > 20
     or v_room_number !~ '^[0-9A-Za-zก-๙._-]+$' then
    raise exception 'Room number is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.academic_terms term
    where term.id = p_term_id
      and term.status in ('active', 'planned')
  ) then
    raise exception 'Current academic term not found'
      using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.classrooms classroom
    where classroom.term_id = p_term_id
      and classroom.grade_level = v_grade_level
      and classroom.room_number = v_room_number
  ) then
    raise exception 'Classroom already exists'
      using errcode = '23505';
  end if;

  v_display_name := private.classroom_display_name(v_grade_level, v_room_number);

  insert into public.classrooms(
    term_id, grade_level, room_number, display_name, is_active
  ) values (
    p_term_id, v_grade_level, v_room_number, v_display_name, true
  )
  returning id into v_classroom_id;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, before_state, after_state
  ) values (
    p_actor_user_id,
    'create_school_classroom',
    'classroom',
    v_classroom_id::text,
    null,
    jsonb_build_object(
      'termId', p_term_id::text,
      'gradeLevel', v_grade_level,
      'roomNumber', v_room_number,
      'displayName', v_display_name
    )
  );

  return jsonb_build_object(
    'id', v_classroom_id::text,
    'name', v_display_name,
    'gradeLevel', v_grade_level,
    'roomNumber', v_room_number
  );
end;
$$;

revoke all on function public.service_create_school_classroom(
  uuid, bigint, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_create_school_classroom(
  uuid, bigint, text, text
) to service_role;

comment on function public.service_create_school_classroom(
  uuid, bigint, text, text
) is 'Creates an active classroom for the current term after service-role and administrator verification.';

commit;
