begin;

select plan(1);

do $$
declare
  v_function regprocedure;
  v_definition text;
  v_index_definition text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'guardian_contact_attempts'
      and column_name = 'client_request_id'
      and data_type = 'uuid'
  ) then
    raise exception 'guardian-contact attempts need a UUID client_request_id';
  end if;

  select indexdef into v_index_definition
  from pg_indexes
  where schemaname = 'private'
    and tablename = 'guardian_contact_attempts'
    and indexname = 'guardian_attempts_task_client_request_uidx';
  if v_index_definition is null
     or position('UNIQUE' in upper(v_index_definition)) = 0
     or position('(task_id, client_request_id)' in lower(v_index_definition)) = 0 then
    raise exception 'guardian-contact retry identity is not uniquely scoped to task';
  end if;

  v_function := to_regprocedure('public.record_guardian_contact_attempt_v3(uuid,bigint,text,text,text,text)');
  if v_function is null then
    raise exception 'guardian-contact v3 RPC is missing';
  end if;
  select pg_get_functiondef(v_function) into v_definition;
  if position('security definer' in lower(v_definition)) = 0
     or position('set search_path' in lower(v_definition)) = 0
     or position('private.is_admin' in lower(v_definition)) = 0
     or not has_function_privilege('authenticated', v_function, 'EXECUTE')
     or has_function_privilege('anon', v_function, 'EXECUTE') then
    raise exception 'guardian-contact v3 RPC lost its hardened authenticated-only contract';
  end if;
  if position('for update' in lower(v_definition)) = 0
     or position('client_request_id = p_client_request_id' in lower(v_definition)) = 0
     or position('if found then' in lower(v_definition)) = 0
     or position('''replayed'', true' in lower(v_definition)) = 0
     or position('''replayed'', false' in lower(v_definition)) = 0 then
    raise exception 'guardian-contact v3 RPC is missing deterministic replay handling';
  end if;
  if position('already used for different guardian-contact data' in lower(v_definition)) = 0 then
    raise exception 'guardian-contact v3 must reject request-ID reuse with different payload data';
  end if;
  if position('client_request_id = p_client_request_id' in lower(v_definition))
       > position('insert into private.guardian_contact_attempts' in lower(v_definition))
     or position('client_request_id = p_client_request_id' in lower(v_definition))
       > position('perform private.write_audit' in lower(v_definition))
     or position('attempted_at + interval ''24 hours''' in lower(v_definition)) = 0
     or position('when v_attempt.closes_notification then ''completed'' else ''pending'' end' in lower(v_definition)) = 0 then
    raise exception 'guardian-contact v3 replay can still add history/audit or move its original reminder';
  end if;
end;
$$;

do $$
declare
  v_signature text;
  v_function regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.review_point_addition(bigint,boolean,text)',
    'public.review_appeal(bigint,boolean,text)'
  ] loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'legacy workflow wrapper % is missing', v_signature;
    end if;
    if (select procedure.prorettype::regtype::text from pg_proc procedure where procedure.oid = v_function) <> 'bigint'
       or not (select procedure.prosecdef from pg_proc procedure where procedure.oid = v_function)
       or not exists (
         select 1 from pg_proc procedure
         where procedure.oid = v_function
           and 'search_path=""' = any(coalesce(procedure.proconfig, array[]::text[]))
       )
       or not has_function_privilege('authenticated', v_function, 'EXECUTE')
       or has_function_privilege('anon', v_function, 'EXECUTE') then
      raise exception 'legacy workflow wrapper % lost its bigint or authenticated-only contract', v_signature;
    end if;

    select pg_get_functiondef(v_function) into v_definition;
    if position('private.is_admin' in lower(v_definition)) = 0
       or position('_v2(' in lower(v_definition)) = 0
       or position('return nullif(v_result ->> ''ledgerid''' in lower(v_definition)) = 0 then
      raise exception 'legacy workflow wrapper % does not preserve v2 delegation and meaningful bigint returns', v_signature;
    end if;
  end loop;
end;
$$;

select pass('workflow reliability assertions completed');
select * from finish();

rollback;
