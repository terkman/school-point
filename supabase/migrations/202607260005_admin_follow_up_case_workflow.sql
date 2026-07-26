begin;

alter table public.follow_up_cases
  add column if not exists follow_up_note text,
  add column if not exists managed_by uuid references auth.users(id) on delete set null,
  add column if not exists managed_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;

create or replace function public.admin_update_follow_up_case(
  p_case_id bigint,
  p_status public.case_status,
  p_note text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_case public.follow_up_cases%rowtype;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_guardian_status text;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_case_id is null
     or p_status is null
     or p_status not in ('following_up', 'resolved')
     or v_note is null
     or pg_catalog.char_length(v_note) < 5 then
    raise exception 'Case, valid status, and a note of at least 5 characters are required'
      using errcode = '22023';
  end if;

  select case_row.*
  into v_case
  from public.follow_up_cases case_row
  where case_row.id = p_case_id
  for update;

  if not found then
    raise exception 'Follow-up case not found'
      using errcode = 'P0002';
  end if;

  if v_case.status = 'resolved' then
    if p_status = 'resolved' then
      return v_case.id;
    end if;
    raise exception 'Resolved case cannot be reopened through this workflow'
      using errcode = '55000';
  end if;

  if p_status = 'resolved' then
    if v_case.status <> 'following_up' then
      raise exception 'Case must be in follow-up before it can be resolved'
        using errcode = '55000';
    end if;

    select task.status
    into v_guardian_status
    from public.guardian_contact_tasks task
    where task.incident_id = v_case.incident_id
    for update;

    if found and v_guardian_status <> 'completed' then
      raise exception 'Guardian contact must be completed before resolving this case'
        using errcode = '55000';
    end if;
  end if;

  update public.follow_up_cases
  set status = p_status,
      follow_up_note = v_note,
      managed_by = v_uid,
      managed_at = now(),
      resolved_at = case when p_status = 'resolved' then now() else null end,
      resolved_by = case when p_status = 'resolved' then v_uid else null end
  where id = v_case.id;

  perform private.write_audit(
    'admin_update_follow_up_case',
    'follow_up_case',
    v_case.id::text,
    jsonb_build_object(
      'status', v_case.status,
      'follow_up_note', v_case.follow_up_note,
      'managed_at', v_case.managed_at
    ),
    jsonb_build_object(
      'status', p_status,
      'follow_up_note', v_note,
      'managed_at', now()
    )
  );

  return v_case.id;
end;
$$;

comment on function public.admin_update_follow_up_case(bigint, public.case_status, text) is
  'Start, update, or resolve a serious follow-up case; requires an active password-AMR administrator, requires guardian contact before resolution, and records an audit event.';

revoke all on function public.admin_update_follow_up_case(bigint, public.case_status, text)
from public, anon, authenticated, service_role;
grant execute on function public.admin_update_follow_up_case(bigint, public.case_status, text)
to authenticated;

commit;
