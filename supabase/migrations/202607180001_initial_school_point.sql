begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.app_role as enum ('student', 'teacher', 'admin');
create type public.person_status as enum ('active', 'suspended', 'graduated', 'archived');
create type public.term_status as enum ('planned', 'active', 'closed');
create type public.rule_severity as enum ('low', 'medium', 'serious', 'critical');
create type public.request_status as enum ('pending', 'approved', 'rejected');
create type public.appeal_status as enum ('submitted', 'reviewing', 'accepted', 'rejected');
create type public.case_status as enum ('open', 'following_up', 'resolved');
create type public.score_entry_type as enum ('semester_opening', 'deduction', 'teacher_request_approved', 'admin_addition', 'appeal_reversal');

-- Auth profile. Passwords remain in Supabase Auth and never enter these tables.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  display_name text not null check (nullif(btrim(display_name), '') is not null),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.academic_terms (
  id bigint generated always as identity primary key,
  school_year smallint not null check (school_year between 2500 and 3000),
  semester smallint not null check (semester between 1 and 3),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status public.term_status not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_year, semester),
  check (starts_on <= ends_on)
);

create unique index academic_terms_one_active_idx
  on public.academic_terms ((1)) where status = 'active';

create table public.classrooms (
  id bigint generated always as identity primary key,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  grade_level text not null check (grade_level in ('P1','P2','P3','P4','P5','P6','M1','M2','M3')),
  room_number text not null,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_id, grade_level, room_number),
  unique (id, term_id)
);

create table public.students (
  id bigint generated always as identity primary key,
  user_id uuid unique references public.profiles(user_id) on delete set null,
  student_code text not null check (nullif(btrim(student_code), '') is not null),
  title text,
  given_name text not null check (nullif(btrim(given_name), '') is not null),
  family_name text not null check (nullif(btrim(family_name), '') is not null),
  status public.person_status not null default 'active',
  graduation_confirmed_at timestamptz,
  graduation_confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'graduated' and graduation_confirmed_at is not null) or status <> 'graduated')
);

create unique index students_code_ci_idx on public.students (lower(btrim(student_code)));

create table public.teachers (
  id bigint generated always as identity primary key,
  user_id uuid unique references public.profiles(user_id) on delete set null,
  employee_code text not null check (nullif(btrim(employee_code), '') is not null),
  title text,
  given_name text not null check (nullif(btrim(given_name), '') is not null),
  family_name text not null check (nullif(btrim(family_name), '') is not null),
  status public.person_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index teachers_code_ci_idx on public.teachers (lower(btrim(employee_code)));

-- PII and activation data are deliberately outside the API-exposed public schema.
create table private.student_private_identities (
  student_id bigint primary key references public.students(id) on delete restrict,
  birth_date date,
  updated_at timestamptz not null default now()
);

create table private.login_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_normalized text generated always as (lower(btrim(username))) stored unique,
  created_at timestamptz not null default now()
);

create table private.account_activations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 20),
  issued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create unique index account_activations_one_open_idx
  on private.account_activations(user_id) where used_at is null;

create table public.enrollments (
  id bigint generated always as identity primary key,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  classroom_id bigint not null,
  student_id bigint not null references public.students(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, term_id),
  foreign key (classroom_id, term_id) references public.classrooms(id, term_id) on delete restrict
);

create table public.teacher_classroom_assignments (
  id bigint generated always as identity primary key,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  classroom_id bigint not null,
  teacher_id bigint not null references public.teachers(id) on delete restrict,
  subject_name text not null default 'ประจำชั้น',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_id, classroom_id, teacher_id, subject_name),
  foreign key (classroom_id, term_id) references public.classrooms(id, term_id) on delete restrict
);

create table public.behavior_rules (
  id bigint generated always as identity primary key,
  rule_code text not null unique,
  category text not null,
  title_th text not null,
  description_th text,
  default_deduction smallint not null check (default_deduction between 1 and 100),
  severity public.rule_severity not null default 'low',
  guardian_contact_required boolean not null default false,
  is_active boolean not null default true,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table public.score_accounts (
  id bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete restrict,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  balance smallint not null default 100 check (balance between 0 and 100),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, term_id),
  unique (id, student_id, term_id)
);

create table public.incidents (
  id bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete restrict,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  classroom_id bigint not null,
  rule_id bigint not null references public.behavior_rules(id) on delete restrict,
  rule_snapshot jsonb not null,
  requested_points smallint not null check (requested_points between 1 and 100),
  applied_points smallint not null check (applied_points between 0 and 100 and applied_points <= requested_points),
  severity public.rule_severity not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  appeal_deadline timestamptz not null,
  student_visible_note text,
  internal_note text,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_by_snapshot text not null,
  is_voided boolean not null default false,
  correction_reason text,
  corrected_at timestamptz,
  corrected_by uuid references auth.users(id) on delete set null,
  foreign key (classroom_id, term_id) references public.classrooms(id, term_id) on delete restrict,
  check (appeal_deadline >= recorded_at),
  check ((not is_voided and correction_reason is null and corrected_at is null) or (is_voided and nullif(btrim(correction_reason), '') is not null and corrected_at is not null))
);

create table public.point_addition_requests (
  id bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete restrict,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  requested_points smallint not null check (requested_points between 1 and 100),
  reason text not null check (nullif(btrim(reason), '') is not null),
  evidence_note text,
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_snapshot text not null,
  status public.request_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check ((status = 'pending' and reviewed_at is null) or (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null))
);

create table public.appeals (
  id bigint generated always as identity primary key,
  incident_id bigint not null unique references public.incidents(id) on delete restrict,
  student_id bigint not null references public.students(id) on delete restrict,
  reason text not null check (nullif(btrim(reason), '') is not null),
  status public.appeal_status not null default 'submitted',
  decision_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.follow_up_cases (
  id bigint generated always as identity primary key,
  incident_id bigint not null unique references public.incidents(id) on delete restrict,
  student_id bigint not null references public.students(id) on delete restrict,
  opened_in_term_id bigint not null references public.academic_terms(id) on delete restrict,
  status public.case_status not null default 'open',
  carry_over_required boolean not null default true,
  internal_note text,
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'resolved' and resolved_at is not null) or status <> 'resolved')
);

create table public.guardian_contact_tasks (
  id bigint generated always as identity primary key,
  incident_id bigint not null unique references public.incidents(id) on delete restrict,
  student_id bigint not null references public.students(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  note text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null
);

create table public.score_ledger (
  id bigint generated always as identity primary key,
  score_account_id bigint not null,
  student_id bigint not null,
  term_id bigint not null,
  entry_type public.score_entry_type not null,
  requested_delta smallint not null,
  applied_delta smallint not null,
  balance_before smallint not null check (balance_before between 0 and 100),
  balance_after smallint not null check (balance_after between 0 and 100),
  incident_id bigint references public.incidents(id) on delete restrict,
  addition_request_id bigint references public.point_addition_requests(id) on delete restrict,
  reason text not null check (nullif(btrim(reason), '') is not null),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_snapshot text not null,
  created_at timestamptz not null default now(),
  foreign key (score_account_id, student_id, term_id) references public.score_accounts(id, student_id, term_id) on delete restrict,
  check (balance_after = balance_before + applied_delta),
  check ((entry_type = 'deduction' and requested_delta < 0 and applied_delta between -100 and 0) or
         (entry_type = 'semester_opening' and requested_delta = 100 and applied_delta = 100 and balance_before = 0 and balance_after = 100) or
         (entry_type in ('teacher_request_approved','admin_addition','appeal_reversal') and requested_delta > 0 and applied_delta between 0 and 100))
);

create unique index score_ledger_incident_type_idx
  on public.score_ledger(incident_id, entry_type) where incident_id is not null;
create unique index score_ledger_request_idx
  on public.score_ledger(addition_request_id) where addition_request_id is not null;

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

-- Foreign keys and columns used by RLS/common lists need explicit indexes in Postgres.
create index classrooms_term_idx on public.classrooms(term_id, is_active);
create index enrollments_class_term_idx on public.enrollments(classroom_id, term_id, is_active);
create index enrollments_student_term_idx on public.enrollments(student_id, term_id, is_active);
create index assignments_teacher_term_idx on public.teacher_classroom_assignments(teacher_id, term_id, is_active);
create index assignments_class_term_idx on public.teacher_classroom_assignments(classroom_id, term_id, is_active);
create index incidents_student_term_date_idx on public.incidents(student_id, term_id, occurred_at desc);
create index incidents_class_term_date_idx on public.incidents(classroom_id, term_id, occurred_at desc);
create index incidents_recorded_by_idx on public.incidents(recorded_by);
create index point_requests_status_date_idx on public.point_addition_requests(status, created_at);
create index point_requests_requester_idx on public.point_addition_requests(requested_by, created_at desc);
create index appeals_student_date_idx on public.appeals(student_id, created_at desc);
create index cases_student_status_idx on public.follow_up_cases(student_id, status);
create index guardian_tasks_student_status_idx on public.guardian_contact_tasks(student_id, status);
create index score_accounts_term_student_idx on public.score_accounts(term_id, student_id);
create index ledger_student_term_date_idx on public.score_ledger(student_id, term_id, created_at desc);
create index ledger_account_date_idx on public.score_ledger(score_account_id, created_at desc);
create index audit_entity_date_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.reject_immutable_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

create or replace function private.current_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.user_id = (select auth.uid()) and p.is_active
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.user_id = (select auth.uid()) and p.is_active), false)
$$;

create or replace function private.current_student_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select s.id from public.students s join public.profiles p on p.user_id = s.user_id
  where s.user_id = (select auth.uid()) and p.role = 'student' and p.is_active and s.status = 'active'
$$;

create or replace function private.teacher_has_student(p_student_id bigint, p_term_id bigint default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.teachers t
    join public.teacher_classroom_assignments a on a.teacher_id = t.id and a.is_active
    join public.enrollments e on e.classroom_id = a.classroom_id and e.term_id = a.term_id and e.is_active
    where t.user_id = (select auth.uid()) and t.status = 'active'
      and e.student_id = p_student_id and (p_term_id is null or e.term_id = p_term_id)
  )
$$;

create or replace function private.actor_snapshot(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select p.display_name from public.profiles p where p.user_id = p_user_id), 'บัญชีระบบ')
$$;

create or replace function private.write_audit(p_action text, p_entity_type text, p_entity_id text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, before_state, after_state)
  values ((select auth.uid()), p_action, p_entity_type, p_entity_id, p_before, p_after)
$$;

create or replace function private.ensure_score_account(p_student_id bigint, p_term_id bigint, p_actor uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_account_id bigint;
  v_actor_name text := private.actor_snapshot(p_actor);
begin
  insert into public.score_accounts(student_id, term_id, balance)
  values (p_student_id, p_term_id, 100)
  on conflict (student_id, term_id) do nothing
  returning id into v_account_id;

  if v_account_id is not null then
    insert into public.score_ledger(
      score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta,
      balance_before, balance_after, reason, actor_user_id, actor_snapshot
    ) values (
      v_account_id, p_student_id, p_term_id, 'semester_opening', 100, 100,
      0, 100, 'เปิดคะแนนประจำภาคเรียน', p_actor, v_actor_name
    );
  else
    select a.id into strict v_account_id from public.score_accounts a
    where a.student_id = p_student_id and a.term_id = p_term_id;
  end if;
  return v_account_id;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger terms_updated_at before update on public.academic_terms for each row execute function private.set_updated_at();
create trigger classrooms_updated_at before update on public.classrooms for each row execute function private.set_updated_at();
create trigger students_updated_at before update on public.students for each row execute function private.set_updated_at();
create trigger teachers_updated_at before update on public.teachers for each row execute function private.set_updated_at();
create trigger enrollments_updated_at before update on public.enrollments for each row execute function private.set_updated_at();
create trigger assignments_updated_at before update on public.teacher_classroom_assignments for each row execute function private.set_updated_at();
create trigger rules_updated_at before update on public.behavior_rules for each row execute function private.set_updated_at();
create trigger accounts_updated_at before update on public.score_accounts for each row execute function private.set_updated_at();
create trigger cases_updated_at before update on public.follow_up_cases for each row execute function private.set_updated_at();
create trigger score_ledger_immutable before update or delete on public.score_ledger for each row execute function private.reject_immutable_change();
create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function private.reject_immutable_change();

create or replace function public.record_deduction(
  p_student_id bigint,
  p_rule_id bigint,
  p_occurred_at timestamptz default now(),
  p_student_visible_note text default null,
  p_internal_note text default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.app_role := private.current_role();
  v_rule public.behavior_rules%rowtype;
  v_term_id bigint;
  v_classroom_id bigint;
  v_account_id bigint;
  v_balance smallint;
  v_applied smallint;
  v_incident_id bigint;
  v_actor_name text;
begin
  if v_uid is null or v_role not in ('teacher','admin') then
    raise exception 'Teacher or administrator permission required' using errcode = '42501';
  end if;

  select e.term_id, e.classroom_id into v_term_id, v_classroom_id
  from public.enrollments e join public.academic_terms t on t.id = e.term_id
  where e.student_id = p_student_id and e.is_active and t.status = 'active'
  order by e.id limit 1;

  if v_term_id is null then raise exception 'Student has no active enrollment' using errcode = 'P0002'; end if;
  if v_role = 'teacher' and not private.teacher_has_student(p_student_id, v_term_id) then
    raise exception 'Teacher is not assigned to this classroom' using errcode = '42501';
  end if;

  select * into v_rule from public.behavior_rules r where r.id = p_rule_id and r.is_active for share;
  if not found then raise exception 'Rule not found or inactive' using errcode = 'P0002'; end if;

  v_account_id := private.ensure_score_account(p_student_id, v_term_id, v_uid);
  select balance into v_balance from public.score_accounts where id = v_account_id for update;
  v_applied := least(v_balance::integer, v_rule.default_deduction::integer)::smallint;
  v_actor_name := private.actor_snapshot(v_uid);

  insert into public.incidents(
    student_id, term_id, classroom_id, rule_id, rule_snapshot, requested_points,
    applied_points, severity, occurred_at, appeal_deadline, student_visible_note,
    internal_note, recorded_by, recorded_by_snapshot
  ) values (
    p_student_id, v_term_id, v_classroom_id, v_rule.id,
    jsonb_build_object('rule_code', v_rule.rule_code, 'title_th', v_rule.title_th, 'points', v_rule.default_deduction, 'severity', v_rule.severity),
    v_rule.default_deduction, v_applied, v_rule.severity, p_occurred_at,
    now() + interval '7 days', nullif(btrim(p_student_visible_note), ''),
    nullif(btrim(p_internal_note), ''), v_uid, v_actor_name
  ) returning id into v_incident_id;

  update public.score_accounts set balance = balance - v_applied where id = v_account_id;
  insert into public.score_ledger(
    score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta,
    balance_before, balance_after, incident_id, reason, actor_user_id, actor_snapshot
  ) values (
    v_account_id, p_student_id, v_term_id, 'deduction', -v_rule.default_deduction,
    -v_applied, v_balance, v_balance - v_applied, v_incident_id,
    v_rule.title_th, v_uid, v_actor_name
  );

  if v_rule.severity in ('serious','critical') then
    insert into public.follow_up_cases(incident_id, student_id, opened_in_term_id, internal_note, opened_by)
    values (v_incident_id, p_student_id, v_term_id, p_internal_note, v_uid);
    if v_rule.guardian_contact_required then
      insert into public.guardian_contact_tasks(incident_id, student_id, note)
      values (v_incident_id, p_student_id, 'ต้องติดต่อผู้ปกครองสำหรับเหตุการณ์ร้ายแรง');
    end if;
  end if;

  perform private.write_audit('record_deduction', 'incident', v_incident_id::text, null,
    jsonb_build_object('student_id', p_student_id, 'requested_points', v_rule.default_deduction, 'applied_points', v_applied, 'balance_before', v_balance, 'balance_after', v_balance - v_applied));
  return v_incident_id;
end;
$$;

create or replace function public.request_point_addition(p_student_id bigint, p_points smallint, p_reason text, p_evidence_note text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_term_id bigint;
  v_request_id bigint;
begin
  if private.current_role() <> 'teacher' then raise exception 'Teacher permission required' using errcode = '42501'; end if;
  if p_points not between 1 and 100 or nullif(btrim(p_reason), '') is null then raise exception 'Valid points and reason are required' using errcode = '22023'; end if;
  select e.term_id into v_term_id from public.enrollments e join public.academic_terms t on t.id = e.term_id
  where e.student_id = p_student_id and e.is_active and t.status = 'active' limit 1;
  if v_term_id is null or not private.teacher_has_student(p_student_id, v_term_id) then raise exception 'Teacher is not assigned to this student' using errcode = '42501'; end if;
  insert into public.point_addition_requests(student_id, term_id, requested_points, reason, evidence_note, requested_by, requested_by_snapshot)
  values (p_student_id, v_term_id, p_points, btrim(p_reason), nullif(btrim(p_evidence_note), ''), v_uid, private.actor_snapshot(v_uid))
  returning id into v_request_id;
  perform private.write_audit('request_point_addition', 'point_addition_request', v_request_id::text, null, jsonb_build_object('student_id', p_student_id, 'points', p_points));
  return v_request_id;
end;
$$;

create or replace function public.review_point_addition(p_request_id bigint, p_approve boolean, p_review_note text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_request public.point_addition_requests%rowtype;
  v_account_id bigint;
  v_balance smallint;
  v_applied smallint;
  v_ledger_id bigint;
begin
  if not private.is_admin() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  select * into v_request from public.point_addition_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then raise exception 'Request already reviewed' using errcode = '55000'; end if;
  if not p_approve then
    if nullif(btrim(p_review_note), '') is null then raise exception 'Rejection note required' using errcode = '22023'; end if;
    update public.point_addition_requests set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_note = btrim(p_review_note) where id = p_request_id;
    perform private.write_audit('reject_point_addition', 'point_addition_request', p_request_id::text, to_jsonb(v_request), jsonb_build_object('status','rejected','note',p_review_note));
    return null;
  end if;
  v_account_id := private.ensure_score_account(v_request.student_id, v_request.term_id, v_uid);
  select balance into v_balance from public.score_accounts where id = v_account_id for update;
  v_applied := least(v_request.requested_points::integer, (100 - v_balance)::integer)::smallint;
  update public.score_accounts set balance = balance + v_applied where id = v_account_id;
  update public.point_addition_requests set status = 'approved', reviewed_by = v_uid, reviewed_at = now(), review_note = nullif(btrim(p_review_note), '') where id = p_request_id;
  insert into public.score_ledger(
    score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta,
    balance_before, balance_after, addition_request_id, reason, actor_user_id, actor_snapshot
  ) values (
    v_account_id, v_request.student_id, v_request.term_id, 'teacher_request_approved',
    v_request.requested_points, v_applied, v_balance, v_balance + v_applied,
    v_request.id, v_request.reason, v_uid, private.actor_snapshot(v_uid)
  ) returning id into v_ledger_id;
  perform private.write_audit('approve_point_addition', 'point_addition_request', p_request_id::text, to_jsonb(v_request), jsonb_build_object('status','approved','applied_points',v_applied,'ledger_id',v_ledger_id));
  return v_ledger_id;
end;
$$;

create or replace function public.admin_add_points(p_student_id bigint, p_points smallint, p_reason text, p_term_id bigint default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_term_id bigint;
  v_account_id bigint;
  v_balance smallint;
  v_applied smallint;
  v_ledger_id bigint;
begin
  if not private.is_admin() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  if p_points not between 1 and 100 or nullif(btrim(p_reason), '') is null then raise exception 'Valid points and reason are required' using errcode = '22023'; end if;
  select e.term_id into v_term_id from public.enrollments e join public.academic_terms t on t.id = e.term_id
  where e.student_id = p_student_id and e.is_active and t.status = 'active' and (p_term_id is null or e.term_id = p_term_id) limit 1;
  if v_term_id is null then raise exception 'No active enrollment' using errcode = 'P0002'; end if;
  v_account_id := private.ensure_score_account(p_student_id, v_term_id, v_uid);
  select balance into v_balance from public.score_accounts where id = v_account_id for update;
  v_applied := least(p_points::integer, (100 - v_balance)::integer)::smallint;
  update public.score_accounts set balance = balance + v_applied where id = v_account_id;
  insert into public.score_ledger(
    score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta,
    balance_before, balance_after, reason, actor_user_id, actor_snapshot
  ) values (
    v_account_id, p_student_id, v_term_id, 'admin_addition', p_points, v_applied,
    v_balance, v_balance + v_applied, btrim(p_reason), v_uid, private.actor_snapshot(v_uid)
  ) returning id into v_ledger_id;
  perform private.write_audit('admin_add_points', 'score_ledger', v_ledger_id::text, null, jsonb_build_object('student_id',p_student_id,'requested_points',p_points,'applied_points',v_applied));
  return v_ledger_id;
end;
$$;

create or replace function public.submit_appeal(p_incident_id bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_student_id bigint := private.current_student_id();
  v_incident public.incidents%rowtype;
  v_appeal_id bigint;
begin
  if v_student_id is null then raise exception 'Student permission required' using errcode = '42501'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Reason required' using errcode = '22023'; end if;
  select * into v_incident from public.incidents where id = p_incident_id for update;
  if not found or v_incident.student_id <> v_student_id then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  if v_incident.is_voided or now() > v_incident.appeal_deadline then raise exception 'Appeal period expired or incident corrected' using errcode = '22023'; end if;
  insert into public.appeals(incident_id, student_id, reason) values (p_incident_id, v_student_id, btrim(p_reason)) returning id into v_appeal_id;
  perform private.write_audit('submit_appeal', 'appeal', v_appeal_id::text, null, jsonb_build_object('incident_id',p_incident_id,'student_id',v_student_id));
  return v_appeal_id;
end;
$$;

create or replace function public.review_appeal(p_appeal_id bigint, p_accept boolean, p_decision_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_appeal public.appeals%rowtype;
  v_incident public.incidents%rowtype;
  v_account_id bigint;
  v_balance smallint;
  v_restore smallint;
  v_ledger_id bigint;
begin
  if not private.is_admin() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  if nullif(btrim(p_decision_note), '') is null then raise exception 'Decision note required' using errcode = '22023'; end if;
  select * into v_appeal from public.appeals where id = p_appeal_id for update;
  if not found then raise exception 'Appeal not found' using errcode = 'P0002'; end if;
  if v_appeal.status not in ('submitted','reviewing') then raise exception 'Appeal already decided' using errcode = '55000'; end if;

  if not p_accept then
    update public.appeals set status = 'rejected', decision_note = btrim(p_decision_note), decided_by = v_uid, decided_at = now()
    where id = p_appeal_id;
    perform private.write_audit('reject_appeal','appeal',p_appeal_id::text,to_jsonb(v_appeal),jsonb_build_object('status','rejected','note',p_decision_note));
    return null;
  end if;

  select * into v_incident from public.incidents where id = v_appeal.incident_id for update;
  if v_incident.is_voided then raise exception 'Incident already corrected' using errcode = '55000'; end if;
  v_account_id := private.ensure_score_account(v_incident.student_id, v_incident.term_id, v_uid);
  select balance into v_balance from public.score_accounts where id = v_account_id for update;
  v_restore := least(v_incident.applied_points::integer, (100 - v_balance)::integer)::smallint;
  update public.score_accounts set balance = balance + v_restore where id = v_account_id;
  insert into public.score_ledger(
    score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta,
    balance_before, balance_after, incident_id, reason, actor_user_id, actor_snapshot
  ) values (
    v_account_id, v_incident.student_id, v_incident.term_id, 'appeal_reversal',
    v_incident.applied_points, v_restore, v_balance, v_balance + v_restore,
    v_incident.id, 'คืนคะแนนจากคำอุทธรณ์ที่ได้รับอนุมัติ', v_uid, private.actor_snapshot(v_uid)
  ) returning id into v_ledger_id;
  update public.incidents set is_voided = true, correction_reason = btrim(p_decision_note), corrected_at = now(), corrected_by = v_uid
  where id = v_incident.id;
  update public.appeals set status = 'accepted', decision_note = btrim(p_decision_note), decided_by = v_uid, decided_at = now()
  where id = p_appeal_id;
  perform private.write_audit('accept_appeal','appeal',p_appeal_id::text,to_jsonb(v_appeal),jsonb_build_object('status','accepted','restored_points',v_restore,'ledger_id',v_ledger_id));
  return v_ledger_id;
end;
$$;

create or replace function public.initialize_term_scores(p_term_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_student_id bigint;
  v_total bigint;
begin
  if not private.is_admin() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  if not exists (select 1 from public.academic_terms where id = p_term_id and status in ('planned','active')) then raise exception 'Term unavailable' using errcode = 'P0002'; end if;
  for v_student_id in select e.student_id from public.enrollments e where e.term_id = p_term_id and e.is_active order by e.student_id loop
    perform private.ensure_score_account(v_student_id, p_term_id, v_uid);
  end loop;
  select count(*) into v_total from public.score_accounts where term_id = p_term_id;
  perform private.write_audit('initialize_term_scores','academic_term',p_term_id::text,null,jsonb_build_object('initialized_accounts',v_total));
  return v_total;
end;
$$;

-- Students use these views; actor identity is intentionally absent.
create view public.student_current_scores with (security_barrier = true, security_invoker = true) as
select a.id as score_account_id, a.term_id, t.name as term_name, a.balance, a.updated_at
from public.score_accounts a
join public.students s on s.id = a.student_id
join public.academic_terms t on t.id = a.term_id
where s.user_id = (select auth.uid());

create view public.student_score_history with (security_barrier = true, security_invoker = true) as
select l.id, l.term_id, l.entry_type, l.requested_delta, l.applied_delta,
       l.balance_before, l.balance_after, l.reason, l.incident_id, l.created_at
from public.score_ledger l
join public.students s on s.id = l.student_id
where s.user_id = (select auth.uid());

create view public.student_incident_history with (security_barrier = true, security_invoker = true) as
select i.id, i.term_id, i.rule_snapshot ->> 'rule_code' as rule_code,
       i.rule_snapshot ->> 'title_th' as rule_title, i.requested_points,
       i.applied_points, i.severity, i.occurred_at, i.recorded_at,
       i.appeal_deadline, i.student_visible_note, i.is_voided,
       a.id as appeal_id, a.status as appeal_status, a.decision_note
from public.incidents i
join public.students s on s.id = i.student_id
left join public.appeals a on a.incident_id = i.id
where s.user_id = (select auth.uid());

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'profiles','academic_terms','classrooms','students','teachers','enrollments',
    'teacher_classroom_assignments','behavior_rules','score_accounts','incidents',
    'point_addition_requests','appeals','follow_up_cases','guardian_contact_tasks',
    'score_ledger','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
  end loop;
end;
$$;

alter table private.student_private_identities enable row level security;
alter table private.student_private_identities force row level security;
alter table private.login_identities enable row level security;
alter table private.login_identities force row level security;
alter table private.account_activations enable row level security;
alter table private.account_activations force row level security;
-- No RLS policies on private tables: only postgres/service_role can access them.

create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy students_select on public.students for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()) or private.teacher_has_student(id, null));
create policy teachers_select on public.teachers for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy terms_select on public.academic_terms for select to authenticated using (true);
create policy rules_select on public.behavior_rules for select to authenticated using (is_active or (select private.is_admin()));
create policy classrooms_select on public.classrooms for select to authenticated using (
  (select private.is_admin()) or exists (
    select 1 from public.enrollments e join public.students s on s.id = e.student_id
    where e.classroom_id = classrooms.id and e.term_id = classrooms.term_id and s.user_id = (select auth.uid())
  ) or exists (
    select 1 from public.teacher_classroom_assignments a join public.teachers t on t.id = a.teacher_id
    where a.classroom_id = classrooms.id and a.term_id = classrooms.term_id and a.is_active and t.user_id = (select auth.uid())
  )
);
create policy enrollments_select on public.enrollments for select to authenticated using (
  (select private.is_admin()) or exists (select 1 from public.students s where s.id = enrollments.student_id and s.user_id = (select auth.uid()))
  or exists (select 1 from public.teacher_classroom_assignments a join public.teachers t on t.id = a.teacher_id where a.classroom_id = enrollments.classroom_id and a.term_id = enrollments.term_id and a.is_active and t.user_id = (select auth.uid()))
);
create policy assignments_select on public.teacher_classroom_assignments for select to authenticated using (
  (select private.is_admin()) or exists (select 1 from public.teachers t where t.id = teacher_classroom_assignments.teacher_id and t.user_id = (select auth.uid()))
);
create policy score_accounts_select on public.score_accounts for select to authenticated using (
  (select private.is_admin()) or private.teacher_has_student(student_id, term_id)
  or exists (select 1 from public.students s where s.id = score_accounts.student_id and s.user_id = (select auth.uid()))
);
create policy incidents_staff_select on public.incidents for select to authenticated
  using ((select private.is_admin()) or private.teacher_has_student(student_id, term_id));
create policy ledger_staff_select on public.score_ledger for select to authenticated
  using ((select private.is_admin()) or private.teacher_has_student(student_id, term_id));
create policy requests_staff_select on public.point_addition_requests for select to authenticated
  using ((select private.is_admin()) or requested_by = (select auth.uid()));
create policy appeals_select on public.appeals for select to authenticated using (
  (select private.is_admin()) or exists (select 1 from public.students s where s.id = appeals.student_id and s.user_id = (select auth.uid()))
  or private.teacher_has_student(student_id, null)
);
create policy cases_staff_select on public.follow_up_cases for select to authenticated
  using ((select private.is_admin()) or private.teacher_has_student(student_id, opened_in_term_id));
create policy guardian_tasks_staff_select on public.guardian_contact_tasks for select to authenticated
  using ((select private.is_admin()) or private.teacher_has_student(student_id, null));
create policy audit_admin_select on public.audit_logs for select to authenticated using ((select private.is_admin()));

-- Admin-managed master data. Score changes are intentionally RPC-only.
create policy profiles_admin_write on public.profiles for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy terms_admin_write on public.academic_terms for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy classrooms_admin_write on public.classrooms for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy students_admin_write on public.students for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy teachers_admin_write on public.teachers for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy enrollments_admin_write on public.enrollments for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy assignments_admin_write on public.teacher_classroom_assignments for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy rules_admin_write on public.behavior_rules for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.academic_terms, public.classrooms, public.students,
  public.teachers, public.enrollments, public.teacher_classroom_assignments,
  public.behavior_rules, public.score_accounts, public.incidents,
  public.point_addition_requests, public.appeals, public.follow_up_cases,
  public.guardian_contact_tasks, public.score_ledger, public.audit_logs to authenticated;
grant insert, update on public.profiles, public.academic_terms, public.classrooms,
  public.students, public.teachers, public.enrollments,
  public.teacher_classroom_assignments, public.behavior_rules to authenticated;
grant select on public.student_current_scores, public.student_score_history, public.student_incident_history to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant usage on schema private to authenticated;
revoke all on function private.actor_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.write_audit(text,text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function private.ensure_score_account(bigint,bigint,uuid) from public, anon, authenticated;
grant execute on function private.current_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.current_student_id() to authenticated;
grant execute on function private.teacher_has_student(bigint,bigint) to authenticated;

revoke all on function public.record_deduction(bigint,bigint,timestamptz,text,text) from public, anon;
revoke all on function public.request_point_addition(bigint,smallint,text,text) from public, anon;
revoke all on function public.review_point_addition(bigint,boolean,text) from public, anon;
revoke all on function public.admin_add_points(bigint,smallint,text,bigint) from public, anon;
revoke all on function public.submit_appeal(bigint,text) from public, anon;
revoke all on function public.review_appeal(bigint,boolean,text) from public, anon;
revoke all on function public.initialize_term_scores(bigint) from public, anon;
grant execute on function public.record_deduction(bigint,bigint,timestamptz,text,text) to authenticated;
grant execute on function public.request_point_addition(bigint,smallint,text,text) to authenticated;
grant execute on function public.review_point_addition(bigint,boolean,text) to authenticated;
grant execute on function public.admin_add_points(bigint,smallint,text,bigint) to authenticated;
grant execute on function public.submit_appeal(bigint,text) to authenticated;
grant execute on function public.review_appeal(bigint,boolean,text) to authenticated;
grant execute on function public.initialize_term_scores(bigint) to authenticated;

commit;
