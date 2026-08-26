select plan(1);

do $$
declare
  v_function regprocedure :=
    to_regprocedure('public.service_create_school_classroom(uuid,bigint,text,text)');
begin
  if v_function is null then
    raise exception 'service_create_school_classroom is missing';
  end if;
  if not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid = v_function
  ) then
    raise exception 'service_create_school_classroom must be security definer';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.service_create_school_classroom(uuid,bigint,text,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot create classrooms';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.service_create_school_classroom(uuid,bigint,text,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can call the service classroom function directly';
  end if;
end;
$$;

select pass('classroom management assertions completed');
select * from finish();
