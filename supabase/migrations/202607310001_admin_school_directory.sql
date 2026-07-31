-- Web-based school directory and a read-only director role.
-- The new enum value is only compared as text inside this migration so it is
-- safe to use after the migration transaction commits.
alter type public.app_role add value if not exists 'director';

alter table public.teachers
  drop constraint if exists teachers_intended_role_staff_only;
alter table public.teachers
  add constraint teachers_intended_role_staff_only
  check (intended_role::text in ('teacher', 'director', 'admin'));

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_entry.conname
    from pg_constraint constraint_entry
    where constraint_entry.conrelid = 'private.account_provisioning_queue'::regclass
      and constraint_entry.contype = 'c'
      and position('intended_role' in lower(pg_get_constraintdef(constraint_entry.oid))) > 0
  loop
    execute format(
      'alter table private.account_provisioning_queue drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table private.account_provisioning_queue
  add constraint account_provisioning_person_role
  check (
    (student_id is not null and intended_role::text = 'student')
    or (
      teacher_id is not null
      and intended_role::text in ('teacher', 'director', 'admin')
    )
  );

create or replace function private.service_actor_is_admin(p_actor_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select auth.role()), '') = 'service_role'
    and exists (
      select 1
      from public.profiles profile
      where profile.user_id = p_actor_user_id
        and profile.role::text = 'admin'
        and profile.is_active
        and not profile.activation_required
    )
$$;

revoke all on function private.service_actor_is_admin(uuid)
from public, anon, authenticated, service_role;

create or replace function public.school_directory_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := private.current_role()::text;
  v_term public.academic_terms%rowtype;
begin
  if v_role not in ('admin', 'director') then
    raise exception 'Administrator or director permission required'
      using errcode = '42501';
  end if;

  select term.*
  into v_term
  from public.academic_terms term
  where term.status in ('active', 'planned')
  order by
    case term.status when 'active' then 0 else 1 end,
    term.school_year desc,
    term.semester desc,
    term.id desc
  limit 1;

  return jsonb_build_object(
    'termId', coalesce(v_term.id::text, ''),
    'termLabel', coalesce(v_term.name, ''),
    'classrooms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', classroom.id::text,
          'name', classroom.display_name,
          'gradeLevel', classroom.grade_level,
          'roomNumber', classroom.room_number
        )
        order by classroom.grade_level, classroom.room_number, classroom.id
      )
      from public.classrooms classroom
      where classroom.term_id = v_term.id
        and classroom.is_active
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', student.id::text,
          'studentCode', student.student_code,
          'username', coalesce(identity.username, ''),
          'title', coalesce(student.title, ''),
          'givenName', student.given_name,
          'familyName', student.family_name,
          'status', student.status::text,
          'classroomId', coalesce(placement.classroom_id::text, ''),
          'classroomName', coalesce(placement.classroom_name, ''),
          'birthDate', coalesce(private_identity.birth_date::text, ''),
          'accountActive', coalesce(profile.is_active, false),
          'activationRequired', coalesce(profile.activation_required, true)
        )
        order by student.status, student.student_code, student.id
      )
      from public.students student
      left join public.profiles profile on profile.user_id = student.user_id
      left join private.login_identities identity on identity.user_id = student.user_id
      left join private.student_private_identities private_identity
        on private_identity.student_id = student.id
      left join lateral (
        select
          enrollment.classroom_id,
          classroom.display_name as classroom_name
        from public.enrollments enrollment
        join public.classrooms classroom on classroom.id = enrollment.classroom_id
        where enrollment.student_id = student.id
        order by
          (enrollment.term_id = v_term.id) desc,
          enrollment.is_active desc,
          enrollment.updated_at desc,
          enrollment.id desc
        limit 1
      ) placement on true
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', teacher.id::text,
          'employeeCode', teacher.employee_code,
          'username', coalesce(identity.username, ''),
          'title', coalesce(teacher.title, ''),
          'givenName', teacher.given_name,
          'familyName', teacher.family_name,
          'status', teacher.status::text,
          'role', coalesce(profile.role::text, teacher.intended_role::text),
          'classroomIds', coalesce((
            select jsonb_agg(assignment.classroom_id::text order by assignment.classroom_id)
            from public.teacher_classroom_assignments assignment
            where assignment.teacher_id = teacher.id
              and assignment.term_id = v_term.id
              and assignment.is_active
          ), '[]'::jsonb),
          'accountActive', coalesce(profile.is_active, false),
          'activationRequired', coalesce(profile.activation_required, true)
        )
        order by teacher.status, teacher.employee_code, teacher.id
      )
      from public.teachers teacher
      left join public.profiles profile on profile.user_id = teacher.user_id
      left join private.login_identities identity on identity.user_id = teacher.user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.school_directory_snapshot()
from public, anon, authenticated, service_role;
grant execute on function public.school_directory_snapshot() to authenticated;

create or replace function public.service_create_school_person(
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
  p_birth_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_code text := btrim(coalesce(p_code, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_given_name text := btrim(coalesce(p_given_name, ''));
  v_family_name text := btrim(coalesce(p_family_name, ''));
  v_display_name text;
  v_student_id bigint;
  v_teacher_id bigint;
  v_term_id bigint;
  v_role public.app_role;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;
  if p_auth_user_id is null or not exists (
    select 1 from auth.users auth_user where auth_user.id = p_auth_user_id
  ) then
    raise exception 'Provisioned Auth account not found'
      using errcode = 'P0002';
  end if;
  if not private.is_valid_username(v_username) then
    raise exception 'Username is invalid'
      using errcode = '22023';
  end if;
  if v_code = '' or v_given_name = '' or v_family_name = '' then
    raise exception 'Code, given name and family name are required'
      using errcode = '22023';
  end if;
  if p_kind not in ('student', 'staff') then
    raise exception 'Person kind is invalid'
      using errcode = '22023';
  end if;
  if p_kind = 'staff' and coalesce(p_role, '') not in ('teacher', 'director', 'admin') then
    raise exception 'Staff role is invalid'
      using errcode = '22023';
  end if;

  v_role := (
    case when p_kind = 'student' then 'student' else p_role end
  )::public.app_role;
  v_display_name := concat_ws(' ', v_title, v_given_name, v_family_name);

  insert into public.profiles(
    user_id, role, display_name, is_active, activation_required
  ) values (
    p_auth_user_id, v_role, v_display_name, true, true
  );

  insert into private.login_identities(user_id, username)
  values (p_auth_user_id, v_username);

  if p_kind = 'student' then
    insert into public.students(
      user_id, student_code, title, given_name, family_name, status
    ) values (
      p_auth_user_id, v_code, v_title, v_given_name, v_family_name, 'active'
    )
    returning id into v_student_id;

    if p_birth_date is not null then
      insert into private.student_private_identities(student_id, birth_date)
      values (v_student_id, p_birth_date);
    end if;

    if p_classroom_id is not null then
      select classroom.term_id
      into v_term_id
      from public.classrooms classroom
      where classroom.id = p_classroom_id
        and classroom.is_active;
      if v_term_id is null then
        raise exception 'Classroom not found'
          using errcode = 'P0002';
      end if;

      insert into public.enrollments(
        term_id, classroom_id, student_id, is_active
      ) values (
        v_term_id, p_classroom_id, v_student_id, true
      );
      perform private.ensure_score_account(v_student_id, v_term_id, p_actor_user_id);
    end if;

    insert into private.account_provisioning_queue(
      student_id, username, intended_role, status, linked_user_id
    ) values (
      v_student_id, v_username, 'student', 'provisioned', p_auth_user_id
    );
  else
    insert into public.teachers(
      user_id, employee_code, title, given_name, family_name, status, intended_role
    ) values (
      p_auth_user_id, v_code, v_title, v_given_name, v_family_name, 'active', v_role
    )
    returning id into v_teacher_id;

    insert into private.account_provisioning_queue(
      teacher_id, username, intended_role, status, linked_user_id
    ) values (
      v_teacher_id, v_username, v_role, 'provisioned', p_auth_user_id
    );
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, before_state, after_state
  ) values (
    p_actor_user_id,
    'create_school_person',
    p_kind,
    coalesce(v_student_id, v_teacher_id)::text,
    null,
    jsonb_build_object(
      'username', v_username,
      'code', v_code,
      'displayName', v_display_name,
      'role', v_role::text
    )
  );

  return jsonb_build_object(
    'id', coalesce(v_student_id, v_teacher_id)::text,
    'username', v_username
  );
end;
$$;

create or replace function public.service_update_school_student(
  p_actor_user_id uuid,
  p_student_id bigint,
  p_title text,
  p_given_name text,
  p_family_name text,
  p_status text,
  p_classroom_id bigint,
  p_birth_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_before jsonb;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_given_name text := btrim(coalesce(p_given_name, ''));
  v_family_name text := btrim(coalesce(p_family_name, ''));
  v_display_name text;
  v_term_id bigint;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;
  if v_given_name = '' or v_family_name = '' then
    raise exception 'Given name and family name are required'
      using errcode = '22023';
  end if;
  if p_status not in ('active', 'suspended', 'graduated', 'archived') then
    raise exception 'Student status is invalid'
      using errcode = '22023';
  end if;

  select student.*
  into v_student
  from public.students student
  where student.id = p_student_id
  for update;
  if not found then
    raise exception 'Student not found'
      using errcode = 'P0002';
  end if;
  v_before := to_jsonb(v_student);
  v_display_name := concat_ws(' ', v_title, v_given_name, v_family_name);

  update public.students
  set
    title = v_title,
    given_name = v_given_name,
    family_name = v_family_name,
    status = p_status::public.person_status,
    graduation_confirmed_at = case when p_status = 'graduated' then now() else null end,
    graduation_confirmed_by = case when p_status = 'graduated' then p_actor_user_id else null end
  where id = p_student_id;

  update public.profiles
  set
    display_name = v_display_name,
    is_active = (p_status = 'active')
  where user_id = v_student.user_id;

  if p_birth_date is null then
    delete from private.student_private_identities
    where student_id = p_student_id;
  else
    insert into private.student_private_identities(student_id, birth_date)
    values (p_student_id, p_birth_date)
    on conflict (student_id)
    do update set birth_date = excluded.birth_date;
  end if;

  if p_status = 'active' then
    if p_classroom_id is null then
      raise exception 'Active student requires a classroom'
        using errcode = '22023';
    end if;
    select classroom.term_id
    into v_term_id
    from public.classrooms classroom
    where classroom.id = p_classroom_id
      and classroom.is_active;
    if v_term_id is null then
      raise exception 'Classroom not found'
        using errcode = 'P0002';
    end if;

    insert into public.enrollments(
      term_id, classroom_id, student_id, is_active
    ) values (
      v_term_id, p_classroom_id, p_student_id, true
    )
    on conflict (student_id, term_id)
    do update set
      classroom_id = excluded.classroom_id,
      is_active = true;
    perform private.ensure_score_account(p_student_id, v_term_id, p_actor_user_id);
  else
    update public.enrollments
    set is_active = false
    where student_id = p_student_id
      and is_active;
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, before_state, after_state
  ) values (
    p_actor_user_id,
    'update_school_student',
    'student',
    p_student_id::text,
    v_before,
    jsonb_build_object(
      'displayName', v_display_name,
      'status', p_status,
      'classroomId', p_classroom_id
    )
  );

  return jsonb_build_object('ok', true, 'id', p_student_id::text);
end;
$$;

create or replace function public.service_update_school_staff(
  p_actor_user_id uuid,
  p_teacher_id bigint,
  p_title text,
  p_given_name text,
  p_family_name text,
  p_status text,
  p_role text,
  p_classroom_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher public.teachers%rowtype;
  v_before jsonb;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_given_name text := btrim(coalesce(p_given_name, ''));
  v_family_name text := btrim(coalesce(p_family_name, ''));
  v_display_name text;
  v_term_id bigint;
  v_classroom_id bigint;
  v_active_admin_count integer;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;
  if v_given_name = '' or v_family_name = '' then
    raise exception 'Given name and family name are required'
      using errcode = '22023';
  end if;
  if p_status not in ('active', 'suspended', 'archived') then
    raise exception 'Staff status is invalid'
      using errcode = '22023';
  end if;
  if p_role not in ('teacher', 'director', 'admin') then
    raise exception 'Staff role is invalid'
      using errcode = '22023';
  end if;

  select teacher.*
  into v_teacher
  from public.teachers teacher
  where teacher.id = p_teacher_id
  for update;
  if not found then
    raise exception 'Staff record not found'
      using errcode = 'P0002';
  end if;
  if v_teacher.user_id = p_actor_user_id
     and (p_status <> 'active' or p_role <> 'admin') then
    raise exception 'You cannot remove or demote your own administrator account'
      using errcode = '42501';
  end if;

  if v_teacher.intended_role::text = 'admin'
     and (p_status <> 'active' or p_role <> 'admin') then
    select count(*)
    into v_active_admin_count
    from public.teachers teacher
    join public.profiles profile on profile.user_id = teacher.user_id
    where teacher.status = 'active'
      and teacher.intended_role::text = 'admin'
      and profile.is_active;
    if v_active_admin_count <= 1 then
      raise exception 'The final active administrator cannot be removed'
        using errcode = '23514';
    end if;
  end if;

  v_before := to_jsonb(v_teacher);
  v_display_name := concat_ws(' ', v_title, v_given_name, v_family_name);

  update public.teachers
  set
    title = v_title,
    given_name = v_given_name,
    family_name = v_family_name,
    status = p_status::public.person_status,
    intended_role = p_role::public.app_role
  where id = p_teacher_id;

  update public.profiles
  set
    display_name = v_display_name,
    role = p_role::public.app_role,
    is_active = (p_status = 'active')
  where user_id = v_teacher.user_id;

  select term.id
  into v_term_id
  from public.academic_terms term
  where term.status in ('active', 'planned')
  order by case term.status when 'active' then 0 else 1 end,
           term.school_year desc,
           term.semester desc
  limit 1;

  if v_term_id is not null then
    update public.teacher_classroom_assignments
    set is_active = false
    where teacher_id = p_teacher_id
      and term_id = v_term_id
      and is_active;

    if p_status = 'active' and p_role = 'teacher' then
      foreach v_classroom_id in array coalesce(p_classroom_ids, array[]::bigint[])
      loop
        if not exists (
          select 1
          from public.classrooms classroom
          where classroom.id = v_classroom_id
            and classroom.term_id = v_term_id
            and classroom.is_active
        ) then
          raise exception 'Classroom not found in current term'
            using errcode = 'P0002';
        end if;
        insert into public.teacher_classroom_assignments(
          term_id, classroom_id, teacher_id, subject_name, is_active
        ) values (
          v_term_id, v_classroom_id, p_teacher_id, 'ประจำชั้น', true
        )
        on conflict (term_id, classroom_id, teacher_id, subject_name)
        do update set is_active = true;
      end loop;
    end if;
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, before_state, after_state
  ) values (
    p_actor_user_id,
    'update_school_staff',
    'teacher',
    p_teacher_id::text,
    v_before,
    jsonb_build_object(
      'displayName', v_display_name,
      'status', p_status,
      'role', p_role,
      'classroomIds', coalesce(to_jsonb(p_classroom_ids), '[]'::jsonb)
    )
  );

  return jsonb_build_object('ok', true, 'id', p_teacher_id::text);
end;
$$;

create or replace function public.service_get_activation_account(
  p_actor_user_id uuid,
  p_username text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'userId', profile.user_id,
    'username', identity.username,
    'active', profile.is_active,
    'activationRequired', profile.activation_required
  )
  into v_result
  from private.login_identities identity
  join public.profiles profile on profile.user_id = identity.user_id
  where identity.username_normalized = lower(btrim(p_username));

  if v_result is null then
    raise exception 'School account not found'
      using errcode = 'P0002';
  end if;
  if not (v_result ->> 'active')::boolean then
    raise exception 'School account is inactive'
      using errcode = '55000';
  end if;
  if not (v_result ->> 'activationRequired')::boolean then
    raise exception 'Account has already been activated'
      using errcode = '55000';
  end if;
  return v_result;
end;
$$;

revoke all on function public.service_create_school_person(
  uuid, uuid, text, text, text, text, text, text, text, bigint, date
) from public, anon, authenticated, service_role;
revoke all on function public.service_update_school_student(
  uuid, bigint, text, text, text, text, bigint, date
) from public, anon, authenticated, service_role;
revoke all on function public.service_update_school_staff(
  uuid, bigint, text, text, text, text, text, bigint[]
) from public, anon, authenticated, service_role;
revoke all on function public.service_get_activation_account(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.service_create_school_person(
  uuid, uuid, text, text, text, text, text, text, text, bigint, date
) to service_role;
grant execute on function public.service_update_school_student(
  uuid, bigint, text, text, text, text, bigint, date
) to service_role;
grant execute on function public.service_update_school_staff(
  uuid, bigint, text, text, text, text, text, bigint[]
) to service_role;
grant execute on function public.service_get_activation_account(uuid, text)
to service_role;

-- Director access is deliberately read-only. Existing write policies still
-- require private.is_admin(), so adding these select policies cannot grant a
-- mutation path.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles',
    'academic_terms',
    'classrooms',
    'students',
    'teachers',
    'enrollments',
    'teacher_classroom_assignments',
    'behavior_rules',
    'positive_behavior_rules',
    'score_accounts',
    'incidents',
    'point_addition_requests',
    'appeals',
    'follow_up_cases',
    'guardian_contact_tasks',
    'score_ledger',
    'audit_logs'
  ]
  loop
    execute format(
      'drop policy if exists director_read_all on public.%I',
      v_table
    );
    execute format(
      'create policy director_read_all on public.%I for select to authenticated using ((select private.current_role())::text = ''director'')',
      v_table
    );
  end loop;
end;
$$;
