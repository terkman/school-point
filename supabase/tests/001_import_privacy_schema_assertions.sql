-- Run after all migrations, for example with:
--   supabase db reset
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/001_import_privacy_schema_assertions.sql
-- The transaction is always rolled back and contains no real school data.

begin;

do $$
declare
  v_import_definition text;
  v_record_definition text;
  v_link_definition text;
  v_activation_definition text;
  v_session_definition text;
  v_helper_definition text;
  v_helper_signature text;
  v_teacher_scope_definition text;
  v_view_definition text;
  v_view_name text;
  v_policy_definition text;
  v_policy record;
  v_rpc record;
  v_table_name text;
  v_original_claims text := current_setting('request.jwt.claims', true);
begin
  if to_regclass('private.student_guardian_contacts') is null then
    raise exception 'private.student_guardian_contacts is missing';
  end if;

  if to_regclass('private.account_provisioning_queue') is null then
    raise exception 'private.account_provisioning_queue is missing';
  end if;

  if to_regclass('private.import_batches') is null then
    raise exception 'private.import_batches is missing';
  end if;

  if to_regclass('public.positive_behavior_rules') is null then
    raise exception 'public.positive_behavior_rules is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'enrollments'
      and column_name = 'student_number'
  ) then
    raise exception 'public.enrollments.student_number is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'activation_required'
      and is_nullable = 'NO'
      and column_default ilike '%true%'
  ) then
    raise exception 'profiles.activation_required must be NOT NULL default true';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'academic_terms'
      and column_name in ('starts_on', 'ends_on')
      and is_nullable <> 'YES'
  ) then
    raise exception 'planned academic term dates must be nullable';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'student_incident_history'
      and column_name = 'appeal_created_at'
  ) then
    raise exception 'student_incident_history.appeal_created_at is missing';
  end if;

  if private.normalize_room_number(null) <> '0'
     or private.normalize_room_number('  ') <> '0'
     or private.normalize_room_number(' 2 ') <> '2' then
    raise exception 'room normalization contract failed';
  end if;

  if private.classroom_display_name('P1', '0') <> 'ป.1'
     or private.classroom_display_name('M3', '2') <> 'ม.3/2' then
    raise exception 'classroom display-name contract failed';
  end if;

  if not private.is_valid_username('69001')
     or not private.is_valid_username('teacher.demo')
     or private.is_valid_username('.teacher')
     or private.is_valid_username('teacher.')
     or private.is_valid_username('teacher..demo')
     or private.is_valid_username(repeat('a', 65))
     or private.is_valid_username('ครู01') then
    raise exception 'username validation contract failed';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'appeals'
      and policyname = 'appeals_select'
  ) then
    raise exception 'legacy student-readable appeals_select policy still exists';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'appeals'
      and policyname = 'appeals_staff_select'
  ) then
    raise exception 'staff-only appeals policy is missing';
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname in (
        'student_guardian_contacts',
        'account_provisioning_queue',
        'import_batches'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
    group by namespace.nspname
    having count(*) = 3
  ) then
    raise exception 'private import/PII tables must have forced RLS';
  end if;

  if has_table_privilege('authenticated', 'private.student_guardian_contacts', 'SELECT')
     or has_table_privilege('anon', 'private.student_guardian_contacts', 'SELECT') then
    raise exception 'guardian PII is directly readable by an API role';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.admin_import_school_data(jsonb,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.admin_import_school_data(jsonb,boolean)',
       'EXECUTE'
     ) then
    raise exception 'import RPC must not be executable by frontend roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.admin_import_school_data(jsonb,boolean)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute import RPC';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.admin_link_provisioned_account(text,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.admin_link_provisioned_account(text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'account-link RPC must not be executable by frontend roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.admin_link_provisioned_account(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute account-link RPC';
  end if;

  if to_regprocedure('public.admin_mark_account_activated(uuid)') is not null then
    raise exception 'legacy encrypted-password activation RPC still exists';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.complete_first_password_activation()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.complete_first_password_activation()',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.complete_first_password_activation()',
       'EXECUTE'
     ) then
    raise exception 'first-password activation RPC privileges are not least-privilege';
  end if;

  foreach v_helper_signature in array array[
    'private.has_password_session()',
    'private.current_role()',
    'private.is_admin()',
    'private.current_student_id()',
    'private.teacher_has_student(bigint,bigint)'
  ] loop
    if not has_function_privilege(
         'authenticated',
         v_helper_signature,
         'EXECUTE'
       )
       or has_function_privilege('anon', v_helper_signature, 'EXECUTE')
       or has_function_privilege('service_role', v_helper_signature, 'EXECUTE')
       or exists (
         select 1
         from pg_proc procedure
         cross join lateral aclexplode(
           coalesce(procedure.proacl, acldefault('f', procedure.proowner))
         ) as acl_entry
         where procedure.oid = v_helper_signature::regprocedure
           and acl_entry.grantee = 0
           and acl_entry.privilege_type = 'EXECUTE'
       ) then
      raise exception 'shared authorization helper % has unsafe EXECUTE privileges',
        v_helper_signature;
    end if;
  end loop;

  if to_regprocedure('public.rls_auto_enable()') is not null
     and (
       has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE')
     ) then
    raise exception 'automatic RLS event-trigger function is callable by a frontend role';
  end if;

  if to_regprocedure('private.clear_activation_after_first_password()') is not null then
    raise exception 'legacy encrypted-password activation trigger function still exists';
  end if;

  if exists (
    select 1
    from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'auth'
      and relation.relname = 'users'
      and trigger_row.tgname = 'school_point_clear_activation_after_password'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'legacy auth.users encrypted-password activation trigger still exists';
  end if;

  select pg_get_functiondef(
    'public.admin_import_school_data(jsonb,boolean)'::regprocedure
  ) into v_import_definition;
  if position('sha256' in lower(v_import_definition)) = 0
     or position('p_payload -' in lower(v_import_definition)) = 0 then
    raise exception 'import idempotency key is not derived from payload server-side';
  end if;

  if position('status in (''provisioned'', ''disabled'')' in lower(v_import_definition)) = 0 then
    raise exception 're-import does not preserve disabled provisioning records';
  end if;

  if regexp_count(lower(v_import_definition), '::public\.person_status') < 2 then
    raise exception 'import staff/student status CASE expressions are not cast to person_status';
  end if;

  if position('''active''::public.person_status' in lower(v_import_definition)) = 0
     or position('''archived''::public.person_status' in lower(v_import_definition)) = 0 then
    raise exception 'import person status CASE expressions need explicit enum casts';
  end if;

  select pg_get_functiondef('private.has_password_session()'::regprocedure)
  into v_session_definition;
  if position('auth.uid()' in lower(v_session_definition)) = 0
     or position('auth.role()' in lower(v_session_definition)) = 0
     or position('auth.jwt()' in lower(v_session_definition)) = 0
     or position('jsonb_typeof' in lower(v_session_definition)) = 0
     or position('jsonb_array_elements' in lower(v_session_definition)) = 0
     or position('''amr''' in lower(v_session_definition)) = 0
     or position('''password''' in lower(v_session_definition)) = 0 then
    raise exception 'password-session helper does not enforce the signed JWT AMR contract';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'has_password_session'
      and procedure.pronargs = 0
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting(value)
        where replace(setting.value, '"', '') = 'search_path='
      )
  ) then
    raise exception 'password-session helper must be STABLE SECURITY DEFINER with empty search_path';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    true
  );
  if private.has_password_session() then
    raise exception 'OTP AMR must not satisfy the password-session contract';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","amr":[{"method":"password","timestamp":1}]}',
    true
  );
  if not private.has_password_session() then
    raise exception 'password AMR must satisfy the password-session contract';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","amr":{"method":"password"}}',
    true
  );
  if private.has_password_session() then
    raise exception 'malformed non-array AMR must fail closed';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
    true
  );
  if private.has_password_session() then
    raise exception 'missing AMR must fail closed';
  end if;

  if v_original_claims is null then
    execute 'reset request.jwt.claims';
  else
    perform set_config('request.jwt.claims', v_original_claims, true);
  end if;

  foreach v_helper_signature in array array[
    'private.current_role()',
    'private.is_admin()',
    'private.current_student_id()',
    'private.teacher_has_student(bigint,bigint)'
  ] loop
    select pg_get_functiondef(v_helper_signature::regprocedure)
    into v_helper_definition;
    if position('private.has_password_session' in lower(v_helper_definition)) = 0
       or position('activation_required' in lower(v_helper_definition)) = 0 then
      raise exception '% does not enforce password AMR and activation state', v_helper_signature;
    end if;
  end loop;

  select pg_get_functiondef(
    'private.teacher_has_student(bigint,bigint)'::regprocedure
  ) into v_teacher_scope_definition;
  if position('term.status = ''active''' in lower(v_teacher_scope_definition)) = 0
     or position('activation_required' in lower(v_teacher_scope_definition)) = 0
     or position('private.has_password_session' in lower(v_teacher_scope_definition)) = 0 then
    raise exception 'teacher scope is not limited to active-term assignments and password sessions';
  end if;

  foreach v_view_name in array array[
    'student_current_scores',
    'student_score_history',
    'student_incident_history'
  ] loop
    select pg_get_viewdef(
      format('public.%I', v_view_name)::regclass,
      true
    ) into v_view_definition;
    if position('activation_required' in lower(v_view_definition)) = 0
       or position('private.has_password_session' in lower(v_view_definition)) = 0 then
      raise exception '% does not enforce activation and password-session gates', v_view_name;
    end if;
    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = v_view_name
        and coalesce(relation.reloptions, array[]::text[]) @> array['security_invoker=true']
    ) then
      raise exception '% must run with caller permissions', v_view_name;
    end if;
  end loop;

  select pg_get_functiondef(
    'public.record_deduction(bigint,bigint,timestamp with time zone,text,text)'::regprocedure
  ) into v_record_definition;
  if position('v_role is null' in lower(v_record_definition)) = 0 then
    raise exception 'record_deduction does not reject a gated NULL role';
  end if;

  select pg_get_functiondef(
    'public.admin_link_provisioned_account(text,uuid)'::regprocedure
  ) into v_link_definition;
  if position('activation_required' in lower(v_link_definition)) = 0 then
    raise exception 'account linking does not create an activation gate';
  end if;

  select pg_get_functiondef(
    'public.complete_first_password_activation()'::regprocedure
  ) into v_activation_definition;
  if position('auth.uid()' in lower(v_activation_definition)) = 0
     or position('auth.role()' in lower(v_activation_definition)) = 0
     or position('activation_required' in lower(v_activation_definition)) = 0
     or position('is_active' in lower(v_activation_definition)) = 0
     or position('''amr''' in lower(v_activation_definition)) = 0
     or position('''password''' in lower(v_activation_definition)) = 0
     or position('private.write_audit' in lower(v_activation_definition)) = 0
     or position('private.current_role' in lower(v_activation_definition)) > 0
     or position('encrypted_password' in lower(v_activation_definition)) > 0 then
    raise exception 'first-password activation does not enforce the JWT AMR contract';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'complete_first_password_activation'
      and procedure.pronargs = 0
      and procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting(value)
        where replace(setting.value, '"', '') = 'search_path='
      )
  ) then
    raise exception 'first-password activation RPC must be SECURITY DEFINER with empty search_path';
  end if;

  select lower(coalesce(policy.qual, ''))
  into v_policy_definition
  from pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename = 'profiles'
    and policy.policyname = 'profiles_select';

  if v_policy_definition is null
     or position('auth.uid()' in v_policy_definition) = 0
     or position('private.is_admin' in v_policy_definition) = 0 then
    raise exception 'own-profile OTP read exception is missing or too broad';
  end if;

  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'profiles'
      and policy.policyname = 'password_session_required'
  ) then
    raise exception 'profiles must preserve the narrow own-row OTP read exception';
  end if;

  foreach v_table_name in array array[
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
  ] loop
    if not exists (
      select 1
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = v_table_name
        and policy.policyname = 'password_session_required'
        and lower(policy.permissive) = 'restrictive'
        and lower(policy.cmd) = 'all'
        and 'authenticated' = any(policy.roles)
        and position('private.has_password_session' in lower(coalesce(policy.qual, ''))) > 0
        and position('private.has_password_session' in lower(coalesce(policy.with_check, ''))) > 0
    ) then
      raise exception 'table % is missing its top-level restrictive password-session policy',
        v_table_name;
    end if;
  end loop;

  -- Every authenticated public-table policy except the deliberately narrow own-
  -- profile read must call the password-session helper directly or through one
  -- of the four shared authorization helpers.
  for v_policy in
    select policy.tablename,
           policy.policyname,
           replace(lower(concat_ws(' ', policy.qual, policy.with_check)), '"', '') as definition
    from pg_policies policy
    where policy.schemaname = 'public'
      and (
        'authenticated' = any(policy.roles)
        or 'public' = any(policy.roles)
      )
      and not (
        policy.tablename = 'profiles'
        and policy.policyname = 'profiles_select'
      )
  loop
    if position('private.has_password_session' in v_policy.definition) = 0
       and position('private.current_role' in v_policy.definition) = 0
       and position('private.is_admin' in v_policy.definition) = 0
       and position('private.current_student_id' in v_policy.definition) = 0
       and position('private.teacher_has_student' in v_policy.definition) = 0 then
      raise exception 'policy %.% bypasses the password-session authorization contract',
        v_policy.tablename,
        v_policy.policyname;
    end if;
  end loop;

  -- Audit all authenticated SECURITY DEFINER endpoints, not just today's named
  -- RPC list. The activation-completion RPC proves AMR itself; every other
  -- frontend endpoint must delegate authorization to a shared gated helper.
  for v_rpc in
    select procedure.oid::regprocedure::text as signature,
           procedure.proname,
           replace(lower(pg_get_functiondef(procedure.oid)), '"', '') as definition
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  loop
    if v_rpc.proname = 'complete_first_password_activation' then
      continue;
    end if;

    if position('private.current_role' in v_rpc.definition) = 0
       and position('private.is_admin' in v_rpc.definition) = 0
       and position('private.current_student_id' in v_rpc.definition) = 0
       and position('private.teacher_has_student' in v_rpc.definition) = 0
       and position('private.has_password_session' in v_rpc.definition) = 0 then
      raise exception 'authenticated SECURITY DEFINER function % bypasses password-session authorization',
        v_rpc.signature;
    end if;
  end loop;

  if has_sequence_privilege('authenticated', 'public.score_ledger_id_seq', 'USAGE') then
    raise exception 'authenticated has unnecessary score-ledger sequence usage';
  end if;

  if not has_sequence_privilege('authenticated', 'public.students_id_seq', 'USAGE') then
    raise exception 'authenticated admin cannot use students sequence';
  end if;
end;
$$;

rollback;
