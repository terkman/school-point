-- Read-only preflight for an operational score/workflow reset.
--
-- Safety contract:
--   * This file contains SELECT/CTE queries only. It performs no DDL or DML.
--   * It does not select PII columns or Auth credentials.
--   * Run it before choosing a retention scope; do not infer approval from its output.
--
-- The recommended path is a new academic term plus
-- public.initialize_term_scores(p_term_id), which creates 100-point accounts
-- without erasing prior score history. This preview does not invoke that RPC.

-- 1) Scope and readiness by academic term. Compare active enrollment with the
--    target term's score accounts before any operational decision.
select
  term.id as term_id,
  term.school_year,
  term.semester,
  term.name as term_name,
  term.status,
  term.starts_on,
  term.ends_on,
  (
    select count(*)::bigint
    from public.enrollments enrollment
    where enrollment.term_id = term.id and enrollment.is_active
  ) as active_enrollments,
  (
    select count(*)::bigint
    from public.score_accounts account
    where account.term_id = term.id
  ) as score_accounts,
  (
    select count(*)::bigint
    from public.score_accounts account
    where account.term_id = term.id and account.balance = 100
  ) as accounts_at_100,
  (
    select count(*)::bigint
    from public.incidents incident
    where incident.term_id = term.id
  ) as incidents,
  (
    select count(*)::bigint
    from public.point_addition_requests request
    where request.term_id = term.id
  ) as point_addition_requests,
  (
    select count(*)::bigint
    from public.deduction_approval_requests deduction_request
    where deduction_request.term_id = term.id
  ) as deduction_approval_requests,
  (
    select count(*)::bigint
    from public.appeals appeal
    join public.incidents appeal_incident on appeal_incident.id = appeal.incident_id
    where appeal_incident.term_id = term.id
  ) as appeals,
  (
    select count(*)::bigint
    from public.follow_up_cases case_row
    where case_row.opened_in_term_id = term.id
  ) as follow_up_cases,
  (
    select count(*)::bigint
    from public.guardian_contact_tasks guardian_task
    join public.incidents task_incident on task_incident.id = guardian_task.incident_id
    where task_incident.term_id = term.id
  ) as guardian_contact_tasks,
  (
    select count(*)::bigint
    from public.student_paper_documents student_document
    where student_document.term_id = term.id
  ) as student_paper_documents,
  (
    select count(*)::bigint
    from public.paper_documents paper_document
    where paper_document.term_id = term.id
  ) as paper_documents
from public.academic_terms term
order by term.school_year desc, term.semester desc, term.id desc;

-- 2) Counts of all rows that need a retention decision. These are candidates
--    for archive/retention planning, NOT an instruction to clear them.
select 'public.score_accounts' as object_name, count(*)::bigint as row_count from public.score_accounts
union all select 'public.score_ledger', count(*)::bigint from public.score_ledger
union all select 'public.incidents', count(*)::bigint from public.incidents
union all select 'public.point_addition_requests', count(*)::bigint from public.point_addition_requests
union all select 'public.deduction_approval_requests', count(*)::bigint from public.deduction_approval_requests
union all select 'public.appeals', count(*)::bigint from public.appeals
union all select 'public.follow_up_cases', count(*)::bigint from public.follow_up_cases
union all select 'public.guardian_contact_tasks', count(*)::bigint from public.guardian_contact_tasks
union all select 'private.deduction_batches', count(*)::bigint from private.deduction_batches
union all select 'private.addition_batches', count(*)::bigint from private.addition_batches
union all select 'private.appeal_decisions', count(*)::bigint from private.appeal_decisions
union all select 'private.guardian_contact_attempts', count(*)::bigint from private.guardian_contact_attempts
union all select 'public.student_paper_documents', count(*)::bigint from public.student_paper_documents
union all select 'public.student_paper_document_events', count(*)::bigint from public.student_paper_document_events
union all select 'public.paper_documents', count(*)::bigint from public.paper_documents
union all select 'public.paper_document_events', count(*)::bigint from public.paper_document_events
union all select 'storage.objects (score-evidence only)', count(*)::bigint
  from storage.objects where bucket_id = 'score-evidence'
order by object_name;

-- 3) Outstanding operational work. Every non-zero result needs an owner and a
--    documented disposition (carry over, complete normally, or retain/archive).
select 'point_addition_pending' as check_name, count(*)::bigint as row_count
from public.point_addition_requests
where status = 'pending'
union all select 'deduction_approval_pending', count(*)::bigint
from public.deduction_approval_requests
where status = 'pending'
union all select 'appeal_submitted_or_reviewing', count(*)::bigint
from public.appeals
where status in ('submitted', 'reviewing')
union all select 'follow_up_case_open_or_following_up', count(*)::bigint
from public.follow_up_cases
where status in ('open', 'following_up')
union all select 'guardian_task_pending', count(*)::bigint
from public.guardian_contact_tasks
where status = 'pending'
order by check_name;

-- 4) Account/ledger integrity signals. This query returns one row per term
--    that has score accounts. After correct initialization, both counters in
--    the target term's row must be zero.
select
  account.term_id,
  count(*) filter (where account.balance <> 100)::bigint as accounts_not_at_100,
  count(*) filter (
    where not exists (
      select 1
      from public.score_ledger ledger
      where ledger.score_account_id = account.id
        and ledger.student_id = account.student_id
        and ledger.term_id = account.term_id
        and ledger.entry_type = 'semester_opening'
    )
  )::bigint as accounts_missing_opening_ledger
from public.score_accounts account
group by account.term_id
order by account.term_id;

-- 5) Preserve-side inventory. All of these must remain outside an operational
--    reset; the row counts provide a before/after guardrail.
select 'auth.users (not queried by this script)' as object_name, null::bigint as row_count
union all select 'public.profiles', count(*)::bigint from public.profiles
union all select 'public.students', count(*)::bigint from public.students
union all select 'public.teachers', count(*)::bigint from public.teachers
union all select 'public.academic_terms', count(*)::bigint from public.academic_terms
union all select 'public.classrooms', count(*)::bigint from public.classrooms
union all select 'public.enrollments', count(*)::bigint from public.enrollments
union all select 'public.teacher_classroom_assignments', count(*)::bigint from public.teacher_classroom_assignments
union all select 'public.behavior_rules', count(*)::bigint from public.behavior_rules
union all select 'public.positive_behavior_rules', count(*)::bigint from public.positive_behavior_rules
union all select 'public.staff_permission_grants', count(*)::bigint from public.staff_permission_grants
union all select 'public.staff_permission_grant_classrooms', count(*)::bigint from public.staff_permission_grant_classrooms
union all select 'public.audit_logs', count(*)::bigint from public.audit_logs
union all select 'private.login_identities', count(*)::bigint from private.login_identities
union all select 'private.account_activations', count(*)::bigint from private.account_activations
union all select 'private.student_private_identities', count(*)::bigint from private.student_private_identities
union all select 'private.student_guardian_contacts', count(*)::bigint from private.student_guardian_contacts
union all select 'private.account_provisioning_queue', count(*)::bigint from private.account_provisioning_queue
union all select 'private.import_batches', count(*)::bigint from private.import_batches
union all select 'storage.objects (student-profile-images only)', count(*)::bigint
  from storage.objects where bucket_id = 'student-profile-images'
order by object_name;

-- 6) Current foreign-key inventory touching the operational candidate tables.
--    Use this as the authoritative dependency check when preparing an approved
--    archive plan; it reports child -> parent relations from the live schema.
with candidate_tables(table_name) as (
  values
    ('public.score_accounts'),
    ('public.score_ledger'),
    ('public.incidents'),
    ('public.point_addition_requests'),
    ('public.deduction_approval_requests'),
    ('public.appeals'),
    ('public.follow_up_cases'),
    ('public.guardian_contact_tasks'),
    ('private.deduction_batches'),
    ('private.addition_batches'),
    ('private.appeal_decisions'),
    ('private.guardian_contact_attempts'),
    ('public.student_paper_documents'),
    ('public.student_paper_document_events'),
    ('public.paper_documents'),
    ('public.paper_document_events')
)
select
  child_namespace.nspname || '.' || child_relation.relname as child_table,
  parent_namespace.nspname || '.' || parent_relation.relname as parent_table,
  constraint_row.conname as constraint_name,
  pg_get_constraintdef(constraint_row.oid) as constraint_definition
from pg_constraint constraint_row
join pg_class child_relation
  on child_relation.oid = constraint_row.conrelid
join pg_namespace child_namespace
  on child_namespace.oid = child_relation.relnamespace
join pg_class parent_relation
  on parent_relation.oid = constraint_row.confrelid
join pg_namespace parent_namespace
  on parent_namespace.oid = parent_relation.relnamespace
where constraint_row.contype = 'f'
  and (
    constraint_row.conrelid in (select to_regclass(table_name) from candidate_tables)
    or constraint_row.confrelid in (select to_regclass(table_name) from candidate_tables)
  )
order by child_table, parent_table, constraint_name;
