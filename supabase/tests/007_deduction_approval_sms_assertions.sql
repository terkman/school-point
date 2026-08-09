do $$
declare
  v_definition text;
  v_constraint_definition text;
  v_default text;
begin
  if to_regclass('public.deduction_approval_requests') is null then
    raise exception 'deduction_approval_requests is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'score_ledger'
      and column_name = 'deduction_request_id'
  ) then
    raise exception 'score_ledger.deduction_request_id is missing';
  end if;

  if to_regprocedure(
    'public.request_deductions_bulk_v1(uuid,text,bigint[],bigint,bigint,timestamp with time zone,text,text,boolean)'
  ) is null then
    raise exception 'request_deductions_bulk_v1 is missing';
  end if;
  if to_regprocedure(
    'public.review_deduction_request_v1(bigint,boolean,smallint,text)'
  ) is null then
    raise exception 'review_deduction_request_v1 is missing';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.request_deductions_bulk_v1(uuid,text,bigint[],bigint,bigint,timestamp with time zone,text,text,boolean)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.review_deduction_request_v1(bigint,boolean,smallint,text)',
    'EXECUTE'
  ) then
    raise exception 'deduction approval RPC grants are missing';
  end if;

  if has_table_privilege('authenticated', 'public.deduction_approval_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.deduction_approval_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.deduction_approval_requests', 'DELETE') then
    raise exception 'deduction requests allow direct authenticated writes';
  end if;

  if not exists (
    select 1 from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'deduction_approval_requests'
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then
    raise exception 'deduction requests do not force RLS';
  end if;

  select pg_get_functiondef(
    'public.request_deductions_bulk_v1(uuid,text,bigint[],bigint,bigint,timestamp with time zone,text,text,boolean)'::regprocedure
  ) into v_definition;
  if position('default_deduction < 10' in lower(v_definition)) = 0
     or position('teacher_has_student' in lower(v_definition)) = 0
     or position('pg_advisory_xact_lock' in lower(v_definition)) = 0 then
    raise exception 'deduction request RPC lacks threshold, authorization, or idempotency protection';
  end if;

  select pg_get_functiondef(
    'public.review_deduction_request_v1(bigint,boolean,smallint,text)'::regprocedure
  ) into v_definition;
  if position('private.is_admin' in lower(v_definition)) = 0
     or position('for update' in lower(v_definition)) = 0
     or position('deduction_request_id' in lower(v_definition)) = 0
     or position('insert into public.guardian_contact_tasks' in lower(v_definition)) = 0 then
    raise exception 'deduction review RPC lacks admin, locking, provenance, or guardian workflow protection';
  end if;

  select pg_get_functiondef(
    'public.record_deduction(bigint,bigint,timestamp with time zone,text,text)'::regprocedure
  ) into v_definition;
  if position('v_role = ''teacher'' and v_rule.default_deduction >= 10' in lower(v_definition)) = 0
     or has_function_privilege(
       'authenticated',
       'public.record_deduction(bigint,bigint,timestamp with time zone,text,text)',
       'EXECUTE'
     ) then
    raise exception 'legacy direct deduction can bypass the 10-point approval threshold';
  end if;

  select string_agg(pg_get_constraintdef(constraint_row.oid), ' ')
  into v_constraint_definition
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'private.guardian_contact_attempts'::regclass
    and constraint_row.contype = 'c';
  if position('sms' in lower(v_constraint_definition)) = 0
     or position('sent_waiting' in lower(v_constraint_definition)) = 0
     or position('read_or_replied' in lower(v_constraint_definition)) = 0 then
    raise exception 'SMS waiting/read outcome constraints are missing';
  end if;

  select pg_get_functiondef(
    'public.record_guardian_contact_attempt_v2(bigint,text,text,text,text)'::regprocedure
  ) into v_definition;
  if position('line'', ''messenger'', ''sms' in lower(v_definition)) = 0
     or position('v_outcome = ''read_or_replied''' in lower(v_definition)) = 0
     or position('v_channel = ''sms'' and v_outcome = ''sent''' in lower(v_definition)) > 0 then
    raise exception 'SMS still closes before read/reply confirmation';
  end if;

  select column_default into v_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'guardian_contact_tasks'
    and column_name = 'next_reminder_at';
  if v_default is null or position('24:00:00' in v_default) = 0 then
    raise exception 'guardian task first reminder default is missing';
  end if;
end;
$$;
