begin;

select plan(1);

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.record_guardian_contact_attempt_v2(bigint,text,text,text,text)'::regprocedure
  ) into v_definition;

  if position('security definer' in lower(v_definition)) = 0
     or position('set search_path' in lower(v_definition)) = 0 then
    raise exception 'guardian contact RPC lost its hardened execution context';
  end if;

  if position('update public.follow_up_cases' in lower(v_definition)) = 0
     or position('when v_closes then ''resolved''::public.case_status' in lower(v_definition)) = 0
     or position('resolved_at = case when v_closes' in lower(v_definition)) = 0
     or position('closed_by_guardian_confirmation' in lower(v_definition)) = 0 then
    raise exception 'confirmed guardian contact does not atomically resolve and audit the serious case';
  end if;

  if exists (
    select 1
    from public.guardian_contact_tasks task
    join public.follow_up_cases case_row on case_row.incident_id = task.incident_id
    where task.status = 'completed'
      and case_row.status <> 'resolved'
  ) then
    raise exception 'completed guardian notification still has an unresolved serious case';
  end if;
end;
$$;

select pass('guardian confirmation assertions completed');
select * from finish();

rollback;
