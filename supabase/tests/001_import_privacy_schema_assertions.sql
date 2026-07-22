-- Run after all migrations, for example with:
--   supabase db reset
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/001_import_privacy_schema_assertions.sql
-- The transaction is always rolled back and contains no real school data.

begin;

do $$
declare
  v_import_definition text;
  v_role_definition text;
  v_record_definition text;
  v_link_definition text;
  v_activation_definition text;
  v_teacher_scope_definition text;
  v_view_definition text;
  v_view_name text;
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

  if has_function_privilege(
       'authenticated',
       'public.admin_mark_account_activated(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.admin_mark_account_activated(uuid)',
       'EXECUTE'
     ) then
    raise exception 'activation-completion RPC must not be executable by frontend roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.admin_mark_account_activated(uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute activation-completion RPC';
  end if;

  if has_function_privilege(
       'authenticated',
       'private.clear_activation_after_first_password()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'private.clear_activation_after_first_password()',
       'EXECUTE'
     ) then
    raise exception 'activation trigger function is callable by a frontend role';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'auth'
      and relation.relname = 'users'
      and trigger_row.tgname = 'school_point_clear_activation_after_password'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'auth.users first-password activation trigger is missing';
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

  select pg_get_functiondef('private.current_role()'::regprocedure)
  into v_role_definition;
  if position('activation_required' in lower(v_role_definition)) = 0 then
    raise exception 'current_role does not enforce activation gate';
  end if;

  select pg_get_functiondef(
    'private.teacher_has_student(bigint,bigint)'::regprocedure
  ) into v_teacher_scope_definition;
  if position('term.status = ''active''' in lower(v_teacher_scope_definition)) = 0
     or position('activation_required' in lower(v_teacher_scope_definition)) = 0 then
    raise exception 'teacher scope is not limited to active-term assignments and activated accounts';
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
    if position('activation_required' in lower(v_view_definition)) = 0 then
      raise exception '% does not enforce activation gate', v_view_name;
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
    'public.admin_mark_account_activated(uuid)'::regprocedure
  ) into v_activation_definition;
  if position('encrypted_password' in lower(v_activation_definition)) = 0 then
    raise exception 'activation completion does not prove password presence server-side';
  end if;

  if has_sequence_privilege('authenticated', 'public.score_ledger_id_seq', 'USAGE') then
    raise exception 'authenticated has unnecessary score-ledger sequence usage';
  end if;

  if not has_sequence_privilege('authenticated', 'public.students_id_seq', 'USAGE') then
    raise exception 'authenticated admin cannot use students sequence';
  end if;
end;
$$;

rollback;
