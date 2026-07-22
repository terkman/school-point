begin;

-- Guardian contact is a severity policy, not a discretionary per-rule switch.
-- Normalize any pre-existing custom rules before pinning the invariant so every
-- serious/critical deduction creates a contact task and no lower severity can.
update public.behavior_rules
set guardian_contact_required = (severity in ('serious', 'critical'))
where guardian_contact_required is distinct from
      (severity in ('serious', 'critical'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'behavior_rules_guardian_contact_severity'
      and constraint_row.conrelid = 'public.behavior_rules'::regclass
  ) then
    alter table public.behavior_rules
      add constraint behavior_rules_guardian_contact_severity
      check (
        guardian_contact_required = (severity in ('serious', 'critical'))
      );
  end if;
end;
$$;

comment on constraint behavior_rules_guardian_contact_severity
on public.behavior_rules is
  'Guardian contact is required exactly for serious and critical behavior rules.';

-- Defense in depth for privileged/server-side writes: a workflow task must
-- always reference the same student as a serious/critical incident.
create or replace function private.enforce_guardian_contact_task_severity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident_student_id bigint;
  v_incident_severity public.rule_severity;
begin
  select incident.student_id, incident.severity
  into v_incident_student_id, v_incident_severity
  from public.incidents incident
  where incident.id = new.incident_id;

  if not found then
    raise exception 'Incident not found'
      using errcode = '23503';
  end if;

  if v_incident_severity not in ('serious', 'critical') then
    raise exception 'Guardian contact is limited to serious or critical incidents'
      using errcode = '23514';
  end if;

  if new.student_id is distinct from v_incident_student_id then
    raise exception 'Guardian contact student must match the incident student'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_guardian_contact_task_severity()
from public, anon, authenticated, service_role;

drop trigger if exists guardian_contact_task_severity_guard
on public.guardian_contact_tasks;

create trigger guardian_contact_task_severity_guard
before insert or update of incident_id, student_id
on public.guardian_contact_tasks
for each row execute function private.enforce_guardian_contact_task_severity();

do $$
begin
  if exists (
    select 1
    from public.guardian_contact_tasks task
    join public.incidents incident on incident.id = task.incident_id
    where incident.severity not in ('serious', 'critical')
       or task.student_id is distinct from incident.student_id
  ) then
    raise exception 'Existing guardian contact task violates the severity policy';
  end if;
end;
$$;

-- Admin-only schedule editor used by the web UI. Row locking serializes edits
-- to the same term, while an identical retry is a no-op and creates no duplicate
-- audit entry. Closed terms remain immutable through this workflow so historical
-- reports keep their original calendar boundaries.
create or replace function public.admin_update_term_schedule(
  p_term_id bigint,
  p_starts_on date,
  p_ends_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term public.academic_terms%rowtype;
  v_updated_at timestamptz;
  v_before jsonb;
  v_after jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_term_id is null then
    raise exception 'Term is required'
      using errcode = '22023';
  end if;

  if p_starts_on is null or p_ends_on is null then
    raise exception 'Term start and end dates are required'
      using errcode = '22023';
  end if;

  if p_starts_on > p_ends_on then
    raise exception 'Term start date must not be after its end date'
      using errcode = '22023';
  end if;

  select term.*
  into v_term
  from public.academic_terms term
  where term.id = p_term_id
  for update;

  if not found then
    raise exception 'Term not found'
      using errcode = 'P0002';
  end if;

  if v_term.status not in ('planned', 'active') then
    raise exception 'Closed term schedule cannot be changed'
      using errcode = '55000';
  end if;

  if v_term.starts_on is not distinct from p_starts_on
     and v_term.ends_on is not distinct from p_ends_on then
    return jsonb_build_object(
      'ok', true,
      'updated', false,
      'term_id', v_term.id,
      'starts_on', v_term.starts_on,
      'ends_on', v_term.ends_on,
      'status', v_term.status
    );
  end if;

  v_before := jsonb_build_object(
    'starts_on', v_term.starts_on,
    'ends_on', v_term.ends_on,
    'status', v_term.status
  );

  update public.academic_terms
  set starts_on = p_starts_on,
      ends_on = p_ends_on
  where id = v_term.id
  returning updated_at into v_updated_at;

  v_after := jsonb_build_object(
    'starts_on', p_starts_on,
    'ends_on', p_ends_on,
    'status', v_term.status
  );

  perform private.write_audit(
    'admin_update_term_schedule',
    'academic_term',
    v_term.id::text,
    v_before,
    v_after
  );

  return jsonb_build_object(
    'ok', true,
    'updated', true,
    'term_id', v_term.id,
    'starts_on', p_starts_on,
    'ends_on', p_ends_on,
    'status', v_term.status,
    'updated_at', v_updated_at
  );
end;
$$;

comment on function public.admin_update_term_schedule(bigint, date, date) is
  'Update a planned/active term schedule using ISO date inputs; requires an active, activated password-AMR admin.';

revoke all on function public.admin_update_term_schedule(bigint, date, date)
from public, anon, authenticated, service_role;
grant execute on function public.admin_update_term_schedule(bigint, date, date)
to authenticated;

commit;
