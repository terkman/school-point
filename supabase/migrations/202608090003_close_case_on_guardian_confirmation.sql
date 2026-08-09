begin;

-- A successful guardian confirmation is the terminal step for a serious case.
-- Keep the notification task and case transition in one short transaction so
-- the UI cannot observe a completed notification with an open case.
create or replace function public.record_guardian_contact_attempt_v2(
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
  if p_task_id is null then
    raise exception 'Guardian contact task is required' using errcode = '22023';
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

  -- Read the incident first, then lock case -> task. This matches the existing
  -- case-resolution RPC lock order and avoids a task/case deadlock.
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
    task_id, channel, outcome, closes_notification, note, evidence_note,
    attempted_by, attempted_by_snapshot, attempted_at
  ) values (
    v_task.id, v_channel, v_outcome, v_closes, v_note, v_evidence,
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
      'record_guardian_contact_attempt_v2', 'follow_up_case', v_case.id::text,
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
    'record_guardian_contact_attempt_v2', 'guardian_contact_task', v_task.id::text,
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

comment on function public.record_guardian_contact_attempt_v2(bigint, text, text, text, text) is
  'Record an audited guardian contact attempt; unanswered or unconfirmed contact schedules a 24-hour reminder, while confirmed contact atomically completes the notification and resolves its serious case.';

revoke all on function public.record_guardian_contact_attempt_v2(bigint,text,text,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.record_guardian_contact_attempt_v2(bigint,text,text,text,text)
to authenticated;

-- Bring existing completed notification tasks in line with the clarified rule.
update public.follow_up_cases case_row
set status = 'resolved',
    follow_up_note = coalesce(case_row.follow_up_note, 'ปิดเคสอัตโนมัติหลังผู้ปกครองยืนยันรับทราบ'),
    managed_by = coalesce(task.completed_by, case_row.managed_by),
    managed_at = coalesce(task.completed_at, case_row.managed_at, now()),
    resolved_at = coalesce(task.completed_at, now()),
    resolved_by = coalesce(task.completed_by, case_row.resolved_by)
from public.guardian_contact_tasks task
where task.incident_id = case_row.incident_id
  and task.status = 'completed'
  and case_row.status <> 'resolved';

commit;
