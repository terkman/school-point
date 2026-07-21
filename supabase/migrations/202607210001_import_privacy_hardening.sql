begin;

-- Import/privacy hardening layered on top of 202607180001_initial_school_point.sql.
-- This migration contains schema and reusable import plumbing only. It intentionally
-- contains no school data, credentials, activation tokens, or other secrets.

-- An import plan knows the academic year/semester before the exact calendar is
-- always available. Planned terms may therefore omit dates; dates are mandatory
-- before the term becomes active or closed.
alter table public.academic_terms alter column starts_on drop not null;
alter table public.academic_terms alter column ends_on drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'academic_terms_dates_pair'
      and conrelid = 'public.academic_terms'::regclass
  ) then
    alter table public.academic_terms
      add constraint academic_terms_dates_pair
      check (
        (starts_on is null and ends_on is null)
        or (starts_on is not null and ends_on is not null and starts_on <= ends_on)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'academic_terms_active_dates_required'
      and conrelid = 'public.academic_terms'::regclass
  ) then
    alter table public.academic_terms
      add constraint academic_terms_active_dates_required
      check (status = 'planned' or (starts_on is not null and ends_on is not null));
  end if;
end;
$$;

-- A magic-link/OTP session used for first-time activation may read its own profile,
-- but it must not gain school-data or score privileges until a first password has
-- actually been stored by Supabase Auth.
alter table public.profiles
  add column if not exists activation_required boolean not null default true;

-- Preserve access for accounts that pre-date this migration and already have a
-- password. Passwordless accounts remain gated.
update public.profiles profile
set activation_required = case
  when nullif(btrim(auth_user.encrypted_password), '') is not null then false
  else true
end
from auth.users auth_user
where auth_user.id = profile.user_id;

create or replace function private.clear_activation_after_first_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(old.encrypted_password), '') is null
     and nullif(btrim(new.encrypted_password), '') is not null then
    update public.profiles
    set activation_required = false
    where user_id = new.id
      and activation_required;
  end if;
  return new;
end;
$$;

drop trigger if exists school_point_clear_activation_after_password on auth.users;
create trigger school_point_clear_activation_after_password
after update of encrypted_password on auth.users
for each row
when (
  nullif(btrim(old.encrypted_password), '') is null
  and nullif(btrim(new.encrypted_password), '') is not null
)
execute function private.clear_activation_after_first_password();

-- A blank room in the source workbook means the school has one room for that grade.
-- Store it canonically as room "0"; presentation code may hide the suffix.
update public.classrooms
set room_number = '0'
where nullif(btrim(room_number), '') is null;

update public.classrooms
set room_number = btrim(room_number)
where room_number <> btrim(room_number);

alter table public.classrooms alter column room_number set default '0';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'classrooms_room_number_not_blank'
      and conrelid = 'public.classrooms'::regclass
  ) then
    alter table public.classrooms
      add constraint classrooms_room_number_not_blank
      check (nullif(btrim(room_number), '') is not null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'classrooms_display_name_not_blank'
      and conrelid = 'public.classrooms'::regclass
  ) then
    alter table public.classrooms
      add constraint classrooms_display_name_not_blank
      check (nullif(btrim(display_name), '') is not null);
  end if;
end;
$$;

-- The original unique constraint is case/whitespace-sensitive. This index is the
-- natural key used by imports and prevents "0" and " 0 " from becoming two rooms.
create unique index if not exists classrooms_term_grade_room_normalized_idx
  on public.classrooms (term_id, grade_level, (lower(btrim(room_number))));

-- A roll number belongs to a classroom enrollment and may change each term.
alter table public.enrollments add column if not exists student_number smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'enrollments_student_number_positive'
      and conrelid = 'public.enrollments'::regclass
  ) then
    alter table public.enrollments
      add constraint enrollments_student_number_positive
      check (student_number is null or student_number between 1 and 9999);
  end if;
end;
$$;

create index if not exists enrollments_class_student_number_idx
  on public.enrollments (classroom_id, student_number)
  where is_active and student_number is not null;

-- Keep the intended account role with the staff master row while the Auth account
-- is still waiting to be provisioned. Both teachers and admins may be imported.
alter table public.teachers
  add column if not exists intended_role public.app_role not null default 'teacher';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'teachers_intended_role_staff_only'
      and conrelid = 'public.teachers'::regclass
  ) then
    alter table public.teachers
      add constraint teachers_intended_role_staff_only
      check (intended_role in ('teacher', 'admin'));
  end if;
end;
$$;

-- Positive actions have their own catalogue because deduction rules are consumed
-- directly by record_deduction(). A nullable default supports "ตามพิจารณา" while
-- max_addition still bounds what a later approval workflow may request.
create table if not exists public.positive_behavior_rules (
  id bigint generated always as identity primary key,
  rule_code text not null unique check (nullif(btrim(rule_code), '') is not null),
  category text not null check (nullif(btrim(category), '') is not null),
  title_th text not null check (nullif(btrim(title_th), '') is not null),
  description_th text,
  default_addition smallint check (default_addition between 1 and 100),
  max_addition smallint not null default 100 check (max_addition between 1 and 100),
  is_discretionary boolean not null default false,
  is_active boolean not null default true,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (default_addition is null or default_addition <= max_addition),
  check (is_discretionary or default_addition is not null),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

alter table public.point_addition_requests
  add column if not exists positive_rule_id bigint
    references public.positive_behavior_rules(id) on delete restrict;
alter table public.point_addition_requests
  add column if not exists rule_snapshot jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'point_requests_rule_snapshot_required'
      and conrelid = 'public.point_addition_requests'::regclass
  ) then
    alter table public.point_addition_requests
      add constraint point_requests_rule_snapshot_required
      check (positive_rule_id is null or rule_snapshot is not null);
  end if;
end;
$$;

create trigger positive_rules_updated_at
before update on public.positive_behavior_rules
for each row execute function private.set_updated_at();

alter table public.positive_behavior_rules enable row level security;
alter table public.positive_behavior_rules force row level security;

create policy positive_rules_select on public.positive_behavior_rules
for select to authenticated
using (is_active or (select private.is_admin()));

create policy positive_rules_admin_write on public.positive_behavior_rules
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

-- Guardian details are PII. They deliberately live outside the API-exposed public
-- schema. Public guardian_contact_tasks contain workflow state, never phone numbers.
create table if not exists private.student_guardian_contacts (
  id bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete restrict,
  contact_order smallint not null default 1 check (contact_order between 1 and 20),
  contact_name text,
  relationship text,
  phone_number text,
  is_primary boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, contact_order),
  check (
    nullif(btrim(contact_name), '') is not null
    or nullif(btrim(relationship), '') is not null
    or nullif(btrim(phone_number), '') is not null
  )
);

create unique index if not exists student_guardian_one_primary_idx
  on private.student_guardian_contacts (student_id)
  where is_primary and is_active;

create index if not exists student_guardian_student_active_idx
  on private.student_guardian_contacts (student_id, is_active, contact_order);

-- Import rows may exist before Auth users do. This private queue gives a trusted
-- Edge Function/server enough information to provision accounts later without ever
-- putting passwords or activation codes in the import artifact.
create table if not exists private.account_provisioning_queue (
  id bigint generated always as identity primary key,
  student_id bigint unique references public.students(id) on delete restrict,
  teacher_id bigint unique references public.teachers(id) on delete restrict,
  username text not null check (nullif(btrim(username), '') is not null),
  username_normalized text generated always as (lower(btrim(username))) stored unique,
  intended_role public.app_role not null,
  status text not null default 'pending'
    check (status in ('pending', 'provisioned', 'disabled')),
  linked_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(student_id, teacher_id) = 1),
  check (
    (student_id is not null and intended_role = 'student')
    or (teacher_id is not null and intended_role in ('teacher', 'admin'))
  )
);

create index if not exists account_provisioning_pending_idx
  on private.account_provisioning_queue (created_at, id)
  where status = 'pending';

-- Store only import metadata and aggregate counts. The payload itself may contain
-- PII and is never retained here or in the public audit log.
create table if not exists private.import_batches (
  id bigint generated always as identity primary key,
  schema_version text not null,
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  row_counts jsonb not null default '{}'::jsonb,
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz not null default now()
);

create index if not exists import_batches_applied_at_idx
  on private.import_batches (applied_at desc);

create or replace function private.normalize_room_number(p_room_number text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(p_room_number), ''), '0')
$$;

create or replace function private.classroom_display_name(
  p_grade_level text,
  p_room_number text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select
    case p_grade_level
      when 'P1' then 'ป.1'
      when 'P2' then 'ป.2'
      when 'P3' then 'ป.3'
      when 'P4' then 'ป.4'
      when 'P5' then 'ป.5'
      when 'P6' then 'ป.6'
      when 'M1' then 'ม.1'
      when 'M2' then 'ม.2'
      when 'M3' then 'ม.3'
      else p_grade_level
    end
    || case
         when private.normalize_room_number(p_room_number) = '0' then ''
         else '/' || private.normalize_room_number(p_room_number)
       end
$$;

create or replace function private.try_iso_date(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

create or replace function private.try_smallint(p_value text)
returns smallint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[0-9]+$' then
    return null;
  end if;
  return p_value::smallint;
exception when numeric_value_out_of_range then
  return null;
end;
$$;

create or replace function private.is_valid_username(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    char_length(btrim(p_value)) between 1 and 64
    and lower(btrim(p_value)) ~ '^[a-z0-9._-]+$'
    and left(lower(btrim(p_value)), 1) <> '.'
    and right(lower(btrim(p_value)), 1) <> '.'
    and strpos(lower(btrim(p_value)), '..') = 0,
    false
  )
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'account_provisioning_username_valid'
      and conrelid = 'private.account_provisioning_queue'::regclass
  ) then
    alter table private.account_provisioning_queue
      add constraint account_provisioning_username_valid
      check (private.is_valid_username(username));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'login_identities_username_valid'
      and conrelid = 'private.login_identities'::regclass
  ) then
    alter table private.login_identities
      add constraint login_identities_username_valid
      check (private.is_valid_username(username));
  end if;
end;
$$;

create trigger student_private_identities_updated_at
before update on private.student_private_identities
for each row execute function private.set_updated_at();

create trigger student_guardian_contacts_updated_at
before update on private.student_guardian_contacts
for each row execute function private.set_updated_at();

create trigger account_provisioning_queue_updated_at
before update on private.account_provisioning_queue
for each row execute function private.set_updated_at();

alter table private.student_guardian_contacts enable row level security;
alter table private.student_guardian_contacts force row level security;
alter table private.account_provisioning_queue enable row level security;
alter table private.account_provisioning_queue force row level security;
alter table private.import_batches enable row level security;
alter table private.import_batches force row level security;
-- No policies are created for these private tables. Only trusted server/service
-- processes and narrowly-authorized SECURITY DEFINER functions may use them.

-- Tighten the helper used by RLS/RPCs: an assignment only grants teacher access
-- while both the teacher profile and staff row are active and have teacher role.
create or replace function private.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles profile
  where profile.user_id = (select auth.uid())
    and profile.is_active
    and not profile.activation_required
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select profile.role = 'admin'
    from public.profiles profile
    where profile.user_id = (select auth.uid())
      and profile.is_active
      and not profile.activation_required
  ), false)
$$;

create or replace function private.current_student_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select student.id
  from public.students student
  join public.profiles profile on profile.user_id = student.user_id
  where student.user_id = (select auth.uid())
    and student.status = 'active'
    and profile.role = 'student'
    and profile.is_active
    and not profile.activation_required
$$;

create or replace function private.teacher_has_student(
  p_student_id bigint,
  p_term_id bigint default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teachers t
    join public.profiles p
      on p.user_id = t.user_id
     and p.role = 'teacher'
     and p.is_active
     and not p.activation_required
    join public.teacher_classroom_assignments a
      on a.teacher_id = t.id
     and a.is_active
    join public.enrollments e
      on e.classroom_id = a.classroom_id
     and e.term_id = a.term_id
     and e.is_active
    join public.academic_terms term
      on term.id = e.term_id
     and term.status = 'active'
    where t.user_id = (select auth.uid())
      and t.status = 'active'
      and t.intended_role = 'teacher'
      and e.student_id = p_student_id
      and (p_term_id is null or e.term_id = p_term_id)
  )
$$;

-- Rebuild identity/scope policies so a deactivated profile or staff row cannot keep
-- reading roster metadata through an old JWT.
drop policy if exists terms_select on public.academic_terms;
create policy terms_select on public.academic_terms
for select to authenticated
using ((select private.current_role()) is not null);

drop policy if exists rules_select on public.behavior_rules;
create policy rules_select on public.behavior_rules
for select to authenticated
using (
  (select private.current_role()) is not null
  and (is_active or (select private.is_admin()))
);

drop policy if exists positive_rules_select on public.positive_behavior_rules;
create policy positive_rules_select on public.positive_behavior_rules
for select to authenticated
using (
  (select private.current_role()) is not null
  and (is_active or (select private.is_admin()))
);

drop policy if exists teachers_select on public.teachers;
create policy teachers_select on public.teachers
for select to authenticated
using (
  (select private.is_admin())
  or (
    user_id = (select auth.uid())
    and (select private.current_role()) = 'teacher'
    and status = 'active'
    and intended_role = 'teacher'
  )
);

drop policy if exists students_select on public.students;
create policy students_select on public.students
for select to authenticated
using (
  id = (select private.current_student_id())
  or (select private.is_admin())
  or private.teacher_has_student(id, null)
);

drop policy if exists classrooms_select on public.classrooms;
create policy classrooms_select on public.classrooms
for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.enrollments enrollment
    join public.students student on student.id = enrollment.student_id
    join public.profiles profile on profile.user_id = student.user_id
    where enrollment.classroom_id = classrooms.id
      and enrollment.term_id = classrooms.term_id
      and enrollment.is_active
      and student.status = 'active'
      and student.user_id = (select auth.uid())
      and profile.role = 'student'
      and profile.is_active
      and not profile.activation_required
  )
  or exists (
    select 1
    from public.teacher_classroom_assignments assignment
    join public.teachers teacher on teacher.id = assignment.teacher_id
    join public.profiles profile on profile.user_id = teacher.user_id
    join public.academic_terms term
      on term.id = assignment.term_id
     and term.status = 'active'
    where assignment.classroom_id = classrooms.id
      and assignment.term_id = classrooms.term_id
      and assignment.is_active
      and teacher.status = 'active'
      and teacher.intended_role = 'teacher'
      and teacher.user_id = (select auth.uid())
      and profile.role = 'teacher'
      and profile.is_active
      and not profile.activation_required
  )
);

drop policy if exists enrollments_select on public.enrollments;
create policy enrollments_select on public.enrollments
for select to authenticated
using (
  (select private.is_admin())
  or student_id = (select private.current_student_id())
  or private.teacher_has_student(student_id, term_id)
);

drop policy if exists assignments_select on public.teacher_classroom_assignments;
create policy assignments_select on public.teacher_classroom_assignments
for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.teachers teacher
    join public.profiles profile on profile.user_id = teacher.user_id
    join public.academic_terms term
      on term.id = teacher_classroom_assignments.term_id
     and term.status = 'active'
    where teacher.id = teacher_classroom_assignments.teacher_id
      and teacher.status = 'active'
      and teacher.intended_role = 'teacher'
      and teacher.user_id = (select auth.uid())
      and profile.role = 'teacher'
      and profile.is_active
      and not profile.activation_required
  )
);

drop policy if exists score_accounts_select on public.score_accounts;
create policy score_accounts_select on public.score_accounts
for select to authenticated
using (
  (select private.is_admin())
  or private.teacher_has_student(student_id, null)
  or student_id = (select private.current_student_id())
);

drop policy if exists incidents_staff_select on public.incidents;
create policy incidents_staff_select on public.incidents
for select to authenticated
using (
  (select private.is_admin())
  or private.teacher_has_student(student_id, null)
);

drop policy if exists ledger_staff_select on public.score_ledger;
create policy ledger_staff_select on public.score_ledger
for select to authenticated
using (
  (select private.is_admin())
  or private.teacher_has_student(student_id, null)
);

drop policy if exists requests_staff_select on public.point_addition_requests;
create policy requests_staff_select on public.point_addition_requests
for select to authenticated
using (
  (select private.is_admin())
  or (
    requested_by = (select auth.uid())
    and (select private.current_role()) = 'teacher'
    and private.teacher_has_student(student_id, null)
    and exists (
      select 1
      from public.teachers teacher
      where teacher.user_id = (select auth.uid())
        and teacher.status = 'active'
        and teacher.intended_role = 'teacher'
    )
  )
);

-- Student access to appeal status goes through the redacted student view. Direct
-- table access is for assigned staff/admin only because the table has actor UUIDs.
drop policy if exists appeals_select on public.appeals;
drop policy if exists appeals_staff_select on public.appeals;
create policy appeals_staff_select on public.appeals
for select to authenticated
using (
  (select private.is_admin())
  or private.teacher_has_student(student_id, null)
);

drop policy if exists cases_staff_select on public.follow_up_cases;
create policy cases_staff_select on public.follow_up_cases
for select to authenticated
using (
  (select private.is_admin())
  or private.teacher_has_student(student_id, null)
);

-- Keep the existing view contract and append the appeal timestamp requested by the
-- real-data loader. Actor identity remains intentionally absent.
create or replace view public.student_current_scores
with (security_barrier = true)
as
select account.id as score_account_id,
       account.term_id,
       term.name as term_name,
       account.balance,
       account.updated_at
from public.score_accounts account
join public.students student on student.id = account.student_id
join public.profiles profile on profile.user_id = student.user_id
join public.academic_terms term on term.id = account.term_id
where student.user_id = (select auth.uid())
  and student.status = 'active'
  and profile.role = 'student'
  and profile.is_active
  and not profile.activation_required;

create or replace view public.student_score_history
with (security_barrier = true)
as
select ledger.id,
       ledger.term_id,
       ledger.entry_type,
       ledger.requested_delta,
       ledger.applied_delta,
       ledger.balance_before,
       ledger.balance_after,
       ledger.reason,
       ledger.incident_id,
       ledger.created_at
from public.score_ledger ledger
join public.students student on student.id = ledger.student_id
join public.profiles profile on profile.user_id = student.user_id
where student.user_id = (select auth.uid())
  and student.status = 'active'
  and profile.role = 'student'
  and profile.is_active
  and not profile.activation_required;

create or replace view public.student_incident_history
with (security_barrier = true)
as
select i.id,
       i.term_id,
       i.rule_snapshot ->> 'rule_code' as rule_code,
       i.rule_snapshot ->> 'title_th' as rule_title,
       i.requested_points,
       i.applied_points,
       i.severity,
       i.occurred_at,
       i.recorded_at,
       i.appeal_deadline,
       i.student_visible_note,
       i.is_voided,
       a.id as appeal_id,
       a.status as appeal_status,
       a.decision_note,
       a.created_at as appeal_created_at
from public.incidents i
join public.students s on s.id = i.student_id
join public.profiles p on p.user_id = s.user_id
left join public.appeals a on a.incident_id = i.id
where s.user_id = (select auth.uid())
  and s.status = 'active'
  and p.role = 'student'
  and p.is_active
  and not p.activation_required;

-- Replace the two teacher mutation RPCs whose original role comparisons treated a
-- NULL role as false. Activation-gated sessions now fail before any score write.
create or replace function public.record_deduction(
  p_student_id bigint,
  p_rule_id bigint,
  p_occurred_at timestamptz default now(),
  p_student_visible_note text default null,
  p_internal_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
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
  if v_uid is null or v_role is null or v_role not in ('teacher', 'admin') then
    raise exception 'Teacher or administrator permission required' using errcode = '42501';
  end if;

  select enrollment.term_id, enrollment.classroom_id
  into v_term_id, v_classroom_id
  from public.enrollments enrollment
  join public.academic_terms term on term.id = enrollment.term_id
  where enrollment.student_id = p_student_id
    and enrollment.is_active
    and term.status = 'active'
  order by enrollment.id
  limit 1;

  if v_term_id is null then
    raise exception 'Student has no active enrollment' using errcode = 'P0002';
  end if;

  if v_role = 'teacher' and not private.teacher_has_student(p_student_id, v_term_id) then
    raise exception 'Teacher is not assigned to this classroom' using errcode = '42501';
  end if;

  select * into v_rule
  from public.behavior_rules rule
  where rule.id = p_rule_id and rule.is_active
  for share;

  if not found then
    raise exception 'Rule not found or inactive' using errcode = 'P0002';
  end if;

  v_account_id := private.ensure_score_account(p_student_id, v_term_id, v_uid);
  select balance into v_balance
  from public.score_accounts
  where id = v_account_id
  for update;

  v_applied := least(v_balance::integer, v_rule.default_deduction::integer)::smallint;
  v_actor_name := private.actor_snapshot(v_uid);

  insert into public.incidents(
    student_id, term_id, classroom_id, rule_id, rule_snapshot, requested_points,
    applied_points, severity, occurred_at, appeal_deadline, student_visible_note,
    internal_note, recorded_by, recorded_by_snapshot
  ) values (
    p_student_id, v_term_id, v_classroom_id, v_rule.id,
    jsonb_build_object(
      'rule_code', v_rule.rule_code,
      'title_th', v_rule.title_th,
      'points', v_rule.default_deduction,
      'severity', v_rule.severity
    ),
    v_rule.default_deduction, v_applied, v_rule.severity, p_occurred_at,
    now() + interval '7 days', nullif(btrim(p_student_visible_note), ''),
    nullif(btrim(p_internal_note), ''), v_uid, v_actor_name
  ) returning id into v_incident_id;

  update public.score_accounts
  set balance = balance - v_applied
  where id = v_account_id;

  insert into public.score_ledger(
    score_account_id, student_id, term_id, entry_type, requested_delta,
    applied_delta, balance_before, balance_after, incident_id, reason,
    actor_user_id, actor_snapshot
  ) values (
    v_account_id, p_student_id, v_term_id, 'deduction', -v_rule.default_deduction,
    -v_applied, v_balance, v_balance - v_applied, v_incident_id,
    v_rule.title_th, v_uid, v_actor_name
  );

  if v_rule.severity in ('serious', 'critical') then
    insert into public.follow_up_cases(
      incident_id, student_id, opened_in_term_id, internal_note, opened_by
    ) values (
      v_incident_id, p_student_id, v_term_id, p_internal_note, v_uid
    );

    if v_rule.guardian_contact_required then
      insert into public.guardian_contact_tasks(incident_id, student_id, note)
      values (
        v_incident_id,
        p_student_id,
        'ต้องติดต่อผู้ปกครองสำหรับเหตุการณ์ร้ายแรง'
      );
    end if;
  end if;

  perform private.write_audit(
    'record_deduction',
    'incident',
    v_incident_id::text,
    null,
    jsonb_build_object(
      'student_id', p_student_id,
      'requested_points', v_rule.default_deduction,
      'applied_points', v_applied,
      'balance_before', v_balance,
      'balance_after', v_balance - v_applied
    )
  );

  return v_incident_id;
end;
$$;

create or replace function public.request_point_addition(
  p_student_id bigint,
  p_points smallint,
  p_reason text,
  p_evidence_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_term_id bigint;
  v_request_id bigint;
begin
  if private.current_role() is distinct from 'teacher'::public.app_role then
    raise exception 'Teacher permission required' using errcode = '42501';
  end if;

  if p_points not between 1 and 100 or nullif(btrim(p_reason), '') is null then
    raise exception 'Valid points and reason are required' using errcode = '22023';
  end if;

  select enrollment.term_id into v_term_id
  from public.enrollments enrollment
  join public.academic_terms term on term.id = enrollment.term_id
  where enrollment.student_id = p_student_id
    and enrollment.is_active
    and term.status = 'active'
  limit 1;

  if v_term_id is null or not private.teacher_has_student(p_student_id, v_term_id) then
    raise exception 'Teacher is not assigned to this student' using errcode = '42501';
  end if;

  insert into public.point_addition_requests(
    student_id, term_id, requested_points, reason, evidence_note,
    requested_by, requested_by_snapshot
  ) values (
    p_student_id, v_term_id, p_points, btrim(p_reason),
    nullif(btrim(p_evidence_note), ''), v_uid, private.actor_snapshot(v_uid)
  ) returning id into v_request_id;

  perform private.write_audit(
    'request_point_addition',
    'point_addition_request',
    v_request_id::text,
    null,
    jsonb_build_object('student_id', p_student_id, 'points', p_points)
  );

  return v_request_id;
end;
$$;

-- Return guardian PII only for a concrete contact task and only to its assigned
-- teacher or an administrator. There is no general guardian-directory endpoint.
create or replace function public.get_guardian_contacts_for_task(p_task_id bigint)
returns table (
  contact_id bigint,
  contact_name text,
  relationship text,
  phone_number text,
  is_primary boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_id bigint;
  v_role public.app_role := private.current_role();
begin
  if v_role is null or v_role not in ('teacher', 'admin') then
    raise exception 'Staff permission required' using errcode = '42501';
  end if;

  select task.student_id
  into v_student_id
  from public.guardian_contact_tasks task
  where task.id = p_task_id;

  if v_student_id is null then
    raise exception 'Guardian contact task not found' using errcode = 'P0002';
  end if;

  if v_role = 'teacher' and not private.teacher_has_student(v_student_id, null) then
    raise exception 'Teacher is not assigned to this student' using errcode = '42501';
  end if;

  return query
  select contact.id,
         contact.contact_name,
         contact.relationship,
         contact.phone_number,
         contact.is_primary
  from private.student_guardian_contacts contact
  where contact.student_id = v_student_id
    and contact.is_active
  order by contact.is_primary desc, contact.contact_order, contact.id;
end;
$$;

create or replace function public.complete_guardian_contact_task(
  p_task_id bigint,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.app_role := private.current_role();
  v_task public.guardian_contact_tasks%rowtype;
begin
  if v_role is null or v_role not in ('teacher', 'admin') then
    raise exception 'Staff permission required' using errcode = '42501';
  end if;

  select task.*
  into v_task
  from public.guardian_contact_tasks task
  where task.id = p_task_id
  for update of task;

  if not found then
    raise exception 'Guardian contact task not found' using errcode = 'P0002';
  end if;

  if v_role = 'teacher' and not private.teacher_has_student(v_task.student_id, null) then
    raise exception 'Teacher is not assigned to this student' using errcode = '42501';
  end if;

  if v_task.status = 'completed' then
    return v_task.id;
  end if;

  if v_task.status = 'cancelled' then
    raise exception 'Cancelled task cannot be completed' using errcode = '55000';
  end if;

  update public.guardian_contact_tasks
  set status = 'completed',
      note = coalesce(nullif(btrim(p_note), ''), note),
      completed_at = now(),
      completed_by = v_uid
  where id = p_task_id;

  perform private.write_audit(
    'complete_guardian_contact_task',
    'guardian_contact_task',
    p_task_id::text,
    jsonb_build_object('status', v_task.status),
    jsonb_build_object('status', 'completed')
  );

  return p_task_id;
end;
$$;

-- Validate and atomically apply a normalized school-point-import/v1 JSON plan.
-- Natural keys are studentCode, employeeCode, and (term, gradeLevel, roomNumber).
-- A dry run performs validation only. Missing optional values never erase known PII.
create or replace function public.admin_import_school_data(
  p_payload jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_schema_version text;
  v_client_fingerprint text;
  v_fingerprint text;
  v_errors jsonb := '[]'::jsonb;
  v_counts jsonb;
  v_item jsonb;
  v_school_year smallint;
  v_semester smallint;
  v_term_id bigint;
  v_term_starts_on date;
  v_term_ends_on date;
  v_assignment_term_id bigint;
  v_student_id bigint;
  v_teacher_id bigint;
  v_classroom_id bigint;
  v_batch_id bigint;
  v_room_number text;
  v_grade_level text;
  v_display_name text;
  v_code text;
  v_username text;
  v_role public.app_role;
  v_student_number smallint;
  v_birth_date date;
  v_is_active boolean;
begin
  -- Import is intentionally server-only. auth.role() comes from the verified JWT;
  -- session_user permits migrations/tests run directly by trusted database owners.
  if coalesce((select auth.role()), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Trusted server permission required' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'dryRun', p_dry_run,
      'errors', jsonb_build_array(jsonb_build_object('path', '$', 'code', 'object_required'))
    );
  end if;

  v_schema_version := p_payload ->> 'schemaVersion';
  v_client_fingerprint := nullif(lower(btrim(p_payload ->> 'fingerprint')), '');
  -- Never trust the caller's fingerprint for locking or idempotency. jsonb::text has
  -- canonical object-key ordering, and removing the claimed hash prevents a stale
  -- client value from making a changed payload look already applied.
  v_fingerprint := encode(
    sha256(convert_to((p_payload - 'fingerprint')::text, 'UTF8')),
    'hex'
  );

  if v_schema_version is distinct from 'school-point-import/v1' then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.schemaVersion', 'code', 'unsupported_schema_version')
    );
  end if;

  if v_client_fingerprint is not null
     and v_client_fingerprint !~ '^[0-9a-f]{64}$' then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.fingerprint', 'code', 'invalid_client_fingerprint')
    );
  end if;

  foreach v_code in array array['classrooms', 'students', 'guardians', 'staff', 'assignments'] loop
    if p_payload ? v_code and jsonb_typeof(p_payload -> v_code) <> 'array' then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.' || v_code, 'code', 'array_required')
      );
    end if;
  end loop;

  if jsonb_typeof(p_payload -> 'term') <> 'object'
     or coalesce(p_payload #>> '{term,schoolYear}', '') !~ '^[0-9]{4}$'
     or coalesce(p_payload #>> '{term,semester}', '') !~ '^[1-3]$' then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.term', 'code', 'valid_term_required')
    );
  else
    v_school_year := (p_payload #>> '{term,schoolYear}')::smallint;
    v_semester := (p_payload #>> '{term,semester}')::smallint;

    select term.id into v_term_id
    from public.academic_terms term
    where term.school_year = v_school_year
      and term.semester = v_semester;

    v_term_starts_on := private.try_iso_date(nullif(btrim(p_payload #>> '{term,startsOn}'), ''));
    v_term_ends_on := private.try_iso_date(nullif(btrim(p_payload #>> '{term,endsOn}'), ''));

    if (nullif(btrim(p_payload #>> '{term,startsOn}'), '') is null)
       <> (nullif(btrim(p_payload #>> '{term,endsOn}'), '') is null) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.term', 'code', 'term_dates_must_be_a_pair')
      );
    elsif (nullif(btrim(p_payload #>> '{term,startsOn}'), '') is not null)
          and (v_term_starts_on is null or v_term_ends_on is null) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.term', 'code', 'invalid_term_dates')
      );
    elsif v_term_starts_on is not null and v_term_starts_on > v_term_ends_on then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.term', 'code', 'term_dates_out_of_order')
      );
    end if;
  end if;

  -- Stop before array expansion if any array has an invalid JSON type.
  if exists (
    select 1
    from jsonb_array_elements(v_errors) error
    where error ->> 'code' = 'array_required'
  ) then
    return jsonb_build_object('ok', false, 'dryRun', p_dry_run, 'errors', v_errors);
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'classrooms', '[]'::jsonb))
  loop
    v_grade_level := v_item ->> 'gradeLevel';
    if jsonb_typeof(v_item) <> 'object'
       or v_grade_level is null
       or v_grade_level not in ('P1','P2','P3','P4','P5','P6','M1','M2','M3') then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.classrooms[]', 'code', 'invalid_classroom')
      );
    end if;
  end loop;

  -- Student validation. Empty optional values are accepted and can be filled later.
  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb))
  loop
    v_code := nullif(btrim(v_item ->> 'studentCode'), '');
    v_grade_level := v_item ->> 'gradeLevel';

    if jsonb_typeof(v_item) <> 'object'
       or v_code is null
       or nullif(btrim(v_item ->> 'givenName'), '') is null
       or nullif(btrim(v_item ->> 'familyName'), '') is null then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[]', 'code', 'student_required_fields')
      );
    end if;

    if v_code is not null and not private.is_valid_username(v_code) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[].studentCode', 'code', 'invalid_username', 'studentCode', v_code)
      );
    end if;

    if v_grade_level is null
       or v_grade_level not in ('P1','P2','P3','P4','P5','P6','M1','M2','M3') then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[]', 'code', 'invalid_grade_level', 'studentCode', v_code)
      );
    end if;

    if v_item ? 'birthDate'
       and nullif(btrim(v_item ->> 'birthDate'), '') is not null
       and private.try_iso_date(v_item ->> 'birthDate') is null then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[].birthDate', 'code', 'invalid_iso_date', 'studentCode', v_code)
      );
    end if;

    if v_item ? 'studentNumber'
       and nullif(btrim(v_item ->> 'studentNumber'), '') is not null
       and (
         private.try_smallint(v_item ->> 'studentNumber') is null
         or private.try_smallint(v_item ->> 'studentNumber') not between 1 and 9999
       ) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[].studentNumber', 'code', 'invalid_student_number', 'studentCode', v_code)
      );
    end if;

    if v_item ? 'isActive' and jsonb_typeof(v_item -> 'isActive') <> 'boolean' then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.students[].isActive', 'code', 'boolean_required', 'studentCode', v_code)
      );
    end if;

  end loop;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb)) student
    group by lower(btrim(student ->> 'studentCode'))
    having count(*) > 1
  ) then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.students', 'code', 'duplicate_student_code')
    );
  end if;

  -- Staff and assignment validation.
  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb))
  loop
    v_code := nullif(btrim(v_item ->> 'employeeCode'), '');
    if jsonb_typeof(v_item) <> 'object'
       or v_code is null
       or nullif(btrim(v_item ->> 'givenName'), '') is null
       or nullif(btrim(v_item ->> 'familyName'), '') is null
       or coalesce(v_item ->> 'role', '') not in ('teacher', 'admin') then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.staff[]', 'code', 'staff_required_fields', 'employeeCode', v_code)
      );
    end if;

    if v_item ? 'isActive' and jsonb_typeof(v_item -> 'isActive') <> 'boolean' then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.staff[].isActive', 'code', 'boolean_required', 'employeeCode', v_code)
      );
    end if;

    if nullif(btrim(v_item ->> 'username'), '') is not null
       and not private.is_valid_username(v_item ->> 'username') then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.staff[].username', 'code', 'invalid_username', 'employeeCode', v_code)
      );
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb)) staff_member
    group by lower(btrim(staff_member ->> 'employeeCode'))
    having count(*) > 1
  ) then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$.staff', 'code', 'duplicate_employee_code')
    );
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'assignments', '[]'::jsonb))
  loop
    v_grade_level := v_item ->> 'gradeLevel';
    v_code := nullif(btrim(v_item ->> 'employeeCode'), '');
    v_assignment_term_id := null;

    if coalesce(v_item ->> 'schoolYear', '') ~ '^[0-9]{4}$'
       and coalesce(v_item ->> 'semester', '') ~ '^[1-3]$' then
      select term.id into v_assignment_term_id
      from public.academic_terms term
      where term.school_year = (v_item ->> 'schoolYear')::smallint
        and term.semester = (v_item ->> 'semester')::smallint;
    end if;

    if jsonb_typeof(v_item) <> 'object'
       or v_code is null
       or v_grade_level is null
       or v_grade_level not in ('P1','P2','P3','P4','P5','P6','M1','M2','M3')
       or (
         v_assignment_term_id is null
         and not coalesce(
           private.try_smallint(v_item ->> 'schoolYear') = v_school_year
           and private.try_smallint(v_item ->> 'semester') = v_semester,
           false
         )
       ) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.assignments[]', 'code', 'invalid_assignment', 'employeeCode', v_code)
      );
    end if;

    if not exists (
      select 1 from public.teachers teacher
      where lower(btrim(teacher.employee_code)) = lower(v_code)
      union all
      select 1
      from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb)) staff_member
      where lower(btrim(staff_member ->> 'employeeCode')) = lower(v_code)
    ) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.assignments[].employeeCode', 'code', 'staff_not_found', 'employeeCode', v_code)
      );
    end if;

    if v_item ? 'isActive' and jsonb_typeof(v_item -> 'isActive') <> 'boolean' then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.assignments[].isActive', 'code', 'boolean_required', 'employeeCode', v_code)
      );
    end if;
  end loop;

  -- Guardian rows may refer to a student already in the database or in this plan.
  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'guardians', '[]'::jsonb))
  loop
    v_code := nullif(btrim(v_item ->> 'studentCode'), '');
    if jsonb_typeof(v_item) <> 'object' or v_code is null then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.guardians[]', 'code', 'student_code_required')
      );
    elsif not exists (
      select 1 from public.students student
      where lower(btrim(student.student_code)) = lower(v_code)
      union all
      select 1
      from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb)) student
      where lower(btrim(student ->> 'studentCode')) = lower(v_code)
    ) then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('path', '$.guardians[].studentCode', 'code', 'student_not_found', 'studentCode', v_code)
      );
    end if;
  end loop;

  -- Student codes become student usernames. Staff usernames are optional until
  -- supplied. Validate combined input usernames case-insensitively.
  if exists (
    select 1
    from (
      select lower(btrim(student ->> 'studentCode')) as username_normalized
      from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb)) student
      union all
      select lower(btrim(staff_member ->> 'username'))
      from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb)) staff_member
      where nullif(btrim(staff_member ->> 'username'), '') is not null
    ) usernames
    group by username_normalized
    having count(*) > 1
  ) then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('path', '$', 'code', 'duplicate_username')
    );
  end if;

  v_counts := jsonb_build_object(
    'classrooms', jsonb_array_length(coalesce(p_payload -> 'classrooms', '[]'::jsonb)),
    'students', jsonb_array_length(coalesce(p_payload -> 'students', '[]'::jsonb)),
    'guardians', jsonb_array_length(coalesce(p_payload -> 'guardians', '[]'::jsonb)),
    'staff', jsonb_array_length(coalesce(p_payload -> 'staff', '[]'::jsonb)),
    'assignments', jsonb_array_length(coalesce(p_payload -> 'assignments', '[]'::jsonb))
  );

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'dryRun', p_dry_run,
      'schemaVersion', v_schema_version,
      'fingerprint', v_fingerprint,
      'serverFingerprint', v_fingerprint,
      'clientFingerprint', v_client_fingerprint,
      'counts', v_counts,
      'errors', v_errors
    );
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true,
      'dryRun', true,
      'schemaVersion', v_schema_version,
      'fingerprint', v_fingerprint,
      'serverFingerprint', v_fingerprint,
      'clientFingerprint', v_client_fingerprint,
      'counts', v_counts,
      'errors', '[]'::jsonb
    );
  end if;

  -- Serialize the same deterministic plan so two server workers cannot both apply
  -- it. The second caller observes the committed import_batches row and no-ops.
  perform pg_advisory_xact_lock(hashtextextended(v_fingerprint, 0));

  if exists (
    select 1 from private.import_batches batch where batch.fingerprint = v_fingerprint
  ) then
    return jsonb_build_object(
      'ok', true,
      'dryRun', false,
      'alreadyApplied', true,
      'schemaVersion', v_schema_version,
      'fingerprint', v_fingerprint,
      'serverFingerprint', v_fingerprint,
      'clientFingerprint', v_client_fingerprint,
      'counts', v_counts,
      'errors', '[]'::jsonb
    );
  end if;

  -- The nested block is a subtransaction. A natural-key collision rolls back the
  -- whole import and returns a non-PII error instead of leaving partial data behind.
  begin
    -- Create a planned term when this is the first import. Exact dates can be filled
    -- later; an existing term keeps its name/status and only fills missing dates.
    insert into public.academic_terms(
      school_year, semester, name, starts_on, ends_on, status
    ) values (
      v_school_year,
      v_semester,
      coalesce(
        nullif(btrim(p_payload #>> '{term,name}'), ''),
        format('ปีการศึกษา %s ภาคเรียนที่ %s', v_school_year, v_semester)
      ),
      v_term_starts_on,
      v_term_ends_on,
      'planned'
    )
    on conflict (school_year, semester)
    do update set
      name = coalesce(
        nullif(btrim(p_payload #>> '{term,name}'), ''),
        public.academic_terms.name
      ),
      starts_on = coalesce(public.academic_terms.starts_on, excluded.starts_on),
      ends_on = coalesce(public.academic_terms.ends_on, excluded.ends_on)
    returning id into v_term_id;

    -- Explicit classroom rows can override their display name.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'classrooms', '[]'::jsonb))
    loop
      v_grade_level := v_item ->> 'gradeLevel';
      v_room_number := private.normalize_room_number(v_item ->> 'roomNumber');
      v_display_name := coalesce(
        nullif(btrim(v_item ->> 'displayName'), ''),
        private.classroom_display_name(v_grade_level, v_room_number)
      );

      insert into public.classrooms(term_id, grade_level, room_number, display_name, is_active)
      values (v_term_id, v_grade_level, v_room_number, v_display_name, true)
      on conflict (term_id, grade_level, (lower(btrim(room_number))))
      do update set display_name = excluded.display_name, is_active = true;
    end loop;

    -- Student rows also derive missing classroom rows. Room "0" is first-class.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb))
    loop
      v_grade_level := v_item ->> 'gradeLevel';
      v_room_number := private.normalize_room_number(v_item ->> 'roomNumber');
      insert into public.classrooms(term_id, grade_level, room_number, display_name, is_active)
      values (
        v_term_id,
        v_grade_level,
        v_room_number,
        private.classroom_display_name(v_grade_level, v_room_number),
        true
      )
      on conflict (term_id, grade_level, (lower(btrim(room_number)))) do nothing;
    end loop;

    -- Staff master data is independent of Auth and can be updated later by code.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'staff', '[]'::jsonb))
    loop
      v_code := btrim(v_item ->> 'employeeCode');
      v_role := (v_item ->> 'role')::public.app_role;
      v_is_active := coalesce((v_item ->> 'isActive')::boolean, true);

      insert into public.teachers(
        employee_code, title, given_name, family_name, status, intended_role
      )
      values (
        v_code,
        nullif(btrim(v_item ->> 'title'), ''),
        btrim(v_item ->> 'givenName'),
        btrim(v_item ->> 'familyName'),
        case when v_is_active then 'active' else 'archived' end,
        v_role
      )
      on conflict ((lower(btrim(employee_code))))
      do update set
        title = coalesce(excluded.title, public.teachers.title),
        given_name = excluded.given_name,
        family_name = excluded.family_name,
        status = case
          when public.teachers.status = 'graduated' then public.teachers.status
          else excluded.status
        end,
        intended_role = excluded.intended_role
      returning id into v_teacher_id;

      -- Data-only imports must keep already-provisioned accounts in sync too.
      update public.profiles profile
      set role = teacher.intended_role,
          display_name = btrim(concat_ws(
            ' ', teacher.title, teacher.given_name, teacher.family_name
          )),
          is_active = teacher.status = 'active'
      from public.teachers teacher
      where teacher.id = v_teacher_id
        and teacher.user_id is not null
        and profile.user_id = teacher.user_id;

      update private.account_provisioning_queue queue
      set intended_role = v_role
      where queue.teacher_id = v_teacher_id;

      v_username := nullif(lower(btrim(v_item ->> 'username')), '');
      if v_username is not null
         and not exists (select 1 from public.teachers where id = v_teacher_id and user_id is not null) then
        insert into private.account_provisioning_queue(
          teacher_id, username, intended_role, status
        ) values (
          v_teacher_id, v_username, v_role, 'pending'
        )
        on conflict (teacher_id)
        do update set
          username = case
            when private.account_provisioning_queue.status in ('provisioned', 'disabled')
              then private.account_provisioning_queue.username
            else excluded.username
          end,
          intended_role = excluded.intended_role,
          status = case
            when private.account_provisioning_queue.status in ('provisioned', 'disabled')
              then private.account_provisioning_queue.status
            else 'pending'
          end;
      end if;
    end loop;

    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'students', '[]'::jsonb))
    loop
      v_code := btrim(v_item ->> 'studentCode');
      v_is_active := coalesce((v_item ->> 'isActive')::boolean, true);
      v_birth_date := private.try_iso_date(nullif(btrim(v_item ->> 'birthDate'), ''));
      v_student_number := case
        when nullif(btrim(v_item ->> 'studentNumber'), '') is null then null
        else (v_item ->> 'studentNumber')::smallint
      end;

      insert into public.students(
        student_code, title, given_name, family_name, status
      )
      values (
        v_code,
        nullif(btrim(v_item ->> 'title'), ''),
        btrim(v_item ->> 'givenName'),
        btrim(v_item ->> 'familyName'),
        case when v_is_active then 'active' else 'archived' end
      )
      on conflict ((lower(btrim(student_code))))
      do update set
        title = coalesce(excluded.title, public.students.title),
        given_name = excluded.given_name,
        family_name = excluded.family_name,
        status = case
          when public.students.status = 'graduated' then public.students.status
          else excluded.status
        end
      returning id into v_student_id;

      update public.profiles profile
      set role = 'student',
          display_name = btrim(concat_ws(
            ' ', student.title, student.given_name, student.family_name
          )),
          is_active = student.status = 'active'
      from public.students student
      where student.id = v_student_id
        and student.user_id is not null
        and profile.user_id = student.user_id;

      if v_birth_date is not null then
        insert into private.student_private_identities(student_id, birth_date)
        values (v_student_id, v_birth_date)
        on conflict (student_id)
        do update set birth_date = excluded.birth_date;
      end if;

      v_grade_level := v_item ->> 'gradeLevel';
      v_room_number := private.normalize_room_number(v_item ->> 'roomNumber');
      select classroom.id into strict v_classroom_id
      from public.classrooms classroom
      where classroom.term_id = v_term_id
        and classroom.grade_level = v_grade_level
        and lower(btrim(classroom.room_number)) = lower(v_room_number);

      insert into public.enrollments(
        term_id, classroom_id, student_id, student_number, is_active
      ) values (
        v_term_id, v_classroom_id, v_student_id, v_student_number, v_is_active
      )
      on conflict (student_id, term_id)
      do update set
        classroom_id = excluded.classroom_id,
        student_number = coalesce(excluded.student_number, public.enrollments.student_number),
        is_active = excluded.is_active;

      if not exists (select 1 from public.students where id = v_student_id and user_id is not null) then
        insert into private.account_provisioning_queue(
          student_id, username, intended_role, status
        ) values (
          v_student_id, lower(v_code), 'student', 'pending'
        )
        on conflict (student_id)
        do update set
          username = case
            when private.account_provisioning_queue.status in ('provisioned', 'disabled')
              then private.account_provisioning_queue.username
            else excluded.username
          end,
          intended_role = 'student',
          status = case
            when private.account_provisioning_queue.status in ('provisioned', 'disabled')
              then private.account_provisioning_queue.status
            else 'pending'
          end;
      end if;
    end loop;

    -- Omitted guardian fields preserve prior known values. A completely blank row
    -- is ignored, so missing source data can be supplied by a later import.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'guardians', '[]'::jsonb))
    loop
      if nullif(btrim(v_item ->> 'name'), '') is not null
         or nullif(btrim(v_item ->> 'relationship'), '') is not null
         or nullif(btrim(v_item ->> 'phone'), '') is not null then
        select student.id into strict v_student_id
        from public.students student
        where lower(btrim(student.student_code)) = lower(btrim(v_item ->> 'studentCode'));

        insert into private.student_guardian_contacts(
          student_id, contact_order, contact_name, relationship, phone_number,
          is_primary, is_active
        ) values (
          v_student_id,
          1,
          nullif(btrim(v_item ->> 'name'), ''),
          nullif(btrim(v_item ->> 'relationship'), ''),
          nullif(btrim(v_item ->> 'phone'), ''),
          true,
          true
        )
        on conflict (student_id, contact_order)
        do update set
          contact_name = coalesce(excluded.contact_name, private.student_guardian_contacts.contact_name),
          relationship = coalesce(excluded.relationship, private.student_guardian_contacts.relationship),
          phone_number = coalesce(excluded.phone_number, private.student_guardian_contacts.phone_number),
          is_primary = true,
          is_active = true;
      end if;
    end loop;

    -- Assignment rows may target any already-created term in the plan.
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload -> 'assignments', '[]'::jsonb))
    loop
      select term.id into strict v_assignment_term_id
      from public.academic_terms term
      where term.school_year = (v_item ->> 'schoolYear')::smallint
        and term.semester = (v_item ->> 'semester')::smallint;

      v_grade_level := v_item ->> 'gradeLevel';
      v_room_number := private.normalize_room_number(v_item ->> 'roomNumber');
      insert into public.classrooms(term_id, grade_level, room_number, display_name, is_active)
      values (
        v_assignment_term_id,
        v_grade_level,
        v_room_number,
        private.classroom_display_name(v_grade_level, v_room_number),
        true
      )
      on conflict (term_id, grade_level, (lower(btrim(room_number)))) do nothing;

      select classroom.id into strict v_classroom_id
      from public.classrooms classroom
      where classroom.term_id = v_assignment_term_id
        and classroom.grade_level = v_grade_level
        and lower(btrim(classroom.room_number)) = lower(v_room_number);

      select teacher.id into strict v_teacher_id
      from public.teachers teacher
      where lower(btrim(teacher.employee_code)) = lower(btrim(v_item ->> 'employeeCode'));

      v_is_active := coalesce((v_item ->> 'isActive')::boolean, true);
      insert into public.teacher_classroom_assignments(
        term_id, classroom_id, teacher_id, subject_name, is_active
      ) values (
        v_assignment_term_id,
        v_classroom_id,
        v_teacher_id,
        coalesce(nullif(btrim(v_item ->> 'subjectName'), ''), 'ประจำชั้น'),
        v_is_active
      )
      on conflict (term_id, classroom_id, teacher_id, subject_name)
      do update set is_active = excluded.is_active;
    end loop;

    insert into private.import_batches(
      schema_version, fingerprint, row_counts, applied_by
    ) values (
      v_schema_version, v_fingerprint, v_counts, v_uid
    )
    returning id into v_batch_id;

    perform private.write_audit(
      'import_school_data',
      'import_batch',
      v_batch_id::text,
      null,
      jsonb_build_object(
        'schema_version', v_schema_version,
        'fingerprint', v_fingerprint,
        'row_counts', v_counts
      )
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', false,
        'dryRun', false,
        'schemaVersion', v_schema_version,
        'fingerprint', v_fingerprint,
        'serverFingerprint', v_fingerprint,
        'clientFingerprint', v_client_fingerprint,
        'counts', v_counts,
        'errors', jsonb_build_array(jsonb_build_object('path', '$', 'code', 'natural_key_conflict'))
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'dryRun', false,
    'alreadyApplied', false,
    'batchId', v_batch_id,
    'schemaVersion', v_schema_version,
    'fingerprint', v_fingerprint,
    'serverFingerprint', v_fingerprint,
    'clientFingerprint', v_client_fingerprint,
    'counts', v_counts,
    'errors', '[]'::jsonb
  );
end;
$$;

-- Called only after a trusted server has created the Supabase Auth user. This RPC
-- links that user to the imported natural-key record without ever accepting or
-- storing a password, temporary password, activation token, or plaintext secret.
create or replace function public.admin_link_provisioned_account(
  p_username text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username_normalized text := lower(btrim(p_username));
  v_queue private.account_provisioning_queue%rowtype;
  v_display_name text;
  v_role public.app_role;
  v_is_active boolean;
  v_subject_type text;
  v_already_linked boolean := false;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Trusted server permission required' using errcode = '42501';
  end if;

  if p_user_id is null or not private.is_valid_username(v_username_normalized) then
    raise exception 'Valid username and Auth user id are required' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users auth_user where auth_user.id = p_user_id) then
    raise exception 'Auth user not found' using errcode = 'P0002';
  end if;

  select queue.* into v_queue
  from private.account_provisioning_queue queue
  where queue.username_normalized = v_username_normalized
  for update;

  if not found then
    raise exception 'Provisioning record not found' using errcode = 'P0002';
  end if;

  if v_queue.status = 'disabled' then
    raise exception 'Provisioning record is disabled' using errcode = '55000';
  end if;

  if v_queue.linked_user_id is not null and v_queue.linked_user_id <> p_user_id then
    raise exception 'Provisioning record is linked to another Auth user' using errcode = '23505';
  end if;

  v_already_linked := coalesce(
    v_queue.status = 'provisioned' and v_queue.linked_user_id = p_user_id,
    false
  );

  if exists (
    select 1
    from private.login_identities identity_row
    where identity_row.username_normalized = v_username_normalized
      and identity_row.user_id <> p_user_id
  ) then
    raise exception 'Username is linked to another Auth user' using errcode = '23505';
  end if;

  if exists (
    select 1
    from private.login_identities identity_row
    where identity_row.user_id = p_user_id
      and identity_row.username_normalized <> v_username_normalized
  ) then
    raise exception 'Auth user is linked to another username' using errcode = '23505';
  end if;

  if v_queue.student_id is not null then
    v_subject_type := 'student';
    select btrim(concat_ws(' ', student.title, student.given_name, student.family_name)),
           'student'::public.app_role,
           student.status = 'active'
    into v_display_name, v_role, v_is_active
    from public.students student
    where student.id = v_queue.student_id
      and (student.user_id is null or student.user_id = p_user_id)
    for update;

    if not found then
      raise exception 'Student is linked to another Auth user' using errcode = '23505';
    end if;

    if exists (
      select 1 from public.students student
      where student.user_id = p_user_id and student.id <> v_queue.student_id
    ) or exists (
      select 1 from public.teachers teacher
      where teacher.user_id = p_user_id
    ) then
      raise exception 'Auth user is linked to another school identity' using errcode = '23505';
    end if;
  else
    v_subject_type := 'staff';
    select btrim(concat_ws(' ', teacher.title, teacher.given_name, teacher.family_name)),
           teacher.intended_role,
           teacher.status = 'active'
    into v_display_name, v_role, v_is_active
    from public.teachers teacher
    where teacher.id = v_queue.teacher_id
      and (teacher.user_id is null or teacher.user_id = p_user_id)
    for update;

    if not found then
      raise exception 'Staff member is linked to another Auth user' using errcode = '23505';
    end if;

    if exists (
      select 1 from public.teachers teacher
      where teacher.user_id = p_user_id and teacher.id <> v_queue.teacher_id
    ) or exists (
      select 1 from public.students student
      where student.user_id = p_user_id
    ) then
      raise exception 'Auth user is linked to another school identity' using errcode = '23505';
    end if;
  end if;

  -- A clean retry is a true no-op: no updated_at churn and no duplicate audit row.
  if v_already_linked
     and exists (
       select 1 from public.profiles profile
       where profile.user_id = p_user_id
         and profile.role = v_role
         and profile.display_name = v_display_name
         and profile.is_active = v_is_active
     )
     and exists (
       select 1 from private.login_identities identity_row
       where identity_row.user_id = p_user_id
         and identity_row.username_normalized = v_username_normalized
     )
     and (
       (v_queue.student_id is not null and exists (
         select 1 from public.students student
         where student.id = v_queue.student_id and student.user_id = p_user_id
       ))
       or
       (v_queue.teacher_id is not null and exists (
         select 1 from public.teachers teacher
         where teacher.id = v_queue.teacher_id and teacher.user_id = p_user_id
       ))
     ) then
    return jsonb_build_object(
      'ok', true,
      'queueId', v_queue.id,
      'subjectType', v_subject_type,
      'role', v_role,
      'alreadyLinked', true
    );
  end if;

  insert into public.profiles(
    user_id, role, display_name, is_active, activation_required
  )
  values (p_user_id, v_role, v_display_name, v_is_active, true)
  on conflict (user_id)
  do update set
    role = excluded.role,
    display_name = excluded.display_name,
    is_active = excluded.is_active;
    -- activation_required is deliberately omitted: retries never re-arm an account.

  if v_queue.student_id is not null then
    update public.students
    set user_id = p_user_id
    where id = v_queue.student_id;
  else
    update public.teachers
    set user_id = p_user_id
    where id = v_queue.teacher_id;
  end if;

  insert into private.login_identities(user_id, username)
  values (p_user_id, v_username_normalized)
  on conflict (user_id)
  do update set username = excluded.username;

  update private.account_provisioning_queue
  set linked_user_id = p_user_id,
      status = 'provisioned'
  where id = v_queue.id;

  perform private.write_audit(
    'link_provisioned_account',
    'account_provisioning_queue',
    v_queue.id::text,
    null,
    jsonb_build_object(
      'subject_type', v_subject_type,
      'role', v_role,
      'already_linked', v_already_linked
    )
  );

  return jsonb_build_object(
    'ok', true,
    'queueId', v_queue.id,
    'subjectType', v_subject_type,
    'role', v_role,
    'alreadyLinked', v_already_linked
  );
end;
$$;

-- Hosted fallback/bootstrap path. It performs the same server-side proof as the
-- auth.users trigger and cannot clear the gate until encrypted_password is present.
create or replace function public.admin_mark_account_activated(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_already_activated boolean;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Trusted server permission required' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Auth user id is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from auth.users auth_user
    where auth_user.id = p_user_id
  ) then
    raise exception 'Auth user not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from auth.users auth_user
    where auth_user.id = p_user_id
      and nullif(btrim(auth_user.encrypted_password), '') is not null
  ) then
    return jsonb_build_object(
      'ok', true,
      'activated', false,
      'reason', 'first_password_required'
    );
  end if;

  select not profile.activation_required
  into v_already_activated
  from public.profiles profile
  where profile.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if not v_already_activated then
    update public.profiles
    set activation_required = false
    where user_id = p_user_id;

    perform private.write_audit(
      'mark_account_activated',
      'profile',
      p_user_id::text,
      jsonb_build_object('activation_required', true),
      jsonb_build_object('activation_required', false)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'activated', true,
    'alreadyActivated', v_already_activated
  );
end;
$$;

-- Foreign-key and RLS lookup indexes omitted by the initial migration.
create index if not exists students_graduation_confirmer_idx
  on public.students (graduation_confirmed_by)
  where graduation_confirmed_by is not null;
create index if not exists enrollments_term_idx
  on public.enrollments (term_id);
create index if not exists incidents_rule_idx
  on public.incidents (rule_id);
create index if not exists incidents_corrected_by_idx
  on public.incidents (corrected_by)
  where corrected_by is not null;
create index if not exists point_requests_student_term_idx
  on public.point_addition_requests (student_id, term_id, created_at desc);
create index if not exists point_requests_positive_rule_idx
  on public.point_addition_requests (positive_rule_id)
  where positive_rule_id is not null;
create index if not exists point_requests_reviewer_idx
  on public.point_addition_requests (reviewed_by)
  where reviewed_by is not null;
create index if not exists appeals_decider_idx
  on public.appeals (decided_by)
  where decided_by is not null;
create index if not exists cases_opened_term_idx
  on public.follow_up_cases (opened_in_term_id);
create index if not exists cases_opened_by_idx
  on public.follow_up_cases (opened_by)
  where opened_by is not null;
create index if not exists guardian_tasks_completed_by_idx
  on public.guardian_contact_tasks (completed_by)
  where completed_by is not null;
create index if not exists ledger_actor_idx
  on public.score_ledger (actor_user_id)
  where actor_user_id is not null;
create index if not exists audit_actor_date_idx
  on public.audit_logs (actor_user_id, created_at desc)
  where actor_user_id is not null;
create index if not exists account_activations_user_idx
  on private.account_activations (user_id);
create index if not exists account_activations_issued_by_idx
  on private.account_activations (issued_by)
  where issued_by is not null;

-- Least privilege for sequences: only direct admin-managed master-data inserts need
-- nextval. Score/workflow tables are written through SECURITY DEFINER RPCs.
revoke all on all sequences in schema public from anon, authenticated;
grant usage on sequence public.academic_terms_id_seq,
  public.classrooms_id_seq,
  public.students_id_seq,
  public.teachers_id_seq,
  public.enrollments_id_seq,
  public.teacher_classroom_assignments_id_seq,
  public.behavior_rules_id_seq,
  public.positive_behavior_rules_id_seq
to authenticated;

revoke all on table public.positive_behavior_rules from anon, authenticated;
grant select, insert, update on public.positive_behavior_rules to authenticated;

revoke all on table private.student_guardian_contacts from public, anon, authenticated;
revoke all on table private.account_provisioning_queue from public, anon, authenticated;
revoke all on table private.import_batches from public, anon, authenticated;

revoke all on function private.normalize_room_number(text) from public, anon, authenticated;
revoke all on function private.classroom_display_name(text, text) from public, anon, authenticated;
revoke all on function private.try_iso_date(text) from public, anon, authenticated;
revoke all on function private.try_smallint(text) from public, anon, authenticated;
revoke all on function private.is_valid_username(text) from public, anon, authenticated;
revoke all on function private.clear_activation_after_first_password() from public, anon, authenticated, service_role;

revoke all on function public.get_guardian_contacts_for_task(bigint) from public, anon, authenticated;
revoke all on function public.complete_guardian_contact_task(bigint, text) from public, anon, authenticated;
revoke all on function public.admin_import_school_data(jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function public.admin_link_provisioned_account(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_mark_account_activated(uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_guardian_contacts_for_task(bigint) to authenticated;
grant execute on function public.complete_guardian_contact_task(bigint, text) to authenticated;
grant execute on function public.admin_import_school_data(jsonb, boolean) to service_role;
grant execute on function public.admin_link_provisioned_account(text, uuid) to service_role;
grant execute on function public.admin_mark_account_activated(uuid) to service_role;

commit;
