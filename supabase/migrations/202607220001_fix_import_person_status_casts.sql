begin;

-- Repair the import routine on databases where the original migration was
-- already applied. A CASE made only from unknown string literals resolves to
-- text, which cannot be assigned to person_status. Keep the explicit enum casts
-- in both staff and student inserts.
create or replace function public.admin_import_school_data(
  p_payload jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_schema_version text;
  v_client_fingerprint text;
  v_fingerprint text;
  v_errors jsonb := '[]'::jsonb;
  v_counts jsonb;
  v_item jsonb;
  v_school_year smallint;
  v_semester smallint;
  v_term_id bigint;
  v_term_starts_on date;
  v_term_ends_on date;
  v_assignment_term_id bigint;
  v_student_id bigint;
  v_teacher_id bigint;
  v_classroom_id bigint;
  v_batch_id bigint;
  v_room_number text;
  v_grade_level text;
  v_display_name text;
  v_code text;
  v_username text;
  v_role public.app_role;
  v_student_number smallint;
  v_birth_date date;
  v_is_active boolean;
begin
  -- Import is intentionally server-only. auth.role() comes from the verified JWT;
  -- session_user permits migrations/tests run directly by trusted database owners.
  if coalesce((select auth.role()), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Trusted server permission required' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'dryRun', p_dry_run,
      'errors', jsonb_build_array(jsonb_build_object('path', '$', 'code', 'object_required'))
    );
  end if;

  v_schema_version := p_payload ->> 'schemaVersion';
  v_client_fingerprint := nullif(lower(btrim(p_payload ->> 'fingerprint')), '');
  -- Never trust the caller's fingerprint for locking or idempotency. jsonb::text has
  -- canonical object-key ordering, and removing the claimed hash prevents a stale
  -- client value from making a changed payload look already applied.
  v_fingerprint := encode(
    sha256(convert_to((p_payload - 'fingerprint')::text, 'UTF8')),
    'hex'
  );

  if v_schema_version is distinct from 'school-point-import/v1' then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.schemaVersion', 'code', 'unsupported_schema_version')
    );
  end if;

  if v_client_fingerprint is not null
     and v_client_fingerprint !~ '^[0-9a-f]{64}$' then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.fingerprint', 'code', 'invalid_client_fingerprint')
    );
  end if;

  foreach v_code in array array['classrooms', 'students', 'guardians', 'staff', 'assignments'] loop
    if p_payload ? v_code and jsonb_typeof(p_payload -> v_code) <> 'array' then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.' || v_code, 'code', 'array_required')
      );
    end if;
  end loop;

  if jsonb_typeof(p_payload -> 'term') <> 'object'
     or coalesce(p_payload #>> '{term,schoolYear}', '') !~ '^[0-9]{4}$'
     or coalesce(p_payload #>> '{term,semester}', '') !~ '^[1-3]$' then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.term', 'code', 'valid_term_required')
    );
  else
    v_school_year := (p_payload #>> '{term,schoolYear}')::smallint;
    v_semester := (p_payload #>> '{term,semester}')::smallint;

    select term.id into v_term_id
    from public.academic_terms term
    where term.school_year = v_school_year
      and term.semester = v_semester;

    v_term_starts_on := private.try_iso_date(nullif(btrim(p_payload #>> '{term,startsOn}'), ''));
    v_term_ends_on := private.try_iso_date(nullif(btrim(p_payload #>> '{term,endsOn}'), ''));

    if (nullif(btrim(p_payload #>> '{term,startsOn}'), '') is null)
       <> (nullif(btrim(p_payload #>> '{term,endsOn}'), '') is null) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.term', 'code', 'term_dates_must_be_a_pair')
      );
    elsif (nullif(btrim(p_payload #>> '{term,startsOn}'), '') is not null)
          and (v_term_starts_on is null or v_term_ends_on is null) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.term', 'code', 'invalid_term_dates')
      );
    elsif v_term_starts_on is not null and v_term_starts_on > v_term_ends_on then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.term', 'code', 'term_dates_out_of_order')
      );
    end if;
  end if;

  -- Stop before array expansion if any array has an invalid JSON type.
  if exists (
    select 1
    from jsonb_array_elements(v_errors) error
    where error ->> 'code' = 'array_required'
  ) then
    return jsonb_build_object('ok', false, 'dryRun', p_dry_run, 'errors', v_errors);
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'classrooms', '[]'::jsonb))
  loop
    v_grade_level := v_item ->> 'gradeLevel';
    if jsonb_typeof(v_item) <> 'object'
       or v_grade_level is null
       or v_grade_level not in ('P1','P2','P3','P4','P5','P6','M1','M2','M3') then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.classrooms[]', 'code', 'invalid_classroom')
      );
    end if;
  end loop;

  -- Student validation. Empty optional values are accepted and can be filled later.
  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb))
  loop
    v_code := nullif(btrim(v_item ->> 'studentCode'), '');
    v_grade_level := v_item ->> 'gradeLevel';

    if jsonb_typeof(v_item) <> 'object'
       or v_code is null
       or nullif(btrim(v_item ->> 'givenName'), '') is null
       or nullif(btrim(v_item ->> 'familyName'), '') is null then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[]', 'code', 'student_required_fields')
      );
    end if;

    if v_code is not null and not private.is_valid_username(v_code) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[].studentCode', 'code', 'invalid_username', 'studentCode', v_code)
      );
    end if;

    if v_grade_level is null
       or v_grade_level not in ('P1','P2','P3','P4','P5','P6','M1','M2','M3') then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[]', 'code', 'invalid_grade_level', 'studentCode', v_code)
      );
    end if;

    if v_item ? 'birthDate'
       and nullif(btrim(v_item ->> 'birthDate'), '') is not null
       and private.try_iso_date(v_item ->> 'birthDate') is null then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[].birthDate', 'code', 'invalid_iso_date', 'studentCode', v_code)
      );
    end if;

    if v_item ? 'studentNumber'
       and nullif(btrim(v_item ->> 'studentNumber'), '') is not null
       and (
         private.try_smallint(v_item ->> 'studentNumber') is null
         or private.try_smallint(v_item ->> 'studentNumber') not between 1 and 9999
       ) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[].studentNumber', 'code', 'invalid_student_number', 'studentCode', v_code)
      );
    end if;

    if v_item ? 'isActive' and jsonb_typeof(v_item -> 'isActive') <> 'boolean' then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[].isActive', 'code', 'boolean_required', 'studentCode', v_code)
      );
    end if;

  end loop;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb)) student
    group by lower(btrim(student ->> 'studentCode'))
    having count(*) > 1
  ) then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.students', 'code', 'duplicate_student_code')
    );
  end if;

  -- Staff and assignment validation.
  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb))
  loop
    v_code := nullif(btrim(v_item ->> 'employeeCode'), '');
    if jsonb_typeof(v_item) <> 'object'
       or v_code is null
       or nullif(btrim(v_item ->> 'givenName'), '') is null
       or nullif(btrim(v_item ->> 'familyName'), '') is null
       or coalesce(v_item ->> 'role', '') not in ('teacher', 'admin') then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.staff[]', 'code', 'staff_required_fields', 'employeeCode', v_code)
      );
    end if;

    if v_item ? 'isActive' and jsonb_typeof(v_item -> 'isActive') <> 'boolean' then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.staff[].isActive', 'code', 'boolean_required', 'employeeCode', v_code)
      );
    end if;

    if nullif(btrim(v_item ->> 'username'), '') is not null
       and not private.is_valid_username(v_item ->> 'username') then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.staff[].username', 'code', 'invalid_username', 'employeeCode', v_code)
      );
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb)) staff_member
    group by lower(btrim(staff_member ->> 'employeeCode'))
    having count(*) > 1
  ) then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.staff', 'code', 'duplicate_employee_code')
    );
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'assignments', '[]'::jsonb))
  loop
    v_grade_level := v_item ->> 'gradeLevel';
    v_code := nullif(btrim(v_item ->> 'employeeCode'), '');
    v_assignment_term_id := null;

    if coalesce(v_item ->> 'schoolYear', '') ~ '^[0-9]{4}$'
       and coalesce(v_item ->> 'semester', '') ~ '^[1-3]$' then
      select term.id into v_assignment_term_id
      from public.academic_terms term
      where term.school_year = (v_item ->> 'schoolYear')::smallint
        and term.semester = (v_item ->> 'semester')::smallint;
    end if;

    if jsonb_typeof(v_item) <> 'object'
       or v_code is null
       or v_grade_level is null
       or v_grade_level not in ('P1','P2','P3','P4','P5','P6','M1','M2','M3')
       or (
         v_assignment_term_id is null
         and not coalesce(
           private.try_smallint(v_item ->> 'schoolYear') = v_school_year
           and private.try_smallint(v_item ->> 'semester') = v_semester,
           false
         )
       ) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.assignments[]', 'code', 'invalid_assignment', 'employeeCode', v_code)
      );
    end if;

    if not exists (
      select 1 from public.teachers teacher
      where lower(btrim(teacher.employee_code)) = lower(v_code)
      union all
      select 1
      from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb)) staff_member
      where lower(btrim(staff_member ->> 'employeeCode')) = lower(v_code)
    ) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.assignments[].employeeCode', 'code', 'staff_not_found', 'employeeCode', v_code)
      );
    end if;

    if v_item ? 'isActive' and jsonb_typeof(v_item -> 'isActive') <> 'boolean' then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.assignments[].isActive', 'code', 'boolean_required', 'employeeCode', v_code)
      );
    end if;
  end loop;

  -- Guardian rows may refer to a student already in the database or in this plan.
  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'guardians', '[]'::jsonb))
  loop
    v_code := nullif(btrim(v_item ->> 'studentCode'), '');
    if jsonb_typeof(v_item) <> 'object' or v_code is null then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.guardians[]', 'code', 'student_code_required')
      );
    elsif not exists (
      select 1 from public.students student
      where lower(btrim(student.student_code)) = lower(v_code)
      union all
      select 1
      from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb)) student
      where lower(btrim(student ->> 'studentCode')) = lower(v_code)
    ) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.guardians[].studentCode', 'code', 'student_not_found', 'studentCode', v_code)
      );
    end if;
  end loop;

  -- Student codes become student usernames. Staff usernames are optional until
  -- supplied. Validate combined input usernames case-insensitively.
  if exists (
    select 1
    from (
      select lower(btrim(student ->> 'studentCode')) as username_normalized
      from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb)) student
      union all
      select lower(btrim(staff_member ->> 'username'))
      from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb)) staff_member
      where nullif(btrim(staff_member ->> 'username'), '') is not null
    ) usernames
    group by username_normalized
    having count(*) > 1
  ) then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$', 'code', 'duplicate_username')
    );
  end if;

  v_counts := jsonb_build_object(
    'classrooms', jsonb_array_length(coalesce(p_payload -> 'classrooms', '[]'::jsonb)),
    'students', jsonb_array_length(coalesce(p_payload -> 'students', '[]'::jsonb)),
    'guardians', jsonb_array_length(coalesce(p_payload -> 'guardians', '[]'::jsonb)),
    'staff', jsonb_array_length(coalesce(p_payload -> 'staff', '[]'::jsonb)),
    'assignments', jsonb_array_length(coalesce(p_payload -> 'assignments', '[]'::jsonb))
  );

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'dryRun', p_dry_run,
      'schemaVersion', v_schema_version,
      'fingerprint', v_fingerprint,
      'serverFingerprint', v_fingerprint,
      'clientFingerprint', v_client_fingerprint,
      'counts', v_counts,
      'errors', v_errors
    );
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true,
      'dryRun', true,
      'schemaVersion', v_schema_version,
      'fingerprint', v_fingerprint,
      'serverFingerprint', v_fingerprint,
      'clientFingerprint', v_client_fingerprint,
      'counts', v_counts,
      'errors', '[]'::jsonb
    );
  end if;

  -- Serialize the same deterministic plan so two server workers cannot both apply
  -- it. The second caller observes the committed import_batches row and no-ops.
  perform pg_advisory_xact_lock(hashtextextended(v_fingerprint, 0));

  if exists (
    select 1 from private.import_batches batch where batch.fingerprint = v_fingerprint
  ) then
    return jsonb_build_object(
      'ok', true,
      'dryRun', false,
      'alreadyApplied', true,
      'schemaVersion', v_schema_version,
      'fingerprint', v_fingerprint,
      'serverFingerprint', v_fingerprint,
      'clientFingerprint', v_client_fingerprint,
      'counts', v_counts,
      'errors', '[]'::jsonb
    );
  end if;

  -- The nested block is a subtransaction. A natural-key collision rolls back the
  -- whole import and returns a non-PII error instead of leaving partial data behind.
  begin
    -- Create a planned term when this is the first import. Exact dates can be filled
    -- later; an existing term keeps its name/status and only fills missing dates.
    insert into public.academic_terms(
      school_year, semester, name, starts_on, ends_on, status
    ) values (
      v_school_year,
      v_semester,
      coalesce(
        nullif(btrim(p_payload #>> '{term,name}'), ''),
        format('ปีการศึกษา %s ภาคเรียนที่ %s', v_school_year, v_semester)
      ),
      v_term_starts_on,
      v_term_ends_on,
      'planned'
    )
    on conflict (school_year, semester)
    do update set
      name = coalesce(
        nullif(btrim(p_payload #>> '{term,name}'), ''),
        public.academic_terms.name
      ),
      starts_on = coalesce(public.academic_terms.starts_on, excluded.starts_on),
      ends_on = coalesce(public.academic_terms.ends_on, excluded.ends_on)
    returning id into v_term_id;

    -- Explicit classroom rows can override their display name.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'classrooms', '[]'::jsonb))
    loop
      v_grade_level := v_item ->> 'gradeLevel';
      v_room_number := private.normalize_room_number(v_item ->> 'roomNumber');
      v_display_name := coalesce(
        nullif(btrim(v_item ->> 'displayName'), ''),
        private.classroom_display_name(v_grade_level, v_room_number)
      );

      insert into public.classrooms(term_id, grade_level, room_number, display_name, is_active)
      values (v_term_id, v_grade_level, v_room_number, v_display_name, true)
      on conflict (term_id, grade_level, (lower(btrim(room_number))))
      do update set display_name = excluded.display_name, is_active = true;
    end loop;

    -- Student rows also derive missing classroom rows. Room "0" is first-class.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb))
    loop
      v_grade_level := v_item ->> 'gradeLevel';
      v_room_number := private.normalize_room_number(v_item ->> 'roomNumber');
      insert into public.classrooms(term_id, grade_level, room_number, display_name, is_active)
      values (
        v_term_id,
        v_grade_level,
        v_room_number,
        private.classroom_display_name(v_grade_level, v_room_number),
        true
      )
      on conflict (term_id, grade_level, (lower(btrim(room_number)))) do nothing;
    end loop;

    -- Staff master data is independent of Auth and can be updated later by code.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb))
    loop
      v_code := btrim(v_item ->> 'employeeCode');
      v_role := (v_item ->> 'role')::public.app_role;
      v_is_active := coalesce((v_item ->> 'isActive')::boolean, true);

      insert into public.teachers(
        employee_code, title, given_name, family_name, status, intended_role
      )
      values (
        v_code,
        nullif(btrim(v_item ->> 'title'), ''),
        btrim(v_item ->> 'givenName'),
        btrim(v_item ->> 'familyName'),
        case
          when v_is_active then 'active'::public.person_status
          else 'archived'::public.person_status
        end,
        v_role
      )
      on conflict ((lower(btrim(employee_code))))
      do update set
        title = coalesce(excluded.title, public.teachers.title),
        given_name = excluded.given_name,
        family_name = excluded.family_name,
        status = case
          when public.teachers.status = 'graduated' then public.teachers.status
          else excluded.status
        end,
        intended_role = excluded.intended_role
      returning id into v_teacher_id;

      -- Data-only imports must keep already-provisioned accounts in sync too.
      update public.profiles profile
      set role = teacher.intended_role,
          display_name = btrim(concat_ws(
            ' ', teacher.title, teacher.given_name, teacher.family_name
          )),
          is_active = teacher.status = 'active'
      from public.teachers teacher
      where teacher.id = v_teacher_id
        and teacher.user_id is not null
        and profile.user_id = teacher.user_id;

      update private.account_provisioning_queue queue
      set intended_role = v_role
      where queue.teacher_id = v_teacher_id;

      v_username := nullif(lower(btrim(v_item ->> 'username')), '');
      if v_username is not null
         and not exists (select 1 from public.teachers where id = v_teacher_id and user_id is not null) then
        insert into private.account_provisioning_queue(
          teacher_id, username, intended_role, status
        ) values (
          v_teacher_id, v_username, v_role, 'pending'
        )
        on conflict (teacher_id)
        do update set
          username = case
            when private.account_provisioning_queue.status in ('provisioned', 'disabled')
              then private.account_provisioning_queue.username
            else excluded.username
          end,
          intended_role = excluded.intended_role,
          status = case
            when private.account_provisioning_queue.status in ('provisioned', 'disabled')
              then private.account_provisioning_queue.status
            else 'pending'
          end;
      end if;
    end loop;

    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb))
    loop
      v_code := btrim(v_item ->> 'studentCode');
      v_is_active := coalesce((v_item ->> 'isActive')::boolean, true);
      v_birth_date := private.try_iso_date(nullif(btrim(v_item ->> 'birthDate'), ''));
      v_student_number := case
        when nullif(btrim(v_item ->> 'studentNumber'), '') is null then null
        else (v_item ->> 'studentNumber')::smallint
      end;

      insert into public.students(
        student_code, title, given_name, family_name, status
      )
      values (
        v_code,
        nullif(btrim(v_item ->> 'title'), ''),
        btrim(v_item ->> 'givenName'),
        btrim(v_item ->> 'familyName'),
        case
          when v_is_active then 'active'::public.person_status
          else 'archived'::public.person_status
        end
      )
      on conflict ((lower(btrim(student_code))))
      do update set
        title = coalesce(excluded.title, public.students.title),
        given_name = excluded.given_name,
        family_name = excluded.family_name,
        status = case
          when public.students.status = 'graduated' then public.students.status
          else excluded.status
        end
      returning id into v_student_id;

      update public.profiles profile
      set role = 'student',
          display_name = btrim(concat_ws(
            ' ', student.title, student.given_name, student.family_name
          )),
          is_active = student.status = 'active'
      from public.students student
      where student.id = v_student_id
        and student.user_id is not null
        and profile.user_id = student.user_id;

      if v_birth_date is not null then
        insert into private.student_private_identities(student_id, birth_date)
        values (v_student_id, v_birth_date)
        on conflict (student_id)
        do update set birth_date = excluded.birth_date;
      end if;

      v_grade_level := v_item ->> 'gradeLevel';
      v_room_number := private.normalize_room_number(v_item ->> 'roomNumber');
      select classroom.id into strict v_classroom_id
      from public.classrooms classroom
      where classroom.term_id = v_term_id
        and classroom.grade_level = v_grade_level
        and lower(btrim(classroom.room_number)) = lower(v_room_number);

      insert into public.enrollments(
        term_id, classroom_id, student_id, student_number, is_active
      ) values (
        v_term_id, v_classroom_id, v_student_id, v_student_number, v_is_active
      )
      on conflict (student_id, term_id)
      do update set
        classroom_id = excluded.classroom_id,
        student_number = coalesce(excluded.student_number, public.enrollments.student_number),
        is_active = excluded.is_active;

      if not exists (select 1 from public.students where id = v_student_id and user_id is not null) then
        insert into private.account_provisioning_queue(
          student_id, username, intended_role, status
        ) values (
          v_student_id, lower(v_code), 'student', 'pending'
        )
        on conflict (student_id)
        do update set
          username = case
            when private.account_provisioning_queue.status in ('provisioned', 'disabled')
              then private.account_provisioning_queue.username
            else excluded.username
          end,
          intended_role = 'student',
          status = case
            when private.account_provisioning_queue.status in ('provisioned', 'disabled')
              then private.account_provisioning_queue.status
            else 'pending'
          end;
      end if;
    end loop;

    -- Omitted guardian fields preserve prior known values. A completely blank row
    -- is ignored, so missing source data can be supplied by a later import.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'guardians', '[]'::jsonb))
    loop
      if nullif(btrim(v_item ->> 'name'), '') is not null
         or nullif(btrim(v_item ->> 'relationship'), '') is not null
         or nullif(btrim(v_item ->> 'phone'), '') is not null then
        select student.id into strict v_student_id
        from public.students student
        where lower(btrim(student.student_code)) = lower(btrim(v_item ->> 'studentCode'));

        insert into private.student_guardian_contacts(
          student_id, contact_order, contact_name, relationship, phone_number,
          is_primary, is_active
        ) values (
          v_student_id,
          1,
          nullif(btrim(v_item ->> 'name'), ''),
          nullif(btrim(v_item ->> 'relationship'), ''),
          nullif(btrim(v_item ->> 'phone'), ''),
          true,
          true
        )
        on conflict (student_id, contact_order)
        do update set
          contact_name = coalesce(excluded.contact_name, private.student_guardian_contacts.contact_name),
          relationship = coalesce(excluded.relationship, private.student_guardian_contacts.relationship),
          phone_number = coalesce(excluded.phone_number, private.student_guardian_contacts.phone_number),
          is_primary = true,
          is_active = true;
      end if;
    end loop;

    -- Assignment rows may target any already-created term in the plan.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'assignments', '[]'::jsonb))
    loop
      select term.id into strict v_assignment_term_id
      from public.academic_terms term
      where term.school_year = (v_item ->> 'schoolYear')::smallint
        and term.semester = (v_item ->> 'semester')::smallint;

      v_grade_level := v_item ->> 'gradeLevel';
      v_room_number := private.normalize_room_number(v_item ->> 'roomNumber');
      insert into public.classrooms(term_id, grade_level, room_number, display_name, is_active)
      values (
        v_assignment_term_id,
        v_grade_level,
        v_room_number,
        private.classroom_display_name(v_grade_level, v_room_number),
        true
      )
      on conflict (term_id, grade_level, (lower(btrim(room_number)))) do nothing;

      select classroom.id into strict v_classroom_id
      from public.classrooms classroom
      where classroom.term_id = v_assignment_term_id
        and classroom.grade_level = v_grade_level
        and lower(btrim(classroom.room_number)) = lower(v_room_number);

      select teacher.id into strict v_teacher_id
      from public.teachers teacher
      where lower(btrim(teacher.employee_code)) = lower(btrim(v_item ->> 'employeeCode'));

      v_is_active := coalesce((v_item ->> 'isActive')::boolean, true);
      insert into public.teacher_classroom_assignments(
        term_id, classroom_id, teacher_id, subject_name, is_active
      ) values (
        v_assignment_term_id,
        v_classroom_id,
        v_teacher_id,
        coalesce(nullif(btrim(v_item ->> 'subjectName'), ''), 'ประจำชั้น'),
        v_is_active
      )
      on conflict (term_id, classroom_id, teacher_id, subject_name)
      do update set is_active = excluded.is_active;
    end loop;

    insert into private.import_batches(
      schema_version, fingerprint, row_counts, applied_by
    ) values (
      v_schema_version, v_fingerprint, v_counts, v_uid
    )
    returning id into v_batch_id;

    perform private.write_audit(
      'import_school_data',
      'import_batch',
      v_batch_id::text,
      null,
      jsonb_build_object(
        'schema_version', v_schema_version,
        'fingerprint', v_fingerprint,
        'row_counts', v_counts
      )
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', false,
        'dryRun', false,
        'schemaVersion', v_schema_version,
        'fingerprint', v_fingerprint,
        'serverFingerprint', v_fingerprint,
        'clientFingerprint', v_client_fingerprint,
        'counts', v_counts,
        'errors', jsonb_build_array(jsonb_build_object('path', '$', 'code', 'natural_key_conflict'))
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'dryRun', false,
    'alreadyApplied', false,
    'batchId', v_batch_id,
    'schemaVersion', v_schema_version,
    'fingerprint', v_fingerprint,
    'serverFingerprint', v_fingerprint,
    'clientFingerprint', v_client_fingerprint,
    'counts', v_counts,
    'errors', '[]'::jsonb
  );
end;
$$;

commit;
