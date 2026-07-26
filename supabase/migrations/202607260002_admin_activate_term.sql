begin;

create or replace function public.admin_activate_term(p_term_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term public.academic_terms%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_updated_at timestamptz;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_term_id is null then
    raise exception 'Term is required'
      using errcode = '22023';
  end if;

  -- Serialize the cross-row "one active term" decision without locking rows
  -- that are unrelated to this short state transition.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('school-point:academic-term-activation')
  );

  select term.*
  into v_term
  from public.academic_terms term
  where term.id = p_term_id
  for update;

  if not found then
    raise exception 'Academic term not found'
      using errcode = 'P0002';
  end if;

  if v_term.status = 'active' then
    return jsonb_build_object(
      'ok', true,
      'updated', false,
      'term_id', v_term.id,
      'status', v_term.status
    );
  end if;

  if v_term.status <> 'planned' then
    raise exception 'Only a planned academic term can be activated'
      using errcode = '55000';
  end if;

  if v_term.starts_on is null or v_term.ends_on is null then
    raise exception 'Term start and end dates are required before activation'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.academic_terms term
    where term.status = 'active'
      and term.id <> v_term.id
  ) then
    raise exception 'Another academic term is already active'
      using errcode = '55000';
  end if;

  v_before := jsonb_build_object(
    'starts_on', v_term.starts_on,
    'ends_on', v_term.ends_on,
    'status', v_term.status
  );

  update public.academic_terms
  set status = 'active'
  where id = v_term.id
    and status = 'planned'
  returning updated_at into v_updated_at;

  if not found then
    raise exception 'Academic term state changed; retry'
      using errcode = '40001';
  end if;

  v_after := jsonb_build_object(
    'starts_on', v_term.starts_on,
    'ends_on', v_term.ends_on,
    'status', 'active'
  );

  perform private.write_audit(
    'admin_activate_term',
    'academic_term',
    v_term.id::text,
    v_before,
    v_after
  );

  return jsonb_build_object(
    'ok', true,
    'updated', true,
    'term_id', v_term.id,
    'status', 'active',
    'updated_at', v_updated_at
  );
end;
$$;

comment on function public.admin_activate_term(bigint) is
  'Activate one planned academic term after dates are set; requires an active, activated password-AMR admin and records an audit event.';

revoke all on function public.admin_activate_term(bigint)
from public, anon, authenticated, service_role;
grant execute on function public.admin_activate_term(bigint)
to authenticated;

commit;
