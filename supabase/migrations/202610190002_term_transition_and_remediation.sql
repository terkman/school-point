begin;

-- Semester lifecycle, immutable closing snapshots, and original-term
-- remediation. Every semester opens at 100; a closed term's ledger stays
-- append-only and accepts only late appeal adjustments and reviewed
-- remediation credits. Remediation passes when the ORIGINAL closed-term
-- balance reaches the threshold stored on the case; the current term is never
-- touched by remediation.
--
-- Lock order used by every score path:
--   score account (row) -> academic term (row, FOR SHARE by trigger)
--   -> remediation case (row, by the sync trigger).
-- The term transition takes academic-term rows FOR UPDATE and never locks or
-- writes the closing term's score accounts, so it cannot participate in a
-- cycle with ordinary scoring. Remediation request creation locks only the
-- case (FOR SHARE); remediation review locks the account first and lets the
-- sync trigger lock the case, matching the order above.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function private.remediation_threshold()
returns smallint
language sql
immutable
set search_path = ''
as $$
  select 80::smallint
$$;

create or replace function private.current_teacher_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select teacher.id
  from public.teachers teacher
  join public.profiles profile
    on profile.user_id = teacher.user_id
   and profile.role = 'teacher'::public.app_role
   and profile.is_active
   and not profile.activation_required
  where (select private.has_password_session())
    and teacher.user_id = (select auth.uid())
    and teacher.status = 'active'
    and teacher.intended_role = 'teacher'::public.app_role
$$;

create or replace function private.academic_term_json(p_term public.academic_terms)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_term.id,
    'schoolYear', p_term.school_year,
    'semester', p_term.semester,
    'name', p_term.name,
    'startsOn', p_term.starts_on,
    'endsOn', p_term.ends_on,
    'status', p_term.status
  )
$$;

create or replace function private.term_student_json(p_student public.students)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_student.id,
    'studentCode', p_student.student_code,
    'title', p_student.title,
    'givenName', p_student.given_name,
    'familyName', p_student.family_name,
    'nickname', p_student.nickname,
    'status', p_student.status
  )
$$;

-- Student-safe ledger projection: no actor IDs, actor names, internal notes,
-- evidence, or appeal-decision identifiers.
create or replace function private.safe_score_ledger_entry(p_entry public.score_ledger)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_entry.id,
    'termId', p_entry.term_id,
    'entryType', p_entry.entry_type,
    'requestedDelta', p_entry.requested_delta,
    'appliedDelta', p_entry.applied_delta,
    'balanceBefore', p_entry.balance_before,
    'balanceAfter', p_entry.balance_after,
    'reason', case
      when p_entry.entry_type in ('teacher_request_approved', 'admin_addition')
        then coalesce(nullif(btrim(p_entry.positive_rule_snapshot ->> 'title_th'), ''), 'กิจกรรมเพิ่มคะแนน')
      else p_entry.reason
    end,
    'incidentId', p_entry.incident_id,
    'activityOccurredAt', p_entry.activity_occurred_at,
    'createdAt', p_entry.created_at
  )
$$;

revoke all on function private.remediation_threshold() from public, anon, authenticated;
revoke all on function private.current_teacher_id() from public, anon, authenticated;
revoke all on function private.academic_term_json(public.academic_terms) from public, anon, authenticated;
revoke all on function private.term_student_json(public.students) from public, anon, authenticated;
revoke all on function private.safe_score_ledger_entry(public.score_ledger) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Workflow authorization tokens
-- ---------------------------------------------------------------------------
-- Closing a term and posting a closed-term remediation credit are only
-- permitted while the owning SECURITY DEFINER workflow holds a token for the
-- current transaction. Clients cannot write this private table, and a custom
-- GUC is deliberately not used because callers can set those themselves.
create table private.term_write_authorizations (
  txid bigint not null,
  kind text not null check (kind in ('close_term', 'remediation_credit')),
  ref_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (txid, kind, ref_id)
);

alter table private.term_write_authorizations enable row level security;
alter table private.term_write_authorizations force row level security;
revoke all on table private.term_write_authorizations from public, anon, authenticated, service_role;

create or replace function private.has_term_write_authorization(p_kind text, p_ref_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.term_write_authorizations authorization_row
    where authorization_row.txid = pg_catalog.txid_current()
      and authorization_row.kind = p_kind
      and authorization_row.ref_id = p_ref_id
  )
$$;

revoke all on function private.has_term_write_authorization(text, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.academic_term_preparations (
  id bigint generated always as identity primary key,
  source_term_id bigint not null references public.academic_terms(id) on delete restrict,
  target_term_id bigint not null unique references public.academic_terms(id) on delete restrict,
  request_payload_hash text not null check (char_length(request_payload_hash) = 64),
  classroom_count integer not null check (classroom_count >= 0),
  enrollment_count integer not null check (enrollment_count >= 0),
  assignment_count integer not null check (assignment_count >= 0),
  prepared_by uuid references auth.users(id) on delete set null,
  prepared_by_snapshot text not null,
  created_at timestamptz not null default now(),
  check (source_term_id <> target_term_id)
);

create table public.academic_term_transitions (
  id bigint generated always as identity primary key,
  from_term_id bigint not null unique references public.academic_terms(id) on delete restrict,
  to_term_id bigint not null unique references public.academic_terms(id) on delete restrict,
  client_request_id uuid not null unique,
  request_payload_hash text not null check (char_length(request_payload_hash) = 64),
  threshold smallint not null check (threshold between 1 and 100),
  snapshot_count integer not null check (snapshot_count >= 0),
  remediation_case_count integer not null check (remediation_case_count >= 0),
  initialized_account_count integer not null check (initialized_account_count >= 0),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_snapshot text not null,
  created_at timestamptz not null default now(),
  check (from_term_id <> to_term_id)
);

-- One immutable row per student per closed term. A student enrolled in the
-- closing term without a score account is recorded explicitly as
-- account_missing with NULL score fields instead of an invented 100.
create table public.term_closing_snapshots (
  id bigint generated always as identity primary key,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  student_id bigint not null references public.students(id) on delete restrict,
  score_account_id bigint references public.score_accounts(id) on delete restrict,
  closing_balance smallint,
  account_missing boolean not null,
  threshold smallint not null check (threshold between 1 and 100),
  classroom_id bigint references public.classrooms(id) on delete restrict,
  closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (term_id, student_id),
  check (
    (account_missing and score_account_id is null and closing_balance is null)
    or (not account_missing and score_account_id is not null and closing_balance between 0 and 100)
  )
);

create table public.term_remediation_cases (
  id bigint generated always as identity primary key,
  source_term_id bigint not null references public.academic_terms(id) on delete restrict,
  student_id bigint not null references public.students(id) on delete restrict,
  score_account_id bigint not null unique references public.score_accounts(id) on delete restrict,
  snapshot_id bigint not null unique references public.term_closing_snapshots(id) on delete restrict,
  closing_balance smallint not null check (closing_balance between 0 and 100),
  threshold smallint not null check (threshold between 1 and 100),
  status text not null default 'open' check (status in ('open', 'passed')),
  status_changed_at timestamptz not null default now(),
  passed_at timestamptz,
  responsible_teacher_id bigint references public.teachers(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_term_id, student_id),
  check ((status = 'passed') = (passed_at is not null))
);

create index term_remediation_cases_status_idx
  on public.term_remediation_cases(status, source_term_id);
create index term_remediation_cases_student_idx
  on public.term_remediation_cases(student_id);
create index term_remediation_cases_teacher_idx
  on public.term_remediation_cases(responsible_teacher_id)
  where responsible_teacher_id is not null;

create table public.term_remediation_requests (
  id bigint generated always as identity primary key,
  case_id bigint not null references public.term_remediation_cases(id) on delete restrict,
  student_id bigint not null references public.students(id) on delete restrict,
  source_term_id bigint not null references public.academic_terms(id) on delete restrict,
  requested_points smallint not null check (requested_points between 1 and 100),
  approved_points smallint check (approved_points between 1 and 100),
  -- The real activity time; it may fall in the current term while the credit
  -- is booked to source_term_id.
  activity_occurred_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 2000),
  status public.request_status not null default 'pending',
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_snapshot text not null,
  requested_by_role public.app_role not null,
  client_request_id uuid not null,
  request_payload_hash text not null check (char_length(request_payload_hash) = 64),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(btrim(review_note)) between 5 and 2000),
  review_client_request_id uuid unique,
  review_payload_hash text check (review_payload_hash is null or char_length(review_payload_hash) = 64),
  ledger_id bigint unique references public.score_ledger(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (requested_by, client_request_id),
  check (
    (status = 'pending' and approved_points is null and reviewed_at is null and ledger_id is null
      and review_client_request_id is null and review_payload_hash is null)
    or (status = 'approved' and approved_points is not null and reviewed_at is not null and ledger_id is not null
      and review_client_request_id is not null and review_payload_hash is not null)
    or (status = 'rejected' and approved_points is null and reviewed_at is not null and ledger_id is null
      and review_client_request_id is not null and review_payload_hash is not null and review_note is not null)
  )
);

create unique index term_remediation_requests_one_pending_idx
  on public.term_remediation_requests(case_id)
  where status = 'pending';
create index term_remediation_requests_case_idx
  on public.term_remediation_requests(case_id, created_at desc, id desc);

-- Ledger provenance for remediation credits.
alter table public.score_ledger
  add column remediation_request_id bigint
    references public.term_remediation_requests(id) on delete restrict;

create unique index score_ledger_remediation_request_idx
  on public.score_ledger(remediation_request_id)
  where remediation_request_id is not null;

alter table public.score_ledger
  add constraint score_ledger_remediation_provenance
  check ((entry_type = 'remediation_credit') = (remediation_request_id is not null));

alter table public.score_ledger
  drop constraint if exists score_ledger_entry_delta_policy;

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
      entry_type in ('appeal_adjustment', 'admin_adjustment')
      and requested_delta between -100 and 100
      and requested_delta <> 0
      and (
        (requested_delta > 0 and applied_delta between 0 and requested_delta)
        or (requested_delta < 0 and applied_delta between requested_delta and 0)
      )
    )
    or (
      entry_type = 'remediation_credit'
      and requested_delta between 1 and 100
      and applied_delta between 0 and requested_delta
    )
  );

-- One opening entry per score account. Fail loudly with remediation guidance
-- instead of silently skipping the invariant when historical data violates it.
do $$
declare
  v_duplicates integer;
begin
  select count(*) into v_duplicates
  from (
    select ledger.score_account_id
    from public.score_ledger ledger
    where ledger.entry_type = 'semester_opening'
    group by ledger.score_account_id
    having count(*) > 1
  ) duplicate_accounts;

  if v_duplicates > 0 then
    raise exception 'Cannot install score_ledger_one_opening_idx: % score account(s) have more than one semester_opening entry',
      v_duplicates
      using errcode = '23505',
            hint = 'List them with: select score_account_id, count(*) from public.score_ledger where entry_type = ''semester_opening'' group by 1 having count(*) > 1; reconcile through an approved, audited data-correction migration before retrying.';
  end if;
end;
$$;

create unique index score_ledger_one_opening_idx
  on public.score_ledger(score_account_id)
  where entry_type = 'semester_opening';

-- RLS: these tables are read and written only through SECURITY DEFINER RPCs.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'academic_term_preparations',
    'academic_term_transitions',
    'term_closing_snapshots',
    'term_remediation_cases',
    'term_remediation_requests'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_table);
    execute format('revoke all on sequence public.%I from public, anon, authenticated, service_role', v_table || '_id_seq');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------------

create trigger academic_term_preparations_immutable
before update or delete on public.academic_term_preparations
for each row execute function private.reject_immutable_change();

create trigger academic_term_transitions_immutable
before update or delete on public.academic_term_transitions
for each row execute function private.reject_immutable_change();

create trigger term_closing_snapshots_immutable
before update or delete on public.term_closing_snapshots
for each row execute function private.reject_immutable_change();

create or replace function private.guard_term_remediation_case_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Remediation cases cannot be deleted' using errcode = '55000';
  end if;
  if (new.source_term_id, new.student_id, new.score_account_id, new.snapshot_id,
      new.closing_balance, new.threshold, new.created_at)
     is distinct from
     (old.source_term_id, old.student_id, old.score_account_id, old.snapshot_id,
      old.closing_balance, old.threshold, old.created_at) then
    raise exception 'Remediation case source, closing score, and threshold are immutable'
      using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger term_remediation_cases_guard
before update or delete on public.term_remediation_cases
for each row execute function private.guard_term_remediation_case_change();

create or replace function private.guard_term_remediation_request_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Remediation requests are append-only' using errcode = '55000';
  end if;
  if old.status <> 'pending' then
    raise exception 'A reviewed remediation request is immutable' using errcode = '55000';
  end if;
  if (new.case_id, new.student_id, new.source_term_id, new.requested_points,
      new.activity_occurred_at, new.reason, new.requested_by, new.requested_by_snapshot,
      new.requested_by_role, new.client_request_id, new.request_payload_hash, new.created_at)
     is distinct from
     (old.case_id, old.student_id, old.source_term_id, old.requested_points,
      old.activity_occurred_at, old.reason, old.requested_by, old.requested_by_snapshot,
      old.requested_by_role, old.client_request_id, old.request_payload_hash, old.created_at) then
    raise exception 'Remediation request details are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger term_remediation_requests_guard
before update or delete on public.term_remediation_requests
for each row execute function private.guard_term_remediation_request_change();

revoke all on function private.guard_term_remediation_case_change() from public, anon, authenticated, service_role;
revoke all on function private.guard_term_remediation_request_change() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Academic term lifecycle
-- ---------------------------------------------------------------------------
-- Direct table DML by application users is removed; administrators use the
-- audited RPCs. The trigger also constrains privileged/server-side writes:
--   insert: planned only
--   planned -> active (admin_activate_term / transition)
--   active -> closed only inside admin_transition_term_v1
--   closed rows are immutable (identical no-op upserts from imports pass)
drop policy if exists terms_admin_write on public.academic_terms;
revoke insert, update, delete on public.academic_terms from authenticated;

create or replace function private.guard_academic_term_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'planned' then
      raise exception 'A new academic term must start as planned' using errcode = '55000';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'planned' then
      raise exception 'Only a planned academic term can be deleted' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.status = 'closed' then
    if (new.school_year, new.semester, new.name, new.starts_on, new.ends_on, new.status)
       is distinct from
       (old.school_year, old.semester, old.name, old.starts_on, old.ends_on, old.status) then
      raise exception 'A closed academic term is immutable' using errcode = '55000';
    end if;
    return new;
  end if;

  if old.status <> 'planned'
     and (new.school_year, new.semester) is distinct from (old.school_year, old.semester) then
    raise exception 'School year and semester are fixed once a term is active' using errcode = '55000';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'planned' and new.status = 'active' then
      null;
    elsif old.status = 'active' and new.status = 'closed'
          and private.has_term_write_authorization('close_term', old.id) then
      null;
    else
      raise exception 'Academic term status can only change through the term lifecycle RPCs'
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_academic_term_lifecycle() from public, anon, authenticated, service_role;

create trigger academic_terms_lifecycle_guard
before insert or update or delete on public.academic_terms
for each row execute function private.guard_academic_term_lifecycle();

-- ---------------------------------------------------------------------------
-- Score write term guards
-- ---------------------------------------------------------------------------
-- Score accounts only take the term row lock (account -> term order). They do
-- not reject here because ensure_score_account() proposes an insert even when
-- the account already exists (ON CONFLICT DO NOTHING).
create or replace function private.lock_score_account_term()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.academic_terms term
  where term.id = new.term_id
  for share;
  return new;
end;
$$;

revoke all on function private.lock_score_account_term() from public, anon, authenticated, service_role;

create trigger score_accounts_term_lock
before insert or update of balance on public.score_accounts
for each row execute function private.lock_score_account_term();

-- The authoritative gate: every balance change produces a ledger row. A
-- caller that waited behind the transition re-reads the committed term row
-- and is rejected once the term is closed, so stale postings cannot land.
create or replace function private.guard_score_ledger_term_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.term_status;
  v_request public.term_remediation_requests%rowtype;
  v_case public.term_remediation_cases%rowtype;
begin
  select term.status
  into v_status
  from public.academic_terms term
  where term.id = new.term_id
  for share;

  if not found then
    raise exception 'Academic term not found' using errcode = '23503';
  end if;

  if new.entry_type = 'remediation_credit' then
    if v_status <> 'closed' then
      raise exception 'Remediation credit can only be posted to a closed term' using errcode = '55000';
    end if;
    if new.remediation_request_id is null
       or not private.has_term_write_authorization('remediation_credit', new.remediation_request_id) then
      raise exception 'Remediation credit must be posted by the remediation review workflow'
        using errcode = '42501';
    end if;

    select request.* into v_request
    from public.term_remediation_requests request
    where request.id = new.remediation_request_id;

    select case_row.* into v_case
    from public.term_remediation_cases case_row
    where case_row.id = v_request.case_id;

    if v_request.id is null
       or v_request.status <> 'pending'
       or v_case.id is null
       or v_case.score_account_id <> new.score_account_id
       or v_case.student_id <> new.student_id
       or v_case.source_term_id <> new.term_id
       or new.requested_delta <> v_request.requested_points then
      raise exception 'Remediation credit provenance does not match its request'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if v_status = 'active' then
    return new;
  end if;

  if v_status = 'planned' and new.entry_type = 'semester_opening' then
    return new;
  end if;

  -- Existing appeal rules still apply to incidents of a closed term.
  if v_status = 'closed' and new.entry_type = 'appeal_adjustment' then
    return new;
  end if;

  raise exception 'Score changes are not allowed for a % academic term', v_status
    using errcode = '55000';
end;
$$;

revoke all on function private.guard_score_ledger_term_write() from public, anon, authenticated, service_role;

create trigger score_ledger_term_guard
before insert on public.score_ledger
for each row execute function private.guard_score_ledger_term_write();

-- Keep the case status in step with the ORIGINAL account balance, including
-- late or reopened appeal decisions that lower it below the threshold.
create or replace function private.sync_term_remediation_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.term_remediation_cases%rowtype;
  v_snapshot public.term_closing_snapshots%rowtype;
  v_status text;
begin
  select case_row.* into v_case
  from public.term_remediation_cases case_row
  where case_row.score_account_id = new.score_account_id
  for update;

  if not found then
    -- A revised appeal may lower a previously passing closing balance. Keep
    -- the original snapshot and open a new case instead of losing this pupil.
    select snapshot.* into v_snapshot
    from public.term_closing_snapshots snapshot
    where snapshot.score_account_id = new.score_account_id;
    if not found or new.balance_after >= v_snapshot.threshold then
      return null;
    end if;
    insert into public.term_remediation_cases (
      source_term_id, student_id, score_account_id, snapshot_id,
      closing_balance, threshold, status
    ) values (
      v_snapshot.term_id, v_snapshot.student_id, new.score_account_id, v_snapshot.id,
      v_snapshot.closing_balance, v_snapshot.threshold, 'open'
    ) returning * into v_case;
    perform private.write_audit(
      'term_remediation_opened_after_adjustment', 'term_remediation_case', v_case.id::text,
      null, jsonb_build_object('source_term_id', v_case.source_term_id,
        'student_id', v_case.student_id, 'closing_balance', v_case.closing_balance,
        'balance', new.balance_after, 'threshold', v_case.threshold, 'ledger_id', new.id)
    );
  end if;

  v_status := case when new.balance_after >= v_case.threshold then 'passed' else 'open' end;

  if v_status <> v_case.status then
    update public.term_remediation_cases
    set status = v_status,
        status_changed_at = now(),
        passed_at = case when v_status = 'passed' then now() else null end
    where id = v_case.id;

    perform private.write_audit(
      'term_remediation_status_sync',
      'term_remediation_case',
      v_case.id::text,
      jsonb_build_object('status', v_case.status, 'balance', new.balance_before),
      jsonb_build_object(
        'status', v_status,
        'balance', new.balance_after,
        'threshold', v_case.threshold,
        'ledger_id', new.id,
        'entry_type', new.entry_type
      )
    );
  end if;

  return null;
end;
$$;

revoke all on function private.sync_term_remediation_case() from public, anon, authenticated, service_role;

create trigger score_ledger_sync_term_remediation
after insert on public.score_ledger
for each row execute function private.sync_term_remediation_case();

-- New pending score requests are accepted only for the active term. The share
-- lock serializes them with the transition's pending-request check.
create or replace function private.require_active_term_for_score_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.term_status;
begin
  select term.status into v_status
  from public.academic_terms term
  where term.id = new.term_id
  for share;

  if v_status is distinct from 'active'::public.term_status then
    raise exception 'Score requests can only be created for the active academic term'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.require_active_term_for_score_request() from public, anon, authenticated, service_role;

create trigger point_addition_requests_active_term
before insert on public.point_addition_requests
for each row execute function private.require_active_term_for_score_request();

create trigger deduction_approval_requests_active_term
before insert on public.deduction_approval_requests
for each row execute function private.require_active_term_for_score_request();

-- ---------------------------------------------------------------------------
-- Authorization helpers for remediation and history
-- ---------------------------------------------------------------------------

create or replace function private.can_manage_term_remediation(p_student_id bigint, p_responsible_teacher_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin())
    or (
      private.current_teacher_id() is not null
      and (
        private.teacher_has_student(p_student_id, null)
        or p_responsible_teacher_id is not distinct from private.current_teacher_id()
           and p_responsible_teacher_id is not null
      )
    )
$$;

revoke all on function private.can_manage_term_remediation(bigint, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Readiness check shared by preview and transition
-- ---------------------------------------------------------------------------

create or replace function private.term_transition_check(p_current_term_id bigint, p_next_term_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current public.academic_terms%rowtype;
  v_next public.academic_terms%rowtype;
  v_has_current boolean := false;
  v_has_next boolean := false;
  v_blockers text[] := array[]::text[];
  v_threshold smallint := private.remediation_threshold();
  v_pending_additions integer := 0;
  v_pending_deductions integer := 0;
  v_pending_appeals integer := 0;
  v_open_appeal_windows integer := 0;
  v_current_accounts integer := 0;
  v_current_enrolled integer := 0;
  v_missing_accounts integer := 0;
  v_below integer := 0;
  v_next_classrooms integer := 0;
  v_next_enrolled integer := 0;
  v_next_assignments integer := 0;
  v_next_invalid_roster integer := 0;
  v_next_activity integer := 0;
  v_not_carried integer := 0;
  v_open_remediation integer := 0;
  v_pending_remediation integer := 0;
begin
  if p_current_term_id is not null then
    select term.* into v_current from public.academic_terms term where term.id = p_current_term_id;
    v_has_current := found;
  end if;
  if p_next_term_id is not null then
    select term.* into v_next from public.academic_terms term where term.id = p_next_term_id;
    v_has_next := found;
  end if;

  if not v_has_current then
    v_blockers := array_append(v_blockers, 'NO_ACTIVE_TERM');
  elsif v_current.status <> 'active' then
    v_blockers := array_append(v_blockers, 'CURRENT_TERM_NOT_ACTIVE');
  end if;

  if not v_has_next then
    v_blockers := array_append(v_blockers, 'NEXT_TERM_NOT_FOUND');
  else
    if v_has_current and v_next.id = v_current.id then
      v_blockers := array_append(v_blockers, 'SAME_TERM');
    end if;
    if v_next.status <> 'planned' then
      v_blockers := array_append(v_blockers, 'NEXT_TERM_NOT_PLANNED');
    end if;
    if v_next.starts_on is null or v_next.ends_on is null then
      v_blockers := array_append(v_blockers, 'NEXT_TERM_DATES_MISSING');
    end if;
    if v_has_current then
      if (v_next.school_year, v_next.semester) <= (v_current.school_year, v_current.semester) then
        v_blockers := array_append(v_blockers, 'NEXT_TERM_NOT_LATER');
      end if;
      if v_next.starts_on is not null and v_current.ends_on is not null
         and v_next.starts_on <= v_current.ends_on then
        v_blockers := array_append(v_blockers, 'NEXT_TERM_OVERLAPS_CURRENT');
      end if;
    end if;
  end if;

  if v_has_current then
    if exists (select 1 from public.academic_term_transitions transition where transition.from_term_id = v_current.id) then
      v_blockers := array_append(v_blockers, 'CURRENT_TERM_ALREADY_TRANSITIONED');
    end if;

    select count(*) into v_pending_additions
    from public.point_addition_requests request
    where request.term_id = v_current.id and request.status = 'pending';

    select count(*) into v_pending_deductions
    from public.deduction_approval_requests request
    where request.term_id = v_current.id and request.status = 'pending';

    select count(*) into v_pending_appeals
    from public.appeals appeal
    join public.incidents incident on incident.id = appeal.incident_id
    where incident.term_id = v_current.id
      and appeal.status in ('submitted', 'reviewing');

    select count(*) into v_open_appeal_windows
    from public.incidents incident
    where incident.term_id = v_current.id
      and not incident.is_voided
      and incident.appeal_deadline > now()
      and not exists (select 1 from public.appeals appeal where appeal.incident_id = incident.id);

    select count(*) into v_current_accounts
    from public.score_accounts account
    where account.term_id = v_current.id;

    select count(*) into v_below
    from public.score_accounts account
    where account.term_id = v_current.id and account.balance < v_threshold;

    select count(*) into v_current_enrolled
    from public.enrollments enrollment
    where enrollment.term_id = v_current.id and enrollment.is_active;

    select count(*) into v_missing_accounts
    from public.enrollments enrollment
    where enrollment.term_id = v_current.id
      and enrollment.is_active
      and not exists (
        select 1 from public.score_accounts account
        where account.term_id = v_current.id and account.student_id = enrollment.student_id
      );

    if v_pending_additions > 0 then
      v_blockers := array_append(v_blockers, 'PENDING_ADDITION_REQUESTS');
    end if;
    if v_pending_deductions > 0 then
      v_blockers := array_append(v_blockers, 'PENDING_DEDUCTION_REQUESTS');
    end if;
    if v_missing_accounts > 0 then
      v_blockers := array_append(v_blockers, 'CURRENT_TERM_MISSING_ACCOUNTS');
    end if;
  end if;

  if v_has_next then
    select count(*) into v_next_classrooms
    from public.classrooms classroom
    where classroom.term_id = v_next.id and classroom.is_active;

    select count(*) into v_next_enrolled
    from public.enrollments enrollment
    where enrollment.term_id = v_next.id and enrollment.is_active;

    select count(*) into v_next_assignments
    from public.teacher_classroom_assignments assignment
    where assignment.term_id = v_next.id and assignment.is_active;

    select count(*) into v_next_invalid_roster
    from public.enrollments enrollment
    join public.classrooms classroom on classroom.id = enrollment.classroom_id
    join public.students student on student.id = enrollment.student_id
    where enrollment.term_id = v_next.id
      and enrollment.is_active
      and (not classroom.is_active or student.status <> 'active');

    select
      (select count(*) from public.score_ledger ledger
        where ledger.term_id = v_next.id and ledger.entry_type <> 'semester_opening')
      + (select count(*) from public.score_accounts account
        where account.term_id = v_next.id and account.balance <> 100)
      + (select count(*) from public.incidents incident where incident.term_id = v_next.id)
      + (select count(*) from public.point_addition_requests request where request.term_id = v_next.id)
      + (select count(*) from public.deduction_approval_requests request where request.term_id = v_next.id)
    into v_next_activity;

    if v_next_enrolled = 0 then
      v_blockers := array_append(v_blockers, 'NEXT_TERM_EMPTY_ROSTER');
    end if;
    if v_next_invalid_roster > 0 then
      v_blockers := array_append(v_blockers, 'NEXT_TERM_INVALID_ROSTER');
    end if;
    if v_next_activity > 0 then
      v_blockers := array_append(v_blockers, 'NEXT_TERM_HAS_SCORE_ACTIVITY');
    end if;
  end if;

  if v_has_current and v_has_next then
    select count(*) into v_not_carried
    from public.enrollments enrollment
    where enrollment.term_id = v_current.id
      and enrollment.is_active
      and not exists (
        select 1 from public.enrollments next_enrollment
        where next_enrollment.term_id = v_next.id
          and next_enrollment.student_id = enrollment.student_id
          and next_enrollment.is_active
      );
  end if;

  select count(*) into v_open_remediation
  from public.term_remediation_cases case_row
  where case_row.status = 'open';

  select count(*) into v_pending_remediation
  from public.term_remediation_requests request
  where request.status = 'pending';

  return jsonb_build_object(
    'currentTermId', case when v_has_current then v_current.id end,
    'nextTermId', case when v_has_next then v_next.id end,
    'currentTerm', case when v_has_current then private.academic_term_json(v_current) end,
    'nextTerm', case when v_has_next then private.academic_term_json(v_next) end,
    'threshold', v_threshold,
    'blockers', to_jsonb(v_blockers),
    'canTransition', cardinality(v_blockers) = 0,
    'counts', jsonb_build_object(
      'currentAccounts', v_current_accounts,
      'currentEnrolled', v_current_enrolled,
      'currentMissingAccounts', v_missing_accounts,
      'expectedRemediationCases', v_below,
      'pendingAdditionRequests', v_pending_additions,
      'pendingDeductionRequests', v_pending_deductions,
      'pendingAppeals', v_pending_appeals,
      'openAppealWindows', v_open_appeal_windows,
      'nextClassrooms', v_next_classrooms,
      'nextEnrolled', v_next_enrolled,
      'nextAssignments', v_next_assignments,
      'nextInvalidRoster', v_next_invalid_roster,
      'nextScoreActivity', v_next_activity,
      'studentsNotCarriedOver', v_not_carried,
      'openRemediationCases', v_open_remediation,
      'pendingRemediationRequests', v_pending_remediation
    )
  );
end;
$$;

revoke all on function private.term_transition_check(bigint, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public read RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_academic_terms_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.current_role();
  v_all boolean;
  v_result jsonb;
begin
  if v_role is null then
    raise exception 'Active school account required' using errcode = '42501';
  end if;
  v_all := v_role::text in ('admin', 'director');

  select coalesce(jsonb_agg(item order by sort_year desc, sort_semester desc), '[]'::jsonb)
  into v_result
  from (
    select private.academic_term_json(term) || jsonb_build_object(
             'closedAt', transition.created_at,
             'nextTermId', transition.to_term_id,
             'threshold', private.remediation_threshold()
           ) as item,
           term.school_year as sort_year,
           term.semester as sort_semester
    from public.academic_terms term
    left join public.academic_term_transitions transition on transition.from_term_id = term.id
    where v_all or term.status <> 'planned'
  ) visible;

  return v_result;
end;
$$;

create or replace function public.get_term_history_v1(p_term_id bigint, p_student_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.current_role();
  v_all boolean := false;
  v_self_student_id bigint;
  v_teacher_id bigint;
  v_term public.academic_terms%rowtype;
  v_closed_at timestamptz;
  v_students jsonb;
begin
  if v_role is null then
    raise exception 'Active school account required' using errcode = '42501';
  end if;
  if v_role::text in ('admin', 'director') then
    v_all := true;
  elsif v_role::text = 'teacher' then
    v_teacher_id := private.current_teacher_id();
    if v_teacher_id is null then
      raise exception 'Active teacher permission required' using errcode = '42501';
    end if;
  elsif v_role::text = 'student' then
    v_self_student_id := private.current_student_id();
    if v_self_student_id is null then
      raise exception 'Active student permission required' using errcode = '42501';
    end if;
  else
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  if p_term_id is null then
    raise exception 'Term is required' using errcode = '22023';
  end if;

  select term.* into v_term from public.academic_terms term where term.id = p_term_id;
  if not found or (v_term.status = 'planned' and not v_all) then
    raise exception 'Academic term not found' using errcode = 'P0002';
  end if;

  select transition.created_at into v_closed_at
  from public.academic_term_transitions transition
  where transition.from_term_id = p_term_id;

  select coalesce(jsonb_agg(visible.item order by visible.grade_level nulls last, visible.room_number nulls last,
                            visible.student_number nulls last, visible.student_code), '[]'::jsonb)
  into v_students
  from (
    select
      private.term_student_json(student) || jsonb_build_object(
        'studentId', student.id,
        'enrolled', coalesce(enrollment.is_active, false),
        'classroom', case when classroom.id is null then null else jsonb_build_object(
          'id', classroom.id,
          'name', classroom.display_name,
          'gradeLevel', classroom.grade_level,
          'roomNumber', classroom.room_number
        ) end,
        'studentNumber', enrollment.student_number,
        'hasAccount', account.id is not null,
        'openingScore', case when account.id is null then null else 100 end,
        'latestScore', account.balance,
        'closingScore', snapshot.closing_balance,
        'closingAccountMissing', snapshot.account_missing,
        'threshold', coalesce(snapshot.threshold, private.remediation_threshold()),
        'remediation', case when case_row.id is null then null else jsonb_build_object(
          'caseId', case_row.id,
          'status', case_row.status,
          'threshold', case_row.threshold,
          'passedAt', case_row.passed_at
        ) end,
        'history', coalesce((
          select jsonb_agg(private.safe_score_ledger_entry(ledger) order by ledger.created_at, ledger.id)
          from public.score_ledger ledger
          where ledger.score_account_id = account.id
        ), '[]'::jsonb)
      ) as item,
      classroom.grade_level,
      classroom.room_number,
      enrollment.student_number,
      student.student_code
    from (
      select account_row.student_id from public.score_accounts account_row where account_row.term_id = p_term_id
      union
      select enrollment_row.student_id from public.enrollments enrollment_row where enrollment_row.term_id = p_term_id
    ) base
    join public.students student on student.id = base.student_id
    left join public.score_accounts account
      on account.term_id = p_term_id and account.student_id = base.student_id
    left join public.enrollments enrollment
      on enrollment.term_id = p_term_id and enrollment.student_id = base.student_id
    left join public.classrooms classroom on classroom.id = enrollment.classroom_id
    left join public.term_closing_snapshots snapshot
      on snapshot.term_id = p_term_id and snapshot.student_id = base.student_id
    left join public.term_remediation_cases case_row
      on case_row.source_term_id = p_term_id and case_row.student_id = base.student_id
    where (p_student_id is null or base.student_id = p_student_id)
      and (
        v_all
        or (v_self_student_id is not null and base.student_id = v_self_student_id)
        or (
          v_teacher_id is not null
          and (
            private.teacher_has_student(base.student_id, null)
            or case_row.responsible_teacher_id = v_teacher_id
          )
        )
      )
  ) visible;

  return jsonb_build_object(
    'term', private.academic_term_json(v_term),
    'closedAt', v_closed_at,
    'threshold', private.remediation_threshold(),
    'students', v_students
  );
end;
$$;

create or replace function public.list_term_remediations_v1(p_include_passed boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.app_role := private.current_role();
  v_all boolean := false;
  v_is_admin boolean := false;
  v_self_student_id bigint;
  v_teacher_id bigint;
  v_result jsonb;
begin
  if v_role is null then
    raise exception 'Active school account required' using errcode = '42501';
  end if;
  if v_role::text in ('admin', 'director') then
    v_all := true;
    v_is_admin := (select private.is_admin());
  elsif v_role::text = 'teacher' then
    v_teacher_id := private.current_teacher_id();
    if v_teacher_id is null then
      raise exception 'Active teacher permission required' using errcode = '42501';
    end if;
  elsif v_role::text = 'student' then
    v_self_student_id := private.current_student_id();
    if v_self_student_id is null then
      raise exception 'Active student permission required' using errcode = '42501';
    end if;
  else
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(visible.item order by visible.status_rank, visible.school_year, visible.semester,
                            visible.student_code), '[]'::jsonb)
  into v_result
  from (
    select
      jsonb_build_object(
        'caseId', case_row.id,
        'sourceTerm', private.academic_term_json(term),
        'student', private.term_student_json(student),
        'currentClassroom', (
          select jsonb_build_object(
            'id', classroom.id,
            'termId', classroom.term_id,
            'name', classroom.display_name,
            'gradeLevel', classroom.grade_level,
            'roomNumber', classroom.room_number
          )
          from public.enrollments enrollment
          join public.academic_terms active_term
            on active_term.id = enrollment.term_id and active_term.status = 'active'
          join public.classrooms classroom on classroom.id = enrollment.classroom_id
          where enrollment.student_id = case_row.student_id and enrollment.is_active
          limit 1
        ),
        'closingScore', case_row.closing_balance,
        'currentScore', account.balance,
        'threshold', case_row.threshold,
        'pointsNeeded', greatest(case_row.threshold - account.balance, 0),
        'status', case_row.status,
        'passedAt', case_row.passed_at,
        'openedAt', case_row.created_at,
        'responsibleTeacherId', case when v_self_student_id is null then case_row.responsible_teacher_id end,
        'canRequest', v_self_student_id is null
          and case_row.status = 'open'
          and (v_is_admin or v_teacher_id is not null)
          and not exists (
            select 1 from public.term_remediation_requests pending
            where pending.case_id = case_row.id and pending.status = 'pending'
          ),
        'pendingRequestCount', (
          select count(*) from public.term_remediation_requests pending
          where pending.case_id = case_row.id and pending.status = 'pending'
        ),
        'requests', coalesce((
          select jsonb_agg(
            case when v_self_student_id is not null then jsonb_build_object(
              'id', request.id,
              'requestedPoints', request.requested_points,
              'approvedPoints', request.approved_points,
              'activityOccurredAt', request.activity_occurred_at,
              'status', request.status,
              'createdAt', request.created_at,
              'reviewedAt', request.reviewed_at
            ) else jsonb_build_object(
              'id', request.id,
              'requestedPoints', request.requested_points,
              'approvedPoints', request.approved_points,
              'activityOccurredAt', request.activity_occurred_at,
              'reason', request.reason,
              'status', request.status,
              'createdAt', request.created_at,
              'reviewedAt', request.reviewed_at,
              'reviewNote', request.review_note,
              'ledgerId', request.ledger_id,
              'requestedByMe', request.requested_by is not distinct from v_uid,
              'requestedByRole', request.requested_by_role,
              'requestedBySnapshot', case when v_all then request.requested_by_snapshot end
            ) end
            order by request.created_at desc, request.id desc
          )
          from public.term_remediation_requests request
          where request.case_id = case_row.id
        ), '[]'::jsonb),
        'changesSinceClose', coalesce((
          select jsonb_agg(private.safe_score_ledger_entry(ledger) order by ledger.created_at, ledger.id)
          from public.score_ledger ledger
          where ledger.score_account_id = case_row.score_account_id
            and ledger.entry_type in ('remediation_credit', 'appeal_adjustment')
            and ledger.created_at >= case_row.created_at
        ), '[]'::jsonb)
      ) as item,
      case when case_row.status = 'open' then 0 else 1 end as status_rank,
      term.school_year,
      term.semester,
      student.student_code
    from public.term_remediation_cases case_row
    join public.academic_terms term on term.id = case_row.source_term_id
    join public.students student on student.id = case_row.student_id
    join public.score_accounts account on account.id = case_row.score_account_id
    where (coalesce(p_include_passed, true) or case_row.status = 'open')
      and (
        v_all
        or (v_self_student_id is not null and case_row.student_id = v_self_student_id)
        or (
          v_teacher_id is not null
          and (
            private.teacher_has_student(case_row.student_id, null)
            or case_row.responsible_teacher_id = v_teacher_id
          )
        )
      )
  ) visible;

  return v_result;
end;
$$;

create or replace function public.admin_preview_term_transition_v1(p_next_term_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current_id bigint;
  v_check jsonb;
  v_students jsonb;
  v_threshold smallint := private.remediation_threshold();
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_next_term_id is null then
    raise exception 'Next term is required' using errcode = '22023';
  end if;

  select term.id into v_current_id
  from public.academic_terms term
  where term.status = 'active';

  v_check := private.term_transition_check(v_current_id, p_next_term_id);

  select coalesce(jsonb_agg(item order by sort_code), '[]'::jsonb)
  into v_students
  from (
    select jsonb_build_object(
             'studentId', student.id,
             'studentCode', student.student_code,
             'title', student.title,
             'givenName', student.given_name,
             'familyName', student.family_name,
             'nickname', student.nickname,
             'classroomName', classroom.display_name,
             'balance', account.balance,
             'accountMissing', account.id is null,
             'belowThreshold', account.balance < v_threshold,
             'carriedToNextTerm', exists (
               select 1 from public.enrollments next_enrollment
               where next_enrollment.term_id = p_next_term_id
                 and next_enrollment.student_id = base.student_id
                 and next_enrollment.is_active
             )
           ) as item,
           student.student_code as sort_code
    from (
      select account_row.student_id from public.score_accounts account_row where account_row.term_id = v_current_id
      union
      select enrollment_row.student_id from public.enrollments enrollment_row
      where enrollment_row.term_id = v_current_id and enrollment_row.is_active
    ) base
    join public.students student on student.id = base.student_id
    left join public.score_accounts account
      on account.term_id = v_current_id and account.student_id = base.student_id
    left join public.enrollments enrollment
      on enrollment.term_id = v_current_id and enrollment.student_id = base.student_id
    left join public.classrooms classroom on classroom.id = enrollment.classroom_id
  ) rows_for_preview;

  return v_check || jsonb_build_object('students', v_students);
end;
$$;

-- ---------------------------------------------------------------------------
-- Prepare the next semester (same school year only)
-- ---------------------------------------------------------------------------

create or replace function public.admin_prepare_next_term_v1(
  p_school_year smallint,
  p_semester smallint,
  p_name text,
  p_starts_on date,
  p_ends_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := nullif(btrim(p_name), '');
  v_source public.academic_terms%rowtype;
  v_target public.academic_terms%rowtype;
  v_prep public.academic_term_preparations%rowtype;
  v_hash text;
  v_classrooms integer := 0;
  v_enrollments integer := 0;
  v_assignments integer := 0;
  v_prep_id bigint;
  v_result jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_school_year is null or p_semester is null or p_starts_on is null or p_ends_on is null then
    raise exception 'School year, semester, start date, and end date are required' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) > 200 then
    raise exception 'Term name must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if p_starts_on > p_ends_on then
    raise exception 'Term start date must not be after its end date' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('school-point:academic-term-activation')
  );

  select term.* into v_source
  from public.academic_terms term
  where term.status = 'active'
  for share;

  if not found then
    raise exception 'An active term is required to prepare the next term' using errcode = 'P0002';
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'operation', 'admin_prepare_next_term_v1',
    'source_term_id', v_source.id,
    'school_year', p_school_year,
    'semester', p_semester,
    'name', v_name,
    'starts_on', p_starts_on,
    'ends_on', p_ends_on
  )::text, 'UTF8')), 'hex');

  select term.* into v_target
  from public.academic_terms term
  where term.school_year = p_school_year and term.semester = p_semester
  for update;

  if found then
    select prep.* into v_prep
    from public.academic_term_preparations prep
    where prep.target_term_id = v_target.id;

    if found then
      -- Compare against the original source term so a retry still replays
      -- after the transition has made the prepared term active.
      if v_prep.request_payload_hash <> encode(sha256(convert_to(jsonb_build_object(
           'operation', 'admin_prepare_next_term_v1',
           'source_term_id', v_prep.source_term_id,
           'school_year', p_school_year,
           'semester', p_semester,
           'name', v_name,
           'starts_on', p_starts_on,
           'ends_on', p_ends_on
         )::text, 'UTF8')), 'hex') then
        raise exception 'This term was already prepared with different values'
          using errcode = '22023';
      end if;
      select term.* into v_target from public.academic_terms term where term.id = v_target.id;
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'preparationId', v_prep.id,
        'term', private.academic_term_json(v_target),
        'sourceTermId', v_prep.source_term_id,
        'classroomCount', v_prep.classroom_count,
        'enrollmentCount', v_prep.enrollment_count,
        'assignmentCount', v_prep.assignment_count
      );
    end if;
  end if;

  -- Validate the requested term only for a first (non-replay) preparation.
  if p_school_year <> v_source.school_year or p_semester <> v_source.semester + 1 then
    raise exception 'The next term must be the following semester of the same school year'
      using errcode = '22023';
  end if;
  if v_source.ends_on is null or p_starts_on <= v_source.ends_on then
    raise exception 'The next term must start after the current term ends' using errcode = '22023';
  end if;

  if v_target.id is not null then
    if v_target.status <> 'planned' then
      raise exception 'The requested term is not planned' using errcode = '55000';
    end if;
    if exists (select 1 from public.classrooms classroom where classroom.term_id = v_target.id)
       or exists (select 1 from public.enrollments enrollment where enrollment.term_id = v_target.id)
       or exists (select 1 from public.teacher_classroom_assignments assignment where assignment.term_id = v_target.id) then
      raise exception 'The planned term already has a roster; review it and transition it directly'
        using errcode = '55000';
    end if;
    update public.academic_terms
    set name = v_name, starts_on = p_starts_on, ends_on = p_ends_on
    where id = v_target.id
    returning * into v_target;
  else
    insert into public.academic_terms(school_year, semester, name, starts_on, ends_on, status)
    values (p_school_year, p_semester, v_name, p_starts_on, p_ends_on, 'planned')
    returning * into v_target;
  end if;

  insert into public.classrooms(term_id, grade_level, room_number, display_name, is_active)
  select v_target.id, classroom.grade_level, classroom.room_number, classroom.display_name, true
  from public.classrooms classroom
  where classroom.term_id = v_source.id and classroom.is_active;
  get diagnostics v_classrooms = row_count;

  insert into public.enrollments(term_id, classroom_id, student_id, is_active, student_number)
  select v_target.id, next_classroom.id, enrollment.student_id, true, enrollment.student_number
  from public.enrollments enrollment
  join public.classrooms source_classroom
    on source_classroom.id = enrollment.classroom_id and source_classroom.is_active
  join public.classrooms next_classroom
    on next_classroom.term_id = v_target.id
   and next_classroom.grade_level = source_classroom.grade_level
   and next_classroom.room_number = source_classroom.room_number
  join public.students student on student.id = enrollment.student_id and student.status = 'active'
  where enrollment.term_id = v_source.id and enrollment.is_active;
  get diagnostics v_enrollments = row_count;

  insert into public.teacher_classroom_assignments(term_id, classroom_id, teacher_id, subject_name, is_active)
  select v_target.id, next_classroom.id, assignment.teacher_id, assignment.subject_name, true
  from public.teacher_classroom_assignments assignment
  join public.classrooms source_classroom
    on source_classroom.id = assignment.classroom_id and source_classroom.is_active
  join public.classrooms next_classroom
    on next_classroom.term_id = v_target.id
   and next_classroom.grade_level = source_classroom.grade_level
   and next_classroom.room_number = source_classroom.room_number
  join public.teachers teacher on teacher.id = assignment.teacher_id and teacher.status = 'active'
  where assignment.term_id = v_source.id and assignment.is_active;
  get diagnostics v_assignments = row_count;

  insert into public.academic_term_preparations(
    source_term_id, target_term_id, request_payload_hash,
    classroom_count, enrollment_count, assignment_count,
    prepared_by, prepared_by_snapshot
  ) values (
    v_source.id, v_target.id, v_hash,
    v_classrooms, v_enrollments, v_assignments,
    v_uid, private.actor_snapshot(v_uid)
  ) returning id into v_prep_id;

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'preparationId', v_prep_id,
    'term', private.academic_term_json(v_target),
    'sourceTermId', v_source.id,
    'classroomCount', v_classrooms,
    'enrollmentCount', v_enrollments,
    'assignmentCount', v_assignments
  );

  perform private.write_audit('admin_prepare_next_term_v1', 'academic_term', v_target.id::text, null, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic transition
-- ---------------------------------------------------------------------------

create or replace function public.admin_transition_term_v1(
  p_current_term_id bigint,
  p_next_term_id bigint,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_threshold smallint := private.remediation_threshold();
  v_hash text;
  v_existing public.academic_term_transitions%rowtype;
  v_check jsonb;
  v_blockers text;
  v_student_id bigint;
  v_snapshots integer := 0;
  v_missing integer := 0;
  v_cases integer := 0;
  v_enrolled integer := 0;
  v_initialized integer := 0;
  v_bad integer := 0;
  v_transition_id bigint;
  v_result jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_current_term_id is null or p_next_term_id is null or p_client_request_id is null then
    raise exception 'Current term, next term, and client request ID are required' using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'operation', 'admin_transition_term_v1',
    'current_term_id', p_current_term_id,
    'next_term_id', p_next_term_id
  )::text, 'UTF8')), 'hex');

  -- Same key as admin_activate_term and admin_prepare_next_term_v1.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('school-point:academic-term-activation')
  );

  select transition.* into v_existing
  from public.academic_term_transitions transition
  where transition.client_request_id = p_client_request_id;

  if found then
    if v_existing.request_payload_hash <> v_hash then
      raise exception 'Client request ID was already used for a different term transition'
        using errcode = '22023';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true, 'transitionId', v_existing.id);
  end if;

  -- Lock both term rows in id order. In-flight score writes hold FOR SHARE on
  -- the current term; this waits for them and blocks later ones.
  perform 1
  from public.academic_terms term
  where term.id in (p_current_term_id, p_next_term_id)
  order by term.id
  for update;

  v_check := private.term_transition_check(p_current_term_id, p_next_term_id);
  if jsonb_array_length(v_check -> 'blockers') > 0 then
    select string_agg(blocker.value, ', ') into v_blockers
    from jsonb_array_elements_text(v_check -> 'blockers') blocker;
    raise exception 'Term transition is blocked: %', v_blockers
      using errcode = '55000',
            detail = (v_check -> 'blockers')::text;
  end if;

  -- Immutable closing snapshot. Reads committed balances only; it never locks
  -- or writes the closing term's score accounts.
  insert into public.term_closing_snapshots(
    term_id, student_id, score_account_id, closing_balance, account_missing,
    threshold, classroom_id, closed_by
  )
  select p_current_term_id,
         base.student_id,
         account.id,
         account.balance,
         account.id is null,
         v_threshold,
         enrollment.classroom_id,
         v_uid
  from (
    select account_row.student_id from public.score_accounts account_row where account_row.term_id = p_current_term_id
    union
    select enrollment_row.student_id from public.enrollments enrollment_row
    where enrollment_row.term_id = p_current_term_id and enrollment_row.is_active
  ) base
  left join public.score_accounts account
    on account.term_id = p_current_term_id and account.student_id = base.student_id
  left join public.enrollments enrollment
    on enrollment.term_id = p_current_term_id and enrollment.student_id = base.student_id;
  get diagnostics v_snapshots = row_count;

  select count(*) into v_missing
  from public.term_closing_snapshots snapshot
  where snapshot.term_id = p_current_term_id and snapshot.account_missing;

  insert into public.term_remediation_cases(
    source_term_id, student_id, score_account_id, snapshot_id, closing_balance, threshold, status
  )
  select snapshot.term_id, snapshot.student_id, snapshot.score_account_id, snapshot.id,
         snapshot.closing_balance, snapshot.threshold, 'open'
  from public.term_closing_snapshots snapshot
  where snapshot.term_id = p_current_term_id
    and not snapshot.account_missing
    and snapshot.closing_balance < snapshot.threshold;
  get diagnostics v_cases = row_count;

  insert into private.term_write_authorizations(txid, kind, ref_id)
  values (pg_catalog.txid_current(), 'close_term', p_current_term_id);

  update public.academic_terms
  set status = 'closed'
  where id = p_current_term_id and status = 'active';
  if not found then
    raise exception 'Current term state changed; retry' using errcode = '40001';
  end if;

  delete from private.term_write_authorizations
  where txid = pg_catalog.txid_current() and kind = 'close_term' and ref_id = p_current_term_id;

  update public.academic_terms
  set status = 'active'
  where id = p_next_term_id and status = 'planned';
  if not found then
    raise exception 'Next term state changed; retry' using errcode = '40001';
  end if;

  for v_student_id in
    select enrollment.student_id
    from public.enrollments enrollment
    where enrollment.term_id = p_next_term_id and enrollment.is_active
    order by enrollment.student_id
  loop
    perform private.ensure_score_account(v_student_id, p_next_term_id, v_uid);
  end loop;

  select count(*) into v_enrolled
  from public.enrollments enrollment
  where enrollment.term_id = p_next_term_id and enrollment.is_active;

  select count(*) into v_initialized
  from public.score_accounts account
  where account.term_id = p_next_term_id;

  select count(*) into v_bad
  from public.score_accounts account
  where account.term_id = p_next_term_id
    and (
      account.balance <> 100
      or (select count(*) from public.score_ledger ledger
          where ledger.score_account_id = account.id) <> 1
    );

  if v_bad > 0 or v_initialized < v_enrolled then
    raise exception 'Next term score initialization check failed' using errcode = '55000';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'closedTermId', p_current_term_id,
    'activeTermId', p_next_term_id,
    'threshold', v_threshold,
    'snapshotCount', v_snapshots,
    'missingAccountCount', v_missing,
    'remediationCaseCount', v_cases,
    'initializedAccountCount', v_initialized,
    'transitionedAt', now()
  );

  insert into public.academic_term_transitions(
    from_term_id, to_term_id, client_request_id, request_payload_hash, threshold,
    snapshot_count, remediation_case_count, initialized_account_count, result,
    actor_user_id, actor_snapshot
  ) values (
    p_current_term_id, p_next_term_id, p_client_request_id, v_hash, v_threshold,
    v_snapshots, v_cases, v_initialized, v_result,
    v_uid, private.actor_snapshot(v_uid)
  ) returning id into v_transition_id;

  perform private.write_audit(
    'admin_transition_term_v1',
    'academic_term',
    p_current_term_id::text,
    jsonb_build_object('current_status', 'active', 'next_term_id', p_next_term_id, 'next_status', 'planned'),
    v_result || jsonb_build_object('transition_id', v_transition_id)
  );

  return v_result || jsonb_build_object('transitionId', v_transition_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Remediation workflow
-- ---------------------------------------------------------------------------

create or replace function public.request_term_remediation_v1(
  p_case_id bigint,
  p_points smallint,
  p_activity_occurred_at timestamptz,
  p_reason text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean := (select private.is_admin());
  v_teacher_id bigint := private.current_teacher_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_existing public.term_remediation_requests%rowtype;
  v_case public.term_remediation_cases%rowtype;
  v_term public.academic_terms%rowtype;
  v_request_id bigint;
  v_result jsonb;
begin
  if not v_is_admin and v_teacher_id is null then
    raise exception 'Teacher or administrator permission required' using errcode = '42501';
  end if;
  if p_case_id is null or p_client_request_id is null or p_activity_occurred_at is null then
    raise exception 'Case, activity time, and client request ID are required' using errcode = '22023';
  end if;
  if p_points is null or p_points not between 1 and 100 then
    raise exception 'Remediation points must be between 1 and 100' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 5 and 2000 then
    raise exception 'Reason must contain between 5 and 2000 characters' using errcode = '22023';
  end if;
  if p_activity_occurred_at > now() + interval '5 minutes' then
    raise exception 'Activity time cannot be in the future' using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'operation', 'request_term_remediation_v1',
    'case_id', p_case_id,
    'points', p_points,
    'activity_occurred_at_epoch', extract(epoch from p_activity_occurred_at),
    'reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('term-remediation-request:' || v_uid::text || ':' || p_client_request_id::text, 0)
  );

  select request.* into v_existing
  from public.term_remediation_requests request
  where request.requested_by = v_uid and request.client_request_id = p_client_request_id;

  if found then
    if v_existing.request_payload_hash <> v_hash then
      raise exception 'Client request ID was already used for a different remediation request'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'requestId', v_existing.id,
      'caseId', v_existing.case_id,
      'status', v_existing.status
    );
  end if;

  select case_row.* into v_case
  from public.term_remediation_cases case_row
  where case_row.id = p_case_id
  for share;

  if not found then
    raise exception 'Remediation case not found' using errcode = 'P0002';
  end if;
  if not private.can_manage_term_remediation(v_case.student_id, v_case.responsible_teacher_id) then
    raise exception 'Not authorized for this remediation case' using errcode = '42501';
  end if;
  if v_case.status <> 'open' then
    raise exception 'Remediation case has already passed' using errcode = '55000';
  end if;

  select term.* into v_term from public.academic_terms term where term.id = v_case.source_term_id;
  if v_term.starts_on is not null
     and (p_activity_occurred_at at time zone 'Asia/Bangkok')::date < v_term.starts_on then
    raise exception 'Activity time cannot be before the source term started' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.term_remediation_requests pending
    where pending.case_id = v_case.id and pending.status = 'pending'
  ) then
    raise exception 'A remediation request is already pending for this case' using errcode = '55000';
  end if;

  insert into public.term_remediation_requests(
    case_id, student_id, source_term_id, requested_points, activity_occurred_at, reason,
    requested_by, requested_by_snapshot, requested_by_role, client_request_id, request_payload_hash
  ) values (
    v_case.id, v_case.student_id, v_case.source_term_id, p_points, p_activity_occurred_at, v_reason,
    v_uid, private.actor_snapshot(v_uid),
    case when v_is_admin then 'admin'::public.app_role else 'teacher'::public.app_role end,
    p_client_request_id, v_hash
  ) returning id into v_request_id;

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'requestId', v_request_id,
    'caseId', v_case.id,
    'status', 'pending'
  );

  perform private.write_audit(
    'request_term_remediation_v1',
    'term_remediation_request',
    v_request_id::text,
    null,
    jsonb_build_object(
      'case_id', v_case.id,
      'source_term_id', v_case.source_term_id,
      'requested_points', p_points,
      'activity_occurred_at', p_activity_occurred_at
    )
  );

  return v_result;
end;
$$;

create or replace function public.review_term_remediation_v1(
  p_request_id bigint,
  p_approve boolean,
  p_review_note text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_note text := nullif(btrim(p_review_note), '');
  v_hash text;
  v_request public.term_remediation_requests%rowtype;
  v_case public.term_remediation_cases%rowtype;
  v_balance smallint;
  v_applied smallint;
  v_ledger public.score_ledger%rowtype;
  v_ledger_id bigint;
  v_case_status text;
  v_result jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_request_id is null or p_approve is null or p_client_request_id is null then
    raise exception 'Request, decision, and client request ID are required' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) not between 5 and 2000 then
    raise exception 'Review note must contain between 5 and 2000 characters' using errcode = '22023';
  end if;
  if not p_approve and v_note is null then
    raise exception 'A rejection note is required' using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'operation', 'review_term_remediation_v1',
    'request_id', p_request_id,
    'approve', p_approve,
    'note', v_note
  )::text, 'UTF8')), 'hex');

  -- Serializes all reviews of this request; the request row itself is only
  -- written at the end, after the account -> term -> case locks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('term-remediation-review:' || p_request_id::text, 0)
  );

  select request.* into v_request
  from public.term_remediation_requests request
  where request.review_client_request_id = p_client_request_id;

  if found then
    if v_request.id <> p_request_id or v_request.review_payload_hash <> v_hash then
      raise exception 'Client request ID was already used for a different remediation review'
        using errcode = '22023';
    end if;
    select ledger.* into v_ledger from public.score_ledger ledger where ledger.id = v_request.ledger_id;
    select case_row.status into v_case_status
    from public.term_remediation_cases case_row where case_row.id = v_request.case_id;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'requestId', v_request.id,
      'caseId', v_request.case_id,
      'status', v_request.status,
      'appliedPoints', v_ledger.applied_delta,
      'balanceBefore', v_ledger.balance_before,
      'balanceAfter', v_ledger.balance_after,
      'ledgerId', v_request.ledger_id,
      'caseStatus', v_case_status
    );
  end if;

  select request.* into v_request
  from public.term_remediation_requests request
  where request.id = p_request_id;

  if not found then
    raise exception 'Remediation request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Remediation request was already reviewed' using errcode = '55000';
  end if;

  select case_row.* into v_case
  from public.term_remediation_cases case_row
  where case_row.id = v_request.case_id;

  if p_approve then
    select account.balance into v_balance
    from public.score_accounts account
    where account.id = v_case.score_account_id
    for update;

    v_applied := least(v_request.requested_points::integer, (100 - v_balance)::integer)::smallint;

    insert into private.term_write_authorizations(txid, kind, ref_id)
    values (pg_catalog.txid_current(), 'remediation_credit', v_request.id);

    update public.score_accounts
    set balance = balance + v_applied
    where id = v_case.score_account_id;

    insert into public.score_ledger(
      score_account_id, student_id, term_id, entry_type,
      requested_delta, applied_delta, balance_before, balance_after,
      activity_occurred_at, internal_reason, reason,
      remediation_request_id, actor_user_id, actor_snapshot
    ) values (
      v_case.score_account_id, v_case.student_id, v_case.source_term_id, 'remediation_credit',
      v_request.requested_points, v_applied, v_balance, v_balance + v_applied,
      v_request.activity_occurred_at, v_request.reason,
      'ปรับคะแนนจากกิจกรรมแก้ไขพฤติกรรมของภาคเรียนเดิม',
      v_request.id, v_uid, private.actor_snapshot(v_uid)
    ) returning id into v_ledger_id;

    delete from private.term_write_authorizations
    where txid = pg_catalog.txid_current() and kind = 'remediation_credit' and ref_id = v_request.id;

    update public.term_remediation_requests
    set status = 'approved',
        approved_points = v_request.requested_points,
        reviewed_by = v_uid,
        reviewed_at = now(),
        review_note = v_note,
        review_client_request_id = p_client_request_id,
        review_payload_hash = v_hash,
        ledger_id = v_ledger_id
    where id = v_request.id and status = 'pending';
  else
    update public.term_remediation_requests
    set status = 'rejected',
        reviewed_by = v_uid,
        reviewed_at = now(),
        review_note = v_note,
        review_client_request_id = p_client_request_id,
        review_payload_hash = v_hash
    where id = v_request.id and status = 'pending';
  end if;

  if not found then
    raise exception 'Remediation request state changed; retry' using errcode = '40001';
  end if;

  select case_row.status into v_case_status
  from public.term_remediation_cases case_row where case_row.id = v_case.id;

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'requestId', v_request.id,
    'caseId', v_case.id,
    'status', case when p_approve then 'approved' else 'rejected' end,
    'appliedPoints', case when p_approve then v_applied end,
    'balanceBefore', case when p_approve then v_balance end,
    'balanceAfter', case when p_approve then v_balance + v_applied end,
    'ledgerId', v_ledger_id,
    'caseStatus', v_case_status
  );

  perform private.write_audit(
    'review_term_remediation_v1',
    'term_remediation_request',
    v_request.id::text,
    jsonb_build_object('status', 'pending', 'requested_points', v_request.requested_points),
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.admin_assign_term_remediation_teacher_v1(
  p_case_id bigint,
  p_teacher_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_case public.term_remediation_cases%rowtype;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_case_id is null then
    raise exception 'Case is required' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 5 and 2000 then
    raise exception 'Reason must contain between 5 and 2000 characters' using errcode = '22023';
  end if;
  if p_teacher_id is not null and not exists (
    select 1
    from public.teachers teacher
    join public.profiles profile
      on profile.user_id = teacher.user_id
     and profile.role = 'teacher'::public.app_role
     and profile.is_active
    where teacher.id = p_teacher_id
      and teacher.status = 'active'
      and teacher.intended_role = 'teacher'::public.app_role
  ) then
    raise exception 'Active teacher required' using errcode = '22023';
  end if;

  select case_row.* into v_case
  from public.term_remediation_cases case_row
  where case_row.id = p_case_id
  for update;

  if not found then
    raise exception 'Remediation case not found' using errcode = 'P0002';
  end if;

  if v_case.responsible_teacher_id is not distinct from p_teacher_id then
    return jsonb_build_object('ok', true, 'updated', false, 'caseId', v_case.id,
                              'responsibleTeacherId', p_teacher_id);
  end if;

  update public.term_remediation_cases
  set responsible_teacher_id = p_teacher_id
  where id = v_case.id;

  perform private.write_audit(
    'admin_assign_term_remediation_teacher_v1',
    'term_remediation_case',
    v_case.id::text,
    jsonb_build_object('responsible_teacher_id', v_case.responsible_teacher_id),
    jsonb_build_object('responsible_teacher_id', p_teacher_id, 'reason', v_reason)
  );

  return jsonb_build_object('ok', true, 'updated', true, 'caseId', v_case.id,
                            'responsibleTeacherId', p_teacher_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.list_academic_terms_v1()',
    'public.get_term_history_v1(bigint,bigint)',
    'public.list_term_remediations_v1(boolean)',
    'public.admin_preview_term_transition_v1(bigint)',
    'public.admin_prepare_next_term_v1(smallint,smallint,text,date,date)',
    'public.admin_transition_term_v1(bigint,bigint,uuid)',
    'public.request_term_remediation_v1(bigint,smallint,timestamptz,text,uuid)',
    'public.review_term_remediation_v1(bigint,boolean,text,uuid)',
    'public.admin_assign_term_remediation_teacher_v1(bigint,bigint,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;

comment on function public.admin_transition_term_v1(bigint, bigint, uuid) is
  'Atomically close the active term with immutable per-student snapshots, open remediation cases below the threshold, activate the prepared next term, and open every next-term account at 100. Idempotent per client request ID.';
comment on function public.review_term_remediation_v1(bigint, boolean, text, uuid) is
  'Administrator decision on a remediation request. Approval credits the ORIGINAL closed-term account (capped at 100) and never the active term.';

commit;
