-- Run after all migrations, for example with:
--   supabase db reset
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/001_import_privacy_schema_assertions.sql
-- The transaction is always rolled back and contains no real school data.

begin;

do $$
declare
  v_import_definition text;
  v_record_definition text;
  v_bulk_definition text;
  v_addition_definition text;
  v_review_definition text;
  v_admin_addition_definition text;
  v_link_definition text;
  v_activation_definition text;
  v_session_definition text;
  v_term_schedule_definition text;
  v_term_activation_definition text;
  v_guardian_guard_definition text;
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

  if to_regclass('private.deduction_batches') is null then
    raise exception 'private.deduction_batches is missing';
  end if;

  if exists (
    select 1
    from (
      values
        ('id', 'bigint', 'int8', 'NO', 'YES'),
        ('client_request_id', 'uuid', 'uuid', 'NO', 'NO'),
        ('recorded_by', 'uuid', 'uuid', 'NO', 'NO'),
        ('recorded_by_snapshot', 'text', 'text', 'NO', 'NO'),
        ('term_id', 'bigint', 'int8', 'NO', 'NO'),
        ('scope', 'text', 'text', 'NO', 'NO'),
        ('classroom_id', 'bigint', 'int8', 'YES', 'NO'),
        ('target_student_ids', 'ARRAY', '_int8', 'NO', 'NO'),
        ('target_count', 'smallint', 'int2', 'NO', 'NO'),
        ('rule_id', 'bigint', 'int8', 'NO', 'NO'),
        ('rule_snapshot', 'jsonb', 'jsonb', 'NO', 'NO'),
        ('requested_points_each', 'smallint', 'int2', 'NO', 'NO'),
        ('occurred_at', 'timestamp with time zone', 'timestamptz', 'NO', 'NO'),
        ('student_visible_note', 'text', 'text', 'YES', 'NO'),
        ('internal_note', 'text', 'text', 'NO', 'NO'),
        ('payload_hash', 'text', 'text', 'NO', 'NO'),
        ('total_requested_points', 'integer', 'int4', 'NO', 'NO'),
        ('total_applied_points', 'integer', 'int4', 'NO', 'NO'),
        ('already_at_zero_count', 'smallint', 'int2', 'NO', 'NO'),
        ('guardian_task_count', 'smallint', 'int2', 'NO', 'NO'),
        ('result_summary', 'jsonb', 'jsonb', 'NO', 'NO'),
        ('recorded_at', 'timestamp with time zone', 'timestamptz', 'NO', 'NO')
    ) as expected(column_name, data_type, udt_name, is_nullable, is_identity)
    left join information_schema.columns column_row
      on column_row.table_schema = 'private'
     and column_row.table_name = 'deduction_batches'
     and column_row.column_name = expected.column_name
     and column_row.data_type = expected.data_type
     and column_row.udt_name = expected.udt_name
     and column_row.is_nullable = expected.is_nullable
     and column_row.is_identity = expected.is_identity
    where column_row.column_name is null
  ) then
    raise exception 'private.deduction_batches core structure is incomplete';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'incidents'
      and column_row.column_name = 'deduction_batch_id'
      and column_row.data_type = 'bigint'
      and column_row.is_nullable = 'YES'
  ) then
    raise exception 'public.incidents.deduction_batch_id is missing or malformed';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'private.deduction_batches'::regclass
      and constraint_row.contype = 'u'
      and lower(pg_get_constraintdef(constraint_row.oid)) =
          'unique (recorded_by, client_request_id)'
  ) then
    raise exception 'deduction batch idempotency key is not unique per recorder';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'private.deduction_batches'::regclass
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and position(
        'char_length(payload_hash) = 64'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
  ) then
    raise exception 'deduction batch payload hash must be a 64-character SHA-256 hex digest';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.incidents'::regclass
      and constraint_row.confrelid = 'private.deduction_batches'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.conkey = array[
        (
          select attribute.attnum
          from pg_attribute attribute
          where attribute.attrelid = 'public.incidents'::regclass
            and attribute.attname = 'deduction_batch_id'
            and not attribute.attisdropped
        )
      ]::smallint[]
      and constraint_row.confkey = array[
        (
          select attribute.attnum
          from pg_attribute attribute
          where attribute.attrelid = 'private.deduction_batches'::regclass
            and attribute.attname = 'id'
            and not attribute.attisdropped
        )
      ]::smallint[]
  ) then
    raise exception 'incidents.deduction_batch_id foreign key is missing or incorrect';
  end if;

  if not exists (
    select 1
    from pg_index index_row
    join pg_class index_relation on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.incidents'::regclass
      and index_relation.relname = 'incidents_batch_student_idx'
      and index_row.indisunique
      and position(
        '(deduction_batch_id, student_id)'
        in lower(pg_get_indexdef(index_row.indexrelid))
      ) > 0
      and position(
        'deduction_batch_id is not null'
        in lower(pg_get_expr(index_row.indpred, index_row.indrelid))
      ) > 0
  ) then
    raise exception 'incident batch/student unique partial index is missing or incorrect';
  end if;

  if not exists (
    select 1
    from pg_index index_row
    join pg_class index_relation on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'private.deduction_batches'::regclass
      and index_relation.relname = 'deduction_batches_term_recorded_idx'
      and position(
        '(term_id, recorded_at desc)'
        in lower(pg_get_indexdef(index_row.indexrelid))
      ) > 0
  ) then
    raise exception 'deduction batch term/date index is missing or incorrect';
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'deduction_batches'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception 'private.deduction_batches must have forced RLS';
  end if;

  if exists (
    select 1
    from pg_class relation
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as acl_entry
    where relation.oid = 'private.deduction_batches'::regclass
      and acl_entry.grantee in (
        0,
        (select oid from pg_roles where rolname = 'anon'),
        (select oid from pg_roles where rolname = 'authenticated'),
        (select oid from pg_roles where rolname = 'service_role')
      )
  ) then
    raise exception 'private.deduction_batches grants direct access to an API role';
  end if;

  if exists (
    select 1
    from (
      values
        ('activity_occurred_at', 'timestamp with time zone', 'timestamptz'),
        ('client_request_id', 'uuid', 'uuid'),
        ('request_payload_hash', 'text', 'text')
    ) as expected(column_name, data_type, udt_name)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'point_addition_requests'
     and column_row.column_name = expected.column_name
     and column_row.data_type = expected.data_type
     and column_row.udt_name = expected.udt_name
     and column_row.is_nullable = 'YES'
    where column_row.column_name is null
  ) then
    raise exception 'detailed addition-request columns are missing or malformed';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.point_addition_requests'::regclass
      and constraint_row.conname = 'point_requests_idempotency_pair'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
  )
  or not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.point_addition_requests'::regclass
      and constraint_row.conname = 'point_requests_payload_hash_length'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and position(
        'char_length(request_payload_hash) = 64'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
  )
  or not exists (
    select 1
    from pg_index index_row
    join pg_class index_relation on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.point_addition_requests'::regclass
      and index_relation.relname = 'point_requests_requester_client_id_idx'
      and index_row.indisunique
      and position(
        '(requested_by, client_request_id)'
        in lower(pg_get_indexdef(index_row.indexrelid))
      ) > 0
      and position(
        'client_request_id is not null'
        in lower(pg_get_expr(index_row.indpred, index_row.indrelid))
      ) > 0
  ) then
    raise exception 'addition-request idempotency constraints or index are incomplete';
  end if;

  if exists (
    select 1
    from (
      values
        ('positive_rule_id', 'bigint', 'int8'),
        ('positive_rule_snapshot', 'jsonb', 'jsonb'),
        ('activity_occurred_at', 'timestamp with time zone', 'timestamptz'),
        ('internal_reason', 'text', 'text'),
        ('evidence_note', 'text', 'text'),
        ('client_request_id', 'uuid', 'uuid'),
        ('request_payload_hash', 'text', 'text')
    ) as expected(column_name, data_type, udt_name)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'score_ledger'
     and column_row.column_name = expected.column_name
     and column_row.data_type = expected.data_type
     and column_row.udt_name = expected.udt_name
     and column_row.is_nullable = 'YES'
    where column_row.column_name is null
  ) then
    raise exception 'structured direct-addition score-ledger columns are missing or malformed';
  end if;

  if (
    select count(*)
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.score_ledger'::regclass
      and constraint_row.conname in (
        'score_ledger_positive_rule_snapshot_pair',
        'score_ledger_idempotency_pair',
        'score_ledger_payload_hash_length',
        'score_ledger_direct_addition_details'
      )
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
  ) <> 4 then
    raise exception 'structured direct-addition score-ledger constraints are incomplete';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.score_ledger'::regclass
      and constraint_row.conname = 'score_ledger_positive_rule_snapshot_pair'
      and position(
        'positive_rule_id is null'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
      and position(
        'positive_rule_snapshot is null'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
      and position(
        'positive_rule_id is not null'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
      and position(
        'jsonb_typeof(positive_rule_snapshot) = ''object'''
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
  )
  or not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.score_ledger'::regclass
      and constraint_row.conname = 'score_ledger_idempotency_pair'
      and position(
        'client_request_id is null'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
      and position(
        'request_payload_hash is null'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
      and position(
        'client_request_id is not null'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
      and position(
        'request_payload_hash is not null'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
  )
  or not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.score_ledger'::regclass
      and constraint_row.conname = 'score_ledger_payload_hash_length'
      and position(
        'char_length(request_payload_hash) = 64'
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
  )
  or not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.score_ledger'::regclass
      and constraint_row.conname = 'score_ledger_direct_addition_details'
      and position(
        'entry_type = ''admin_addition'''
        in lower(pg_get_constraintdef(constraint_row.oid))
      ) > 0
      and position('positive_rule_id is not null' in lower(pg_get_constraintdef(constraint_row.oid))) > 0
      and position('activity_occurred_at is not null' in lower(pg_get_constraintdef(constraint_row.oid))) > 0
      and position('internal_reason' in lower(pg_get_constraintdef(constraint_row.oid))) > 0
      and position('evidence_note' in lower(pg_get_constraintdef(constraint_row.oid))) > 0
  ) then
    raise exception 'structured direct-addition score-ledger constraint definitions are unsafe';
  end if;

  if not exists (
    select 1
    from pg_index index_row
    join pg_class index_relation on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.score_ledger'::regclass
      and index_relation.relname = 'score_ledger_actor_client_id_idx'
      and index_row.indisunique
      and position(
        '(actor_user_id, client_request_id)'
        in lower(pg_get_indexdef(index_row.indexrelid))
      ) > 0
      and position(
        'client_request_id is not null'
        in lower(pg_get_expr(index_row.indpred, index_row.indrelid))
      ) > 0
  ) then
    raise exception 'direct-addition actor/request unique partial index is missing or incorrect';
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
    'public.record_deductions_bulk(uuid,text,bigint[],bigint,bigint,timestamp with time zone,text,text,boolean)',
    'public.request_point_addition_detailed(uuid,bigint,bigint,smallint,timestamp with time zone,text,text)',
    'public.review_point_addition(bigint,boolean,text)',
    'public.admin_add_points_detailed(uuid,bigint,bigint,smallint,timestamp with time zone,text,text,bigint)',
    'public.get_my_score_history()',
    'public.get_my_incident_history()'
  ] loop
    if to_regprocedure(v_helper_signature) is null then
      raise exception 'required frontend RPC % is missing', v_helper_signature;
    end if;

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
      raise exception 'frontend RPC % is not authenticated-only',
        v_helper_signature;
    end if;

    if not exists (
      select 1
      from pg_proc procedure
      where procedure.oid = v_helper_signature::regprocedure
        and procedure.prosecdef
        and exists (
          select 1
          from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting(value)
          where replace(setting.value, '"', '') = 'search_path='
        )
    ) then
      raise exception 'frontend RPC % must be SECURITY DEFINER with empty search_path',
        v_helper_signature;
    end if;
  end loop;

  if to_regprocedure(
       'public.request_point_addition(bigint,smallint,text,text)'
     ) is null then
    raise exception 'legacy request_point_addition RPC unexpectedly disappeared';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.request_point_addition(bigint,smallint,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.request_point_addition(bigint,smallint,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.request_point_addition(bigint,smallint,text,text)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(
         coalesce(procedure.proacl, acldefault('f', procedure.proowner))
       ) as acl_entry
       where procedure.oid =
             'public.request_point_addition(bigint,smallint,text,text)'::regprocedure
         and acl_entry.grantee = 0
         and acl_entry.privilege_type = 'EXECUTE'
  ) then
    raise exception 'legacy request_point_addition RPC is still executable by an API role';
  end if;

  if to_regprocedure(
       'public.record_deduction(bigint,bigint,timestamp with time zone,text,text)'
     ) is null then
    raise exception 'legacy record_deduction RPC unexpectedly disappeared';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.record_deduction(bigint,bigint,timestamp with time zone,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.record_deduction(bigint,bigint,timestamp with time zone,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.record_deduction(bigint,bigint,timestamp with time zone,text,text)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(
         coalesce(procedure.proacl, acldefault('f', procedure.proowner))
       ) as acl_entry
       where procedure.oid =
             'public.record_deduction(bigint,bigint,timestamp with time zone,text,text)'::regprocedure
         and acl_entry.grantee = 0
         and acl_entry.privilege_type = 'EXECUTE'
  ) then
    raise exception 'legacy record_deduction RPC is still executable by an API role';
  end if;

  if to_regprocedure(
       'public.admin_add_points(bigint,smallint,text,bigint)'
     ) is null then
    raise exception 'legacy admin_add_points RPC unexpectedly disappeared';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.admin_add_points(bigint,smallint,text,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.admin_add_points(bigint,smallint,text,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.admin_add_points(bigint,smallint,text,bigint)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(
         coalesce(procedure.proacl, acldefault('f', procedure.proowner))
       ) as acl_entry
       where procedure.oid =
             'public.admin_add_points(bigint,smallint,text,bigint)'::regprocedure
         and acl_entry.grantee = 0
         and acl_entry.privilege_type = 'EXECUTE'
     ) then
    raise exception 'legacy admin_add_points RPC is still executable by an API role';
  end if;

  if to_regprocedure(
       'public.admin_update_term_schedule(bigint,date,date)'
     ) is null then
    raise exception 'admin term-schedule RPC is missing';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.admin_update_term_schedule(bigint,date,date)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.admin_update_term_schedule(bigint,date,date)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.admin_update_term_schedule(bigint,date,date)',
       'EXECUTE'
     ) then
    raise exception 'admin term-schedule RPC privileges are not least-privilege';
  end if;

  if to_regprocedure('public.admin_activate_term(bigint)') is null then
    raise exception 'admin term-activation RPC is missing';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.admin_activate_term(bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.admin_activate_term(bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.admin_activate_term(bigint)',
       'EXECUTE'
     ) then
    raise exception 'admin term-activation RPC privileges are not least-privilege';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'behavior_rules_guardian_contact_severity'
      and constraint_row.conrelid = 'public.behavior_rules'::regclass
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
  ) then
    raise exception 'guardian-contact severity CHECK is missing or unvalidated';
  end if;

  if exists (
    select 1
    from public.behavior_rules rule
    where rule.guardian_contact_required is distinct from
          (rule.severity in ('serious', 'critical'))
  ) then
    raise exception 'guardian-contact rule mapping is not serious/critical only';
  end if;

  if to_regprocedure(
       'private.enforce_guardian_contact_task_severity()'
     ) is null
     or has_function_privilege(
       'authenticated',
       'private.enforce_guardian_contact_task_severity()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'private.enforce_guardian_contact_task_severity()',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'private.enforce_guardian_contact_task_severity()',
       'EXECUTE'
     ) then
    raise exception 'guardian-contact task guard has unsafe privileges';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.guardian_contact_tasks'::regclass
      and trigger_row.tgname = 'guardian_contact_task_severity_guard'
      and trigger_row.tgenabled <> 'D'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'guardian-contact task severity trigger is missing or disabled';
  end if;

  if exists (
    select 1
    from public.guardian_contact_tasks task
    join public.incidents incident on incident.id = task.incident_id
    where incident.severity not in ('serious', 'critical')
       or task.student_id is distinct from incident.student_id
  ) then
    raise exception 'guardian-contact task references an ineligible incident';
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

  select pg_get_viewdef(
    'public.student_score_history'::regclass,
    true
  ) into v_view_definition;
  if position('internal_reason' in lower(v_view_definition)) > 0
     or position('evidence_note' in lower(v_view_definition)) > 0
     or position('positive_rule_snapshot' in lower(v_view_definition)) = 0
     or position('teacher_request_approved' in lower(v_view_definition)) = 0
     or position('admin_addition' in lower(v_view_definition)) = 0
     or position('กิจกรรมเพิ่มคะแนน' in v_view_definition) = 0
     or position('else ledger.reason' in lower(v_view_definition)) = 0 then
    raise exception 'student score history does not safely redact addition details and legacy reasons';
  end if;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'student_score_history'
      and column_row.column_name in ('internal_reason', 'evidence_note')
  ) then
    raise exception 'student score history exposes staff-only reason or evidence columns';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = 'public.get_my_score_history()'::regprocedure
      and procedure.pronargs = 0
      and procedure.proretset
      and procedure.provolatile = 's'
      and procedure.proallargtypes = array[
        'bigint'::regtype::oid,
        'bigint'::regtype::oid,
        'public.score_entry_type'::regtype::oid,
        'smallint'::regtype::oid,
        'smallint'::regtype::oid,
        'smallint'::regtype::oid,
        'smallint'::regtype::oid,
        'text'::regtype::oid,
        'bigint'::regtype::oid,
        'timestamp with time zone'::regtype::oid
      ]::oid[]
      and procedure.proargmodes = array[
        't'::"char", 't'::"char", 't'::"char", 't'::"char", 't'::"char",
        't'::"char", 't'::"char", 't'::"char", 't'::"char", 't'::"char"
      ]::"char"[]
      and procedure.proargnames = array[
        'id',
        'term_id',
        'entry_type',
        'requested_delta',
        'applied_delta',
        'balance_before',
        'balance_after',
        'reason',
        'incident_id',
        'created_at'
      ]::text[]
  ) then
    raise exception 'student score-history RPC return contract or STABLE volatility is incorrect';
  end if;

  select pg_get_functiondef(
    'public.get_my_score_history()'::regprocedure
  ) into v_helper_definition;
  if position('private.current_student_id()' in lower(v_helper_definition)) = 0
     or position('v_student_id is null' in lower(v_helper_definition)) = 0
     or position('errcode = ''42501''' in lower(v_helper_definition)) = 0
     or position('ledger.student_id = v_student_id' in lower(v_helper_definition)) = 0
     or position('positive_rule_snapshot ->> ''title_th''' in lower(v_helper_definition)) = 0
     or position('teacher_request_approved' in lower(v_helper_definition)) = 0
     or position('admin_addition' in lower(v_helper_definition)) = 0
     or position('กิจกรรมเพิ่มคะแนน' in v_helper_definition) = 0
     or position('internal_reason' in lower(v_helper_definition)) > 0
     or position('evidence_note' in lower(v_helper_definition)) > 0
     or position('actor_' in lower(v_helper_definition)) > 0
     or position('request_payload_hash' in lower(v_helper_definition)) > 0
     or position('client_request_id' in lower(v_helper_definition)) > 0 then
    raise exception 'student score-history RPC authorization or redaction contract is unsafe';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = 'public.get_my_incident_history()'::regprocedure
      and procedure.pronargs = 0
      and procedure.proretset
      and procedure.provolatile = 's'
      and procedure.proallargtypes = array[
        'bigint'::regtype::oid,
        'bigint'::regtype::oid,
        'text'::regtype::oid,
        'text'::regtype::oid,
        'smallint'::regtype::oid,
        'smallint'::regtype::oid,
        'public.rule_severity'::regtype::oid,
        'timestamp with time zone'::regtype::oid,
        'timestamp with time zone'::regtype::oid,
        'timestamp with time zone'::regtype::oid,
        'text'::regtype::oid,
        'boolean'::regtype::oid,
        'bigint'::regtype::oid,
        'public.appeal_status'::regtype::oid,
        'text'::regtype::oid,
        'timestamp with time zone'::regtype::oid
      ]::oid[]
      and procedure.proargmodes = array[
        't'::"char", 't'::"char", 't'::"char", 't'::"char", 't'::"char",
        't'::"char", 't'::"char", 't'::"char", 't'::"char", 't'::"char",
        't'::"char", 't'::"char", 't'::"char", 't'::"char", 't'::"char",
        't'::"char"
      ]::"char"[]
      and procedure.proargnames = array[
        'id',
        'term_id',
        'rule_code',
        'rule_title',
        'requested_points',
        'applied_points',
        'severity',
        'occurred_at',
        'recorded_at',
        'appeal_deadline',
        'student_visible_note',
        'is_voided',
        'appeal_id',
        'appeal_status',
        'decision_note',
        'appeal_created_at'
      ]::text[]
  ) then
    raise exception 'student incident-history RPC return contract or STABLE volatility is incorrect';
  end if;

  select pg_get_functiondef(
    'public.get_my_incident_history()'::regprocedure
  ) into v_helper_definition;
  if position('private.current_student_id()' in lower(v_helper_definition)) = 0
     or position('v_student_id is null' in lower(v_helper_definition)) = 0
     or position('errcode = ''42501''' in lower(v_helper_definition)) = 0
     or position('incident.student_id = v_student_id' in lower(v_helper_definition)) = 0
     or position('incident.rule_snapshot ->> ''rule_code''' in lower(v_helper_definition)) = 0
     or position('incident.rule_snapshot ->> ''title_th''' in lower(v_helper_definition)) = 0
     or position('internal_note' in lower(v_helper_definition)) > 0
     or position('evidence_note' in lower(v_helper_definition)) > 0
     or position('student_statement' in lower(v_helper_definition)) > 0
     or position('actor_' in lower(v_helper_definition)) > 0
     or position('guardian' in lower(v_helper_definition)) > 0 then
    raise exception 'student incident-history RPC authorization or redaction contract is unsafe';
  end if;

  select pg_get_functiondef(
    'public.record_deduction(bigint,bigint,timestamp with time zone,text,text)'::regprocedure
  ) into v_record_definition;
  if position('v_role is null' in lower(v_record_definition)) = 0 then
    raise exception 'record_deduction does not reject a gated NULL role';
  end if;
  if position('v_rule.severity in (''serious'', ''critical'')' in lower(v_record_definition)) = 0
     or position('v_rule.guardian_contact_required' in lower(v_record_definition)) = 0
     or position('insert into public.guardian_contact_tasks' in lower(v_record_definition)) = 0 then
    raise exception 'record_deduction does not create guardian contact for serious/critical rules';
  end if;

  select pg_get_functiondef(
    'public.record_deductions_bulk(uuid,text,bigint[],bigint,bigint,timestamp with time zone,text,text,boolean)'::regprocedure
  ) into v_bulk_definition;
  if position('pg_advisory_xact_lock' in lower(v_bulk_definition)) = 0
     or position('sha256(convert_to(v_payload::text' in lower(v_bulk_definition)) = 0
     or position('order by distinct_target.student_id' in lower(v_bulk_definition)) = 0
     or position('v_roster is distinct from v_target_ids' in lower(v_bulk_definition)) = 0
     or position('v_authorized_count <> v_target_count' in lower(v_bulk_definition)) = 0
     or position('p_confirm_serious_bulk' in lower(v_bulk_definition)) = 0
     or position('unnest(v_existing.target_student_ids)' in lower(v_bulk_definition)) = 0
     or regexp_count(
          lower(v_bulk_definition),
          'private\.teacher_has_student\([[:space:]]*target\.student_id,[[:space:]]*v_existing\.term_id'
        ) = 0
     or position('join public.students student' in lower(v_bulk_definition)) = 0
     or position('student.status = ''active''' in lower(v_bulk_definition)) = 0
     or position('public.record_deduction' in lower(v_bulk_definition)) = 0
     or position('foreach v_student_id in array v_target_ids' in lower(v_bulk_definition)) = 0 then
    raise exception 'bulk deduction RPC is missing SHA-256 idempotency, atomicity, authorization, active-student, roster, lock-order, or high-risk protections';
  end if;

  select pg_get_functiondef(
    'public.request_point_addition_detailed(uuid,bigint,bigint,smallint,timestamp with time zone,text,text)'::regprocedure
  ) into v_addition_definition;
  if position('pg_advisory_xact_lock' in lower(v_addition_definition)) = 0
     or position('sha256(convert_to(v_payload::text' in lower(v_addition_definition)) = 0
     or position('public.positive_behavior_rules' in lower(v_addition_definition)) = 0
     or position('v_rule.is_discretionary' in lower(v_addition_definition)) = 0
     or position('v_rule.max_addition' in lower(v_addition_definition)) = 0
     or position('v_rule.default_addition' in lower(v_addition_definition)) = 0
     or position('activity_occurred_at' in lower(v_addition_definition)) = 0
     or position('evidence_note' in lower(v_addition_definition)) = 0
     or position('join public.students student' in lower(v_addition_definition)) = 0
     or position('student.status = ''active''' in lower(v_addition_definition)) = 0
     or regexp_count(
          lower(v_addition_definition),
          'private\.teacher_has_student\([[:space:]]*v_existing_student_id,[[:space:]]*v_existing_term_id'
        ) = 0
     or position('private.teacher_has_student' in lower(v_addition_definition)) = 0 then
    raise exception 'detailed addition RPC is missing SHA-256 idempotency, replay authorization, rule, evidence, date, active-student, or teacher-scope validation';
  end if;

  select pg_get_functiondef(
    'public.review_point_addition(bigint,boolean,text)'::regprocedure
  ) into v_review_definition;
  if position('p_approve is null' in lower(v_review_definition)) = 0
     or position('v_review_note is null or char_length(v_review_note) < 5' in lower(v_review_definition)) = 0
     or position('for update' in lower(v_review_definition)) = 0
     or position('v_request.positive_rule_id is null' in lower(v_review_definition)) = 0
     or position('v_request.activity_occurred_at is null' in lower(v_review_definition)) = 0
     or position('v_request.evidence_note' in lower(v_review_definition)) = 0
     or position('term.status = ''active''' in lower(v_review_definition)) = 0
     or position('enrollment.is_active' in lower(v_review_definition)) = 0
     or position('student.status = ''active''' in lower(v_review_definition)) = 0
     or regexp_count(
          lower(v_review_definition),
          'internal_reason,[[:space:]]+evidence_note,[[:space:]]+reason'
        ) = 0
     or regexp_count(
          lower(v_review_definition),
          'v_request\.reason,[[:space:]]+v_request\.evidence_note,[[:space:]]+v_request\.rule_snapshot[[:space:]]*->>[[:space:]]*''title_th'''
        ) = 0 then
    raise exception 'addition review RPC is missing explicit decision, note, detail, lock, active-state, or snapshot-title privacy validation';
  end if;

  select pg_get_functiondef(
    'public.admin_add_points_detailed(uuid,bigint,bigint,smallint,timestamp with time zone,text,text,bigint)'::regprocedure
  ) into v_admin_addition_definition;
  if position('private.is_admin' in lower(v_admin_addition_definition)) = 0
     or position('pg_advisory_xact_lock' in lower(v_admin_addition_definition)) = 0
     or position('sha256(convert_to(v_payload::text' in lower(v_admin_addition_definition)) = 0
     or position('ledger.client_request_id = p_client_request_id' in lower(v_admin_addition_definition)) = 0
     or position('term.status = ''active''' in lower(v_admin_addition_definition)) = 0
     or position('enrollment.is_active' in lower(v_admin_addition_definition)) = 0
     or position('student.status = ''active''' in lower(v_admin_addition_definition)) = 0
     or position('v_rule.is_discretionary' in lower(v_admin_addition_definition)) = 0
     or position('v_rule.max_addition' in lower(v_admin_addition_definition)) = 0
     or position('v_rule.default_addition' in lower(v_admin_addition_definition)) = 0
     or position('activity_occurred_at' in lower(v_admin_addition_definition)) = 0
     or position('internal_reason' in lower(v_admin_addition_definition)) = 0
     or position('evidence_note' in lower(v_admin_addition_definition)) = 0
     or position('positive_rule_snapshot' in lower(v_admin_addition_definition)) = 0
     or position('v_rule.title_th' in lower(v_admin_addition_definition)) = 0
     or regexp_count(
          lower(v_admin_addition_definition),
          'internal_reason,[[:space:]]+evidence_note,[[:space:]]+client_request_id,[[:space:]]+request_payload_hash,[[:space:]]+reason'
        ) = 0
     or regexp_count(
          lower(v_admin_addition_definition),
          'v_reason,[[:space:]]+v_evidence,[[:space:]]+p_client_request_id,[[:space:]]+v_payload_hash,[[:space:]]+v_rule\.title_th'
        ) = 0
     or position('for update' in lower(v_admin_addition_definition)) = 0 then
    raise exception 'detailed admin addition RPC is missing authorization, SHA-256 idempotency, structured details, active-state, rule, privacy, or score-lock validation';
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

  select pg_get_functiondef(
    'public.admin_update_term_schedule(bigint,date,date)'::regprocedure
  ) into v_term_schedule_definition;
  if position('private.is_admin' in lower(v_term_schedule_definition)) = 0
     or position('for update' in lower(v_term_schedule_definition)) = 0
     or position('not in (''planned'', ''active'')' in lower(v_term_schedule_definition)) = 0
     or position('p_starts_on is null' in lower(v_term_schedule_definition)) = 0
     or position('p_ends_on is null' in lower(v_term_schedule_definition)) = 0
     or position('p_starts_on > p_ends_on' in lower(v_term_schedule_definition)) = 0
     or position('is not distinct from' in lower(v_term_schedule_definition)) = 0
     or position('private.write_audit' in lower(v_term_schedule_definition)) = 0 then
    raise exception 'admin term-schedule RPC is missing authorization, validation, locking, idempotency, or audit';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'admin_update_term_schedule'
      and procedure.pronargs = 3
      and procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting(value)
        where replace(setting.value, '"', '') = 'search_path='
      )
  ) then
    raise exception 'admin term-schedule RPC must be SECURITY DEFINER with empty search_path';
  end if;

  select pg_get_functiondef(
    'public.admin_activate_term(bigint)'::regprocedure
  ) into v_term_activation_definition;
  if position('private.is_admin' in lower(v_term_activation_definition)) = 0
     or position('pg_advisory_xact_lock' in lower(v_term_activation_definition)) = 0
     or position('for update' in lower(v_term_activation_definition)) = 0
     or position('v_term.status = ''active''' in lower(v_term_activation_definition)) = 0
     or position('v_term.status <> ''planned''' in lower(v_term_activation_definition)) = 0
     or position('v_term.starts_on is null' in lower(v_term_activation_definition)) = 0
     or position('v_term.ends_on is null' in lower(v_term_activation_definition)) = 0
     or position('another academic term is already active' in lower(v_term_activation_definition)) = 0
     or position('private.write_audit' in lower(v_term_activation_definition)) = 0 then
    raise exception 'admin term-activation RPC is missing authorization, serialization, validation, idempotency, or audit';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'admin_activate_term'
      and procedure.pronargs = 1
      and procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting(value)
        where replace(setting.value, '"', '') = 'search_path='
      )
  ) then
    raise exception 'admin term-activation RPC must be SECURITY DEFINER with empty search_path';
  end if;

  select pg_get_functiondef(
    'private.enforce_guardian_contact_task_severity()'::regprocedure
  ) into v_guardian_guard_definition;
  if position('v_incident_severity not in (''serious'', ''critical'')' in lower(v_guardian_guard_definition)) = 0
     or position('new.student_id is distinct from v_incident_student_id' in lower(v_guardian_guard_definition)) = 0 then
    raise exception 'guardian-contact task guard does not enforce severity and student identity';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'enforce_guardian_contact_task_severity'
      and procedure.pronargs = 0
      and procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting(value)
        where replace(setting.value, '"', '') = 'search_path='
      )
  ) then
    raise exception 'guardian-contact task guard must be SECURITY DEFINER with empty search_path';
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
