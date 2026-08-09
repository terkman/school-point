begin;

-- Teacher deductions of 10 points or more wait for an administrator decision.
-- One row per student keeps bulk submissions reviewable one student at a time.
create table public.deduction_approval_requests (
  id bigint generated always as identity primary key,
  batch_id uuid not null,
  client_request_id uuid not null,
  student_id bigint not null references public.students(id) on delete restrict,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  classroom_id bigint not null,
  rule_id bigint not null references public.behavior_rules(id) on delete restrict,
  rule_snapshot jsonb not null check (jsonb_typeof(rule_snapshot) = 'object'),
  requested_points smallint not null check (requested_points between 10 and 100),
  approved_points smallint check (approved_points between 1 and 100),
  occurred_at timestamptz not null,
  student_visible_note text check (student_visible_note is null or char_length(btrim(student_visible_note)) between 1 and 2000),
  internal_note text check (internal_note is null or char_length(btrim(internal_note)) between 1 and 4000),
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_snapshot text not null,
  request_payload_hash text not null check (char_length(request_payload_hash) = 64),
  status public.request_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(btrim(review_note)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (classroom_id, term_id) references public.classrooms(id, term_id) on delete restrict,
  unique (requested_by, client_request_id, student_id),
  check (
    (status = 'pending' and approved_points is null and reviewed_by is null and reviewed_at is null)
    or (status = 'approved' and approved_points is not null and reviewed_by is not null and reviewed_at is not null)
    or (status = 'rejected' and approved_points is null and reviewed_by is not null and reviewed_at is not null)
  )
);

create index deduction_approval_pending_idx
  on public.deduction_approval_requests(created_at, id)
  where status = 'pending';
create index deduction_approval_requester_idx
  on public.deduction_approval_requests(requested_by, created_at desc, id desc);
create index deduction_approval_student_term_idx
  on public.deduction_approval_requests(student_id, term_id, created_at desc);

alter table public.deduction_approval_requests enable row level security;
alter table public.deduction_approval_requests force row level security;

create policy deduction_approval_staff_select
on public.deduction_approval_requests
for select
to authenticated
using (
  private.current_role() = 'admin'::public.app_role
  or (
    private.current_role() = 'teacher'::public.app_role
    and requested_by = (select auth.uid())
  )
);

revoke all on table public.deduction_approval_requests from public, anon, authenticated, service_role;
revoke all on sequence public.deduction_approval_requests_id_seq from public, anon, authenticated, service_role;
grant select on table public.deduction_approval_requests to authenticated;

alter table public.score_ledger
  add column deduction_request_id bigint
    references public.deduction_approval_requests(id) on delete restrict;

create unique index score_ledger_deduction_request_idx
  on public.score_ledger(deduction_request_id)
  where deduction_request_id is not null;

-- Pending guardian tasks always receive their first 24-hour reminder timestamp.
alter table public.guardian_contact_tasks
  alter column next_reminder_at set default (now() + interval '24 hours');

create or replace function public.request_deductions_bulk_v1(
  p_client_request_id uuid,
  p_scope text,
  p_student_ids bigint[],
  p_rule_id bigint,
  p_classroom_id bigint default null,
  p_occurred_at timestamptz default now(),
  p_student_visible_note text default null,
  p_internal_note text default null,
  p_confirm_serious_bulk boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_target_ids bigint[];
  v_target_count integer;
  v_term public.academic_terms%rowtype;
  v_rule public.behavior_rules%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_requests jsonb;
  v_existing_count integer;
  v_event_date date;
  v_student_note text := nullif(btrim(p_student_visible_note), '');
  v_internal_note text := nullif(btrim(p_internal_note), '');
begin
  if v_uid is null or private.current_role() is distinct from 'teacher'::public.app_role then
    raise exception 'Teacher permission required' using errcode = '42501';
  end if;
  if p_client_request_id is null or p_rule_id is null or p_occurred_at is null then
    raise exception 'Request ID, rule, and occurrence time are required' using errcode = '22023';
  end if;
  if v_scope not in ('single', 'selected', 'classroom') then
    raise exception 'Scope must be single, selected, or classroom' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_student_ids), 0) not between 1 and 100
     or array_position(p_student_ids, null) is not null then
    raise exception 'A request must contain between 1 and 100 valid students' using errcode = '22023';
  end if;

  select array_agg(distinct_target.student_id order by distinct_target.student_id)
  into v_target_ids
  from (select distinct target.student_id from unnest(p_student_ids) target(student_id)) distinct_target;
  v_target_count := cardinality(v_target_ids);

  if v_target_count <> cardinality(p_student_ids) or exists (
    select 1 from unnest(v_target_ids) target(student_id) where target.student_id <= 0
  ) then
    raise exception 'Student IDs must be unique positive values' using errcode = '22023';
  end if;
  if v_scope = 'single' and v_target_count <> 1 then
    raise exception 'Single scope requires exactly one student' using errcode = '22023';
  end if;
  if v_scope = 'classroom' and p_classroom_id is null then
    raise exception 'Classroom scope requires a classroom' using errcode = '22023';
  end if;
  if char_length(coalesce(v_internal_note, '')) > 4000
     or char_length(coalesce(v_student_note, '')) > 2000 then
    raise exception 'Deduction notes are too long' using errcode = '22023';
  end if;
  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Occurrence time cannot be in the future' using errcode = '22023';
  end if;

  select term.* into v_term
  from public.academic_terms term
  where term.status = 'active'
  for share;
  if not found then
    raise exception 'No active academic term' using errcode = 'P0002';
  end if;

  v_event_date := (p_occurred_at at time zone 'Asia/Bangkok')::date;
  if v_term.starts_on is null or v_term.ends_on is null
     or v_event_date < v_term.starts_on or v_event_date > v_term.ends_on then
    raise exception 'Occurrence time must be inside the active term' using errcode = '22023';
  end if;

  select rule.* into v_rule
  from public.behavior_rules rule
  where rule.id = p_rule_id and rule.is_active
  for share;
  if not found then
    raise exception 'Rule not found or inactive' using errcode = 'P0002';
  end if;
  if v_rule.default_deduction < 10 then
    raise exception 'Only deductions of 10 points or more require approval' using errcode = '22023';
  end if;
  if (v_rule.effective_from is not null and v_event_date < v_rule.effective_from)
     or (v_rule.effective_to is not null and v_event_date > v_rule.effective_to) then
    raise exception 'Rule is not effective on the occurrence date' using errcode = '22023';
  end if;
  if v_rule.severity in ('serious', 'critical') and v_target_count > 1
     and not coalesce(p_confirm_serious_bulk, false) then
    raise exception 'Serious multi-student deduction requires explicit confirmation' using errcode = '22023';
  end if;

  if (select count(*) from public.enrollments enrollment
      join public.students student on student.id = enrollment.student_id and student.status = 'active'
      where enrollment.term_id = v_term.id and enrollment.is_active
        and enrollment.student_id = any(v_target_ids)) <> v_target_count then
    raise exception 'One or more students have no active enrollment' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from unnest(v_target_ids) target(student_id)
    where not private.teacher_has_student(target.student_id, v_term.id)
  ) then
    raise exception 'Teacher is not assigned to every selected student' using errcode = '42501';
  end if;
  if p_classroom_id is not null and exists (
    select 1 from public.enrollments enrollment
    where enrollment.term_id = v_term.id and enrollment.is_active
      and enrollment.student_id = any(v_target_ids)
      and enrollment.classroom_id <> p_classroom_id
  ) then
    raise exception 'Selected students do not all belong to the requested classroom' using errcode = '22023';
  end if;
  if v_scope = 'classroom' and v_target_ids is distinct from (
    select array_agg(enrollment.student_id order by enrollment.student_id)
    from public.enrollments enrollment
    join public.students student on student.id = enrollment.student_id and student.status = 'active'
    where enrollment.term_id = v_term.id and enrollment.classroom_id = p_classroom_id
      and enrollment.is_active
  ) then
    raise exception 'Classroom roster changed; review the full roster again' using errcode = '55000';
  end if;

  v_payload := jsonb_build_object(
    'scope', v_scope,
    'student_ids', to_jsonb(v_target_ids),
    'rule_id', p_rule_id,
    'classroom_id', p_classroom_id,
    'occurred_at_epoch', extract(epoch from p_occurred_at),
    'student_visible_note', v_student_note,
    'internal_note', v_internal_note
  );
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('deduction-approval:' || v_uid::text || ':' || p_client_request_id::text, 0)
  );

  select count(*) into v_existing_count
  from public.deduction_approval_requests request
  where request.requested_by = v_uid and request.client_request_id = p_client_request_id;
  if v_existing_count > 0 then
    if v_existing_count <> v_target_count or exists (
      select 1 from public.deduction_approval_requests request
      where request.requested_by = v_uid and request.client_request_id = p_client_request_id
        and (request.request_payload_hash is distinct from v_payload_hash
             or request.student_id <> all(v_target_ids))
    ) then
      raise exception 'Client request ID was already used for a different deduction request' using errcode = '22023';
    end if;
    select jsonb_agg(jsonb_build_object(
      'studentId', request.student_id,
      'requestId', request.id,
      'status', request.status
    ) order by request.student_id) into v_requests
    from public.deduction_approval_requests request
    where request.requested_by = v_uid and request.client_request_id = p_client_request_id;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'batchId', p_client_request_id,
      'scope', v_scope, 'classroomId', p_classroom_id, 'targetCount', v_target_count,
      'requestedPointsEach', v_rule.default_deduction, 'requests', v_requests
    );
  end if;

  insert into public.deduction_approval_requests(
    batch_id, client_request_id, student_id, term_id, classroom_id, rule_id,
    rule_snapshot, requested_points, occurred_at, student_visible_note, internal_note,
    requested_by, requested_by_snapshot, request_payload_hash
  )
  select p_client_request_id, p_client_request_id, target.student_id, v_term.id,
         enrollment.classroom_id, v_rule.id,
         jsonb_build_object(
           'rule_code', v_rule.rule_code,
           'category', v_rule.category,
           'title_th', v_rule.title_th,
           'points', v_rule.default_deduction,
           'severity', v_rule.severity,
           'guardian_contact_required', v_rule.guardian_contact_required
         ),
         v_rule.default_deduction, p_occurred_at, v_student_note, v_internal_note,
         v_uid, private.actor_snapshot(v_uid), v_payload_hash
  from unnest(v_target_ids) target(student_id)
  join public.enrollments enrollment on enrollment.student_id = target.student_id
    and enrollment.term_id = v_term.id and enrollment.is_active;

  select jsonb_agg(jsonb_build_object(
    'studentId', request.student_id,
    'requestId', request.id,
    'status', request.status
  ) order by request.student_id) into v_requests
  from public.deduction_approval_requests request
  where request.requested_by = v_uid and request.client_request_id = p_client_request_id;

  perform private.write_audit(
    'request_deductions_bulk_v1', 'deduction_approval_batch', p_client_request_id::text,
    null, jsonb_build_object('student_ids', to_jsonb(v_target_ids), 'rule_id', v_rule.id,
      'requested_points_each', v_rule.default_deduction, 'target_count', v_target_count)
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'batchId', p_client_request_id,
    'scope', v_scope, 'classroomId', p_classroom_id, 'targetCount', v_target_count,
    'requestedPointsEach', v_rule.default_deduction, 'requests', v_requests
  );
end;
$$;

create or replace function public.review_deduction_request_v1(
  p_request_id bigint,
  p_approve boolean,
  p_approved_points smallint,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request public.deduction_approval_requests%rowtype;
  v_note text := nullif(btrim(p_review_note), '');
  v_account_id bigint;
  v_balance smallint;
  v_applied smallint;
  v_incident_id bigint;
  v_severity public.rule_severity;
  v_guardian_required boolean;
  v_rule_title text;
begin
  if v_uid is null or not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_request_id is null or p_approve is null then
    raise exception 'Request and decision are required' using errcode = '22023';
  end if;
  if not p_approve and char_length(coalesce(v_note, '')) < 5 then
    raise exception 'Rejection reason must contain at least 5 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 2000 then
    raise exception 'Review note is too long' using errcode = '22023';
  end if;

  select request.* into v_request
  from public.deduction_approval_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception 'Deduction request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Deduction request was already reviewed' using errcode = '55000';
  end if;

  if not p_approve then
    update public.deduction_approval_requests
    set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_note = v_note
    where id = v_request.id;
    perform private.write_audit(
      'review_deduction_request_v1', 'deduction_approval_request', v_request.id::text,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'rejected', 'review_note', v_note)
    );
    return jsonb_build_object('ok', true, 'requestId', v_request.id, 'status', 'rejected');
  end if;

  if p_approved_points is null or p_approved_points not between 1 and 100 then
    raise exception 'Approved points must be between 1 and 100' using errcode = '22023';
  end if;
  if p_approved_points <> v_request.requested_points and char_length(coalesce(v_note, '')) < 5 then
    raise exception 'Adjustment reason must contain at least 5 characters' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.academic_terms term
    where term.id = v_request.term_id and term.status = 'active'
  ) then
    raise exception 'The request term is no longer active' using errcode = '55000';
  end if;

  v_severity := (v_request.rule_snapshot ->> 'severity')::public.rule_severity;
  v_guardian_required := coalesce((v_request.rule_snapshot ->> 'guardian_contact_required')::boolean, false);
  v_rule_title := coalesce(nullif(v_request.rule_snapshot ->> 'title_th', ''), 'เหตุการณ์ตามระเบียบ');
  v_account_id := private.ensure_score_account(v_request.student_id, v_request.term_id, v_uid);
  select account.balance into v_balance
  from public.score_accounts account
  where account.id = v_account_id
  for update;
  v_applied := least(v_balance::integer, p_approved_points::integer)::smallint;

  insert into public.incidents(
    student_id, term_id, classroom_id, rule_id, rule_snapshot, requested_points,
    applied_points, severity, occurred_at, appeal_deadline, student_visible_note,
    internal_note, recorded_by, recorded_by_snapshot
  ) values (
    v_request.student_id, v_request.term_id, v_request.classroom_id, v_request.rule_id,
    v_request.rule_snapshot || jsonb_build_object(
      'points', p_approved_points,
      'teacher_requested_points', v_request.requested_points,
      'approved_from_request_id', v_request.id
    ),
    p_approved_points, v_applied, v_severity, v_request.occurred_at,
    now() + interval '7 days', v_request.student_visible_note, v_request.internal_note,
    v_request.requested_by, v_request.requested_by_snapshot
  ) returning id into v_incident_id;

  update public.score_accounts
  set balance = balance - v_applied
  where id = v_account_id;

  insert into public.score_ledger(
    score_account_id, student_id, term_id, entry_type, requested_delta,
    applied_delta, balance_before, balance_after, incident_id, deduction_request_id,
    reason, actor_user_id, actor_snapshot, internal_reason
  ) values (
    v_account_id, v_request.student_id, v_request.term_id, 'deduction', -p_approved_points,
    -v_applied, v_balance, v_balance - v_applied, v_incident_id, v_request.id,
    v_rule_title, v_uid, private.actor_snapshot(v_uid), v_request.internal_note
  );

  if v_severity in ('serious', 'critical') then
    insert into public.follow_up_cases(
      incident_id, student_id, opened_in_term_id, internal_note, opened_by
    ) values (
      v_incident_id, v_request.student_id, v_request.term_id,
      coalesce(v_request.internal_note, v_rule_title), v_uid
    );
    if v_guardian_required then
      insert into public.guardian_contact_tasks(incident_id, student_id, note)
      values (v_incident_id, v_request.student_id, 'ต้องติดต่อผู้ปกครองสำหรับเหตุการณ์ร้ายแรง');
    end if;
  end if;

  update public.deduction_approval_requests
  set status = 'approved', approved_points = p_approved_points,
      reviewed_by = v_uid, reviewed_at = now(), review_note = v_note
  where id = v_request.id;

  perform private.write_audit(
    'review_deduction_request_v1', 'deduction_approval_request', v_request.id::text,
    jsonb_build_object('status', 'pending', 'requested_points', v_request.requested_points),
    jsonb_build_object('status', 'approved', 'approved_points', p_approved_points,
      'applied_points', v_applied, 'incident_id', v_incident_id, 'review_note', v_note)
  );

  return jsonb_build_object(
    'ok', true, 'requestId', v_request.id, 'status', 'approved',
    'approvedPoints', p_approved_points, 'appliedPoints', v_applied, 'incidentId', v_incident_id
  );
end;
$$;

revoke all on function public.request_deductions_bulk_v1(uuid,text,bigint[],bigint,bigint,timestamptz,text,text,boolean)
from public, anon, authenticated, service_role;
grant execute on function public.request_deductions_bulk_v1(uuid,text,bigint[],bigint,bigint,timestamptz,text,text,boolean)
to authenticated;
revoke all on function public.review_deduction_request_v1(bigint,boolean,smallint,text)
from public, anon, authenticated, service_role;
grant execute on function public.review_deduction_request_v1(bigint,boolean,smallint,text)
to authenticated;

-- SMS now follows the same confirmation rule as chat: sending alone remains
-- pending, and only a read/reply outcome closes the notification task.
create temporary table sms_tasks_to_reopen on commit drop as
select task.id as task_id, max(attempt.attempted_at) as last_sms_at
from public.guardian_contact_tasks task
join private.guardian_contact_attempts attempt on attempt.task_id = task.id
where task.status = 'completed'
  and attempt.channel = 'sms'
  and attempt.outcome = 'sent'
  and not exists (
    select 1 from private.guardian_contact_attempts closing_attempt
    where closing_attempt.task_id = task.id
      and (
        (closing_attempt.channel = 'phone' and closing_attempt.outcome = 'answered')
        or (closing_attempt.channel in ('line', 'messenger', 'sms') and closing_attempt.outcome = 'read_or_replied')
      )
  )
group by task.id;

-- Drop the old channel/outcome relationship before converting historical SMS
-- attempts. The generic outcome whitelist remains valid.
do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'private.guardian_contact_attempts'::regclass
      and constraint_row.contype = 'c'
      and (
        pg_get_constraintdef(constraint_row.oid) ilike '%channel%'
        or pg_get_constraintdef(constraint_row.oid) ilike '%closes_notification%'
      )
  loop
    execute format('alter table private.guardian_contact_attempts drop constraint %I', v_constraint_name);
  end loop;
end;
$$;

alter table private.guardian_contact_attempts disable trigger guardian_contact_attempts_immutable;
update private.guardian_contact_attempts
set outcome = 'sent_waiting', closes_notification = false
where channel = 'sms' and outcome = 'sent';
alter table private.guardian_contact_attempts enable trigger guardian_contact_attempts_immutable;

update public.guardian_contact_tasks task
set status = 'pending', completed_at = null, completed_by = null,
    next_reminder_at = reopen.last_sms_at + interval '24 hours'
from sms_tasks_to_reopen reopen
where task.id = reopen.task_id;

alter table private.guardian_contact_attempts
  add constraint guardian_attempts_channel_check
    check (channel in ('phone', 'line', 'messenger', 'sms')),
  add constraint guardian_attempts_channel_outcome_check
    check (
      (channel = 'phone' and outcome in ('answered', 'unanswered'))
      or (channel in ('line', 'messenger', 'sms') and outcome in ('sent_waiting', 'read_or_replied'))
    ),
  add constraint guardian_attempts_close_policy
    check (
      closes_notification = (
        (channel = 'phone' and outcome = 'answered')
        or (channel in ('line', 'messenger', 'sms') and outcome = 'read_or_replied')
      )
    );

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
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_note text := nullif(btrim(p_note), '');
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_closes boolean;
  v_attempt_id bigint;
  v_attempted_at timestamptz := now();
  v_next_reminder timestamptz;
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

  update public.follow_up_cases
  set status = 'following_up', managed_by = v_uid, managed_at = v_attempted_at
  where incident_id = v_task.incident_id and status = 'open';

  perform private.write_audit(
    'record_guardian_contact_attempt_v2', 'guardian_contact_task', v_task.id::text,
    jsonb_build_object('status', v_task.status, 'next_reminder_at', v_task.next_reminder_at),
    jsonb_build_object('status', case when v_closes then 'completed' else 'pending' end,
      'attempt_id', v_attempt_id, 'channel', v_channel, 'outcome', v_outcome,
      'closes_notification', v_closes, 'next_reminder_at', v_next_reminder)
  );

  return jsonb_build_object(
    'ok', true, 'attemptId', v_attempt_id, 'taskId', v_task.id,
    'status', case when v_closes then 'completed' else 'pending' end,
    'closesNotification', v_closes, 'attemptedAt', v_attempted_at,
    'nextReminderAt', v_next_reminder
  );
end;
$$;

revoke all on function public.record_guardian_contact_attempt_v2(bigint,text,text,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.record_guardian_contact_attempt_v2(bigint,text,text,text,text)
to authenticated;

commit;
