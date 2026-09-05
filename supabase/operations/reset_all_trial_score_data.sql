\set ON_ERROR_STOP on

-- psql-only, destructive operator procedure.  Do not run through an API,
-- migration runner, Supabase Studio, or a linked/remote project connection.
--
-- Database scope: reset the fully enumerated operational score/workflow/paper
-- tables and open 100-point accounts for one explicitly bound active term.
-- Retained: auth/accounts, people, terms, roster, assignments, rules,
-- permissions, private identity/import records, audit history, and
-- student-profile-images.  One reset audit row is appended.
--
-- Storage scope: this script never writes storage.objects.  Direct metadata
-- DELETE/TRUNCATE can orphan physical objects.  After COMMIT, delete ONLY the
-- printed score-evidence manifest through the Storage API and document it
-- against the same verified backup reference.
--
-- Required invocation shape (all values must come from the approved ticket):
-- psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--   -v confirm_reset_all_trial_score_data=RESET_ALL_TRIAL_SCORE_DATA \
--   -v target_active_term_id=123 -v expected_database=postgres \
--   -v expected_project_binding=local-school-point \
--   -v expected_migration_head=202609050005 \
--   -v expected_active_enrollments=456 \
--   -v backup_reference='backup-or-ticket-id' \
--   -v operator_label='approved-operator' \
--   -v restore_drill_reference='restore-drill-id' \
--   -f supabase/operations/reset_all_trial_score_data.sql
--
-- expected_project_binding is a ticket/connection label, not fake database
-- authentication: Postgres has no portable trusted Supabase project-ref value.

\if :{?confirm_reset_all_trial_score_data}
  select case when :'confirm_reset_all_trial_score_data' = 'RESET_ALL_TRIAL_SCORE_DATA'
              then 'true' else 'false' end as reset_confirmation_ok \gset
\else
  \set reset_confirmation_ok false
\endif
\if :reset_confirmation_ok
\else
  \echo 'Refusing reset: exact confirmation token is required.'
  select 1 / 0;
\endif
\if :{?target_active_term_id}
\else
  \echo 'Refusing reset: target_active_term_id is required.'
  select 1 / 0;
\endif
\if :{?expected_database}
\else
  \echo 'Refusing reset: expected_database is required.'
  select 1 / 0;
\endif
\if :{?expected_project_binding}
\else
  \echo 'Refusing reset: expected_project_binding is required.'
  select 1 / 0;
\endif
\if :{?expected_migration_head}
\else
  \echo 'Refusing reset: expected_migration_head is required.'
  select 1 / 0;
\endif
\if :{?expected_active_enrollments}
\else
  \echo 'Refusing reset: expected_active_enrollments is required.'
  select 1 / 0;
\endif
\if :{?backup_reference}
\else
  \echo 'Refusing reset: backup_reference is required.'
  select 1 / 0;
\endif
\if :{?operator_label}
\else
  \echo 'Refusing reset: operator_label is required.'
  select 1 / 0;
\endif
\if :{?restore_drill_reference}
\else
  \echo 'Refusing reset: restore_drill_reference is required.'
  select 1 / 0;
\endif

begin;

-- Bind every psql variable before entering any dollar-quoted procedural block.
-- Nothing in a DO/function body depends on psql interpolation.
select pg_catalog.set_config('app.reset.confirmation', 'RESET_ALL_TRIAL_SCORE_DATA', true);
select pg_catalog.set_config('app.reset.target_term_id', :'target_active_term_id', true);
select pg_catalog.set_config('app.reset.expected_database', :'expected_database', true);
select pg_catalog.set_config('app.reset.project_binding', :'expected_project_binding', true);
select pg_catalog.set_config('app.reset.expected_migration_head', :'expected_migration_head', true);
select pg_catalog.set_config('app.reset.expected_active_enrollments', :'expected_active_enrollments', true);
select pg_catalog.set_config('app.reset.backup_reference', :'backup_reference', true);
select pg_catalog.set_config('app.reset.operator_label', :'operator_label', true);
select pg_catalog.set_config('app.reset.restore_drill_reference', :'restore_drill_reference', true);

create function pg_temp.reset_required_setting(p_name text)
returns text language plpgsql stable set search_path = '' as $$
declare v_value text := current_setting(p_name, true);
begin
  if nullif(btrim(v_value), '') is null then
    raise exception 'required reset setting % is empty', p_name using errcode = '42501';
  end if;
  return v_value;
end;
$$;

create function pg_temp.assert_reset_bindings()
returns void language plpgsql set search_path = '' as $$
declare
  v_target_term_id bigint;
  v_expected_roster bigint;
  v_actual_roster bigint;
  v_actual_migration_head text;
begin
  if current_setting('app.reset.confirmation', true) is distinct from 'RESET_ALL_TRIAL_SCORE_DATA' then
    raise exception 'reset confirmation setting is incorrect' using errcode = '42501';
  end if;
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception 'run only as postgres or supabase_admin; session_user is %', session_user using errcode = '42501';
  end if;
  if current_database() <> pg_temp.reset_required_setting('app.reset.expected_database') then
    raise exception 'database binding mismatch: connected to %', current_database() using errcode = '42501';
  end if;
  perform pg_temp.reset_required_setting('app.reset.project_binding');
  perform pg_temp.reset_required_setting('app.reset.backup_reference');
  perform pg_temp.reset_required_setting('app.reset.operator_label');
  perform pg_temp.reset_required_setting('app.reset.restore_drill_reference');

  v_target_term_id := pg_temp.reset_required_setting('app.reset.target_term_id')::bigint;
  v_expected_roster := pg_temp.reset_required_setting('app.reset.expected_active_enrollments')::bigint;
  if v_expected_roster <= 0 then
    raise exception 'expected active enrollment roster must be greater than zero' using errcode = '22023';
  end if;
  if (select count(*) from public.academic_terms where status = 'active') <> 1
     or not exists (
       select 1 from public.academic_terms
       where id = v_target_term_id and status = 'active'
     ) then
    raise exception 'target must be the exactly one active academic term' using errcode = '55000';
  end if;
  select count(*) into v_actual_roster
  from public.enrollments
  where term_id = v_target_term_id and is_active;
  if v_actual_roster <> v_expected_roster then
    raise exception 'roster binding mismatch: expected %, found %', v_expected_roster, v_actual_roster using errcode = '55000';
  end if;
  select coalesce(max(version), '') into v_actual_migration_head
  from supabase_migrations.schema_migrations;
  if v_actual_migration_head <> pg_temp.reset_required_setting('app.reset.expected_migration_head') then
    raise exception 'migration-head binding mismatch: expected %, found %',
      pg_temp.reset_required_setting('app.reset.expected_migration_head'), v_actual_migration_head using errcode = '55000';
  end if;
end;
$$;

select pg_temp.assert_reset_bindings();
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('school-point:reset-all-trial-score-data:v3', 0)
);

-- Maintenance lock: stop every writer/reader whose rows are deleted, protected,
-- or verified.  The exact gate is repeated after this lock.
lock table
  public.score_accounts, public.score_ledger, public.incidents,
  public.point_addition_requests, public.deduction_approval_requests,
  public.appeals, public.follow_up_cases, public.guardian_contact_tasks,
  private.deduction_batches, private.addition_batches, private.appeal_decisions,
  private.guardian_contact_attempts, public.student_paper_documents,
  public.student_paper_document_events, public.paper_documents,
  public.paper_document_events, auth.users, public.profiles, public.students,
  public.teachers, public.academic_terms, public.classrooms, public.enrollments,
  public.teacher_classroom_assignments, public.behavior_rules,
  public.positive_behavior_rules, public.staff_permission_grants,
  public.staff_permission_grant_classrooms, public.audit_logs,
  private.login_identities, private.account_activations,
  private.student_private_identities, private.student_guardian_contacts,
  private.account_provisioning_queue, private.import_batches, storage.objects,
  storage.buckets in access exclusive mode;

select pg_temp.assert_reset_bindings();

-- Full-row hashes make any retained row/field change fail before COMMIT.
create function pg_temp.row_count(p_relation regclass, p_predicate text default null)
returns bigint language plpgsql stable set search_path = '' as $$
declare v_count bigint;
begin
  execute format('select count(*) from %s as t %s', p_relation,
    case when p_predicate is null then '' else 'where ' || p_predicate end)
  into v_count;
  return v_count;
end;
$$;

create function pg_temp.full_row_fingerprint(p_relation regclass, p_predicate text default null)
returns text language plpgsql stable set search_path = '' as $$
declare v_fingerprint text;
begin
  execute format(
    'select coalesce(md5(string_agg(row_hash, '','' order by row_hash)), md5('''')) ' ||
    'from (select md5(row_to_json(t)::text) as row_hash from %s as t %s) rows',
    p_relation, case when p_predicate is null then '' else 'where ' || p_predicate end
  ) into v_fingerprint;
  return v_fingerprint;
end;
$$;

create temporary table reset_protected_targets(
  object_name text primary key, relation_id regclass not null, predicate text
) on commit drop;
insert into reset_protected_targets values
  ('auth.users','auth.users',null),
  ('public.profiles','public.profiles',null),
  ('public.students','public.students',null),
  ('public.teachers','public.teachers',null),
  ('public.academic_terms','public.academic_terms',null),
  ('public.classrooms','public.classrooms',null),
  ('public.enrollments','public.enrollments',null),
  ('public.teacher_classroom_assignments','public.teacher_classroom_assignments',null),
  ('public.behavior_rules','public.behavior_rules',null),
  ('public.positive_behavior_rules','public.positive_behavior_rules',null),
  ('public.staff_permission_grants','public.staff_permission_grants',null),
  ('public.staff_permission_grant_classrooms','public.staff_permission_grant_classrooms',null),
  ('public.audit_logs','public.audit_logs',null),
  ('private.login_identities','private.login_identities',null),
  ('private.account_activations','private.account_activations',null),
  ('private.student_private_identities','private.student_private_identities',null),
  ('private.student_guardian_contacts','private.student_guardian_contacts',null),
  ('private.account_provisioning_queue','private.account_provisioning_queue',null),
  ('private.import_batches','private.import_batches',null),
  ('storage.objects:student-profile-images','storage.objects','bucket_id = ''student-profile-images''');

create temporary table reset_preserved_before(
  object_name text primary key, row_count bigint not null, fingerprint text not null
) on commit drop;
insert into reset_preserved_before
select object_name, pg_temp.row_count(relation_id, predicate),
       pg_temp.full_row_fingerprint(relation_id, predicate)
from reset_protected_targets;

select 'before' as phase, object_name, row_count from (
  select 'score_accounts'::text object_name, count(*)::bigint row_count from public.score_accounts
  union all select 'score_ledger', count(*) from public.score_ledger
  union all select 'incidents', count(*) from public.incidents
  union all select 'point_addition_requests', count(*) from public.point_addition_requests
  union all select 'deduction_approval_requests', count(*) from public.deduction_approval_requests
  union all select 'appeals', count(*) from public.appeals
  union all select 'follow_up_cases', count(*) from public.follow_up_cases
  union all select 'guardian_contact_tasks', count(*) from public.guardian_contact_tasks
  union all select 'deduction_batches', count(*) from private.deduction_batches
  union all select 'addition_batches', count(*) from private.addition_batches
  union all select 'appeal_decisions', count(*) from private.appeal_decisions
  union all select 'guardian_contact_attempts', count(*) from private.guardian_contact_attempts
  union all select 'student_paper_documents', count(*) from public.student_paper_documents
  union all select 'student_paper_document_events', count(*) from public.student_paper_document_events
  union all select 'paper_documents', count(*) from public.paper_documents
  union all select 'paper_document_events', count(*) from public.paper_document_events
) counts order by object_name;

-- No CASCADE.  This enumerates the complete reviewed operational FK closure;
-- TRUNCATE does not invoke the immutable row DELETE triggers, so they remain
-- enabled and unmodified.  CONTINUE IDENTITY deliberately retains sequence IDs.
truncate table
  public.score_accounts, public.score_ledger, public.incidents,
  public.point_addition_requests, public.deduction_approval_requests,
  public.appeals, public.follow_up_cases, public.guardian_contact_tasks,
  private.deduction_batches, private.addition_batches, private.appeal_decisions,
  private.guardian_contact_attempts, public.student_paper_documents,
  public.student_paper_document_events, public.paper_documents,
  public.paper_document_events continue identity;

insert into public.score_accounts(student_id, term_id, balance)
select student_id, term_id, 100
from public.enrollments
where term_id = current_setting('app.reset.target_term_id')::bigint and is_active
order by student_id;
insert into public.score_ledger(
  score_account_id, student_id, term_id, entry_type, requested_delta,
  applied_delta, balance_before, balance_after, reason, actor_snapshot
)
select id, student_id, term_id, 'semester_opening', 100, 100, 0, 100,
       'เปิดคะแนนประจำภาคเรียน (รีเซ็ตข้อมูลทดลอง)', 'ผู้ปฏิบัติการรีเซ็ตข้อมูลทดลอง'
from public.score_accounts;

create temporary table reset_audit_append(id bigint primary key) on commit drop;
with appended as (
  insert into public.audit_logs(action, entity_type, entity_id, after_state)
  values (
    'reset_all_trial_score_data', 'academic_term',
    current_setting('app.reset.target_term_id'),
    jsonb_build_object(
      'project_binding', current_setting('app.reset.project_binding'),
      'backup_reference', current_setting('app.reset.backup_reference'),
      'operator_label', current_setting('app.reset.operator_label'),
      'restore_drill_reference', current_setting('app.reset.restore_drill_reference'),
      'expected_migration_head', current_setting('app.reset.expected_migration_head'),
      'expected_active_enrollments', current_setting('app.reset.expected_active_enrollments')::bigint
    )
  ) returning id
)
insert into reset_audit_append(id) select id from appended;

do $verify$
declare v_bad text;
begin
  if (select count(*) from public.score_accounts)
       <> current_setting('app.reset.expected_active_enrollments')::bigint
     or (select count(*) from public.score_ledger)
       <> current_setting('app.reset.expected_active_enrollments')::bigint
     or exists (select 1 from public.score_accounts where balance <> 100)
     or exists (
       select 1 from public.score_ledger
       where entry_type <> 'semester_opening' or requested_delta <> 100
          or applied_delta <> 100 or balance_before <> 0 or balance_after <> 100
     ) then
    raise exception 'score initialization verification failed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.incidents
    union all select 1 from public.point_addition_requests
    union all select 1 from public.deduction_approval_requests
    union all select 1 from public.appeals
    union all select 1 from public.follow_up_cases
    union all select 1 from public.guardian_contact_tasks
    union all select 1 from private.deduction_batches
    union all select 1 from private.addition_batches
    union all select 1 from private.appeal_decisions
    union all select 1 from private.guardian_contact_attempts
    union all select 1 from public.student_paper_documents
    union all select 1 from public.student_paper_document_events
    union all select 1 from public.paper_documents
    union all select 1 from public.paper_document_events
  ) then
    raise exception 'operational tables are not empty' using errcode = '55000';
  end if;

  update reset_protected_targets
  set predicate = 'id not in (select id from reset_audit_append)'
  where object_name = 'public.audit_logs';
  select string_agg(before_counts.object_name, ', ' order by before_counts.object_name)
  into v_bad
  from reset_preserved_before before_counts
  join reset_protected_targets target using (object_name)
  where before_counts.row_count <> pg_temp.row_count(target.relation_id, target.predicate)
     or before_counts.fingerprint <> pg_temp.full_row_fingerprint(target.relation_id, target.predicate);
  if v_bad is not null then
    raise exception 'protected data verification failed for: %', v_bad using errcode = '55000';
  end if;
end;
$verify$;

select 'score-evidence Storage API deletion manifest' as phase, id, name
from storage.objects
where bucket_id = 'score-evidence'
order by name;

commit;
\echo 'Database reset committed. Delete only the emitted score-evidence objects through Storage API using the same backup reference.'
