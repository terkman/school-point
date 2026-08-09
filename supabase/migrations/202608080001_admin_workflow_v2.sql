begin;

-- Administrator workflow v2 keeps every score mutation append-only while adding
-- adjusted approvals, partial appeal decisions, and structured guardian contact
-- attempts. Existing RPCs remain available during the client rollout.

alter table public.point_addition_requests
  add column if not exists approved_points smallint;

update public.point_addition_requests
set approved_points = requested_points
where status = 'approved'
  and approved_points is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'point_requests_approved_points_policy'
      and conrelid = 'public.point_addition_requests'::regclass
  ) then
    alter table public.point_addition_requests
      add constraint point_requests_approved_points_policy
      check (
        (status = 'pending' and approved_points is null)
        or (status = 'rejected' and approved_points is null)
        or (status = 'approved' and approved_points between 1 and 100)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'point_requests_decision_note_policy'
      and conrelid = 'public.point_addition_requests'::regclass
  ) then
    alter table public.point_addition_requests
      add constraint point_requests_decision_note_policy
      check (
        status = 'pending'
        or (
          status = 'rejected'
          and char_length(btrim(coalesce(review_note, ''))) between 5 and 2000
        )
        or (
          status = 'approved'
          and (
            approved_points = requested_points
            or char_length(btrim(coalesce(review_note, ''))) between 5 and 2000
          )
        )
      );
  end if;
end;
$$;

create index if not exists point_requests_pending_queue_idx
  on public.point_addition_requests(created_at, id)
  where status = 'pending';

-- Teacher evidence is optional. Administrator direct additions keep their
-- stricter evidence requirement. The UI stores the rule title as the neutral
-- reason when the teacher does not enter a free-form description.
alter table private.addition_batches
  drop constraint if exists addition_batches_evidence_note_check;
alter table private.addition_batches
  alter column evidence_note drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'addition_batches_evidence_policy'
      and conrelid = 'private.addition_batches'::regclass
  ) then
    alter table private.addition_batches
      add constraint addition_batches_evidence_policy
      check (
        (
          operation = 'teacher_request'
          and (
            evidence_note is null
            or char_length(btrim(evidence_note)) between 1 and 4000
          )
        )
        or (
          operation = 'admin_direct'
          and evidence_note is not null
          and char_length(btrim(coalesce(evidence_note, ''))) between 5 and 4000
        )
      );
  end if;
end;
$$;

alter table public.appeals
  add column if not exists restored_points smallint,
  add column if not exists public_explanation text,
  add column if not exists review_version smallint not null default 0,
  add column if not exists reopened_by uuid references auth.users(id) on delete set null,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopen_reason text;

update public.appeals appeal
set restored_points = case
      when appeal.status = 'accepted' then coalesce(
        (
          select ledger.requested_delta
          from public.score_ledger ledger
          where ledger.incident_id = appeal.incident_id
            and ledger.entry_type = 'appeal_reversal'
          order by ledger.id desc
          limit 1
        ),
        incident.applied_points
      )
      else 0
    end,
    public_explanation = coalesce(
      nullif(btrim(appeal.decision_note), ''),
      case when appeal.status in ('accepted', 'rejected')
        then 'ผลการพิจารณาตามข้อมูลเดิมของโรงเรียน'
        else null
      end
    ),
    review_version = case
      when appeal.status in ('accepted', 'rejected') then greatest(appeal.review_version, 1)
      else appeal.review_version
    end
from public.incidents incident
where incident.id = appeal.incident_id
  and (
    appeal.restored_points is null
    or (appeal.status in ('accepted', 'rejected') and appeal.public_explanation is null)
    or (appeal.status in ('accepted', 'rejected') and appeal.review_version = 0)
  );

update public.appeals
set restored_points = 0
where restored_points is null;

alter table public.appeals
  alter column restored_points set default 0,
  alter column restored_points set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appeals_v2_decision_policy'
      and conrelid = 'public.appeals'::regclass
  ) then
    alter table public.appeals
      add constraint appeals_v2_decision_policy
      check (
        restored_points between 0 and 100
        and review_version >= 0
        and (
          status not in ('accepted', 'rejected')
          or (
            char_length(btrim(coalesce(public_explanation, ''))) between 5 and 2000
            and (
              (status = 'accepted' and restored_points between 1 and 100)
              or (status = 'rejected' and restored_points = 0)
            )
          )
        )
        and (
          reopened_at is null
          or (
            reopened_by is not null
            and char_length(btrim(coalesce(reopen_reason, ''))) between 5 and 2000
          )
        )
      );
  end if;
end;
$$;

create index if not exists appeals_open_queue_idx
  on public.appeals(created_at, id)
  where status in ('submitted', 'reviewing');
create index if not exists appeals_reopened_by_idx
  on public.appeals(reopened_by)
  where reopened_by is not null;

create table if not exists private.appeal_decisions (
  id bigint generated always as identity primary key,
  appeal_id bigint not null references public.appeals(id) on delete restrict,
  version smallint not null check (version > 0),
  outcome text not null check (outcome in ('accepted', 'rejected')),
  restored_points smallint not null check (restored_points between 0 and 100),
  requested_score_delta smallint not null check (requested_score_delta between -100 and 100),
  applied_score_delta smallint not null check (applied_score_delta between -100 and 100),
  public_explanation text not null check (char_length(btrim(public_explanation)) between 5 and 2000),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  unique (appeal_id, version),
  check (
    (outcome = 'accepted' and restored_points between 1 and 100)
    or (outcome = 'rejected' and restored_points = 0)
  )
);

create index if not exists appeal_decisions_decider_date_idx
  on private.appeal_decisions(decided_by, decided_at desc)
  where decided_by is not null;

insert into private.appeal_decisions(
  appeal_id,
  version,
  outcome,
  restored_points,
  requested_score_delta,
  applied_score_delta,
  public_explanation,
  decided_by,
  decided_at
)
select appeal.id,
       greatest(appeal.review_version, 1),
       case when appeal.status = 'accepted' then 'accepted' else 'rejected' end,
       appeal.restored_points,
       case when appeal.status = 'accepted' then appeal.restored_points else 0 end,
       coalesce(
         (
           select ledger.applied_delta
           from public.score_ledger ledger
           where ledger.incident_id = appeal.incident_id
             and ledger.entry_type = 'appeal_reversal'
           order by ledger.id desc
           limit 1
         ),
         0
       ),
       appeal.public_explanation,
       appeal.decided_by,
       coalesce(appeal.decided_at, appeal.created_at)
from public.appeals appeal
where appeal.status in ('accepted', 'rejected')
on conflict (appeal_id, version) do nothing;

drop trigger if exists appeal_decisions_immutable
  on private.appeal_decisions;
create trigger appeal_decisions_immutable
before update or delete on private.appeal_decisions
for each row execute function private.reject_immutable_change();

alter table public.guardian_contact_tasks
  add column if not exists next_reminder_at timestamptz;

update public.guardian_contact_tasks
set next_reminder_at = case
  when status = 'pending' then coalesce(next_reminder_at, created_at + interval '24 hours')
  else null
end;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'guardian_tasks_reminder_policy'
      and conrelid = 'public.guardian_contact_tasks'::regclass
  ) then
    alter table public.guardian_contact_tasks
      add constraint guardian_tasks_reminder_policy
      check (
        (status = 'pending' and next_reminder_at is not null and completed_at is null)
        or (status = 'completed' and next_reminder_at is null and completed_at is not null)
        or (status = 'cancelled' and next_reminder_at is null)
      );
  end if;
end;
$$;

create index if not exists guardian_tasks_due_reminder_idx
  on public.guardian_contact_tasks(next_reminder_at, id)
  where status = 'pending';

create table if not exists private.guardian_contact_attempts (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.guardian_contact_tasks(id) on delete restrict,
  channel text not null check (channel in ('phone', 'line', 'messenger', 'sms')),
  outcome text not null check (outcome in (
    'answered',
    'unanswered',
    'sent_waiting',
    'read_or_replied',
    'sent'
  )),
  closes_notification boolean not null,
  note text check (note is null or char_length(btrim(note)) between 1 and 2000),
  evidence_note text check (evidence_note is null or char_length(btrim(evidence_note)) between 1 and 500),
  attempted_by uuid references auth.users(id) on delete set null,
  attempted_by_snapshot text not null,
  attempted_at timestamptz not null default now(),
  check (
    (channel = 'phone' and outcome in ('answered', 'unanswered'))
    or (channel in ('line', 'messenger') and outcome in ('sent_waiting', 'read_or_replied'))
    or (channel = 'sms' and outcome = 'sent')
  ),
  check (
    closes_notification = (
      (channel = 'phone' and outcome = 'answered')
      or (channel in ('line', 'messenger') and outcome = 'read_or_replied')
      or (channel = 'sms' and outcome = 'sent')
    )
  )
);

create index if not exists guardian_attempts_task_date_idx
  on private.guardian_contact_attempts(task_id, attempted_at desc, id desc);
create index if not exists guardian_attempts_actor_date_idx
  on private.guardian_contact_attempts(attempted_by, attempted_at desc)
  where attempted_by is not null;

drop trigger if exists guardian_contact_attempts_immutable
  on private.guardian_contact_attempts;
create trigger guardian_contact_attempts_immutable
before update or delete on private.guardian_contact_attempts
for each row execute function private.reject_immutable_change();

revoke all on table private.appeal_decisions, private.guardian_contact_attempts
from public, anon, authenticated, service_role;
revoke all on sequence private.appeal_decisions_id_seq, private.guardian_contact_attempts_id_seq
from public, anon, authenticated, service_role;

commit;

begin;

-- Teachers retain operational score history for assigned students, but appeal
-- decision entries are intentionally absent. Current balances still remain
-- visible because they are needed for day-to-day student support.
drop policy if exists ledger_staff_select on public.score_ledger;
drop policy if exists ledger_staff_select_v2 on public.score_ledger;
create policy ledger_staff_select_v2
on public.score_ledger
for select
to authenticated
using (
  (select private.is_admin())
  or (
    entry_type not in ('appeal_reversal', 'appeal_adjustment')
    and private.teacher_has_student(student_id, term_id)
  )
);

-- Transitional request wrappers preserve the existing validation/idempotency
-- implementation while allowing an omitted description and omitted evidence.
-- Placeholder transport values are removed before the transaction commits.
create or replace function public.request_point_addition_v2(
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
  v_reason text;
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_result jsonb;
  v_request_id bigint;
begin
  select coalesce(
    nullif(btrim(p_reason), ''),
    nullif(btrim(rule.title_th), ''),
    'ไม่ได้ระบุรายละเอียด'
  )
  into v_reason
  from public.positive_behavior_rules rule
  where rule.id = p_positive_rule_id;

  v_reason := coalesce(v_reason, nullif(btrim(p_reason), ''), 'ไม่ได้ระบุรายละเอียด');

  v_result := public.request_point_addition_detailed(
    p_client_request_id,
    p_student_id,
    p_positive_rule_id,
    p_points,
    p_activity_occurred_at,
    v_reason,
    coalesce(v_evidence, 'ไม่มีหลักฐานแนบ')
  );

  v_request_id := (v_result ->> 'requestId')::bigint;
  if v_evidence is null then
    update public.point_addition_requests
    set evidence_note = null
    where id = v_request_id;
  end if;

  return v_result;
end;
$$;

create or replace function public.request_point_additions_bulk_v2(
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
  v_reason text;
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_result jsonb;
  v_batch_id bigint;
begin
  select coalesce(
    nullif(btrim(p_reason), ''),
    nullif(btrim(rule.title_th), ''),
    'ไม่ได้ระบุรายละเอียด'
  )
  into v_reason
  from public.positive_behavior_rules rule
  where rule.id = p_positive_rule_id;

  v_reason := coalesce(v_reason, nullif(btrim(p_reason), ''), 'ไม่ได้ระบุรายละเอียด');

  v_result := public.request_point_additions_bulk(
    p_client_request_id,
    p_scope,
    p_student_ids,
    p_classroom_id,
    p_positive_rule_id,
    p_points,
    p_activity_occurred_at,
    v_reason,
    coalesce(v_evidence, 'ไม่มีหลักฐานแนบ')
  );

  v_batch_id := (v_result ->> 'batchId')::bigint;
  if v_evidence is null then
    update public.point_addition_requests
    set evidence_note = null
    where addition_batch_id = v_batch_id;

    update private.addition_batches
    set evidence_note = null
    where id = v_batch_id;
  end if;

  return v_result;
end;
$$;

create or replace function public.review_point_addition_v2(
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
  v_request public.point_addition_requests%rowtype;
  v_account_id bigint;
  v_balance smallint;
  v_applied smallint;
  v_ledger_id bigint;
  v_review_note text := nullif(btrim(p_review_note), '');
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_request_id is null or p_approve is null then
    raise exception 'Request and explicit approval decision are required'
      using errcode = '22023';
  end if;

  if v_review_note is not null and char_length(v_review_note) > 2000 then
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
    if v_review_note is null or char_length(v_review_note) < 5 then
      raise exception 'Rejection reason must contain at least 5 characters'
        using errcode = '22023';
    end if;

    update public.point_addition_requests
    set status = 'rejected',
        approved_points = null,
        reviewed_by = v_uid,
        reviewed_at = now(),
        review_note = v_review_note
    where id = p_request_id;

    perform private.write_audit(
      'reject_point_addition_v2',
      'point_addition_request',
      p_request_id::text,
      to_jsonb(v_request),
      jsonb_build_object('status', 'rejected', 'note', v_review_note)
    );

    return jsonb_build_object(
      'ok', true,
      'requestId', p_request_id,
      'status', 'rejected',
      'approvedPoints', null
    );
  end if;

  if p_approved_points is null or p_approved_points not between 1 and 100 then
    raise exception 'Approved points must be between 1 and 100'
      using errcode = '22023';
  end if;

  if p_approved_points <> v_request.requested_points
     and (v_review_note is null or char_length(v_review_note) < 5) then
    raise exception 'Adjustment reason must contain at least 5 characters'
      using errcode = '22023';
  end if;

  if v_request.positive_rule_id is null
     or v_request.rule_snapshot is null
     or jsonb_typeof(v_request.rule_snapshot) <> 'object'
     or nullif(btrim(v_request.rule_snapshot ->> 'rule_code'), '') is null
     or nullif(btrim(v_request.rule_snapshot ->> 'title_th'), '') is null
     or v_request.activity_occurred_at is null then
    raise exception 'Request is missing rule or activity details'
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
    p_approved_points::integer,
    (100 - v_balance)::integer
  )::smallint;

  update public.score_accounts
  set balance = balance + v_applied
  where id = v_account_id;

  update public.point_addition_requests
  set status = 'approved',
      approved_points = p_approved_points,
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
    p_approved_points,
    v_applied,
    v_balance,
    v_balance + v_applied,
    v_request.id,
    v_request.positive_rule_id,
    v_request.rule_snapshot,
    v_request.activity_occurred_at,
    v_request.reason,
    v_request.evidence_note,
    coalesce(v_request.rule_snapshot ->> 'title_th', 'เพิ่มคะแนนตามคำขอของครู'),
    v_uid,
    private.actor_snapshot(v_uid)
  ) returning id into v_ledger_id;

  perform private.write_audit(
    'approve_point_addition_v2',
    'point_addition_request',
    p_request_id::text,
    to_jsonb(v_request),
    jsonb_build_object(
      'status', 'approved',
      'requested_points', v_request.requested_points,
      'approved_points', p_approved_points,
      'decision_note', v_review_note,
      'applied_points', v_applied,
      'ledger_id', v_ledger_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'requestId', p_request_id,
    'status', 'approved',
    'approvedPoints', p_approved_points,
    'appliedPoints', v_applied,
    'ledgerId', v_ledger_id
  );
end;
$$;

create or replace function public.review_appeal_v2(
  p_appeal_id bigint,
  p_restored_points smallint,
  p_public_explanation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appeal public.appeals%rowtype;
  v_incident public.incidents%rowtype;
  v_account_id bigint;
  v_balance smallint;
  v_old_restored smallint;
  v_requested_delta smallint;
  v_applied_delta smallint;
  v_version smallint;
  v_outcome text;
  v_explanation text := nullif(btrim(p_public_explanation), '');
  v_decision_id bigint;
  v_ledger_id bigint;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_appeal_id is null
     or p_restored_points is null
     or p_restored_points not between 0 and 100 then
    raise exception 'Appeal and restored points from 0 to 100 are required'
      using errcode = '22023';
  end if;

  if v_explanation is null or char_length(v_explanation) not between 5 and 2000 then
    raise exception 'Public explanation must contain 5 to 2000 characters'
      using errcode = '22023';
  end if;

  select appeal.*
  into v_appeal
  from public.appeals appeal
  where appeal.id = p_appeal_id
  for update;

  if not found then
    raise exception 'Appeal not found'
      using errcode = 'P0002';
  end if;

  if v_appeal.status not in ('submitted', 'reviewing') then
    raise exception 'Appeal already decided; reopen it before another decision'
      using errcode = '55000';
  end if;

  select incident.*
  into v_incident
  from public.incidents incident
  where incident.id = v_appeal.incident_id
  for update;

  if not found then
    raise exception 'Appeal incident not found'
      using errcode = 'P0002';
  end if;

  if p_restored_points > v_incident.applied_points then
    raise exception 'Restored points exceed the points deducted by this incident'
      using errcode = '22023';
  end if;

  v_account_id := private.ensure_score_account(
    v_incident.student_id,
    v_incident.term_id,
    v_uid
  );

  select account.balance
  into v_balance
  from public.score_accounts account
  where account.id = v_account_id
  for update;

  v_old_restored := coalesce(v_appeal.restored_points, 0);
  v_requested_delta := (p_restored_points - v_old_restored)::smallint;
  v_applied_delta := case
    when v_requested_delta > 0 then least(v_requested_delta::integer, (100 - v_balance)::integer)::smallint
    when v_requested_delta < 0 then greatest(v_requested_delta::integer, -v_balance::integer)::smallint
    else 0::smallint
  end;
  v_version := (v_appeal.review_version + 1)::smallint;
  v_outcome := case when p_restored_points > 0 then 'accepted' else 'rejected' end;

  insert into private.appeal_decisions(
    appeal_id,
    version,
    outcome,
    restored_points,
    requested_score_delta,
    applied_score_delta,
    public_explanation,
    decided_by
  ) values (
    v_appeal.id,
    v_version,
    v_outcome,
    p_restored_points,
    v_requested_delta,
    v_applied_delta,
    v_explanation,
    v_uid
  ) returning id into v_decision_id;

  if v_applied_delta <> 0 then
    update public.score_accounts
    set balance = balance + v_applied_delta
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
      incident_id,
      appeal_decision_id,
      reason,
      actor_user_id,
      actor_snapshot
    ) values (
      v_account_id,
      v_incident.student_id,
      v_incident.term_id,
      'appeal_adjustment',
      v_requested_delta,
      v_applied_delta,
      v_balance,
      v_balance + v_applied_delta,
      v_incident.id,
      v_decision_id,
      format('ปรับคะแนนตามผลอุทธรณ์ ครั้งที่ %s', v_version),
      v_uid,
      private.actor_snapshot(v_uid)
    ) returning id into v_ledger_id;
  end if;

  update public.appeals
  set status = v_outcome::public.appeal_status,
      restored_points = p_restored_points,
      public_explanation = v_explanation,
      decision_note = v_explanation,
      decided_by = v_uid,
      decided_at = now(),
      review_version = v_version
  where id = v_appeal.id;

  perform private.write_audit(
    'review_appeal_v2',
    'appeal',
    v_appeal.id::text,
    to_jsonb(v_appeal),
    jsonb_build_object(
      'status', v_outcome,
      'review_version', v_version,
      'restored_points', p_restored_points,
      'requested_score_delta', v_requested_delta,
      'applied_score_delta', v_applied_delta,
      'decision_id', v_decision_id,
      'ledger_id', v_ledger_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'appealId', v_appeal.id,
    'status', v_outcome,
    'reviewVersion', v_version,
    'restoredPoints', p_restored_points,
    'appliedScoreDelta', v_applied_delta,
    'balanceBefore', v_balance,
    'balanceAfter', v_balance + v_applied_delta,
    'decisionId', v_decision_id,
    'ledgerId', v_ledger_id
  );
end;
$$;

create or replace function public.reopen_appeal_v2(
  p_appeal_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appeal public.appeals%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_appeal_id is null
     or v_reason is null
     or char_length(v_reason) not between 5 and 2000 then
    raise exception 'Appeal and reopen reason of 5 to 2000 characters are required'
      using errcode = '22023';
  end if;

  select appeal.*
  into v_appeal
  from public.appeals appeal
  where appeal.id = p_appeal_id
  for update;

  if not found then
    raise exception 'Appeal not found'
      using errcode = 'P0002';
  end if;

  if v_appeal.status not in ('accepted', 'rejected') then
    raise exception 'Only a decided appeal can be reopened'
      using errcode = '55000';
  end if;

  update public.appeals
  set status = 'reviewing',
      reopened_by = v_uid,
      reopened_at = now(),
      reopen_reason = v_reason
  where id = v_appeal.id;

  perform private.write_audit(
    'reopen_appeal_v2',
    'appeal',
    v_appeal.id::text,
    to_jsonb(v_appeal),
    jsonb_build_object(
      'status', 'reviewing',
      'review_version', v_appeal.review_version,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'appealId', v_appeal.id,
    'status', 'reviewing',
    'reviewVersion', v_appeal.review_version
  );
end;
$$;

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
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_task_id is null then
    raise exception 'Guardian contact task is required'
      using errcode = '22023';
  end if;

  if not (
    (v_channel = 'phone' and v_outcome in ('answered', 'unanswered'))
    or (v_channel in ('line', 'messenger') and v_outcome in ('sent_waiting', 'read_or_replied'))
    or (v_channel = 'sms' and v_outcome = 'sent')
  ) then
    raise exception 'Guardian contact channel and outcome do not match'
      using errcode = '22023';
  end if;

  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'Contact note is too long'
      using errcode = '22023';
  end if;
  if v_evidence is not null and char_length(v_evidence) > 500 then
    raise exception 'Evidence note is too long'
      using errcode = '22023';
  end if;

  select task.*
  into v_task
  from public.guardian_contact_tasks task
  where task.id = p_task_id
  for update;

  if not found then
    raise exception 'Guardian contact task not found'
      using errcode = 'P0002';
  end if;

  if v_task.status = 'completed' then
    raise exception 'Guardian notification is already completed'
      using errcode = '55000';
  end if;
  if v_task.status = 'cancelled' then
    raise exception 'Cancelled guardian task cannot receive attempts'
      using errcode = '55000';
  end if;

  v_closes := (
    (v_channel = 'phone' and v_outcome = 'answered')
    or (v_channel in ('line', 'messenger') and v_outcome = 'read_or_replied')
    or (v_channel = 'sms' and v_outcome = 'sent')
  );
  v_next_reminder := case
    when v_closes then null
    else v_attempted_at + interval '24 hours'
  end;

  insert into private.guardian_contact_attempts(
    task_id,
    channel,
    outcome,
    closes_notification,
    note,
    evidence_note,
    attempted_by,
    attempted_by_snapshot,
    attempted_at
  ) values (
    v_task.id,
    v_channel,
    v_outcome,
    v_closes,
    v_note,
    v_evidence,
    v_uid,
    private.actor_snapshot(v_uid),
    v_attempted_at
  ) returning id into v_attempt_id;

  update public.guardian_contact_tasks
  set status = case when v_closes then 'completed' else 'pending' end,
      note = coalesce(v_note, note),
      completed_at = case when v_closes then v_attempted_at else null end,
      completed_by = case when v_closes then v_uid else null end,
      next_reminder_at = v_next_reminder
  where id = v_task.id;

  update public.follow_up_cases
  set status = 'following_up',
      managed_by = v_uid,
      managed_at = v_attempted_at
  where incident_id = v_task.incident_id
    and status = 'open';

  perform private.write_audit(
    'record_guardian_contact_attempt_v2',
    'guardian_contact_task',
    v_task.id::text,
    jsonb_build_object(
      'status', v_task.status,
      'next_reminder_at', v_task.next_reminder_at
    ),
    jsonb_build_object(
      'status', case when v_closes then 'completed' else 'pending' end,
      'attempt_id', v_attempt_id,
      'channel', v_channel,
      'outcome', v_outcome,
      'closes_notification', v_closes,
      'next_reminder_at', v_next_reminder
    )
  );

  return jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt_id,
    'taskId', v_task.id,
    'status', case when v_closes then 'completed' else 'pending' end,
    'closesNotification', v_closes,
    'attemptedAt', v_attempted_at,
    'nextReminderAt', v_next_reminder
  );
end;
$$;

create or replace function public.get_guardian_contact_attempts_v2(
  p_task_ids bigint[]
)
returns table (
  id bigint,
  task_id bigint,
  channel text,
  outcome text,
  note text,
  evidence_note text,
  closes_notification boolean,
  attempted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  return query
  select attempt.id,
         attempt.task_id,
         attempt.channel,
         attempt.outcome,
         attempt.note,
         attempt.evidence_note,
         attempt.closes_notification,
         attempt.attempted_at
  from private.guardian_contact_attempts attempt
  where attempt.task_id = any(coalesce(p_task_ids, array[]::bigint[]))
  order by attempt.task_id, attempt.attempted_at desc, attempt.id desc;
end;
$$;

create or replace function public.get_my_incident_history_v2()
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
  public_explanation text,
  restored_points smallint,
  review_version smallint,
  appeal_created_at timestamptz,
  appeal_decided_at timestamptz
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
         appeal.public_explanation,
         appeal.restored_points,
         appeal.review_version,
         appeal.created_at,
         appeal.decided_at
  from public.incidents incident
  left join public.appeals appeal on appeal.incident_id = incident.id
  where incident.student_id = v_student_id
  order by incident.occurred_at desc, incident.id desc;
end;
$$;

-- Teachers can still see their own addition request outcome, but appeal results
-- are restricted to administrators. Students use the actor-free RPC above.
drop policy if exists appeals_select on public.appeals;
drop policy if exists appeals_staff_select on public.appeals;
drop policy if exists appeals_admin_select_v2 on public.appeals;
create policy appeals_admin_select_v2
on public.appeals
for select
to authenticated
using ((select private.is_admin()));

revoke all on function public.request_point_addition_v2(
  uuid, bigint, bigint, smallint, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_point_addition_v2(
  uuid, bigint, bigint, smallint, timestamptz, text, text
) to authenticated;

revoke all on function public.request_point_additions_bulk_v2(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_point_additions_bulk_v2(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text
) to authenticated;

revoke all on function public.review_point_addition_v2(bigint, boolean, smallint, text)
from public, anon, authenticated, service_role;
grant execute on function public.review_point_addition_v2(bigint, boolean, smallint, text)
to authenticated;

revoke all on function public.review_appeal_v2(bigint, smallint, text)
from public, anon, authenticated, service_role;
grant execute on function public.review_appeal_v2(bigint, smallint, text)
to authenticated;

revoke all on function public.reopen_appeal_v2(bigint, text)
from public, anon, authenticated, service_role;
grant execute on function public.reopen_appeal_v2(bigint, text)
to authenticated;

revoke all on function public.record_guardian_contact_attempt_v2(bigint, text, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_guardian_contact_attempt_v2(bigint, text, text, text, text)
to authenticated;

revoke all on function public.get_guardian_contact_attempts_v2(bigint[])
from public, anon, authenticated, service_role;
grant execute on function public.get_guardian_contact_attempts_v2(bigint[])
to authenticated;

revoke all on function public.get_my_incident_history_v2()
from public, anon, authenticated, service_role;
grant execute on function public.get_my_incident_history_v2()
to authenticated;

comment on function public.review_point_addition_v2(bigint, boolean, smallint, text) is
  'Approve a teacher request with 1-100 adjusted points or reject it; reasons are required only for rejection or adjustment.';
comment on function public.review_appeal_v2(bigint, smallint, text) is
  'Record a full, partial, or rejected appeal decision as an append-only score adjustment without editing the original incident.';
comment on function public.record_guardian_contact_attempt_v2(bigint, text, text, text, text) is
  'Record one structured guardian contact attempt, close only for the approved channel/outcome pairs, otherwise schedule a 24-hour reminder.';

commit;

begin;

alter table public.score_ledger
  add column if not exists appeal_decision_id bigint
    references private.appeal_decisions(id) on delete restrict;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.score_ledger'::regclass
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) ilike '%entry_type%'
      and pg_get_constraintdef(constraint_row.oid) ilike '%semester_opening%'
  loop
    execute format(
      'alter table public.score_ledger drop constraint %I',
      v_constraint_name
    );
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'score_ledger_entry_delta_policy'
      and conrelid = 'public.score_ledger'::regclass
  ) then
    alter table public.score_ledger
      add constraint score_ledger_entry_delta_policy
      check (
        (entry_type = 'deduction' and requested_delta < 0 and applied_delta between -100 and 0)
        or (
          entry_type = 'semester_opening'
          and requested_delta = 100
          and applied_delta = 100
          and balance_before = 0
          and balance_after = 100
        )
        or (
          entry_type in ('teacher_request_approved', 'admin_addition', 'appeal_reversal')
          and requested_delta > 0
          and applied_delta between 0 and 100
        )
        or (
          entry_type = 'appeal_adjustment'
          and requested_delta <> 0
          and (
            (requested_delta > 0 and applied_delta between 0 and requested_delta)
            or (requested_delta < 0 and applied_delta between requested_delta and 0)
          )
        )
      );
  end if;
end;
$$;

drop index if exists public.score_ledger_incident_type_idx;
create unique index if not exists score_ledger_incident_type_unique_idx
  on public.score_ledger(incident_id, entry_type)
  where incident_id is not null
    and entry_type <> 'appeal_adjustment';
create index if not exists score_ledger_incident_type_date_idx
  on public.score_ledger(incident_id, entry_type, created_at desc)
  where incident_id is not null;
create unique index if not exists score_ledger_appeal_decision_idx
  on public.score_ledger(appeal_decision_id)
  where appeal_decision_id is not null;

-- The ledger is append-only for every application role. This one-time,
-- transaction-scoped backfill links legacy appeal reversals to the immutable
-- decision row created above. PostgreSQL rolls the trigger state back too if
-- any statement in this transaction fails.
alter table public.score_ledger
  disable trigger score_ledger_immutable;

update public.score_ledger ledger
set appeal_decision_id = decision.id
from public.appeals appeal
join private.appeal_decisions decision
  on decision.appeal_id = appeal.id
 and decision.version = 1
where ledger.incident_id = appeal.incident_id
  and ledger.entry_type = 'appeal_reversal'
  and ledger.appeal_decision_id is null;

alter table public.score_ledger
  enable trigger score_ledger_immutable;

commit;
