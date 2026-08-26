select plan(1);

do $$
declare
  v_column text;
begin
  foreach v_column in array array[
    'approved_points'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'point_addition_requests'
        and column_name = v_column
    ) then
      raise exception 'point_addition_requests.% is missing', v_column;
    end if;
  end loop;

  foreach v_column in array array[
    'restored_points',
    'public_explanation',
    'review_version',
    'reopened_by',
    'reopened_at',
    'reopen_reason'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'appeals'
        and column_name = v_column
    ) then
      raise exception 'appeals.% is missing', v_column;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guardian_contact_tasks'
      and column_name = 'next_reminder_at'
  ) then
    raise exception 'guardian_contact_tasks.next_reminder_at is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'score_ledger'
      and column_name = 'appeal_decision_id'
  ) then
    raise exception 'score_ledger.appeal_decision_id is missing';
  end if;
end;
$$;

select pass('admin workflow v2 assertions completed');
select * from finish();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'appeal_decisions',
    'guardian_contact_attempts'
  ] loop
    if to_regclass(format('private.%I', v_table)) is null then
      raise exception 'private.% is missing', v_table;
    end if;
    if has_table_privilege('authenticated', format('private.%I', v_table), 'SELECT')
      or has_table_privilege('authenticated', format('private.%I', v_table), 'INSERT')
      or has_table_privilege('authenticated', format('private.%I', v_table), 'UPDATE')
      or has_table_privilege('authenticated', format('private.%I', v_table), 'DELETE')
    then
      raise exception 'authenticated has direct access to private.%', v_table;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.appeal_decisions'::regclass
      and tgname = 'appeal_decisions_immutable'
      and not tgisinternal
  ) then
    raise exception 'appeal decisions are not append-only';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.guardian_contact_attempts'::regclass
      and tgname = 'guardian_contact_attempts_immutable'
      and not tgisinternal
  ) then
    raise exception 'guardian contact attempts are not append-only';
  end if;
end;
$$;

do $$
declare
  v_index text;
begin
  foreach v_index in array array[
    'point_requests_pending_queue_idx',
    'appeals_open_queue_idx',
    'guardian_tasks_due_reminder_idx',
    'guardian_attempts_task_date_idx',
    'score_ledger_appeal_decision_idx'
  ] loop
    if not exists (
      select 1
      from pg_indexes
      where indexname = v_index
    ) then
      raise exception 'required workflow index % is missing', v_index;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_enum enum_value
    join pg_type enum_type on enum_type.oid = enum_value.enumtypid
    join pg_namespace namespace on namespace.oid = enum_type.typnamespace
    where namespace.nspname = 'public'
      and enum_type.typname = 'score_entry_type'
      and enum_value.enumlabel = 'appeal_adjustment'
  ) then
    raise exception 'score_entry_type.appeal_adjustment is missing';
  end if;
end;
$$;

do $$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.request_point_addition_v2(uuid,bigint,bigint,smallint,timestamp with time zone,text,text)',
    'public.request_point_additions_bulk_v2(uuid,text,bigint[],bigint,bigint,smallint,timestamp with time zone,text,text)',
    'public.review_point_addition_v2(bigint,boolean,smallint,text)',
    'public.review_appeal_v2(bigint,smallint,text)',
    'public.reopen_appeal_v2(bigint,text)',
    'public.record_guardian_contact_attempt_v2(bigint,text,text,text,text)',
    'public.get_guardian_contact_attempts_v2(bigint[])',
    'public.get_my_incident_history_v2()'
  ] loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'workflow function % is missing', v_signature;
    end if;
    if not (
      select procedure.prosecdef
      from pg_proc procedure
      where procedure.oid = v_function
    ) then
      raise exception 'workflow function % must be security definer', v_signature;
    end if;
    if not exists (
      select 1
      from pg_proc procedure
      where procedure.oid = v_function
        and 'search_path=""' = any(coalesce(procedure.proconfig, array[]::text[]))
    ) then
      raise exception 'workflow function % must pin an empty search_path', v_signature;
    end if;
    if not has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'authenticated cannot execute workflow function %', v_signature;
    end if;
    if has_function_privilege('anon', v_function, 'EXECUTE') then
      raise exception 'anon can execute workflow function %', v_signature;
    end if;
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'appeals'
      and policyname = 'appeals_admin_select_v2'
  ) then
    raise exception 'admin-only appeal select policy is missing';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'appeals'
      and policyname in ('appeals_select', 'appeals_staff_select')
  ) then
    raise exception 'legacy teacher/student appeal table policy still exists';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'score_ledger'
      and policyname = 'ledger_staff_select_v2'
      and qual like '%appeal_adjustment%'
  ) then
    raise exception 'teacher-safe score ledger policy is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.point_addition_requests'::regclass
      and conname = 'point_requests_decision_note_policy'
  ) then
    raise exception 'conditional addition decision note constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.guardian_contact_tasks'::regclass
      and conname = 'guardian_tasks_reminder_policy'
  ) then
    raise exception 'guardian reminder constraint is missing';
  end if;
end;
$$;
