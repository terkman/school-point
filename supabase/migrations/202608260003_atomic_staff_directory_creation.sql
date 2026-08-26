-- Create staff records and their initial classroom assignments as one unit.
-- The original RPC remains available for existing callers; new callers use
-- this versioned service-only wrapper.
create or replace function public.service_create_school_person_v2(
  p_actor_user_id uuid,
  p_auth_user_id uuid,
  p_kind text,
  p_username text,
  p_code text,
  p_title text,
  p_given_name text,
  p_family_name text,
  p_role text,
  p_classroom_id bigint,
  p_birth_date date,
  p_classroom_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_selected_classroom_ids bigint[];
  v_term_id bigint;
  v_teacher_id bigint;
  v_result jsonb;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_classroom_ids, array[]::bigint[])) selected(classroom_id)
    where selected.classroom_id is null or selected.classroom_id <= 0
  ) then
    raise exception 'Classroom IDs must be positive integers'
      using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct selected.classroom_id order by selected.classroom_id),
    array[]::bigint[]
  )
  into v_selected_classroom_ids
  from pg_catalog.unnest(coalesce(p_classroom_ids, array[]::bigint[])) selected(classroom_id);

  if cardinality(v_selected_classroom_ids) > 0
     and (p_kind <> 'staff' or coalesce(p_role, '') <> 'teacher') then
    raise exception 'Only teacher staff may receive classroom assignments'
      using errcode = '22023';
  end if;

  if cardinality(v_selected_classroom_ids) > 0 then
    select term.id
    into v_term_id
    from public.academic_terms term
    where term.status in ('active', 'planned')
    order by case term.status when 'active' then 0 else 1 end,
             term.school_year desc,
             term.semester desc,
             term.id desc
    limit 1;

    if v_term_id is null then
      raise exception 'Current academic term not found'
        using errcode = 'P0002';
    end if;

    if exists (
      select 1
      from pg_catalog.unnest(v_selected_classroom_ids) selected(classroom_id)
      left join public.classrooms classroom
        on classroom.id = selected.classroom_id
       and classroom.term_id = v_term_id
       and classroom.is_active
      where classroom.id is null
    ) then
      raise exception 'Every classroom must be active in the current term'
        using errcode = '22023';
    end if;
  end if;

  -- A PostgreSQL function call shares this transaction with its caller. If an
  -- assignment insert fails, all rows made by the legacy creation RPC roll
  -- back too; the Edge function then deletes the separately provisioned Auth
  -- user as it did for the original RPC.
  v_result := public.service_create_school_person(
    p_actor_user_id,
    p_auth_user_id,
    p_kind,
    p_username,
    p_code,
    p_title,
    p_given_name,
    p_family_name,
    p_role,
    p_classroom_id,
    p_birth_date
  );

  if cardinality(v_selected_classroom_ids) > 0 then
    v_teacher_id := nullif(v_result ->> 'id', '')::bigint;
    if v_teacher_id is null then
      raise exception 'Created staff record is missing'
        using errcode = 'P0002';
    end if;

    insert into public.teacher_classroom_assignments(
      term_id, classroom_id, teacher_id, subject_name, is_active
    )
    select
      v_term_id,
      selected.classroom_id,
      v_teacher_id,
      'ประจำชั้น',
      true
    from pg_catalog.unnest(v_selected_classroom_ids) selected(classroom_id)
    on conflict (term_id, classroom_id, teacher_id, subject_name)
    do update set is_active = true;

    insert into public.audit_logs(
      actor_user_id, action, entity_type, entity_id, before_state, after_state
    ) values (
      p_actor_user_id,
      'create_school_staff_classroom_assignments',
      'teacher',
      v_teacher_id::text,
      '[]'::jsonb,
      jsonb_build_object(
        'termId', v_term_id,
        'classroomIds', to_jsonb(v_selected_classroom_ids)
      )
    );
  end if;

  return v_result;
end;
$$;

comment on function public.service_create_school_person_v2(
  uuid, uuid, text, text, text, text, text, text, text, bigint, date, bigint[]
) is
  'Service-only transactional wrapper for legacy school-person creation with initial teacher classroom assignments.';

revoke all on function public.service_create_school_person_v2(
  uuid, uuid, text, text, text, text, text, text, text, bigint, date, bigint[]
) from public, anon, authenticated, service_role;
grant execute on function public.service_create_school_person_v2(
  uuid, uuid, text, text, text, text, text, text, text, bigint, date, bigint[]
) to service_role;
