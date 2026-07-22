begin;

-- activation_required is a durable account-state gate, but it is not a session
-- authentication proof. Every school-data session must also carry Supabase's
-- signed Authentication Methods Reference for a password login.
create or replace function private.has_password_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and coalesce((select auth.role()), '') = 'authenticated'
    and exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof((select auth.jwt()) -> 'amr') = 'array'
            then (select auth.jwt()) -> 'amr'
          else '[]'::jsonb
        end
      ) as amr_entry(value)
      where amr_entry.value ->> 'method' = 'password'
    ),
    false
  )
$$;

comment on function private.has_password_session() is
  'True only for an authenticated Supabase JWT whose AMR array contains method=password.';

-- These helpers are the shared authorization contract used by RLS and business
-- RPCs. Requiring the password session here protects existing call sites even
-- after activation_required has been cleared for the account.
create or replace function private.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles profile
  where (select private.has_password_session())
    and profile.user_id = (select auth.uid())
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
    where (select private.has_password_session())
      and profile.user_id = (select auth.uid())
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
  where (select private.has_password_session())
    and student.user_id = (select auth.uid())
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
  select (select private.has_password_session()) and exists (
    select 1
    from public.teachers teacher
    join public.profiles profile
      on profile.user_id = teacher.user_id
     and profile.role = 'teacher'
     and profile.is_active
     and not profile.activation_required
    join public.teacher_classroom_assignments assignment
      on assignment.teacher_id = teacher.id
     and assignment.is_active
    join public.enrollments enrollment
      on enrollment.classroom_id = assignment.classroom_id
     and enrollment.term_id = assignment.term_id
     and enrollment.is_active
    join public.academic_terms term
      on term.id = enrollment.term_id
     and term.status = 'active'
    where teacher.user_id = (select auth.uid())
      and teacher.status = 'active'
      and teacher.intended_role = 'teacher'
      and enrollment.student_id = p_student_id
      and (p_term_id is null or enrollment.term_id = p_term_id)
  )
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and CREATE OR REPLACE
-- preserves earlier ACLs. Pin all shared authorization helpers to the one API
-- role that needs them so anon/service JWTs cannot call them directly.
revoke all on function private.has_password_session()
  from public, anon, authenticated, service_role;
revoke all on function private.current_role()
  from public, anon, authenticated, service_role;
revoke all on function private.is_admin()
  from public, anon, authenticated, service_role;
revoke all on function private.current_student_id()
  from public, anon, authenticated, service_role;
revoke all on function private.teacher_has_student(bigint, bigint)
  from public, anon, authenticated, service_role;

grant execute on function private.has_password_session() to authenticated;
grant execute on function private.current_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.current_student_id() to authenticated;
grant execute on function private.teacher_has_student(bigint, bigint) to authenticated;

-- Reading one's own small profile row is the only intentional password-AMR
-- exception. The OTP activation screen needs activation_required before the user
-- can establish a password-authenticated session. Other profiles still require
-- the AMR-gated administrator helper.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_admin())
);

comment on policy profiles_select on public.profiles is
  'Own-profile read supports OTP activation; reading any other profile requires password-AMR admin access.';

-- A restrictive policy is ANDed with every permissive policy. This makes the
-- password-session check a top-level guard for every direct school-data access,
-- including future permissive policies. Profiles are excluded only because the
-- narrowly scoped own-row SELECT above is required during OTP activation;
-- profile writes remain protected by their AMR-gated administrator policy.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'academic_terms',
    'classrooms',
    'students',
    'teachers',
    'enrollments',
    'teacher_classroom_assignments',
    'behavior_rules',
    'positive_behavior_rules',
    'score_accounts',
    'incidents',
    'point_addition_requests',
    'appeals',
    'follow_up_cases',
    'guardian_contact_tasks',
    'score_ledger',
    'audit_logs'
  ] loop
    execute format(
      'drop policy if exists password_session_required on public.%I',
      v_table
    );
    execute format(
      'create policy password_session_required on public.%I as restrictive for all to authenticated using ((select private.has_password_session())) with check ((select private.has_password_session()))',
      v_table
    );
  end loop;
end;
$$;

-- These two policies previously had direct profile checks that did not pass
-- through the shared authorization helpers.
drop policy if exists classrooms_select on public.classrooms;
create policy classrooms_select on public.classrooms
for select to authenticated
using (
  (select private.has_password_session())
  and (
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
  )
);

drop policy if exists assignments_select on public.teacher_classroom_assignments;
create policy assignments_select on public.teacher_classroom_assignments
for select to authenticated
using (
  (select private.has_password_session())
  and (
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
  )
);

-- The views remain actor-redacted and security-invoker. The explicit session
-- predicate is defense in depth in addition to RLS on their source tables.
create or replace view public.student_current_scores
with (security_barrier = true, security_invoker = true)
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
where (select private.has_password_session())
  and student.user_id = (select auth.uid())
  and student.status = 'active'
  and profile.role = 'student'
  and profile.is_active
  and not profile.activation_required;

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
       ledger.reason,
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

create or replace view public.student_incident_history
with (security_barrier = true, security_invoker = true)
as
select incident.id,
       incident.term_id,
       incident.rule_snapshot ->> 'rule_code' as rule_code,
       incident.rule_snapshot ->> 'title_th' as rule_title,
       incident.requested_points,
       incident.applied_points,
       incident.severity,
       incident.occurred_at,
       incident.recorded_at,
       incident.appeal_deadline,
       incident.student_visible_note,
       incident.is_voided,
       appeal.id as appeal_id,
       appeal.status as appeal_status,
       appeal.decision_note,
       appeal.created_at as appeal_created_at
from public.incidents incident
join public.students student on student.id = incident.student_id
join public.profiles profile on profile.user_id = student.user_id
left join public.appeals appeal on appeal.incident_id = incident.id
where (select private.has_password_session())
  and student.user_id = (select auth.uid())
  and student.status = 'active'
  and profile.role = 'student'
  and profile.is_active
  and not profile.activation_required;

-- Do not mass-update activation_required here. encrypted_password cannot prove
-- user activation, and a blanket repair could lock legitimate accounts. Review
-- audit evidence and re-arm only explicitly approved user IDs if legacy
-- mark_account_activated events are ever found.
comment on column public.profiles.activation_required is
  'Account-state gate; school access also requires password AMR. Repair only reviewed accounts backed by audit evidence.';

commit;
