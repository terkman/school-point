-- ONE-TIME, DESTRUCTIVE, PURE-SQL SUPABASE DASHBOARD PROCEDURE.
-- Project: eymzooodegzjqkkgenal (school-point / main / Production)
-- Prepared: 2026-08-26. Do not reuse after this reset.
--
-- This procedure clears only the reviewed score/workflow/document tables,
-- recreates 100-point opening balances for active term 1, preserves every
-- identity/roster/configuration/audit row, and appends one attributed audit.
-- It intentionally never mutates storage.objects. The live score-evidence
-- bucket was verified empty before backup.

begin;
-- READ COMMITTED is deliberate: the destructive gates must see any writes that
-- committed while maintenance locks were being acquired. Once locked, the
-- protected/operational relations cannot change until COMMIT.
set transaction isolation level read committed;
set local lock_timeout = '15s';
set local statement_timeout = '2min';

create temporary table reset_parameters (
  confirmation text not null,
  project_ref text not null,
  backup_id text not null,
  restore_drill_reference text not null,
  change_ticket text not null,
  target_term_id bigint not null,
  expected_active_enrollments bigint not null,
  expected_migration_head text not null,
  expected_migration_count bigint not null,
  expected_migration_md5 text not null,
  operator_user_id uuid not null,
  operator_label text not null
) on commit drop;

-- OPERATOR_USER_ID and OPERATOR_LABEL must be replaced immediately before run.
insert into reset_parameters values (
  'RESET_ALL_TRIAL_SCORE_DATA',
  'eymzooodegzjqkkgenal',
  'reset_backup_20260826_trial_scores_v1',
  'same-project-logical-restore-20260826T075800Z',
  'codex-reset-20260826',
  1,
  102,
  '202608090004',
  28,
  'a9b1e69f21fc11f66a14b24db240dcd1',
  '16a59fe0-7ffc-4d1d-a679-c1c78b8d997a',
  'นาย พัชรพล เกิดผล'
);

select pg_advisory_xact_lock(
  hashtextextended('school-point:reset-all-trial-score-data:20260826', 0)
);

-- The complete reviewed FK closure is locked and later truncated in one
-- statement. No CASCADE and no sequence reset are used.
lock table
  public.score_accounts, public.score_ledger, public.incidents,
  public.point_addition_requests, public.deduction_approval_requests,
  public.appeals, public.follow_up_cases, public.guardian_contact_tasks,
  private.deduction_batches, private.addition_batches,
  private.appeal_decisions, private.guardian_contact_attempts,
  public.student_paper_documents, public.student_paper_document_events,
  public.paper_documents, public.paper_document_events
in access exclusive mode;

-- Freeze the backup proof and restore-drill evidence used by every gate.
lock table
  reset_backup_20260826_trial_scores.manifest,
  reset_backup_20260826_trial_scores.protected_fingerprints,
  reset_backup_20260826_trial_scores.operational_backup_fingerprints,
  reset_backup_20260826_trial_scores.public_audit_logs,
  reset_restore_drill_20260826_trial_scores.verification
in share mode;
do $$
begin
  if has_table_privilege(
    current_user, 'supabase_migrations.schema_migrations', 'UPDATE'
  ) then
    lock table supabase_migrations.schema_migrations in share mode;
  end if;
end
$$;

-- Lock every table whose complete-row fingerprint was recorded at backup.
-- SHARE blocks writes while allowing ordinary reads during the short reset.
do $$
declare r record; v_relation regclass;
begin
  if to_regnamespace('reset_backup_20260826_trial_scores') is null then
    raise exception 'Required backup schema is absent';
  end if;
  for r in
    select object_name
    from reset_backup_20260826_trial_scores.protected_fingerprints
    order by object_name
  loop
    if r.object_name = 'storage.objects:student-profile-images' then
      v_relation := 'storage.objects'::regclass;
    else
      v_relation := to_regclass(r.object_name);
    end if;
    if v_relation is null then
      raise exception 'Protected relation % is absent', r.object_name;
    end if;
    -- Supabase owns some Auth-internal tables with a dedicated service role.
    -- The dashboard postgres role can SELECT/fingerprint them but cannot take
    -- SHARE locks. Skip only relations lacking UPDATE privilege; they remain
    -- outside this script's write set and are still checked before and after.
    if has_table_privilege(current_user, v_relation, 'UPDATE') then
      execute format('lock table %s in share mode', v_relation);
    end if;
  end loop;
  lock table public.audit_logs in share row exclusive mode;
end
$$;

create function pg_temp.full_row_fingerprint(
  p_relation regclass,
  p_predicate text default null
) returns text
language plpgsql stable set search_path = '' as $$
declare v_fingerprint text;
begin
  execute format(
    'select md5(coalesce(string_agg(row_hash, %L order by row_hash), %L)) ' ||
    'from (select md5(row_to_json(t)::text) row_hash from %s t %s) rows',
    '', '', p_relation,
    case when p_predicate is null then '' else 'where ' || p_predicate end
  ) into v_fingerprint;
  return v_fingerprint;
end
$$;

create function pg_temp.relation_count(
  p_relation regclass,
  p_predicate text default null
) returns bigint
language plpgsql stable set search_path = '' as $$
declare v_count bigint;
begin
  execute format(
    'select count(*) from %s t %s', p_relation,
    case when p_predicate is null then '' else 'where ' || p_predicate end
  ) into v_count;
  return v_count;
end
$$;

-- All environment, backup, migration, roster, operator, storage and preserved
-- data gates run after locks and fail the transaction closed.
do $$
declare
  p reset_parameters%rowtype;
  m reset_backup_20260826_trial_scores.manifest%rowtype;
  r record;
  v_relation regclass;
  v_predicate text;
  v_count bigint;
  v_hash text;
  v_versions_md5 text;
begin
  select * into strict p from reset_parameters;
  if p.confirmation <> 'RESET_ALL_TRIAL_SCORE_DATA' then
    raise exception 'Exact reset confirmation is absent' using errcode = '42501';
  end if;
  if session_user not in ('postgres', 'supabase_admin')
     or current_database() <> 'postgres' then
    raise exception 'Unexpected database operator or database';
  end if;

  select * into strict m
  from reset_backup_20260826_trial_scores.manifest
  where backup_id = p.backup_id;
  if m.project_ref <> p.project_ref
     or m.target_term_id <> p.target_term_id
     or m.expected_active_enrollments <> p.expected_active_enrollments
     or m.migration_head <> p.expected_migration_head
     or m.migration_count <> p.expected_migration_count
     or m.migration_versions_md5 <> p.expected_migration_md5
     or m.restore_drill_reference <> p.restore_drill_reference then
    raise exception 'Backup/project/term/migration/restore binding mismatch';
  end if;

  select md5(string_agg(version, ',' order by version))
    into v_versions_md5
  from supabase_migrations.schema_migrations;
  if (select count(*) from supabase_migrations.schema_migrations)
       <> p.expected_migration_count
     or (select max(version) from supabase_migrations.schema_migrations)
       <> p.expected_migration_head
     or v_versions_md5 <> p.expected_migration_md5 then
    raise exception 'Live migration set differs from the backed-up project';
  end if;

  if p.expected_active_enrollments <= 0
     or (select count(*) from public.academic_terms where status = 'active') <> 1
     or not exists (
       select 1 from public.academic_terms
       where id = p.target_term_id and status = 'active'
     )
     or (select count(*) from public.enrollments
         where term_id = p.target_term_id and is_active)
       <> p.expected_active_enrollments then
    raise exception 'Active term or roster binding mismatch';
  end if;

  if not exists (
    select 1 from public.profiles
    where user_id = p.operator_user_id
      and role = 'admin' and is_active
      and not activation_required
      and display_name = p.operator_label
      and p.operator_label <> '__OPERATOR_LABEL__'
  ) then
    raise exception 'The attributed operator/label is not an activated administrator';
  end if;

  if (select count(*) from storage.objects where bucket_id = 'score-evidence')
       <> m.score_evidence_object_count
     or m.score_evidence_object_count <> 0 then
    raise exception 'score-evidence is not empty or changed after backup';
  end if;

  if (select count(*)
      from reset_backup_20260826_trial_scores.operational_backup_fingerprints)
       <> 17
     or exists (
       select 1
       from reset_backup_20260826_trial_scores.operational_backup_fingerprints
       where not verified
     )
     or (select count(*)
         from reset_restore_drill_20260826_trial_scores.verification) <> 17
     or exists (
       select 1
       from reset_restore_drill_20260826_trial_scores.verification
       where not verified
     ) then
    raise exception 'Backup copy or restore-drill proof is incomplete';
  end if;

  if exists (
    with expected(object_name) as (
      values
        ('public.score_accounts'), ('public.score_ledger'),
        ('public.incidents'), ('public.point_addition_requests'),
        ('public.deduction_approval_requests'), ('public.appeals'),
        ('public.follow_up_cases'), ('public.guardian_contact_tasks'),
        ('public.student_paper_documents'),
        ('public.student_paper_document_events'),
        ('public.paper_documents'), ('public.paper_document_events'),
        ('private.deduction_batches'), ('private.addition_batches'),
        ('private.appeal_decisions'),
        ('private.guardian_contact_attempts'), ('public.audit_logs')
    ), actual as (
      select object_name
      from reset_backup_20260826_trial_scores.operational_backup_fingerprints
    )
    (select object_name from expected except select object_name from actual)
    union all
    (select object_name from actual except select object_name from expected)
  ) then
    raise exception 'Operational backup fingerprint set is not the approved 16 tables plus audit';
  end if;

  if exists (
    with expected(table_name) as (
      values
        ('public_score_accounts'), ('public_score_ledger'),
        ('public_incidents'), ('public_point_addition_requests'),
        ('public_deduction_approval_requests'), ('public_appeals'),
        ('public_follow_up_cases'), ('public_guardian_contact_tasks'),
        ('public_student_paper_documents'),
        ('public_student_paper_document_events'),
        ('public_paper_documents'), ('public_paper_document_events'),
        ('private_deduction_batches'), ('private_addition_batches'),
        ('private_appeal_decisions'),
        ('private_guardian_contact_attempts'), ('public_audit_logs')
    ), actual as (
      select table_name
      from reset_restore_drill_20260826_trial_scores.verification
    )
    (select table_name from expected except select table_name from actual)
    union all
    (select table_name from actual except select table_name from expected)
  ) then
    raise exception 'Restore-drill object set differs from the approved backup set';
  end if;

  if exists (
    with required(object_name) as (
      values
        ('auth.users'), ('auth.identities'), ('public.profiles'),
        ('public.students'), ('public.teachers'), ('public.academic_terms'),
        ('public.classrooms'), ('public.enrollments'),
        ('public.teacher_classroom_assignments'), ('public.behavior_rules'),
        ('public.positive_behavior_rules'), ('public.staff_permission_grants'),
        ('public.staff_permission_grant_classrooms'),
        ('private.login_identities'), ('private.account_activations'),
        ('private.student_private_identities'),
        ('private.student_guardian_contacts'),
        ('private.account_provisioning_queue'), ('private.import_batches'),
        ('storage.buckets'), ('storage.objects:student-profile-images')
    )
    select object_name from required
    except
    select object_name
    from reset_backup_20260826_trial_scores.protected_fingerprints
  ) then
    raise exception 'Required protected-data fingerprint coverage is incomplete';
  end if;

  if exists (
    select 1
    from reset_backup_20260826_trial_scores.protected_fingerprints
    where object_name = 'public.audit_logs'
  ) then
    raise exception 'Audit must be verified by the dedicated append-aware check';
  end if;

  for r in
    select object_name, row_count, content_md5
    from reset_backup_20260826_trial_scores.protected_fingerprints
    order by object_name
  loop
    if r.object_name = 'storage.objects:student-profile-images' then
      v_relation := 'storage.objects'::regclass;
      v_predicate := 'bucket_id = ''student-profile-images''';
    else
      v_relation := to_regclass(r.object_name);
      v_predicate := null;
    end if;
    v_count := pg_temp.relation_count(v_relation, v_predicate);
    v_hash := pg_temp.full_row_fingerprint(v_relation, v_predicate);
    if v_count <> r.row_count or v_hash <> r.content_md5 then
      raise exception 'Protected data changed after backup: %', r.object_name;
    end if;
  end loop;

  for r in
    select object_name, source_row_count, source_md5
    from reset_backup_20260826_trial_scores.operational_backup_fingerprints
    order by object_name
  loop
    v_relation := to_regclass(r.object_name);
    v_count := pg_temp.relation_count(v_relation);
    v_hash := pg_temp.full_row_fingerprint(v_relation);
    if v_count <> r.source_row_count or v_hash <> r.source_md5 then
      raise exception 'Operational data changed after backup: %', r.object_name;
    end if;
  end loop;
end
$$;

create temporary table reset_before_counts (
  object_name text primary key,
  row_count bigint not null
) on commit drop;
insert into reset_before_counts values
  ('score_accounts', (select count(*) from public.score_accounts)),
  ('score_ledger', (select count(*) from public.score_ledger)),
  ('incidents', (select count(*) from public.incidents)),
  ('point_addition_requests', (select count(*) from public.point_addition_requests)),
  ('deduction_approval_requests', (select count(*) from public.deduction_approval_requests)),
  ('appeals', (select count(*) from public.appeals)),
  ('follow_up_cases', (select count(*) from public.follow_up_cases)),
  ('guardian_contact_tasks', (select count(*) from public.guardian_contact_tasks)),
  ('deduction_batches', (select count(*) from private.deduction_batches)),
  ('addition_batches', (select count(*) from private.addition_batches)),
  ('appeal_decisions', (select count(*) from private.appeal_decisions)),
  ('guardian_contact_attempts', (select count(*) from private.guardian_contact_attempts)),
  ('student_paper_documents', (select count(*) from public.student_paper_documents)),
  ('student_paper_document_events', (select count(*) from public.student_paper_document_events)),
  ('paper_documents', (select count(*) from public.paper_documents)),
  ('paper_document_events', (select count(*) from public.paper_document_events));

truncate table
  public.score_accounts, public.score_ledger, public.incidents,
  public.point_addition_requests, public.deduction_approval_requests,
  public.appeals, public.follow_up_cases, public.guardian_contact_tasks,
  private.deduction_batches, private.addition_batches,
  private.appeal_decisions, private.guardian_contact_attempts,
  public.student_paper_documents, public.student_paper_document_events,
  public.paper_documents, public.paper_document_events
continue identity;

insert into public.score_accounts(student_id, term_id, balance)
select e.student_id, e.term_id, 100
from public.enrollments e
join reset_parameters p on p.target_term_id = e.term_id
where e.is_active
order by e.student_id;

insert into public.score_ledger(
  score_account_id, student_id, term_id, entry_type,
  requested_delta, applied_delta, balance_before, balance_after,
  reason, actor_user_id, actor_snapshot
)
select a.id, a.student_id, a.term_id, 'semester_opening',
       100, 100, 0, 100,
       'เปิดคะแนนประจำภาคเรียน (รีเซ็ตข้อมูลทดลอง)',
       p.operator_user_id, p.operator_label
from public.score_accounts a
cross join reset_parameters p;

create temporary table reset_new_audit(id bigint primary key) on commit drop;
with appended as (
  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, after_state
  )
  select
    p.operator_user_id,
    'reset_all_trial_score_data',
    'academic_term',
    p.target_term_id::text,
    jsonb_build_object(
      'project_ref', p.project_ref,
      'backup_id', p.backup_id,
      'restore_drill_reference', p.restore_drill_reference,
      'change_ticket', p.change_ticket,
      'operator_label', p.operator_label,
      'migration_head', p.expected_migration_head,
      'active_enrollments', p.expected_active_enrollments,
      'before_counts', (
        select jsonb_object_agg(object_name, row_count order by object_name)
        from reset_before_counts
      ),
      'after_state', format(
        '%s opening accounts and %s opening ledger rows; all other operational tables empty',
        p.expected_active_enrollments, p.expected_active_enrollments
      )
    )
  from reset_parameters p
  returning id
)
insert into reset_new_audit select id from appended;

do $$
declare p reset_parameters%rowtype; r record;
declare v_relation regclass; v_predicate text; v_count bigint; v_hash text;
declare v_migration_md5 text;
begin
  select * into strict p from reset_parameters;
  select md5(string_agg(version, ',' order by version))
    into v_migration_md5
  from supabase_migrations.schema_migrations;
  if (select count(*) from supabase_migrations.schema_migrations)
       <> p.expected_migration_count
     or (select max(version) from supabase_migrations.schema_migrations)
       <> p.expected_migration_head
     or v_migration_md5 <> p.expected_migration_md5 then
    raise exception 'Migration set changed during reset';
  end if;

  if (select count(*) from public.score_accounts)
       <> p.expected_active_enrollments
     or exists (select 1 from public.score_accounts
                where term_id <> p.target_term_id or balance <> 100)
     or exists (
       (select student_id, term_id
        from public.enrollments
        where term_id = p.target_term_id and is_active)
       except
       (select student_id, term_id from public.score_accounts)
     )
     or exists (
       (select student_id, term_id from public.score_accounts)
       except
       (select student_id, term_id
        from public.enrollments
        where term_id = p.target_term_id and is_active)
     ) then
    raise exception 'Opening score-account verification failed';
  end if;

  if (select count(*) from public.score_ledger)
       <> p.expected_active_enrollments
     or exists (
       select 1 from public.score_ledger
       where entry_type <> 'semester_opening'
          or requested_delta <> 100 or applied_delta <> 100
          or balance_before <> 0 or balance_after <> 100
          or actor_user_id <> p.operator_user_id
     )
     or exists (
       select 1
       from public.score_accounts a
       left join public.score_ledger l
         on l.score_account_id = a.id
        and l.student_id = a.student_id
        and l.term_id = a.term_id
       group by a.id
       having count(l.id) <> 1
     ) then
    raise exception 'Opening ledger verification failed';
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
    raise exception 'A cleared operational table is not empty';
  end if;

  if (select count(*) from storage.objects where bucket_id = 'score-evidence') <> 0 then
    raise exception 'score-evidence changed during reset';
  end if;

  for r in
    select object_name, row_count, content_md5
    from reset_backup_20260826_trial_scores.protected_fingerprints
    order by object_name
  loop
    if r.object_name = 'storage.objects:student-profile-images' then
      v_relation := 'storage.objects'::regclass;
      v_predicate := 'bucket_id = ''student-profile-images''';
    else
      v_relation := to_regclass(r.object_name);
      v_predicate := null;
    end if;
    v_count := pg_temp.relation_count(v_relation, v_predicate);
    v_hash := pg_temp.full_row_fingerprint(v_relation, v_predicate);
    if v_count <> r.row_count or v_hash <> r.content_md5 then
      raise exception 'Protected data changed during reset: %', r.object_name;
    end if;
  end loop;

  if (select count(*) from public.audit_logs)
       <> (select count(*) + 1
           from reset_backup_20260826_trial_scores.public_audit_logs)
     or (select count(*) from reset_new_audit) <> 1
     or pg_temp.full_row_fingerprint(
          'public.audit_logs'::regclass,
          'id not in (select id from reset_new_audit)'
        ) <> pg_temp.full_row_fingerprint(
          'reset_backup_20260826_trial_scores.public_audit_logs'::regclass
        ) then
    raise exception 'Existing audit history was not preserved exactly';
  end if;
end
$$;

commit;

select jsonb_build_object(
  'project_ref', 'eymzooodegzjqkkgenal',
  'target_term_id', 1,
  'active_enrollments', (
    select count(*) from public.enrollments where term_id = 1 and is_active
  ),
  'score_accounts', (select count(*) from public.score_accounts),
  'all_balances_100', (select bool_and(balance = 100) from public.score_accounts),
  'opening_ledger_rows', (select count(*) from public.score_ledger),
  'incidents', (select count(*) from public.incidents),
  'addition_requests', (select count(*) from public.point_addition_requests),
  'deduction_requests', (select count(*) from public.deduction_approval_requests),
  'appeals', (select count(*) from public.appeals),
  'follow_up_cases', (select count(*) from public.follow_up_cases),
  'guardian_tasks', (select count(*) from public.guardian_contact_tasks),
  'paper_documents', (select count(*) from public.paper_documents),
  'score_evidence_objects', (
    select count(*) from storage.objects where bucket_id = 'score-evidence'
  ),
  'students', (select count(*) from public.students),
  'teachers', (select count(*) from public.teachers),
  'profiles', (select count(*) from public.profiles),
  'audit_logs', (select count(*) from public.audit_logs)
) as reset_verification;
