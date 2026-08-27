#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${name ?? '<end>'}`)
    values[name.slice(2)] = value
  }
  return values
}

function required(values, name) {
  const value = String(values[name] ?? '').trim()
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

const values = parseArgs(process.argv.slice(2))
const output = resolve(required(values, 'output'))
const allowedRoots = [
  resolve(repositoryRoot, 'private-data'),
  resolve(repositoryRoot, '..', 'school-point-private-backups'),
]
if (!allowedRoots.some((root) => output.startsWith(`${root}\\`) || output.startsWith(`${root}/`))) {
  throw new Error('Reset SQL output must stay in private-data or school-point-private-backups')
}

const bindings = {
  targetTermId: required(values, 'target-term-id'),
  expectedDatabase: required(values, 'expected-database'),
  projectBinding: required(values, 'project-binding'),
  migrationHead: required(values, 'migration-head'),
  activeEnrollments: required(values, 'active-enrollments'),
  backupReference: required(values, 'backup-reference'),
  operatorLabel: required(values, 'operator-label'),
  restoreDrillReference: required(values, 'restore-drill-reference'),
}

if (!/^\d+$/.test(bindings.targetTermId) || !/^\d+$/.test(bindings.activeEnrollments)) {
  throw new Error('Term id and active enrollment count must be integers')
}
if (!/^\d{12,14}$/.test(bindings.migrationHead)) {
  throw new Error('Migration head must be a Supabase migration version')
}
if (Object.values(bindings).some((value) => String(value).includes('$reset$'))) {
  throw new Error('Reset bindings must not contain the SQL block delimiter')
}

// Supabase's management query endpoint accepts one prepared statement. A DO
// block keeps the reset atomic while retaining the psql procedure's bindings,
// table locks, protected-row fingerprints, and postconditions.
const sql = `-- Generated one-time operational reset. Do not reuse.
do $reset$
declare
  v_target_term_id bigint := ${bindings.targetTermId};
  v_expected_database text := ${sqlLiteral(bindings.expectedDatabase)};
  v_project_binding text := ${sqlLiteral(bindings.projectBinding)};
  v_expected_migration_head text := ${sqlLiteral(bindings.migrationHead)};
  v_expected_active_enrollments bigint := ${bindings.activeEnrollments};
  v_backup_reference text := ${sqlLiteral(bindings.backupReference)};
  v_operator_label text := ${sqlLiteral(bindings.operatorLabel)};
  v_restore_drill_reference text := ${sqlLiteral(bindings.restoreDrillReference)};
  v_actual_roster bigint;
  v_actual_migration_head text;
  v_target record;
  v_before record;
  v_after_count bigint;
  v_after_fingerprint text;
  v_after_predicate text;
  v_audit_id bigint;
  v_bad text := '';
begin
  perform pg_catalog.set_config('lock_timeout', '15s', true);
  perform pg_catalog.set_config('statement_timeout', '2min', true);

  if session_user not in ('postgres', 'supabase_admin') then
    raise exception 'run only as postgres or supabase_admin; session_user is %', session_user using errcode = '42501';
  end if;
  if current_database() <> v_expected_database then
    raise exception 'database binding mismatch: expected %, connected to %', v_expected_database, current_database() using errcode = '42501';
  end if;
  if v_expected_active_enrollments <= 0 then
    raise exception 'expected active enrollment roster must be greater than zero' using errcode = '22023';
  end if;
  if nullif(btrim(v_project_binding), '') is null
     or nullif(btrim(v_backup_reference), '') is null
     or nullif(btrim(v_operator_label), '') is null
     or nullif(btrim(v_restore_drill_reference), '') is null then
    raise exception 'reset audit bindings must not be empty' using errcode = '42501';
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
  if v_actual_roster <> v_expected_active_enrollments then
    raise exception 'roster binding mismatch: expected %, found %', v_expected_active_enrollments, v_actual_roster using errcode = '55000';
  end if;
  select coalesce(max(version), '') into v_actual_migration_head
  from supabase_migrations.schema_migrations;
  if v_actual_migration_head <> v_expected_migration_head then
    raise exception 'migration-head binding mismatch: expected %, found %', v_expected_migration_head, v_actual_migration_head using errcode = '55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('school-point:reset-all-trial-score-data:v3', 0)
  );
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

  -- Repeat live bindings after the maintenance lock closes the race window.
  if (select count(*) from public.academic_terms where status = 'active') <> 1
     or not exists (select 1 from public.academic_terms where id = v_target_term_id and status = 'active')
     or (select count(*) from public.enrollments where term_id = v_target_term_id and is_active)
       <> v_expected_active_enrollments
     or (select coalesce(max(version), '') from supabase_migrations.schema_migrations)
       <> v_expected_migration_head then
    raise exception 'reset bindings changed while acquiring maintenance locks' using errcode = '55000';
  end if;

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
  for v_target in select * from reset_protected_targets order by object_name loop
    execute format(
      'select count(*)::bigint, coalesce(md5(string_agg(row_hash, '','' order by row_hash)), md5('''')) ' ||
      'from (select md5(row_to_json(t)::text) as row_hash from %s as t %s) rows',
      v_target.relation_id,
      case when v_target.predicate is null then '' else 'where ' || v_target.predicate end
    ) into v_after_count, v_after_fingerprint;
    insert into reset_preserved_before values (v_target.object_name, v_after_count, v_after_fingerprint);
  end loop;

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
  where term_id = v_target_term_id and is_active
  order by student_id;
  insert into public.score_ledger(
    score_account_id, student_id, term_id, entry_type, requested_delta,
    applied_delta, balance_before, balance_after, reason, actor_snapshot
  )
  select id, student_id, term_id, 'semester_opening', 100, 100, 0, 100,
         'เปิดคะแนนประจำภาคเรียน (รีเซ็ตข้อมูลทดลอง)', 'ผู้ปฏิบัติการรีเซ็ตข้อมูลทดลอง'
  from public.score_accounts;

  insert into public.audit_logs(action, entity_type, entity_id, after_state)
  values (
    'reset_all_trial_score_data', 'academic_term', v_target_term_id,
    jsonb_build_object(
      'project_binding', v_project_binding,
      'backup_reference', v_backup_reference,
      'operator_label', v_operator_label,
      'restore_drill_reference', v_restore_drill_reference,
      'expected_migration_head', v_expected_migration_head,
      'expected_active_enrollments', v_expected_active_enrollments
    )
  ) returning id into v_audit_id;

  if (select count(*) from public.score_accounts) <> v_expected_active_enrollments
     or (select count(*) from public.score_ledger) <> v_expected_active_enrollments
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

  for v_target in select * from reset_protected_targets order by object_name loop
    v_after_predicate := v_target.predicate;
    if v_target.object_name = 'public.audit_logs' then
      v_after_predicate := format('id <> %s', v_audit_id);
    end if;
    execute format(
      'select count(*)::bigint, coalesce(md5(string_agg(row_hash, '','' order by row_hash)), md5('''')) ' ||
      'from (select md5(row_to_json(t)::text) as row_hash from %s as t %s) rows',
      v_target.relation_id,
      case when v_after_predicate is null then '' else 'where ' || v_after_predicate end
    ) into v_after_count, v_after_fingerprint;
    select * into v_before from reset_preserved_before where object_name = v_target.object_name;
    if v_before.row_count <> v_after_count or v_before.fingerprint <> v_after_fingerprint then
      v_bad := concat_ws(', ', nullif(v_bad, ''), v_target.object_name);
    end if;
  end loop;
  if v_bad <> '' then
    raise exception 'protected data verification failed for: %', v_bad using errcode = '55000';
  end if;
end
$reset$;
`

await writeFile(output, sql, { flag: 'wx' })
console.log(`Generated one-time reset SQL: ${output}`)
