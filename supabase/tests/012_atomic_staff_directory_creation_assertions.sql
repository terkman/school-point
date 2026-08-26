begin;

select plan(1);

do $$
declare
  v_function regprocedure := to_regprocedure(
    'public.service_create_school_person_v2(uuid,uuid,text,text,text,text,text,text,text,bigint,date,bigint[])'
  );
  v_definition text;
begin
  if v_function is null then
    raise exception 'atomic staff creation v2 RPC is missing';
  end if;
  if not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = v_function
      and procedure.prosecdef
      and 'search_path=""' = any(coalesce(procedure.proconfig, array[]::text[]))
  ) then
    raise exception 'atomic staff creation v2 RPC must be SECURITY DEFINER with an empty search_path';
  end if;
  if has_function_privilege('public', v_function, 'EXECUTE')
     or has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('authenticated', v_function, 'EXECUTE')
     or not has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception 'atomic staff creation v2 RPC has unsafe execute privileges';
  end if;

  select pg_get_functiondef(v_function) into v_definition;
  if position('service_create_school_person(' in lower(v_definition)) = 0
     or position('insert into public.teacher_classroom_assignments' in lower(v_definition)) = 0
     or position('on conflict (term_id, classroom_id, teacher_id, subject_name)' in lower(v_definition)) = 0 then
    raise exception 'atomic staff creation v2 RPC does not compose legacy creation and classroom assignment';
  end if;
  if position('private.service_actor_is_admin' in lower(v_definition)) = 0 then
    raise exception 'atomic staff creation v2 RPC must validate the acting administrator';
  end if;
  if position('array_agg(distinct selected.classroom_id' in lower(v_definition)) = 0
     or position('classroom_id is null or selected.classroom_id <= 0' in lower(v_definition)) = 0 then
    raise exception 'atomic staff creation v2 RPC does not validate and deduplicate classroom IDs';
  end if;
  if position('only teacher staff may receive classroom assignments' in lower(v_definition)) = 0
     or position('every classroom must be active in the current term' in lower(v_definition)) = 0 then
    raise exception 'atomic staff creation v2 RPC does not restrict assignments to active current-term teacher classrooms';
  end if;

  if to_regprocedure(
    'public.service_create_school_person(uuid,uuid,text,text,text,text,text,text,text,bigint,date)'
  ) is null then
    raise exception 'legacy school-person creation RPC must remain available';
  end if;
end;
$$;

select pass('atomic staff directory assertions completed');
select * from finish();

rollback;
