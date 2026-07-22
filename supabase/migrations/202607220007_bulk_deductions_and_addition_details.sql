begin;

-- A batch is deliberately private: it contains internal notes and the exact
-- staff-selected roster. Individual incidents remain the public/RLS-protected
-- source of truth for staff and student history.
create table private.deduction_batches (
  id bigint generated always as identity primary key,
  client_request_id uuid not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_by_snapshot text not null,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  scope text not null check (scope in ('single', 'selected', 'classroom')),
  classroom_id bigint references public.classrooms(id) on delete restrict,
  target_student_ids bigint[] not null,
  target_count smallint not null check (target_count between 1 and 100),
  rule_id bigint not null references public.behavior_rules(id) on delete restrict,
  rule_snapshot jsonb not null check (jsonb_typeof(rule_snapshot) = 'object'),
  requested_points_each smallint not null
    check (requested_points_each between 1 and 100),
  occurred_at timestamptz not null,
  student_visible_note text,
  internal_note text not null check (char_length(btrim(internal_note)) >= 5),
  payload_hash text not null check (char_length(payload_hash) = 64),
  total_requested_points integer not null default 0
    check (total_requested_points between 0 and 10000),
  total_applied_points integer not null default 0
    check (total_applied_points between 0 and 10000),
  already_at_zero_count smallint not null default 0
    check (already_at_zero_count between 0 and 100),
  guardian_task_count smallint not null default 0
    check (guardian_task_count between 0 and 100),
  result_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result_summary) = 'object'),
  recorded_at timestamptz not null default now(),
  unique (recorded_by, client_request_id),
  check (target_count = cardinality(target_student_ids)),
  check (array_position(target_student_ids, null) is null),
  check (scope <> 'single' or target_count = 1),
  check (scope <> 'classroom' or classroom_id is not null),
  check (already_at_zero_count <= target_count),
  check (guardian_task_count <= target_count),
  check (total_applied_points <= total_requested_points)
);

comment on table private.deduction_batches is
  'Private idempotency/audit header for one atomic deduction applied to an exact reviewed student set.';

alter table private.deduction_batches enable row level security;
alter table private.deduction_batches force row level security;

create index deduction_batches_term_recorded_idx
  on private.deduction_batches (term_id, recorded_at desc);

alter table public.incidents
  add column deduction_batch_id bigint
    references private.deduction_batches(id) on delete restrict;

create unique index incidents_batch_student_idx
  on public.incidents (deduction_batch_id, student_id)
  where deduction_batch_id is not null;

alter table public.point_addition_requests
  add column activity_occurred_at timestamptz,
  add column client_request_id uuid,
  add column request_payload_hash text;

alter table public.point_addition_requests
  add constraint point_requests_idempotency_pair
  check (
    (client_request_id is null and request_payload_hash is null)
    or
    (client_request_id is not null and request_payload_hash is not null)
  );

alter table public.point_addition_requests
  add constraint point_requests_payload_hash_length
  check (request_payload_hash is null or char_length(request_payload_hash) = 64);

create unique index point_requests_requester_client_id_idx
  on public.point_addition_requests (requested_by, client_request_id)
  where client_request_id is not null;

create index point_requests_activity_idx
  on public.point_addition_requests (student_id, term_id, activity_occurred_at desc)
  where activity_occurred_at is not null;

-- Direct administrator additions need the same structured provenance as teacher
-- requests. These columns stay on the staff-only ledger table; the redacted
-- student_score_history view continues to project only the public rule title in
-- score_ledger.reason and never projects internal_reason or evidence_note.
alter table public.score_ledger
  add column positive_rule_id bigint
    references public.positive_behavior_rules(id) on delete restrict,
  add column positive_rule_snapshot jsonb,
  add column activity_occurred_at timestamptz,
  add column internal_reason text,
  add column evidence_note text,
  add column client_request_id uuid,
  add column request_payload_hash text;

alter table public.score_ledger
  add constraint score_ledger_positive_rule_snapshot_pair
  check (
    (positive_rule_id is null and positive_rule_snapshot is null)
    or
    (
      positive_rule_id is not null
      and positive_rule_snapshot is not null
      and jsonb_typeof(positive_rule_snapshot) = 'object'
    )
  );

alter table public.score_ledger
  add constraint score_ledger_idempotency_pair
  check (
    (client_request_id is null and request_payload_hash is null)
    or
    (client_request_id is not null and request_payload_hash is not null)
  );

alter table public.score_ledger
  add constraint score_ledger_payload_hash_length
  check (request_payload_hash is null or char_length(request_payload_hash) = 64);

alter table public.score_ledger
  add constraint score_ledger_direct_addition_details
  check (
    client_request_id is null
    or
    (
      entry_type = 'admin_addition'
      and actor_user_id is not null
      and positive_rule_id is not null
      and positive_rule_snapshot is not null
      and activity_occurred_at is not null
      and nullif(btrim(internal_reason), '') is not null
      and char_length(btrim(internal_reason)) between 5 and 2000
      and nullif(btrim(evidence_note), '') is not null
      and char_length(btrim(evidence_note)) between 5 and 4000
    )
  );

create unique index score_ledger_actor_client_id_idx
  on public.score_ledger (actor_user_id, client_request_id)
  where client_request_id is not null;

create index score_ledger_positive_rule_idx
  on public.score_ledger (positive_rule_id)
  where positive_rule_id is not null;

-- Defense in depth for legacy addition rows: even if an older ledger reason held
-- an internal explanation, students see only a rule title or a neutral label.
-- The staff-only structured columns are intentionally absent from this view.
create or replace view public.student_score_history
with (security_barrier = true, security_invoker = true)
as
select ledger.id,
       ledger.term_id,
       ledger.entry_type,
       ledger.requested_delta,
       ledger.applied_delta,
       ledger.balance_before,
       ledger.balance_after,
       case
         when ledger.entry_type in ('teacher_request_approved', 'admin_addition')
           then coalesce(
             nullif(btrim(ledger.positive_rule_snapshot ->> 'title_th'), ''),
             'กิจกรรมเพิ่มคะแนน'
           )
         else ledger.reason
       end as reason,
       ledger.incident_id,
       ledger.created_at
from public.score_ledger ledger
join public.students student on student.id = ledger.student_id
join public.profiles profile on profile.user_id = student.user_id
where (select private.has_password_session())
  and student.user_id = (select auth.uid())
  and student.status = 'active'
  and profile.role = 'student'
  and profile.is_active
  and not profile.activation_required;

-- The redacted security-invoker views intentionally cannot bypass staff-only
-- base-table RLS. These narrowly scoped functions run as the database owner but
-- derive the only permitted student id from the password/activation-gated
-- current_student_id helper. Their return contracts contain no actor identity,
-- internal reason, evidence, request payload, or private rule snapshot.
create or replace function public.get_my_score_history()
returns table (
  id bigint,
  term_id bigint,
  entry_type public.score_entry_type,
  requested_delta smallint,
  applied_delta smallint,
  balance_before smallint,
  balance_after smallint,
  reason text,
  incident_id bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_id bigint := private.current_student_id();
begin
  if v_student_id is null then
    raise exception 'Active student permission required'
      using errcode = '42501';
  end if;

  return query
  select ledger.id,
         ledger.term_id,
         ledger.entry_type,
         ledger.requested_delta,
         ledger.applied_delta,
         ledger.balance_before,
         ledger.balance_after,
         case
           when ledger.entry_type in ('teacher_request_approved', 'admin_addition')
             then coalesce(
               nullif(btrim(ledger.positive_rule_snapshot ->> 'title_th'), ''),
               'กิจกรรมเพิ่มคะแนน'
             )
           else ledger.reason
         end,
         ledger.incident_id,
         ledger.created_at
  from public.score_ledger ledger
  where ledger.student_id = v_student_id
  order by ledger.created_at desc, ledger.id desc;
end;
$$;

comment on function public.get_my_score_history() is
  'Return only the authenticated active student score history fields safe for student display; internal evidence and actor data are excluded.';

create or replace function public.get_my_incident_history()
returns table (
  id bigint,
  term_id bigint,
  rule_code text,
  rule_title text,
  requested_points smallint,
  applied_points smallint,
  severity public.rule_severity,
  occurred_at timestamptz,
  recorded_at timestamptz,
  appeal_deadline timestamptz,
  student_visible_note text,
  is_voided boolean,
  appeal_id bigint,
  appeal_status public.appeal_status,
  decision_note text,
  appeal_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_id bigint := private.current_student_id();
begin
  if v_student_id is null then
    raise exception 'Active student permission required'
      using errcode = '42501';
  end if;

  return query
  select incident.id,
         incident.term_id,
         incident.rule_snapshot ->> 'rule_code',
         incident.rule_snapshot ->> 'title_th',
         incident.requested_points,
         incident.applied_points,
         incident.severity,
         incident.occurred_at,
         incident.recorded_at,
         incident.appeal_deadline,
         incident.student_visible_note,
         incident.is_voided,
         appeal.id,
         appeal.status,
         appeal.decision_note,
         appeal.created_at
  from public.incidents incident
  left join public.appeals appeal on appeal.incident_id = incident.id
  where incident.student_id = v_student_id
  order by incident.occurred_at desc, incident.id desc;
end;
$$;

comment on function public.get_my_incident_history() is
  'Return only the authenticated active student incident and appeal fields safe for student display; staff notes, appeal statement, evidence, and actors are excluded.';

revoke all on function public.get_my_score_history()
from public, anon, authenticated, service_role;
grant execute on function public.get_my_score_history()
to authenticated;

revoke all on function public.get_my_incident_history()
from public, anon, authenticated, service_role;
grant execute on function public.get_my_incident_history()
to authenticated;

-- One call is one transaction. Every target is validated before the first score
-- mutation, targets are processed in ascending student-id order, and any failure
-- rolls back the entire batch. The caller-provided UUID makes safe retries return
-- the original result rather than deducting again.
create or replace function public.record_deductions_bulk(
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
  v_role public.app_role := private.current_role();
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_target_ids bigint[];
  v_input_count integer := coalesce(cardinality(p_student_ids), 0);
  v_target_count integer;
  v_term public.academic_terms%rowtype;
  v_rule public.behavior_rules%rowtype;
  v_existing private.deduction_batches%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_actor_snapshot text;
  v_batch_id bigint;
  v_roster bigint[];
  v_enrollment_count bigint;
  v_authorized_count bigint;
  v_student_id bigint;
  v_incident_id bigint;
  v_requested_points smallint;
  v_applied_points smallint;
  v_balance_before smallint;
  v_balance_after smallint;
  v_results jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_total_applied integer := 0;
  v_already_at_zero integer := 0;
  v_guardian_tasks integer := 0;
  v_internal_note text := nullif(btrim(p_internal_note), '');
  v_student_note text := nullif(btrim(p_student_visible_note), '');
  v_event_date date;
begin
  if v_uid is null or v_role is null or v_role not in ('teacher', 'admin') then
    raise exception 'Teacher or administrator permission required'
      using errcode = '42501';
  end if;

  if p_client_request_id is null then
    raise exception 'Client request ID is required'
      using errcode = '22023';
  end if;

  if v_scope not in ('single', 'selected', 'classroom') then
    raise exception 'Scope must be single, selected, or classroom'
      using errcode = '22023';
  end if;

  if p_rule_id is null or p_occurred_at is null then
    raise exception 'Rule and occurrence time are required'
      using errcode = '22023';
  end if;

  if v_input_count < 1 or v_input_count > 100 then
    raise exception 'A batch must contain between 1 and 100 students'
      using errcode = '22023';
  end if;

  if array_position(p_student_ids, null) is not null then
    raise exception 'Student IDs must not contain null'
      using errcode = '22023';
  end if;

  select array_agg(distinct_target.student_id order by distinct_target.student_id)
  into v_target_ids
  from (
    select distinct target.student_id
    from unnest(p_student_ids) as target(student_id)
  ) as distinct_target;

  v_target_count := cardinality(v_target_ids);

  if v_target_count <> v_input_count then
    raise exception 'Student IDs must not contain duplicates'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(v_target_ids) as target(student_id)
    where target.student_id <= 0
  ) then
    raise exception 'Student IDs must be positive'
      using errcode = '22023';
  end if;

  if v_scope = 'single' and v_target_count <> 1 then
    raise exception 'Single scope requires exactly one student'
      using errcode = '22023';
  end if;

  if v_scope = 'classroom' and p_classroom_id is null then
    raise exception 'Classroom scope requires a classroom'
      using errcode = '22023';
  end if;

  if v_internal_note is null or char_length(v_internal_note) < 5 then
    raise exception 'Internal reason must contain at least 5 characters'
      using errcode = '22023';
  end if;

  if char_length(v_internal_note) > 4000
     or char_length(coalesce(v_student_note, '')) > 2000 then
    raise exception 'Deduction notes are too long'
      using errcode = '22023';
  end if;

  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Occurrence time cannot be in the future'
      using errcode = '22023';
  end if;

  -- Normalize all payload fields before hashing so whitespace-only differences
  -- cannot accidentally create two logically identical operations.
  v_payload := jsonb_build_object(
    'scope', v_scope,
    'student_ids', to_jsonb(v_target_ids),
    'rule_id', p_rule_id,
    'classroom_id', p_classroom_id,
    'occurred_at_epoch', extract(epoch from p_occurred_at),
    'student_visible_note', v_student_note,
    'internal_note', v_internal_note
  );
  v_payload_hash := encode(
    sha256(convert_to(v_payload::text, 'UTF8')),
    'hex'
  );

  -- Serialize retries from the same user/request pair before consulting the
  -- unique row. A hash collision remains harmless because the unique key and
  -- full payload hash comparison below are authoritative.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'deduction:' || v_uid::text || ':' || p_client_request_id::text,
      0
    )
  );

  select batch.*
  into v_existing
  from private.deduction_batches batch
  where batch.recorded_by = v_uid
    and batch.client_request_id = p_client_request_id;

  if found then
    if v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'Client request ID was already used for a different deduction'
        using errcode = '22023';
    end if;

    -- Idempotency must not become an authorization bypass. Administrators may
    -- inspect historical results, while a teacher must still hold an active-term
    -- assignment to every student whose balances appear in the stored result.
    if v_role = 'teacher' and exists (
      select 1
      from unnest(v_existing.target_student_ids) as target(student_id)
      where not private.teacher_has_student(
        target.student_id,
        v_existing.term_id
      )
    ) then
      raise exception 'Teacher is no longer assigned to every batch student'
        using errcode = '42501';
    end if;

    return v_existing.result_summary
      || jsonb_build_object('replayed', true);
  end if;

  select term.*
  into v_term
  from public.academic_terms term
  where term.status = 'active'
  for share;

  if not found then
    raise exception 'No active academic term'
      using errcode = 'P0002';
  end if;

  v_event_date := (p_occurred_at at time zone 'Asia/Bangkok')::date;
  if v_term.starts_on is null
     or v_term.ends_on is null
     or v_event_date < v_term.starts_on
     or v_event_date > v_term.ends_on then
    raise exception 'Occurrence time must be inside the active term'
      using errcode = '22023';
  end if;

  select rule.*
  into v_rule
  from public.behavior_rules rule
  where rule.id = p_rule_id
    and rule.is_active
  for share;

  if not found then
    raise exception 'Rule not found or inactive'
      using errcode = 'P0002';
  end if;

  if (v_rule.effective_from is not null and v_event_date < v_rule.effective_from)
     or (v_rule.effective_to is not null and v_event_date > v_rule.effective_to) then
    raise exception 'Rule is not effective on the occurrence date'
      using errcode = '22023';
  end if;

  if v_rule.severity in ('serious', 'critical')
     and v_target_count > 1
     and not coalesce(p_confirm_serious_bulk, false) then
    raise exception 'Serious multi-student deduction requires explicit confirmation'
      using errcode = '22023';
  end if;

  -- Every supplied student must be active and have one active enrollment in the
  -- one active term. The term-level unique enrollment constraint makes the
  -- count exact.
  select count(*)
  into v_enrollment_count
  from public.enrollments enrollment
  join public.students student
    on student.id = enrollment.student_id
   and student.status = 'active'
  where enrollment.term_id = v_term.id
    and enrollment.is_active
    and enrollment.student_id = any(v_target_ids);

  if v_enrollment_count <> v_target_count then
    raise exception 'One or more students have no active enrollment'
      using errcode = 'P0002';
  end if;

  if p_classroom_id is not null and exists (
    select 1
    from public.enrollments enrollment
    join public.students student
      on student.id = enrollment.student_id
     and student.status = 'active'
    where enrollment.term_id = v_term.id
      and enrollment.is_active
      and enrollment.student_id = any(v_target_ids)
      and enrollment.classroom_id <> p_classroom_id
  ) then
    raise exception 'Selected students do not all belong to the requested classroom'
      using errcode = '22023';
  end if;

  if v_scope = 'classroom' then
    perform 1
    from public.classrooms classroom
    where classroom.id = p_classroom_id
      and classroom.term_id = v_term.id
      and classroom.is_active
    for share;

    if not found then
      raise exception 'Classroom not found or inactive'
        using errcode = 'P0002';
    end if;

    select array_agg(enrollment.student_id order by enrollment.student_id)
    into v_roster
    from public.enrollments enrollment
    join public.students student
      on student.id = enrollment.student_id
     and student.status = 'active'
    where enrollment.term_id = v_term.id
      and enrollment.classroom_id = p_classroom_id
      and enrollment.is_active;

    if v_roster is null or v_roster is distinct from v_target_ids then
      raise exception 'Classroom roster changed; review the full roster again'
        using errcode = '55000';
    end if;
  end if;

  if v_role = 'teacher' then
    select count(distinct enrollment.student_id)
    into v_authorized_count
    from public.enrollments enrollment
    join public.students student
      on student.id = enrollment.student_id
     and student.status = 'active'
    join public.teacher_classroom_assignments assignment
      on assignment.term_id = enrollment.term_id
     and assignment.classroom_id = enrollment.classroom_id
     and assignment.is_active
    join public.teachers teacher
      on teacher.id = assignment.teacher_id
     and teacher.status = 'active'
     and teacher.intended_role = 'teacher'
    join public.profiles profile
      on profile.user_id = teacher.user_id
     and profile.role = 'teacher'
     and profile.is_active
     and not profile.activation_required
    where teacher.user_id = v_uid
      and enrollment.term_id = v_term.id
      and enrollment.is_active
      and enrollment.student_id = any(v_target_ids);

    if v_authorized_count <> v_target_count then
      raise exception 'Teacher is not assigned to every selected student'
        using errcode = '42501';
    end if;
  end if;

  v_actor_snapshot := private.actor_snapshot(v_uid);

  insert into private.deduction_batches(
    client_request_id,
    recorded_by,
    recorded_by_snapshot,
    term_id,
    scope,
    classroom_id,
    target_student_ids,
    target_count,
    rule_id,
    rule_snapshot,
    requested_points_each,
    occurred_at,
    student_visible_note,
    internal_note,
    payload_hash
  ) values (
    p_client_request_id,
    v_uid,
    v_actor_snapshot,
    v_term.id,
    v_scope,
    p_classroom_id,
    v_target_ids,
    v_target_count,
    v_rule.id,
    jsonb_build_object(
      'rule_code', v_rule.rule_code,
      'category', v_rule.category,
      'title_th', v_rule.title_th,
      'points', v_rule.default_deduction,
      'severity', v_rule.severity,
      'guardian_contact_required', v_rule.guardian_contact_required
    ),
    v_rule.default_deduction,
    p_occurred_at,
    v_student_note,
    v_internal_note,
    v_payload_hash
  ) returning id into v_batch_id;

  -- record_deduction owns all existing per-student invariants (score clamp,
  -- ledger, appeal window, follow-up and guardian task). Calling it in sorted
  -- order gives every overlapping batch the same score-account lock order.
  foreach v_student_id in array v_target_ids loop
    v_incident_id := public.record_deduction(
      v_student_id,
      v_rule.id,
      p_occurred_at,
      v_student_note,
      v_internal_note
    );

    update public.incidents
    set deduction_batch_id = v_batch_id
    where id = v_incident_id;

    select incident.requested_points,
           incident.applied_points,
           ledger.balance_before,
           ledger.balance_after
    into v_requested_points,
         v_applied_points,
         v_balance_before,
         v_balance_after
    from public.incidents incident
    join public.score_ledger ledger
      on ledger.incident_id = incident.id
     and ledger.entry_type = 'deduction'
    where incident.id = v_incident_id;

    if not found then
      raise exception 'Deduction ledger was not created'
        using errcode = '55000';
    end if;

    v_total_applied := v_total_applied + v_applied_points;
    if v_applied_points = 0 then
      v_already_at_zero := v_already_at_zero + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'studentId', v_student_id,
        'incidentId', v_incident_id,
        'requestedPoints', v_requested_points,
        'appliedPoints', v_applied_points,
        'balanceBefore', v_balance_before,
        'balanceAfter', v_balance_after
      )
    );
  end loop;

  select count(*)
  into v_guardian_tasks
  from public.guardian_contact_tasks task
  join public.incidents incident on incident.id = task.incident_id
  where incident.deduction_batch_id = v_batch_id;

  v_summary := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'batchId', v_batch_id,
    'scope', v_scope,
    'classroomId', p_classroom_id,
    'targetCount', v_target_count,
    'requestedPointsEach', v_rule.default_deduction,
    'totalRequestedPoints', v_rule.default_deduction::integer * v_target_count,
    'totalAppliedPoints', v_total_applied,
    'alreadyAtZeroCount', v_already_at_zero,
    'guardianTaskCount', v_guardian_tasks,
    'results', v_results
  );

  update private.deduction_batches
  set total_requested_points = v_rule.default_deduction::integer * v_target_count,
      total_applied_points = v_total_applied,
      already_at_zero_count = v_already_at_zero,
      guardian_task_count = v_guardian_tasks,
      result_summary = v_summary
  where id = v_batch_id;

  perform private.write_audit(
    'record_deductions_bulk',
    'deduction_batch',
    v_batch_id::text,
    null,
    jsonb_build_object(
      'scope', v_scope,
      'classroom_id', p_classroom_id,
      'target_student_ids', to_jsonb(v_target_ids),
      'target_count', v_target_count,
      'rule_id', v_rule.id,
      'requested_points_each', v_rule.default_deduction,
      'total_applied_points', v_total_applied,
      'guardian_task_count', v_guardian_tasks
    )
  );

  return v_summary;
end;
$$;

comment on function public.record_deductions_bulk(
  uuid, text, bigint[], bigint, bigint, timestamptz, text, text, boolean
) is
  'Atomically deduct one active rule from an exact sorted student set; UUID retries are idempotent and serious multi-student actions require confirmation.';

-- A teacher addition request must now identify the positive behavior rule, when
-- the activity happened, the reason, and evidence. Fixed rules cannot be changed;
-- discretionary rules are bounded by their catalogue maximum.
create or replace function public.request_point_addition_detailed(
  p_client_request_id uuid,
  p_student_id bigint,
  p_positive_rule_id bigint,
  p_points smallint,
  p_activity_occurred_at timestamptz,
  p_reason text,
  p_evidence_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_term public.academic_terms%rowtype;
  v_rule public.positive_behavior_rules%rowtype;
  v_request_id bigint;
  v_existing_id bigint;
  v_existing_student_id bigint;
  v_existing_term_id bigint;
  v_existing_hash text;
  v_existing_status public.request_status;
  v_reason text := nullif(btrim(p_reason), '');
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_payload jsonb;
  v_payload_hash text;
  v_activity_date date;
begin
  if private.current_role() is distinct from 'teacher'::public.app_role then
    raise exception 'Teacher permission required'
      using errcode = '42501';
  end if;

  if p_client_request_id is null
     or p_student_id is null
     or p_student_id <= 0
     or p_positive_rule_id is null
     or p_positive_rule_id <= 0
     or p_activity_occurred_at is null then
    raise exception 'Request ID, student, positive rule, and activity time are required'
      using errcode = '22023';
  end if;

  if p_points is null or p_points not between 1 and 100 then
    raise exception 'Requested points must be between 1 and 100'
      using errcode = '22023';
  end if;

  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Reason must contain at least 5 characters'
      using errcode = '22023';
  end if;

  if v_evidence is null or char_length(v_evidence) < 5 then
    raise exception 'Evidence must contain at least 5 characters'
      using errcode = '22023';
  end if;

  if char_length(v_reason) > 2000 or char_length(v_evidence) > 4000 then
    raise exception 'Reason or evidence is too long'
      using errcode = '22023';
  end if;

  if p_activity_occurred_at > now() + interval '5 minutes' then
    raise exception 'Activity time cannot be in the future'
      using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'student_id', p_student_id,
    'positive_rule_id', p_positive_rule_id,
    'points', p_points,
    'activity_occurred_at_epoch', extract(epoch from p_activity_occurred_at),
    'reason', v_reason,
    'evidence_note', v_evidence
  );
  v_payload_hash := encode(
    sha256(convert_to(v_payload::text, 'UTF8')),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'addition:' || v_uid::text || ':' || p_client_request_id::text,
      0
    )
  );

  select request.id,
         request.student_id,
         request.term_id,
         request.request_payload_hash,
         request.status
  into v_existing_id,
       v_existing_student_id,
       v_existing_term_id,
       v_existing_hash,
       v_existing_status
  from public.point_addition_requests request
  where request.requested_by = v_uid
    and request.client_request_id = p_client_request_id;

  if found then
    if v_existing_hash is distinct from v_payload_hash then
      raise exception 'Client request ID was already used for a different addition request'
        using errcode = '22023';
    end if;

    if not private.teacher_has_student(
      v_existing_student_id,
      v_existing_term_id
    ) then
      raise exception 'Teacher is no longer assigned to the request student'
        using errcode = '42501';
    end if;

    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'requestId', v_existing_id,
      'status', v_existing_status
    );
  end if;

  select term.*
  into v_term
  from public.academic_terms term
  join public.enrollments enrollment
    on enrollment.term_id = term.id
   and enrollment.student_id = p_student_id
   and enrollment.is_active
  join public.students student
    on student.id = enrollment.student_id
   and student.status = 'active'
  where term.status = 'active'
  order by enrollment.id
  limit 1
  for share of term, enrollment, student;

  if not found or not private.teacher_has_student(p_student_id, v_term.id) then
    raise exception 'Teacher is not assigned to an active student enrollment'
      using errcode = '42501';
  end if;

  v_activity_date :=
    (p_activity_occurred_at at time zone 'Asia/Bangkok')::date;
  if v_term.starts_on is null
     or v_term.ends_on is null
     or v_activity_date < v_term.starts_on
     or v_activity_date > v_term.ends_on then
    raise exception 'Activity time must be inside the active term'
      using errcode = '22023';
  end if;

  select rule.*
  into v_rule
  from public.positive_behavior_rules rule
  where rule.id = p_positive_rule_id
    and rule.is_active
  for share;

  if not found then
    raise exception 'Positive behavior rule not found or inactive'
      using errcode = 'P0002';
  end if;

  if (v_rule.effective_from is not null and v_activity_date < v_rule.effective_from)
     or (v_rule.effective_to is not null and v_activity_date > v_rule.effective_to) then
    raise exception 'Positive behavior rule is not effective on the activity date'
      using errcode = '22023';
  end if;

  if v_rule.is_discretionary then
    if p_points > v_rule.max_addition then
      raise exception 'Requested points exceed the rule maximum'
        using errcode = '22023';
    end if;
  elsif p_points is distinct from v_rule.default_addition then
    raise exception 'Requested points must match the fixed rule value'
      using errcode = '22023';
  end if;

  insert into public.point_addition_requests(
    student_id,
    term_id,
    positive_rule_id,
    rule_snapshot,
    requested_points,
    activity_occurred_at,
    reason,
    evidence_note,
    client_request_id,
    request_payload_hash,
    requested_by,
    requested_by_snapshot
  ) values (
    p_student_id,
    v_term.id,
    v_rule.id,
    jsonb_build_object(
      'rule_code', v_rule.rule_code,
      'category', v_rule.category,
      'title_th', v_rule.title_th,
      'description_th', v_rule.description_th,
      'default_addition', v_rule.default_addition,
      'max_addition', v_rule.max_addition,
      'is_discretionary', v_rule.is_discretionary
    ),
    p_points,
    p_activity_occurred_at,
    v_reason,
    v_evidence,
    p_client_request_id,
    v_payload_hash,
    v_uid,
    private.actor_snapshot(v_uid)
  ) returning id into v_request_id;

  perform private.write_audit(
    'request_point_addition_detailed',
    'point_addition_request',
    v_request_id::text,
    null,
    jsonb_build_object(
      'student_id', p_student_id,
      'positive_rule_id', v_rule.id,
      'requested_points', p_points,
      'activity_occurred_at', p_activity_occurred_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'requestId', v_request_id,
    'status', 'pending'
  );
end;
$$;

comment on function public.request_point_addition_detailed(
  uuid, bigint, bigint, smallint, timestamptz, text, text
) is
  'Create an idempotent teacher request tied to an effective positive-behavior rule, activity time, reason, and evidence.';

-- Replace the legacy review implementation. NULL no longer falls through to
-- approval, every decision is explained, and approval rechecks that the term,
-- enrollment, and student are still active before changing a score.
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
  v_uid uuid := (select auth.uid());
  v_request public.point_addition_requests%rowtype;
  v_account_id bigint;
  v_balance smallint;
  v_applied smallint;
  v_ledger_id bigint;
  v_review_note text := nullif(btrim(p_review_note), '');
begin
  if not private.is_admin() then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_request_id is null or p_approve is null then
    raise exception 'Request and explicit approval decision are required'
      using errcode = '22023';
  end if;

  if v_review_note is null or char_length(v_review_note) < 5 then
    raise exception 'Decision note must contain at least 5 characters'
      using errcode = '22023';
  end if;

  if char_length(v_review_note) > 2000 then
    raise exception 'Decision note is too long'
      using errcode = '22023';
  end if;

  select request.*
  into v_request
  from public.point_addition_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Request not found'
      using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Request already reviewed'
      using errcode = '55000';
  end if;

  if not p_approve then
    update public.point_addition_requests
    set status = 'rejected',
        reviewed_by = v_uid,
        reviewed_at = now(),
        review_note = v_review_note
    where id = p_request_id;

    perform private.write_audit(
      'reject_point_addition',
      'point_addition_request',
      p_request_id::text,
      to_jsonb(v_request),
      jsonb_build_object('status', 'rejected', 'note', v_review_note)
    );

    return null;
  end if;

  if v_request.positive_rule_id is null
     or v_request.rule_snapshot is null
     or jsonb_typeof(v_request.rule_snapshot) <> 'object'
     or nullif(btrim(v_request.rule_snapshot ->> 'rule_code'), '') is null
     or nullif(btrim(v_request.rule_snapshot ->> 'title_th'), '') is null
     or v_request.activity_occurred_at is null
     or nullif(btrim(v_request.evidence_note), '') is null
     or char_length(btrim(v_request.evidence_note)) < 5 then
    raise exception 'Request is missing rule, activity, or evidence details'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.academic_terms term
    join public.enrollments enrollment
      on enrollment.term_id = term.id
     and enrollment.student_id = v_request.student_id
     and enrollment.is_active
    join public.students student
      on student.id = enrollment.student_id
     and student.status = 'active'
    where term.id = v_request.term_id
      and term.status = 'active'
      and term.starts_on is not null
      and term.ends_on is not null
      and (v_request.activity_occurred_at at time zone 'Asia/Bangkok')::date
          between term.starts_on and term.ends_on
  ) then
    raise exception 'Student enrollment or academic term is no longer active'
      using errcode = '55000';
  end if;

  v_account_id := private.ensure_score_account(
    v_request.student_id,
    v_request.term_id,
    v_uid
  );

  select account.balance
  into v_balance
  from public.score_accounts account
  where account.id = v_account_id
  for update;

  v_applied := least(
    v_request.requested_points::integer,
    (100 - v_balance)::integer
  )::smallint;

  update public.score_accounts
  set balance = balance + v_applied
  where id = v_account_id;

  update public.point_addition_requests
  set status = 'approved',
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_note = v_review_note
  where id = p_request_id;

  insert into public.score_ledger(
    score_account_id,
    student_id,
    term_id,
    entry_type,
    requested_delta,
    applied_delta,
    balance_before,
    balance_after,
    addition_request_id,
    positive_rule_id,
    positive_rule_snapshot,
    activity_occurred_at,
    internal_reason,
    evidence_note,
    reason,
    actor_user_id,
    actor_snapshot
  ) values (
    v_account_id,
    v_request.student_id,
    v_request.term_id,
    'teacher_request_approved',
    v_request.requested_points,
    v_applied,
    v_balance,
    v_balance + v_applied,
    v_request.id,
    v_request.positive_rule_id,
    v_request.rule_snapshot,
    v_request.activity_occurred_at,
    v_request.reason,
    v_request.evidence_note,
    v_request.rule_snapshot ->> 'title_th',
    v_uid,
    private.actor_snapshot(v_uid)
  ) returning id into v_ledger_id;

  perform private.write_audit(
    'approve_point_addition',
    'point_addition_request',
    p_request_id::text,
    to_jsonb(v_request),
    jsonb_build_object(
      'status', 'approved',
      'decision_note', v_review_note,
      'applied_points', v_applied,
      'ledger_id', v_ledger_id
    )
  );

  return v_ledger_id;
end;
$$;

-- Administrators may add points without a teacher approval, but direct additions
-- must carry the same positive-rule provenance and evidence. Only the immutable
-- rule title is student-visible through score_ledger.reason; staff-only details
-- remain in the columns excluded from student_score_history.
create or replace function public.admin_add_points_detailed(
  p_client_request_id uuid,
  p_student_id bigint,
  p_positive_rule_id bigint,
  p_points smallint,
  p_activity_occurred_at timestamptz,
  p_reason text,
  p_evidence_note text,
  p_term_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_term public.academic_terms%rowtype;
  v_rule public.positive_behavior_rules%rowtype;
  v_rule_snapshot jsonb;
  v_account_id bigint;
  v_balance smallint;
  v_applied smallint;
  v_ledger_id bigint;
  v_existing_ledger_id bigint;
  v_existing_student_id bigint;
  v_existing_requested smallint;
  v_existing_applied smallint;
  v_existing_before smallint;
  v_existing_after smallint;
  v_existing_hash text;
  v_reason text := nullif(btrim(p_reason), '');
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_payload jsonb;
  v_payload_hash text;
  v_activity_date date;
begin
  if not private.is_admin() then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_client_request_id is null
     or p_student_id is null
     or p_student_id <= 0
     or p_positive_rule_id is null
     or p_positive_rule_id <= 0
     or p_term_id is null
     or p_term_id <= 0
     or p_activity_occurred_at is null then
    raise exception 'Request ID, student, term, positive rule, and activity time are required'
      using errcode = '22023';
  end if;

  if p_points is null or p_points not between 1 and 100 then
    raise exception 'Added points must be between 1 and 100'
      using errcode = '22023';
  end if;

  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Internal reason must contain at least 5 characters'
      using errcode = '22023';
  end if;

  if v_evidence is null or char_length(v_evidence) < 5 then
    raise exception 'Evidence must contain at least 5 characters'
      using errcode = '22023';
  end if;

  if char_length(v_reason) > 2000 or char_length(v_evidence) > 4000 then
    raise exception 'Reason or evidence is too long'
      using errcode = '22023';
  end if;

  if p_activity_occurred_at > now() + interval '5 minutes' then
    raise exception 'Activity time cannot be in the future'
      using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'student_id', p_student_id,
    'term_id', p_term_id,
    'positive_rule_id', p_positive_rule_id,
    'points', p_points,
    'activity_occurred_at_epoch', extract(epoch from p_activity_occurred_at),
    'reason', v_reason,
    'evidence_note', v_evidence
  );
  v_payload_hash := encode(
    sha256(convert_to(v_payload::text, 'UTF8')),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin-addition:' || v_uid::text || ':' || p_client_request_id::text,
      0
    )
  );

  select ledger.id,
         ledger.student_id,
         ledger.requested_delta,
         ledger.applied_delta,
         ledger.balance_before,
         ledger.balance_after,
         ledger.request_payload_hash
  into v_existing_ledger_id,
       v_existing_student_id,
       v_existing_requested,
       v_existing_applied,
       v_existing_before,
       v_existing_after,
       v_existing_hash
  from public.score_ledger ledger
  where ledger.actor_user_id = v_uid
    and ledger.client_request_id = p_client_request_id;

  if found then
    if v_existing_hash is distinct from v_payload_hash then
      raise exception 'Client request ID was already used for a different direct addition'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'ledgerId', v_existing_ledger_id,
      'studentId', v_existing_student_id,
      'requestedPoints', v_existing_requested,
      'appliedPoints', v_existing_applied,
      'balanceBefore', v_existing_before,
      'balanceAfter', v_existing_after
    );
  end if;

  select term.*
  into v_term
  from public.academic_terms term
  join public.enrollments enrollment
    on enrollment.term_id = term.id
   and enrollment.student_id = p_student_id
   and enrollment.is_active
  join public.students student
    on student.id = enrollment.student_id
   and student.status = 'active'
  where term.id = p_term_id
    and term.status = 'active'
  for share of term, enrollment, student;

  if not found then
    raise exception 'Student has no active enrollment in the active term'
      using errcode = 'P0002';
  end if;

  v_activity_date :=
    (p_activity_occurred_at at time zone 'Asia/Bangkok')::date;
  if v_term.starts_on is null
     or v_term.ends_on is null
     or v_activity_date < v_term.starts_on
     or v_activity_date > v_term.ends_on then
    raise exception 'Activity time must be inside the active term'
      using errcode = '22023';
  end if;

  select rule.*
  into v_rule
  from public.positive_behavior_rules rule
  where rule.id = p_positive_rule_id
    and rule.is_active
  for share;

  if not found then
    raise exception 'Positive behavior rule not found or inactive'
      using errcode = 'P0002';
  end if;

  if (v_rule.effective_from is not null and v_activity_date < v_rule.effective_from)
     or (v_rule.effective_to is not null and v_activity_date > v_rule.effective_to) then
    raise exception 'Positive behavior rule is not effective on the activity date'
      using errcode = '22023';
  end if;

  if v_rule.is_discretionary then
    if p_points > v_rule.max_addition then
      raise exception 'Added points exceed the rule maximum'
        using errcode = '22023';
    end if;
  elsif p_points is distinct from v_rule.default_addition then
    raise exception 'Added points must match the fixed rule value'
      using errcode = '22023';
  end if;

  v_rule_snapshot := jsonb_build_object(
    'rule_code', v_rule.rule_code,
    'category', v_rule.category,
    'title_th', v_rule.title_th,
    'description_th', v_rule.description_th,
    'default_addition', v_rule.default_addition,
    'max_addition', v_rule.max_addition,
    'is_discretionary', v_rule.is_discretionary
  );

  v_account_id := private.ensure_score_account(
    p_student_id,
    v_term.id,
    v_uid
  );

  select account.balance
  into v_balance
  from public.score_accounts account
  where account.id = v_account_id
  for update;

  v_applied := least(
    p_points::integer,
    (100 - v_balance)::integer
  )::smallint;

  update public.score_accounts
  set balance = balance + v_applied
  where id = v_account_id;

  insert into public.score_ledger(
    score_account_id,
    student_id,
    term_id,
    entry_type,
    requested_delta,
    applied_delta,
    balance_before,
    balance_after,
    positive_rule_id,
    positive_rule_snapshot,
    activity_occurred_at,
    internal_reason,
    evidence_note,
    client_request_id,
    request_payload_hash,
    reason,
    actor_user_id,
    actor_snapshot
  ) values (
    v_account_id,
    p_student_id,
    v_term.id,
    'admin_addition',
    p_points,
    v_applied,
    v_balance,
    v_balance + v_applied,
    v_rule.id,
    v_rule_snapshot,
    p_activity_occurred_at,
    v_reason,
    v_evidence,
    p_client_request_id,
    v_payload_hash,
    v_rule.title_th,
    v_uid,
    private.actor_snapshot(v_uid)
  ) returning id into v_ledger_id;

  perform private.write_audit(
    'admin_add_points_detailed',
    'score_ledger',
    v_ledger_id::text,
    null,
    jsonb_build_object(
      'student_id', p_student_id,
      'term_id', v_term.id,
      'positive_rule_id', v_rule.id,
      'activity_occurred_at', p_activity_occurred_at,
      'requested_points', p_points,
      'applied_points', v_applied,
      'balance_before', v_balance,
      'balance_after', v_balance + v_applied
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'ledgerId', v_ledger_id,
    'studentId', p_student_id,
    'requestedPoints', p_points,
    'appliedPoints', v_applied,
    'balanceBefore', v_balance,
    'balanceAfter', v_balance + v_applied
  );
end;
$$;

comment on function public.admin_add_points_detailed(
  uuid, bigint, bigint, smallint, timestamptz, text, text, bigint
) is
  'Add points directly as an administrator with an effective positive rule, staff-only reason/evidence, score cap, and UUID idempotency.';

-- The legacy teacher-addition endpoint lacks a positive rule, activity time,
-- evidence requirement, and idempotency key; keep it only for historical schema
-- compatibility and remove every API role's EXECUTE privilege.
revoke all on function public.request_point_addition(bigint, smallint, text, text)
from public, anon, authenticated, service_role;

-- The legacy single-student deduction endpoint omits idempotency and the new
-- detail/effective-date checks. record_deductions_bulk can still invoke it as
-- the SECURITY DEFINER owner after all frontend roles lose direct EXECUTE.
revoke all on function public.record_deduction(
  bigint, bigint, timestamptz, text, text
) from public, anon, authenticated, service_role;

-- The legacy direct-admin endpoint lacks positive-rule provenance, evidence,
-- activity time, and idempotency, so it is no longer an API entry point.
revoke all on function public.admin_add_points(bigint, smallint, text, bigint)
from public, anon, authenticated, service_role;

revoke all on function public.record_deductions_bulk(
  uuid, text, bigint[], bigint, bigint, timestamptz, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.record_deductions_bulk(
  uuid, text, bigint[], bigint, bigint, timestamptz, text, text, boolean
) to authenticated;

revoke all on function public.request_point_addition_detailed(
  uuid, bigint, bigint, smallint, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_point_addition_detailed(
  uuid, bigint, bigint, smallint, timestamptz, text, text
) to authenticated;

revoke all on function public.review_point_addition(bigint, boolean, text)
from public, anon, authenticated, service_role;
grant execute on function public.review_point_addition(bigint, boolean, text)
to authenticated;

revoke all on function public.admin_add_points_detailed(
  uuid, bigint, bigint, smallint, timestamptz, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_points_detailed(
  uuid, bigint, bigint, smallint, timestamptz, text, text, bigint
) to authenticated;

revoke all on table private.deduction_batches
from public, anon, authenticated, service_role;
revoke all on sequence private.deduction_batches_id_seq
from public, anon, authenticated, service_role;

commit;
