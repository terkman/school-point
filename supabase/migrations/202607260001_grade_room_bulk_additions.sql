begin;

-- One private header makes teacher requests and administrator additions
-- idempotent and auditable as an exact reviewed roster. Individual requests and
-- ledger rows remain the public/RLS-protected sources of truth.
create table private.addition_batches (
  id bigint generated always as identity primary key,
  client_request_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_snapshot text not null,
  operation text not null check (operation in ('teacher_request', 'admin_direct')),
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  scope text not null check (scope in ('single', 'selected', 'classroom')),
  classroom_id bigint not null references public.classrooms(id) on delete restrict,
  target_student_ids bigint[] not null,
  target_count smallint not null check (target_count between 1 and 100),
  positive_rule_id bigint not null references public.positive_behavior_rules(id) on delete restrict,
  positive_rule_snapshot jsonb not null check (jsonb_typeof(positive_rule_snapshot) = 'object'),
  requested_points_each smallint not null check (requested_points_each between 1 and 100),
  activity_occurred_at timestamptz not null,
  internal_reason text not null check (char_length(btrim(internal_reason)) between 5 and 2000),
  evidence_note text not null check (char_length(btrim(evidence_note)) between 5 and 4000),
  payload_hash text not null check (char_length(payload_hash) = 64),
  total_applied_points integer not null default 0 check (total_applied_points between 0 and 10000),
  result_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(result_summary) = 'object'),
  created_at timestamptz not null default now(),
  unique (created_by, client_request_id),
  check (target_count = cardinality(target_student_ids)),
  check (array_position(target_student_ids, null) is null),
  check (scope <> 'single' or target_count = 1),
  check (scope <> 'selected' or target_count >= 2)
);

comment on table private.addition_batches is
  'Private idempotency and audit header for one exact teacher-request or administrator-addition roster.';

alter table private.addition_batches enable row level security;
alter table private.addition_batches force row level security;

create index addition_batches_term_created_idx
  on private.addition_batches (term_id, created_at desc);

alter table public.point_addition_requests
  add column addition_batch_id bigint
    references private.addition_batches(id) on delete restrict;

create unique index point_requests_batch_student_idx
  on public.point_addition_requests (addition_batch_id, student_id)
  where addition_batch_id is not null;

alter table public.score_ledger
  add column addition_batch_id bigint
    references private.addition_batches(id) on delete restrict;

create unique index score_ledger_addition_batch_student_idx
  on public.score_ledger (addition_batch_id, student_id)
  where addition_batch_id is not null;

create or replace function public.request_point_additions_bulk(
  p_client_request_id uuid,
  p_scope text,
  p_student_ids bigint[],
  p_classroom_id bigint,
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
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_target_ids bigint[];
  v_input_count integer := coalesce(cardinality(p_student_ids), 0);
  v_target_count integer;
  v_authorized_count bigint;
  v_enrollment_count bigint;
  v_term public.academic_terms%rowtype;
  v_rule public.positive_behavior_rules%rowtype;
  v_rule_snapshot jsonb;
  v_existing private.addition_batches%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_activity_date date;
  v_roster bigint[];
  v_payload jsonb;
  v_payload_hash text;
  v_batch_id bigint;
  v_student_id bigint;
  v_request_id bigint;
  v_results jsonb := '[]'::jsonb;
  v_summary jsonb;
begin
  if private.current_role() is distinct from 'teacher'::public.app_role then
    raise exception 'Teacher permission required'
      using errcode = '42501';
  end if;

  if p_client_request_id is null
     or p_classroom_id is null
     or p_classroom_id <= 0
     or p_positive_rule_id is null
     or p_positive_rule_id <= 0
     or p_activity_occurred_at is null then
    raise exception 'Request ID, classroom, positive rule, and activity time are required'
      using errcode = '22023';
  end if;

  if v_scope not in ('single', 'selected', 'classroom') then
    raise exception 'Addition scope is invalid'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(target_id order by target_id), array[]::bigint[])
  into v_target_ids
  from (
    select distinct student_id as target_id
    from unnest(coalesce(p_student_ids, array[]::bigint[])) student_id
    where student_id is not null and student_id > 0
  ) targets;

  v_target_count := cardinality(v_target_ids);
  if v_target_count < 1 or v_target_count > 100 or v_input_count <> v_target_count then
    raise exception 'Student list must contain 1 to 100 unique valid students'
      using errcode = '22023';
  end if;
  if v_scope = 'single' and v_target_count <> 1 then
    raise exception 'Single scope requires exactly one student'
      using errcode = '22023';
  end if;
  if v_scope = 'selected' and v_target_count < 2 then
    raise exception 'Selected scope requires at least two students'
      using errcode = '22023';
  end if;

  if p_points is null or p_points not between 1 and 100 then
    raise exception 'Requested points must be between 1 and 100'
      using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 5
     or v_evidence is null or char_length(v_evidence) < 5 then
    raise exception 'Reason and evidence must contain at least 5 characters'
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
    'scope', v_scope,
    'classroom_id', p_classroom_id,
    'target_student_ids', to_jsonb(v_target_ids),
    'positive_rule_id', p_positive_rule_id,
    'points', p_points,
    'activity_occurred_at_epoch', extract(epoch from p_activity_occurred_at),
    'reason', v_reason,
    'evidence_note', v_evidence
  );
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'addition-batch:' || v_uid::text || ':' || p_client_request_id::text,
      0
    )
  );

  select batch.*
  into v_existing
  from private.addition_batches batch
  where batch.created_by = v_uid
    and batch.client_request_id = p_client_request_id;

  if found then
    if v_existing.operation <> 'teacher_request'
       or v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'Client request ID was already used for a different addition batch'
        using errcode = '22023';
    end if;

    select count(*)
    into v_authorized_count
    from unnest(v_existing.target_student_ids) student_id
    where private.teacher_has_student(student_id, v_existing.term_id);

    if v_authorized_count <> v_existing.target_count then
      raise exception 'Teacher is no longer assigned to every request student'
        using errcode = '42501';
    end if;

    return v_existing.result_summary || jsonb_build_object('replayed', true);
  end if;

  select term.*
  into v_term
  from public.academic_terms term
  join public.classrooms classroom
    on classroom.term_id = term.id
   and classroom.id = p_classroom_id
   and classroom.is_active
  where term.status = 'active'
  for share of term, classroom;

  if not found then
    raise exception 'Classroom is not active in the active term'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.enrollments enrollment
  join public.students student
    on student.id = enrollment.student_id
   and student.status = 'active'
  where enrollment.term_id = v_term.id
    and enrollment.classroom_id = p_classroom_id
    and enrollment.student_id = any(v_target_ids)
    and enrollment.is_active
  order by enrollment.student_id
  for share of enrollment, student;

  select count(*)
  into v_enrollment_count
  from public.enrollments enrollment
  join public.students student
    on student.id = enrollment.student_id
   and student.status = 'active'
  where enrollment.term_id = v_term.id
    and enrollment.classroom_id = p_classroom_id
    and enrollment.student_id = any(v_target_ids)
    and enrollment.is_active;

  if v_enrollment_count <> v_target_count then
    raise exception 'Every selected student must be active in the selected classroom'
      using errcode = '22023';
  end if;

  if v_scope = 'classroom' then
    select coalesce(array_agg(enrollment.student_id order by enrollment.student_id), array[]::bigint[])
    into v_roster
    from public.enrollments enrollment
    join public.students student
      on student.id = enrollment.student_id
     and student.status = 'active'
    where enrollment.term_id = v_term.id
      and enrollment.classroom_id = p_classroom_id
      and enrollment.is_active;

    if v_roster is distinct from v_target_ids then
      raise exception 'Classroom roster changed; review the current roster and try again'
        using errcode = '40001';
    end if;
  end if;

  select count(*)
  into v_authorized_count
  from unnest(v_target_ids) student_id
  where private.teacher_has_student(student_id, v_term.id);

  if v_authorized_count <> v_target_count then
    raise exception 'Teacher is not assigned to every selected student'
      using errcode = '42501';
  end if;

  v_activity_date := (p_activity_occurred_at at time zone 'Asia/Bangkok')::date;
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

  v_rule_snapshot := jsonb_build_object(
    'rule_code', v_rule.rule_code,
    'category', v_rule.category,
    'title_th', v_rule.title_th,
    'description_th', v_rule.description_th,
    'default_addition', v_rule.default_addition,
    'max_addition', v_rule.max_addition,
    'is_discretionary', v_rule.is_discretionary
  );

  insert into private.addition_batches(
    client_request_id,
    created_by,
    created_by_snapshot,
    operation,
    term_id,
    scope,
    classroom_id,
    target_student_ids,
    target_count,
    positive_rule_id,
    positive_rule_snapshot,
    requested_points_each,
    activity_occurred_at,
    internal_reason,
    evidence_note,
    payload_hash
  ) values (
    p_client_request_id,
    v_uid,
    private.actor_snapshot(v_uid),
    'teacher_request',
    v_term.id,
    v_scope,
    p_classroom_id,
    v_target_ids,
    v_target_count,
    v_rule.id,
    v_rule_snapshot,
    p_points,
    p_activity_occurred_at,
    v_reason,
    v_evidence,
    v_payload_hash
  ) returning id into v_batch_id;

  foreach v_student_id in array v_target_ids loop
    insert into public.point_addition_requests(
      student_id,
      term_id,
      positive_rule_id,
      rule_snapshot,
      requested_points,
      activity_occurred_at,
      reason,
      evidence_note,
      requested_by,
      requested_by_snapshot,
      addition_batch_id
    ) values (
      v_student_id,
      v_term.id,
      v_rule.id,
      v_rule_snapshot,
      p_points,
      p_activity_occurred_at,
      v_reason,
      v_evidence,
      v_uid,
      private.actor_snapshot(v_uid),
      v_batch_id
    ) returning id into v_request_id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'studentId', v_student_id,
      'requestId', v_request_id,
      'status', 'pending'
    ));
  end loop;

  v_summary := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'batchId', v_batch_id,
    'scope', v_scope,
    'classroomId', p_classroom_id,
    'targetCount', v_target_count,
    'requestedPointsEach', p_points,
    'requests', v_results
  );

  update private.addition_batches
  set result_summary = v_summary
  where id = v_batch_id;

  perform private.write_audit(
    'request_point_additions_bulk',
    'addition_batch',
    v_batch_id::text,
    null,
    jsonb_build_object(
      'operation', 'teacher_request',
      'scope', v_scope,
      'classroom_id', p_classroom_id,
      'target_student_ids', to_jsonb(v_target_ids),
      'target_count', v_target_count,
      'positive_rule_id', v_rule.id,
      'requested_points_each', p_points
    )
  );

  return v_summary;
end;
$$;

comment on function public.request_point_additions_bulk(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text
) is
  'Atomically create one separately reviewable teacher addition request per student in an exact classroom-scoped roster.';

create or replace function public.admin_add_points_bulk(
  p_client_request_id uuid,
  p_scope text,
  p_student_ids bigint[],
  p_classroom_id bigint,
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
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_target_ids bigint[];
  v_input_count integer := coalesce(cardinality(p_student_ids), 0);
  v_target_count integer;
  v_enrollment_count bigint;
  v_term public.academic_terms%rowtype;
  v_rule public.positive_behavior_rules%rowtype;
  v_rule_snapshot jsonb;
  v_existing private.addition_batches%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_activity_date date;
  v_roster bigint[];
  v_payload jsonb;
  v_payload_hash text;
  v_batch_id bigint;
  v_student_id bigint;
  v_account_id bigint;
  v_balance smallint;
  v_applied smallint;
  v_ledger_id bigint;
  v_total_applied integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_summary jsonb;
begin
  if not private.is_admin() then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_client_request_id is null
     or p_classroom_id is null
     or p_classroom_id <= 0
     or p_positive_rule_id is null
     or p_positive_rule_id <= 0
     or p_term_id is null
     or p_term_id <= 0
     or p_activity_occurred_at is null then
    raise exception 'Request ID, classroom, term, positive rule, and activity time are required'
      using errcode = '22023';
  end if;
  if v_scope not in ('single', 'selected', 'classroom') then
    raise exception 'Addition scope is invalid'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(target_id order by target_id), array[]::bigint[])
  into v_target_ids
  from (
    select distinct student_id as target_id
    from unnest(coalesce(p_student_ids, array[]::bigint[])) student_id
    where student_id is not null and student_id > 0
  ) targets;

  v_target_count := cardinality(v_target_ids);
  if v_target_count < 1 or v_target_count > 100 or v_input_count <> v_target_count then
    raise exception 'Student list must contain 1 to 100 unique valid students'
      using errcode = '22023';
  end if;
  if v_scope = 'single' and v_target_count <> 1 then
    raise exception 'Single scope requires exactly one student'
      using errcode = '22023';
  end if;
  if v_scope = 'selected' and v_target_count < 2 then
    raise exception 'Selected scope requires at least two students'
      using errcode = '22023';
  end if;
  if p_points is null or p_points not between 1 and 100 then
    raise exception 'Added points must be between 1 and 100'
      using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 5
     or v_evidence is null or char_length(v_evidence) < 5 then
    raise exception 'Reason and evidence must contain at least 5 characters'
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
    'scope', v_scope,
    'classroom_id', p_classroom_id,
    'target_student_ids', to_jsonb(v_target_ids),
    'term_id', p_term_id,
    'positive_rule_id', p_positive_rule_id,
    'points', p_points,
    'activity_occurred_at_epoch', extract(epoch from p_activity_occurred_at),
    'reason', v_reason,
    'evidence_note', v_evidence
  );
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin-addition-batch:' || v_uid::text || ':' || p_client_request_id::text,
      0
    )
  );

  select batch.*
  into v_existing
  from private.addition_batches batch
  where batch.created_by = v_uid
    and batch.client_request_id = p_client_request_id;

  if found then
    if v_existing.operation <> 'admin_direct'
       or v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'Client request ID was already used for a different addition batch'
        using errcode = '22023';
    end if;
    return v_existing.result_summary || jsonb_build_object('replayed', true);
  end if;

  select term.*
  into v_term
  from public.academic_terms term
  join public.classrooms classroom
    on classroom.term_id = term.id
   and classroom.id = p_classroom_id
   and classroom.is_active
  where term.id = p_term_id
    and term.status = 'active'
  for share of term, classroom;

  if not found then
    raise exception 'Classroom is not active in the requested term'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.enrollments enrollment
  join public.students student
    on student.id = enrollment.student_id
   and student.status = 'active'
  where enrollment.term_id = v_term.id
    and enrollment.classroom_id = p_classroom_id
    and enrollment.student_id = any(v_target_ids)
    and enrollment.is_active
  order by enrollment.student_id
  for share of enrollment, student;

  select count(*)
  into v_enrollment_count
  from public.enrollments enrollment
  join public.students student
    on student.id = enrollment.student_id
   and student.status = 'active'
  where enrollment.term_id = v_term.id
    and enrollment.classroom_id = p_classroom_id
    and enrollment.student_id = any(v_target_ids)
    and enrollment.is_active;

  if v_enrollment_count <> v_target_count then
    raise exception 'Every selected student must be active in the selected classroom'
      using errcode = '22023';
  end if;

  if v_scope = 'classroom' then
    select coalesce(array_agg(enrollment.student_id order by enrollment.student_id), array[]::bigint[])
    into v_roster
    from public.enrollments enrollment
    join public.students student
      on student.id = enrollment.student_id
     and student.status = 'active'
    where enrollment.term_id = v_term.id
      and enrollment.classroom_id = p_classroom_id
      and enrollment.is_active;

    if v_roster is distinct from v_target_ids then
      raise exception 'Classroom roster changed; review the current roster and try again'
        using errcode = '40001';
    end if;
  end if;

  v_activity_date := (p_activity_occurred_at at time zone 'Asia/Bangkok')::date;
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

  insert into private.addition_batches(
    client_request_id,
    created_by,
    created_by_snapshot,
    operation,
    term_id,
    scope,
    classroom_id,
    target_student_ids,
    target_count,
    positive_rule_id,
    positive_rule_snapshot,
    requested_points_each,
    activity_occurred_at,
    internal_reason,
    evidence_note,
    payload_hash
  ) values (
    p_client_request_id,
    v_uid,
    private.actor_snapshot(v_uid),
    'admin_direct',
    v_term.id,
    v_scope,
    p_classroom_id,
    v_target_ids,
    v_target_count,
    v_rule.id,
    v_rule_snapshot,
    p_points,
    p_activity_occurred_at,
    v_reason,
    v_evidence,
    v_payload_hash
  ) returning id into v_batch_id;

  foreach v_student_id in array v_target_ids loop
    v_account_id := private.ensure_score_account(v_student_id, v_term.id, v_uid);

    select account.balance
    into v_balance
    from public.score_accounts account
    where account.id = v_account_id
    for update;

    v_applied := least(p_points::integer, (100 - v_balance)::integer)::smallint;

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
      reason,
      actor_user_id,
      actor_snapshot,
      addition_batch_id
    ) values (
      v_account_id,
      v_student_id,
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
      v_rule.title_th,
      v_uid,
      private.actor_snapshot(v_uid),
      v_batch_id
    ) returning id into v_ledger_id;

    v_total_applied := v_total_applied + v_applied;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'ledgerId', v_ledger_id,
      'studentId', v_student_id,
      'requestedPoints', p_points,
      'appliedPoints', v_applied,
      'balanceBefore', v_balance,
      'balanceAfter', v_balance + v_applied
    ));
  end loop;

  v_summary := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'batchId', v_batch_id,
    'scope', v_scope,
    'classroomId', p_classroom_id,
    'targetCount', v_target_count,
    'requestedPointsEach', p_points,
    'totalAppliedPoints', v_total_applied,
    'results', v_results
  );

  update private.addition_batches
  set total_applied_points = v_total_applied,
      result_summary = v_summary
  where id = v_batch_id;

  perform private.write_audit(
    'admin_add_points_bulk',
    'addition_batch',
    v_batch_id::text,
    null,
    jsonb_build_object(
      'operation', 'admin_direct',
      'scope', v_scope,
      'classroom_id', p_classroom_id,
      'target_student_ids', to_jsonb(v_target_ids),
      'target_count', v_target_count,
      'positive_rule_id', v_rule.id,
      'requested_points_each', p_points,
      'total_applied_points', v_total_applied
    )
  );

  return v_summary;
end;
$$;

comment on function public.admin_add_points_bulk(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text, bigint
) is
  'Atomically add points as an administrator to an exact classroom-scoped roster with score caps, evidence, audit, and UUID idempotency.';

revoke all on function public.request_point_additions_bulk(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_point_additions_bulk(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text
) to authenticated;

revoke all on function public.admin_add_points_bulk(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_points_bulk(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text, bigint
) to authenticated;

revoke all on table private.addition_batches
from public, anon, authenticated, service_role;
revoke all on sequence private.addition_batches_id_seq
from public, anon, authenticated, service_role;

commit;
