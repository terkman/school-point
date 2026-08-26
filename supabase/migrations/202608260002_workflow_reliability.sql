begin;

-- Historical v2 attempts remain readable. v3 supplies a request UUID and
-- uses the task lock to serialize a replay with a concurrent state transition.
alter table private.guardian_contact_attempts
  add column if not exists client_request_id uuid;

create unique index if not exists guardian_attempts_task_client_request_uidx
  on private.guardian_contact_attempts(task_id, client_request_id)
  where client_request_id is not null;

create or replace function public.record_guardian_contact_attempt_v3(
  p_client_request_id uuid,
  p_task_id bigint,
  p_channel text,
  p_outcome text,
  p_note text default null,
  p_evidence_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_task public.guardian_contact_tasks%rowtype;
  v_case public.follow_up_cases%rowtype;
  v_attempt private.guardian_contact_attempts%rowtype;
  v_has_case boolean := false;
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_note text := nullif(btrim(p_note), '');
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_closes boolean;
  v_attempt_id bigint;
  v_attempted_at timestamptz := now();
  v_next_reminder timestamptz;
  v_case_status public.case_status;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_client_request_id is null or p_task_id is null then
    raise exception 'Client request ID and guardian contact task are required' using errcode = '22023';
  end if;
  if not (
    (v_channel = 'phone' and v_outcome in ('answered', 'unanswered'))
    or (v_channel in ('line', 'messenger', 'sms') and v_outcome in ('sent_waiting', 'read_or_replied'))
  ) then
    raise exception 'Guardian contact channel and outcome do not match' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 2000 or char_length(coalesce(v_evidence, '')) > 500 then
    raise exception 'Contact note or evidence is too long' using errcode = '22023';
  end if;

  -- Lock case -> task, matching the case-resolution RPC and v2. The first
  -- read only identifies the case; the task row is re-read under lock below.
  select task.* into v_task
  from public.guardian_contact_tasks task
  where task.id = p_task_id;
  if not found then
    raise exception 'Guardian contact task not found' using errcode = 'P0002';
  end if;

  select case_row.* into v_case
  from public.follow_up_cases case_row
  where case_row.incident_id = v_task.incident_id
  for update;
  v_has_case := found;

  select task.* into v_task
  from public.guardian_contact_tasks task
  where task.id = p_task_id
  for update;
  if not found then
    raise exception 'Guardian contact task not found' using errcode = 'P0002';
  end if;

  -- This check intentionally precedes completed/cancelled validation. A lost
  -- response may be retried after a closing attempt has completed the task.
  select attempt.* into v_attempt
  from private.guardian_contact_attempts attempt
  where attempt.task_id = v_task.id
    and attempt.client_request_id = p_client_request_id;
  if found then
    if v_attempt.channel <> v_channel
       or v_attempt.outcome <> v_outcome
       or coalesce(v_attempt.note, '') <> coalesce(v_note, '')
       or coalesce(v_attempt.evidence_note, '') <> coalesce(v_evidence, '') then
      raise exception 'Client request ID was already used for different guardian-contact data'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'attemptId', v_attempt.id,
      'taskId', v_task.id,
      'status', case when v_attempt.closes_notification then 'completed' else 'pending' end,
      'closesNotification', v_attempt.closes_notification,
      'caseStatus', case
        when v_has_case then case when v_attempt.closes_notification then 'resolved' else 'following_up' end
        else null
      end,
      'attemptedAt', v_attempt.attempted_at,
      'nextReminderAt', case
        when v_attempt.closes_notification then null
        else v_attempt.attempted_at + interval '24 hours'
      end
    );
  end if;

  if v_task.status = 'completed' then
    raise exception 'Guardian notification is already completed' using errcode = '55000';
  end if;
  if v_task.status = 'cancelled' then
    raise exception 'Cancelled guardian task cannot receive attempts' using errcode = '55000';
  end if;

  v_closes := (
    (v_channel = 'phone' and v_outcome = 'answered')
    or (v_channel in ('line', 'messenger', 'sms') and v_outcome = 'read_or_replied')
  );
  v_next_reminder := case when v_closes then null else v_attempted_at + interval '24 hours' end;
  v_case_status := case
    when v_closes then 'resolved'::public.case_status
    else 'following_up'::public.case_status
  end;

  insert into private.guardian_contact_attempts(
    task_id, client_request_id, channel, outcome, closes_notification, note, evidence_note,
    attempted_by, attempted_by_snapshot, attempted_at
  ) values (
    v_task.id, p_client_request_id, v_channel, v_outcome, v_closes, v_note, v_evidence,
    v_uid, private.actor_snapshot(v_uid), v_attempted_at
  ) returning id into v_attempt_id;

  update public.guardian_contact_tasks
  set status = case when v_closes then 'completed' else 'pending' end,
      note = coalesce(v_note, note),
      completed_at = case when v_closes then v_attempted_at else null end,
      completed_by = case when v_closes then v_uid else null end,
      next_reminder_at = v_next_reminder
  where id = v_task.id;

  if v_has_case and v_case.status <> 'resolved' then
    update public.follow_up_cases
    set status = v_case_status,
        follow_up_note = case
          when v_closes then coalesce(v_note, 'ปิดเคสอัตโนมัติหลังผู้ปกครองยืนยันรับทราบ')
          else follow_up_note
        end,
        managed_by = v_uid,
        managed_at = v_attempted_at,
        resolved_at = case when v_closes then v_attempted_at else null end,
        resolved_by = case when v_closes then v_uid else null end
    where id = v_case.id;

    perform private.write_audit(
      'record_guardian_contact_attempt_v3', 'follow_up_case', v_case.id::text,
      jsonb_build_object(
        'status', v_case.status,
        'follow_up_note', v_case.follow_up_note,
        'managed_at', v_case.managed_at,
        'resolved_at', v_case.resolved_at
      ),
      jsonb_build_object(
        'status', v_case_status,
        'closed_by_guardian_confirmation', v_closes,
        'guardian_task_id', v_task.id,
        'managed_at', v_attempted_at,
        'resolved_at', case when v_closes then v_attempted_at else null end
      )
    );
  end if;

  perform private.write_audit(
    'record_guardian_contact_attempt_v3', 'guardian_contact_task', v_task.id::text,
    jsonb_build_object('status', v_task.status, 'next_reminder_at', v_task.next_reminder_at),
    jsonb_build_object(
      'status', case when v_closes then 'completed' else 'pending' end,
      'attempt_id', v_attempt_id,
      'channel', v_channel,
      'outcome', v_outcome,
      'closes_notification', v_closes,
      'case_status', case when v_has_case then v_case_status else null end,
      'next_reminder_at', v_next_reminder
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'attemptId', v_attempt_id,
    'taskId', v_task.id,
    'status', case when v_closes then 'completed' else 'pending' end,
    'closesNotification', v_closes,
    'caseStatus', case when v_has_case then v_case_status else null end,
    'attemptedAt', v_attempted_at,
    'nextReminderAt', v_next_reminder
  );
end;
$$;

revoke all on function public.record_guardian_contact_attempt_v3(uuid,bigint,text,text,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.record_guardian_contact_attempt_v3(uuid,bigint,text,text,text,text)
to authenticated;

comment on function public.record_guardian_contact_attempt_v3(uuid,bigint,text,text,text,text) is
  'Record one idempotent guardian-contact attempt. Repeating a task-scoped client request ID returns the original result without another task, case, history, or audit update.';

-- These compatibility endpoints keep their established bigint result shape
-- while delegating all writes and validation to the hardened v2 workflows.
create or replace function public.review_point_addition(
  p_request_id bigint,
  p_approve boolean,
  p_review_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_points smallint;
  v_result jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_request_id is null or p_approve is null then
    raise exception 'Request and explicit approval decision are required' using errcode = '22023';
  end if;

  if p_approve then
    select request.requested_points into v_requested_points
    from public.point_addition_requests request
    where request.id = p_request_id;
    if not found then
      raise exception 'Request not found' using errcode = 'P0002';
    end if;
  end if;

  v_result := public.review_point_addition_v2(
    p_request_id,
    p_approve,
    case when p_approve then v_requested_points else null end,
    p_review_note
  );
  return nullif(v_result ->> 'ledgerId', '')::bigint;
end;
$$;

create or replace function public.review_appeal(
  p_appeal_id bigint,
  p_accept boolean,
  p_decision_note text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restored_points smallint := 0;
  v_result jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_appeal_id is null or p_accept is null then
    raise exception 'Appeal and explicit acceptance decision are required' using errcode = '22023';
  end if;

  if p_accept then
    select incident.applied_points into v_restored_points
    from public.appeals appeal
    join public.incidents incident on incident.id = appeal.incident_id
    where appeal.id = p_appeal_id;
    if not found then
      raise exception 'Appeal not found' using errcode = 'P0002';
    end if;
  end if;

  v_result := public.review_appeal_v2(
    p_appeal_id,
    v_restored_points,
    p_decision_note
  );
  return nullif(v_result ->> 'ledgerId', '')::bigint;
end;
$$;

revoke all on function public.review_point_addition(bigint,boolean,text)
from public, anon, authenticated, service_role;
grant execute on function public.review_point_addition(bigint,boolean,text)
to authenticated;
revoke all on function public.review_appeal(bigint,boolean,text)
from public, anon, authenticated, service_role;
grant execute on function public.review_appeal(bigint,boolean,text)
to authenticated;

comment on function public.review_point_addition(bigint,boolean,text) is
  'Compatibility wrapper for the v2 point-addition review workflow; approvals return the created ledger ID and rejections return NULL.';
comment on function public.review_appeal(bigint,boolean,text) is
  'Compatibility wrapper for the v2 appeal-review workflow; accepted appeals return the adjustment ledger ID when one is created.';

commit;
