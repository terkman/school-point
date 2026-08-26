begin;

select plan(1);

do $$
declare
  v_policy record;
begin
  for v_policy in
    select table_entry.table_name
    from (values
      ('staff_permission_grants'),
      ('staff_permission_grant_classrooms')
    ) as table_entry(table_name)
  loop
    if not exists (
      select 1
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = v_policy.table_name
        and policy.policyname = 'password_session_required'
        and policy.permissive = 'RESTRICTIVE'
        and policy.cmd = 'SELECT'
        and policy.roles = array['authenticated']::name[]
        and policy.qual like '%has_password_session%'
    ) then
      raise exception 'missing restrictive password-session SELECT policy on %', v_policy.table_name;
    end if;
  end loop;
end
$$;

do $$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'public.service_admin_import_school_data(uuid,jsonb,boolean)'::regprocedure,
    'public.service_admin_link_provisioned_account(uuid,text,uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;
    if not exists (
      select 1 from pg_proc
      where oid = v_function
        and prosecdef
        and 'search_path=""' = any(coalesce(proconfig, array[]::text[]))
    ) then
      raise exception 'actor-aware RPC % must be SECURITY DEFINER with an empty search_path', v_function;
    end if;
    if has_function_privilege('public', v_function, 'execute')
       or has_function_privilege('anon', v_function, 'execute')
       or has_function_privilege('authenticated', v_function, 'execute')
       or not has_function_privilege('service_role', v_function, 'execute') then
      raise exception 'actor-aware RPC % has unsafe execute privileges', v_function;
    end if;
    if position('service_actor_is_admin' in v_definition) = 0
       or position('request.jwt.claim.sub' in v_definition) = 0 then
      raise exception 'actor-aware RPC % does not validate and propagate the human actor', v_function;
    end if;
  end loop;

  if to_regprocedure('public.admin_import_school_data(jsonb,boolean)') is null
     or to_regprocedure('public.admin_link_provisioned_account(text,uuid)') is null
     or not has_function_privilege(
       'service_role',
       'public.admin_import_school_data(jsonb,boolean)'::regprocedure,
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.admin_link_provisioned_account(text,uuid)'::regprocedure,
       'execute'
     ) then
    raise exception 'legacy service-role RPC signatures must remain available';
  end if;
end
$$;

do $$
declare
  v_definition text := pg_get_functiondef(
    'public.school_directory_snapshot()'::regprocedure
  );
begin
  if position('coalesce(v_role, '''') not in' in lower(v_definition)) = 0 then
    raise exception 'directory snapshot guard is not NULL-safe';
  end if;
  if has_function_privilege(
    'authenticated',
    'private.school_directory_snapshot()'::regprocedure,
    'execute'
  ) then
    raise exception 'authenticated users can bypass the public NULL-safe snapshot wrapper';
  end if;
end
$$;

-- A password-authenticated UUID with no profile makes current_role() NULL. The
-- public snapshot wrapper must reject that state with its authorization error.
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","amr":[{"method":"password"}]}',
    true
  );

  begin
    perform public.school_directory_snapshot();
    raise exception 'NULL current_role unexpectedly passed the snapshot guard';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

select pass('admin session and actor assertions completed');
select * from finish();

rollback;
