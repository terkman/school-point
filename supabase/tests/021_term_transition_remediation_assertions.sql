begin;

select plan(14);

-- ---------------------------------------------------------------------------
-- Static contract checks
-- ---------------------------------------------------------------------------

select ok(
  not exists (
    select 1
    from unnest(array[
      'public.list_academic_terms_v1()',
      'public.get_term_history_v1(bigint,bigint)',
      'public.list_term_remediations_v1(boolean)',
      'public.admin_preview_term_transition_v1(bigint)',
      'public.admin_prepare_next_term_v1(smallint,smallint,text,date,date)',
      'public.admin_transition_term_v1(bigint,bigint,uuid)',
      'public.request_term_remediation_v1(bigint,smallint,timestamptz,text,uuid)',
      'public.review_term_remediation_v1(bigint,boolean,text,uuid)',
      'public.admin_assign_term_remediation_teacher_v1(bigint,bigint,text)'
    ]) as signature(value)
    join pg_proc routine on routine.oid = signature.value::regprocedure
    where not routine.prosecdef
       or not ('search_path=""' = any(coalesce(routine.proconfig, array[]::text[])))
       or not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
       or has_function_privilege('anon', routine.oid, 'EXECUTE')
  ),
  'term lifecycle and remediation RPCs are security definer, empty search_path, authenticated-only'
);

select ok(
  not has_table_privilege('authenticated', 'public.academic_terms', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.term_closing_snapshots', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.term_remediation_cases', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.term_remediation_requests', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.academic_term_transitions', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.academic_term_preparations', 'SELECT,INSERT,UPDATE,DELETE'),
  'application users have no direct DML on terms or any remediation table'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'score_ledger' and indexname = 'score_ledger_one_opening_idx'
  )
  and exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'score_ledger' and indexname = 'score_ledger_remediation_request_idx'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.score_ledger'::regclass and conname = 'score_ledger_remediation_provenance'
  ),
  'ledger enforces one opening per account and unique remediation provenance'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create temp table t21_fixture (key text primary key, value text not null) on commit drop;

create function pg_temp.t21_id(p_key text) returns bigint language sql as $$
  select value::bigint from t21_fixture where key = p_key
$$;

create function pg_temp.t21_uid(p_key text) returns uuid language sql as $$
  select value::uuid from t21_fixture where key = p_key
$$;

create function pg_temp.t21_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', 'authenticated',
      'amr', json_build_array(json_build_object('method', 'password', 'timestamp', 1))
    )::text,
    true
  );
end;
$$;

do $$
declare
  v_admin uuid := '21000000-0000-4000-8000-000000000001';
  v_teacher_a uuid := '21000000-0000-4000-8000-000000000002';
  v_teacher_b uuid := '21000000-0000-4000-8000-000000000003';
  v_student_1_user uuid := '21000000-0000-4000-8000-000000000004';
  v_student_2_user uuid := '21000000-0000-4000-8000-000000000005';
  v_director uuid := '21000000-0000-4000-8000-000000000006';
  v_teacher_a_id bigint;
  v_teacher_b_id bigint;
  v_student_1 bigint;
  v_student_2 bigint;
  v_term_1 bigint;
  v_classroom bigint;
  v_active bigint;
begin
  -- Close any pre-existing active term inside this rolled-back transaction.
  select id into v_active from public.academic_terms where status = 'active';
  if v_active is not null then
    insert into private.term_write_authorizations(txid, kind, ref_id)
    values (txid_current(), 'close_term', v_active);
    update public.academic_terms set status = 'closed' where id = v_active;
    delete from private.term_write_authorizations where txid = txid_current();
  end if;

  insert into auth.users (id, aud, role, email)
  values
    (v_admin, 'authenticated', 'authenticated', 'pgtap21-admin@example.invalid'),
    (v_teacher_a, 'authenticated', 'authenticated', 'pgtap21-teacher-a@example.invalid'),
    (v_teacher_b, 'authenticated', 'authenticated', 'pgtap21-teacher-b@example.invalid'),
    (v_student_1_user, 'authenticated', 'authenticated', 'pgtap21-student-1@example.invalid'),
    (v_student_2_user, 'authenticated', 'authenticated', 'pgtap21-student-2@example.invalid'),
    (v_director, 'authenticated', 'authenticated', 'pgtap21-director@example.invalid');

  insert into public.profiles (user_id, role, display_name, is_active, activation_required)
  values
    (v_admin, 'admin', 'pgTAP21 Admin', true, false),
    (v_teacher_a, 'teacher', 'pgTAP21 Teacher A', true, false),
    (v_teacher_b, 'teacher', 'pgTAP21 Teacher B', true, false),
    (v_student_1_user, 'student', 'pgTAP21 Student 1', true, false),
    (v_student_2_user, 'student', 'pgTAP21 Student 2', true, false),
    (v_director, 'director', 'pgTAP21 Director', true, false);

  insert into public.teachers (user_id, employee_code, given_name, family_name, status, intended_role)
  values (v_teacher_a, 'PGTAP21-TA', 'Teacher', 'A', 'active', 'teacher')
  returning id into v_teacher_a_id;
  insert into public.teachers (user_id, employee_code, given_name, family_name, status, intended_role)
  values (v_teacher_b, 'PGTAP21-TB', 'Teacher', 'B', 'active', 'teacher')
  returning id into v_teacher_b_id;

  insert into public.students (user_id, student_code, given_name, family_name)
  values (v_student_1_user, 'PGTAP21-S1', 'Student', 'One')
  returning id into v_student_1;
  insert into public.students (user_id, student_code, given_name, family_name)
  values (v_student_2_user, 'PGTAP21-S2', 'Student', 'Two')
  returning id into v_student_2;

  insert into public.academic_terms (school_year, semester, name, starts_on, ends_on, status)
  values (2997, 1, 'pgTAP21 Term 1', current_date - 120, current_date - 31, 'planned')
  returning id into v_term_1;

  insert into public.classrooms (term_id, grade_level, room_number, display_name)
  values (v_term_1, 'M1', '21', 'pgTAP21 M1/21')
  returning id into v_classroom;

  insert into public.enrollments (term_id, classroom_id, student_id, student_number)
  values (v_term_1, v_classroom, v_student_1, 1), (v_term_1, v_classroom, v_student_2, 2);

  insert into public.teacher_classroom_assignments (term_id, classroom_id, teacher_id)
  values (v_term_1, v_classroom, v_teacher_a_id);

  insert into t21_fixture values
    ('admin', v_admin), ('teacher_a', v_teacher_a), ('teacher_b', v_teacher_b),
    ('student_1_user', v_student_1_user), ('student_2_user', v_student_2_user), ('director', v_director),
    ('teacher_a_id', v_teacher_a_id), ('teacher_b_id', v_teacher_b_id),
    ('student_1', v_student_1), ('student_2', v_student_2),
    ('term_1', v_term_1), ('classroom_1', v_classroom);
end;
$$;

-- ---------------------------------------------------------------------------
-- Term 1: activate, open at 100, student 1 drops to 70, one pending request
-- ---------------------------------------------------------------------------

do $$
declare
  v_term_1 bigint := pg_temp.t21_id('term_1');
  v_student_1 bigint := pg_temp.t21_id('student_1');
  v_student_2 bigint := pg_temp.t21_id('student_2');
  v_rule public.behavior_rules%rowtype;
  v_result jsonb;
begin
  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  perform public.admin_activate_term(v_term_1);
  perform public.initialize_term_scores(v_term_1);

  v_result := public.admin_adjust_score(
    gen_random_uuid(), v_student_1, (-30)::smallint, now() - interval '40 days',
    'pgTAP21 term one correction', v_term_1
  );
  if (v_result ->> 'balanceAfter')::integer <> 70 then
    raise exception 'student 1 should close term 1 at 70, got %', v_result;
  end if;

  select rule.* into v_rule from public.behavior_rules rule where rule.is_active order by rule.id limit 1;
  insert into public.deduction_approval_requests (
    batch_id, client_request_id, student_id, term_id, classroom_id, rule_id, rule_snapshot,
    requested_points, occurred_at, requested_by, requested_by_snapshot, request_payload_hash
  ) values (
    gen_random_uuid(), gen_random_uuid(), v_student_2, v_term_1, pg_temp.t21_id('classroom_1'), v_rule.id,
    jsonb_build_object('rule_code', v_rule.rule_code, 'title_th', v_rule.title_th),
    10, now() - interval '35 days', pg_temp.t21_uid('admin'), 'pgTAP21 Admin', repeat('a', 64)
  );
  insert into t21_fixture
  select 'pending_deduction', id::text from public.deduction_approval_requests
  where term_id = v_term_1 and status = 'pending';
end;
$$;

select pass('term 1 opens at 100 and records a 70 closing candidate with a pending request');

-- ---------------------------------------------------------------------------
-- Prepare Term 2: copies roster once; same-payload retry replays
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_replay jsonb;
  v_term_2 bigint;
begin
  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  v_result := public.admin_prepare_next_term_v1(
    2997::smallint, 2::smallint, 'pgTAP21 Term 2', current_date - 30, current_date + 60
  );
  v_term_2 := (v_result -> 'term' ->> 'id')::bigint;
  if (v_result ->> 'replayed')::boolean
     or (v_result ->> 'classroomCount')::integer <> 1
     or (v_result ->> 'enrollmentCount')::integer <> 2
     or (v_result ->> 'assignmentCount')::integer <> 1
     or v_result -> 'term' ->> 'status' <> 'planned' then
    raise exception 'unexpected prepare result %', v_result;
  end if;

  v_replay := public.admin_prepare_next_term_v1(
    2997::smallint, 2::smallint, 'pgTAP21 Term 2', current_date - 30, current_date + 60
  );
  if not (v_replay ->> 'replayed')::boolean
     or (select count(*) from public.classrooms where term_id = v_term_2) <> 1
     or (select count(*) from public.enrollments where term_id = v_term_2) <> 2 then
    raise exception 'prepare retry duplicated the roster %', v_replay;
  end if;

  begin
    perform public.admin_prepare_next_term_v1(
      2997::smallint, 2::smallint, 'pgTAP21 Term 2 renamed', current_date - 30, current_date + 60
    );
    raise exception 'mismatched prepare payload was accepted';
  exception when sqlstate '22023' then null;
  end;

  insert into t21_fixture values ('term_2', v_term_2);
end;
$$;

select pass('prepare copies classroom, roster, and assignment once and rejects a mismatched retry');

-- ---------------------------------------------------------------------------
-- Pending requests block the transition and nothing changes
-- ---------------------------------------------------------------------------

do $$
declare
  v_term_1 bigint := pg_temp.t21_id('term_1');
  v_term_2 bigint := pg_temp.t21_id('term_2');
  v_preview jsonb;
begin
  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  v_preview := public.admin_preview_term_transition_v1(v_term_2);
  if (v_preview ->> 'canTransition')::boolean
     or not (v_preview -> 'blockers') ? 'PENDING_DEDUCTION_REQUESTS'
     or (v_preview -> 'counts' ->> 'expectedRemediationCases')::integer <> 1
     or (v_preview ->> 'currentTermId')::bigint <> v_term_1 then
    raise exception 'preview did not report the pending blocker %', v_preview;
  end if;

  begin
    perform public.admin_transition_term_v1(v_term_1, v_term_2, gen_random_uuid());
    raise exception 'transition ignored a pending deduction request';
  exception when sqlstate '55000' then null;
  end;

  if (select status from public.academic_terms where id = v_term_1) <> 'active'
     or (select status from public.academic_terms where id = v_term_2) <> 'planned'
     or exists (select 1 from public.term_closing_snapshots where term_id = v_term_1)
     or exists (select 1 from public.score_accounts where term_id = v_term_2) then
    raise exception 'blocked transition left partial state';
  end if;
end;
$$;

select pass('pending requests block the transition and leave no partial state');

-- ---------------------------------------------------------------------------
-- Successful transition, replay, mismatched replay, and second attempt
-- ---------------------------------------------------------------------------

do $$
declare
  v_term_1 bigint := pg_temp.t21_id('term_1');
  v_term_2 bigint := pg_temp.t21_id('term_2');
  v_student_1 bigint := pg_temp.t21_id('student_1');
  v_student_2 bigint := pg_temp.t21_id('student_2');
  v_request uuid := gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
  v_case_id bigint;
begin
  update public.deduction_approval_requests
  set status = 'rejected', reviewed_by = pg_temp.t21_uid('admin'), reviewed_at = now()
  where id = pg_temp.t21_id('pending_deduction');

  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  v_result := public.admin_transition_term_v1(v_term_1, v_term_2, v_request);

  if (v_result ->> 'replayed')::boolean
     or (v_result ->> 'snapshotCount')::integer <> 2
     or (v_result ->> 'remediationCaseCount')::integer <> 1
     or (v_result ->> 'initializedAccountCount')::integer <> 2
     or (v_result ->> 'threshold')::integer <> 80 then
    raise exception 'unexpected transition result %', v_result;
  end if;

  if (select status from public.academic_terms where id = v_term_1) <> 'closed'
     or (select status from public.academic_terms where id = v_term_2) <> 'active' then
    raise exception 'term statuses were not switched';
  end if;

  if (select closing_balance from public.term_closing_snapshots where term_id = v_term_1 and student_id = v_student_1) <> 70
     or (select closing_balance from public.term_closing_snapshots where term_id = v_term_1 and student_id = v_student_2) <> 100 then
    raise exception 'closing snapshots are wrong';
  end if;

  select id into v_case_id
  from public.term_remediation_cases
  where source_term_id = v_term_1 and student_id = v_student_1 and status = 'open' and threshold = 80
    and closing_balance = 70;
  if v_case_id is null
     or exists (select 1 from public.term_remediation_cases where source_term_id = v_term_1 and student_id = v_student_2) then
    raise exception 'remediation cases are wrong';
  end if;

  if (select count(*) from public.score_accounts where term_id = v_term_2 and balance = 100) <> 2
     or exists (
       select 1 from public.score_accounts account
       where account.term_id = v_term_2
         and (select count(*) from public.score_ledger ledger where ledger.score_account_id = account.id) <> 1
     ) then
    raise exception 'term 2 did not open every account once at 100';
  end if;

  v_replay := public.admin_transition_term_v1(v_term_1, v_term_2, v_request);
  if not (v_replay ->> 'replayed')::boolean
     or v_replay ->> 'transitionId' <> v_result ->> 'transitionId' then
    raise exception 'transition replay did not return the original result %', v_replay;
  end if;

  begin
    perform public.admin_transition_term_v1(v_term_2, v_term_1, v_request);
    raise exception 'mismatched transition replay was accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.admin_transition_term_v1(v_term_1, v_term_2, gen_random_uuid());
    raise exception 'a second transition of the same term was accepted';
  exception when sqlstate '55000' then null;
  end;

  insert into t21_fixture values ('case_1', v_case_id);
end;
$$;

select pass('transition snapshots 70/100, opens one case at 80, starts term 2 at 100, and is idempotent');

-- ---------------------------------------------------------------------------
-- Closed term and snapshot protections
-- ---------------------------------------------------------------------------

do $$
declare
  v_term_1 bigint := pg_temp.t21_id('term_1');
  v_student_1 bigint := pg_temp.t21_id('student_1');
  v_account public.score_accounts%rowtype;
  v_rule public.behavior_rules%rowtype;
begin
  select * into v_account from public.score_accounts where term_id = v_term_1 and student_id = v_student_1;

  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  begin
    perform public.admin_adjust_score(
      gen_random_uuid(), v_student_1, 5::smallint, now() - interval '40 days', 'pgTAP21 stale correction', v_term_1
    );
    raise exception 'ordinary adjustment reached the closed term';
  exception when sqlstate 'P0002' then null;
  end;

  begin
    insert into public.score_ledger (
      score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta,
      balance_before, balance_after, reason, actor_snapshot
    ) values (
      v_account.id, v_student_1, v_term_1, 'admin_addition', 5, 5, 70, 75, 'pgTAP21 plain addition', 'pgTAP'
    );
    raise exception 'plain addition was posted to the closed term';
  exception when sqlstate '55000' then null;
  end;

  begin
    insert into public.score_ledger (
      score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta,
      balance_before, balance_after, reason, actor_snapshot, remediation_request_id
    ) values (
      v_account.id, v_student_1, v_term_1, 'remediation_credit', 5, 5, 70, 75, 'pgTAP21 forged credit', 'pgTAP', -1
    );
    raise exception 'remediation credit bypassed the review workflow';
  exception when sqlstate '42501' then null;
  end;

  select rule.* into v_rule from public.behavior_rules rule where rule.is_active order by rule.id limit 1;
  begin
    insert into public.deduction_approval_requests (
      batch_id, client_request_id, student_id, term_id, classroom_id, rule_id, rule_snapshot,
      requested_points, occurred_at, requested_by_snapshot, request_payload_hash
    ) values (
      gen_random_uuid(), gen_random_uuid(), v_student_1, v_term_1, pg_temp.t21_id('classroom_1'), v_rule.id,
      '{}'::jsonb, 10, now() - interval '35 days', 'pgTAP', repeat('b', 64)
    );
    raise exception 'pending request was created for the closed term';
  exception when sqlstate '55000' then null;
  end;

  begin
    update public.academic_terms set name = 'pgTAP21 rewritten' where id = v_term_1;
    raise exception 'closed term was modified';
  exception when sqlstate '55000' then null;
  end;

  -- An identical no-op upsert (import path) is still accepted.
  update public.academic_terms set name = name where id = v_term_1;

  begin
    update public.academic_terms set status = 'active' where id = v_term_1;
    raise exception 'closed term was reopened';
  exception when sqlstate '55000' then null;
  end;

  begin
    update public.term_closing_snapshots set closing_balance = 99 where term_id = v_term_1;
    raise exception 'closing snapshot was modified';
  exception when sqlstate '55000' then null;
  end;

  begin
    update public.term_remediation_cases set closing_balance = 75 where id = pg_temp.t21_id('case_1');
    raise exception 'case closing score was modified';
  exception when sqlstate '55000' then null;
  end;
end;
$$;

select pass('closed term rejects ordinary scoring, forged credits, new requests, edits, and snapshot changes');

-- ---------------------------------------------------------------------------
-- Term 2 deduction is independent
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
begin
  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  v_result := public.admin_adjust_score(
    gen_random_uuid(), pg_temp.t21_id('student_1'), (-5)::smallint, now(),
    'pgTAP21 term two deduction', pg_temp.t21_id('term_2')
  );
  if (v_result ->> 'balanceAfter')::integer <> 95 then
    raise exception 'term 2 deduction should leave 95, got %', v_result;
  end if;
end;
$$;

select pass('term 2 scoring is independent of the closed term');

-- ---------------------------------------------------------------------------
-- Remediation request: permissions and idempotency
-- ---------------------------------------------------------------------------

do $$
declare
  v_case bigint := pg_temp.t21_id('case_1');
  v_client uuid := gen_random_uuid();
  v_activity timestamptz := now() - interval '1 day';
  v_result jsonb;
  v_replay jsonb;
begin
  perform pg_temp.t21_act(pg_temp.t21_uid('teacher_b'));
  begin
    perform public.request_term_remediation_v1(v_case, 10::smallint, v_activity, 'pgTAP21 unassigned teacher', gen_random_uuid());
    raise exception 'unassigned teacher created a remediation request';
  exception when sqlstate '42501' then null;
  end;

  perform pg_temp.t21_act(pg_temp.t21_uid('student_1_user'));
  begin
    perform public.request_term_remediation_v1(v_case, 10::smallint, v_activity, 'pgTAP21 student self-request', gen_random_uuid());
    raise exception 'student created a remediation request';
  exception when sqlstate '42501' then null;
  end;

  perform pg_temp.t21_act(pg_temp.t21_uid('director'));
  begin
    perform public.request_term_remediation_v1(v_case, 10::smallint, v_activity, 'pgTAP21 director request', gen_random_uuid());
    raise exception 'director created a remediation request';
  exception when sqlstate '42501' then null;
  end;

  perform pg_temp.t21_act(pg_temp.t21_uid('teacher_a'));
  v_result := public.request_term_remediation_v1(v_case, 10::smallint, v_activity, 'pgTAP21 community service', v_client);
  if v_result ->> 'status' <> 'pending' or (v_result ->> 'replayed')::boolean then
    raise exception 'unexpected request result %', v_result;
  end if;

  v_replay := public.request_term_remediation_v1(v_case, 10::smallint, v_activity, 'pgTAP21 community service', v_client);
  if not (v_replay ->> 'replayed')::boolean or v_replay ->> 'requestId' <> v_result ->> 'requestId' then
    raise exception 'request replay mismatch %', v_replay;
  end if;

  begin
    perform public.request_term_remediation_v1(v_case, 20::smallint, v_activity, 'pgTAP21 community service', v_client);
    raise exception 'mismatched request replay was accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.request_term_remediation_v1(v_case, 5::smallint, v_activity, 'pgTAP21 second pending', gen_random_uuid());
    raise exception 'a second pending request was accepted';
  exception when sqlstate '55000' then null;
  end;

  insert into t21_fixture values ('request_1', v_result ->> 'requestId');
end;
$$;

select pass('only the assigned teacher or admin can request; replay and mismatch are distinguished');

-- ---------------------------------------------------------------------------
-- Admin approval credits the ORIGINAL term only: 70 + 10 = 80 passed, Term 2 95
-- ---------------------------------------------------------------------------

do $$
declare
  v_request bigint := pg_temp.t21_id('request_1');
  v_client uuid := gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
  v_ledger public.score_ledger%rowtype;
begin
  perform pg_temp.t21_act(pg_temp.t21_uid('teacher_a'));
  begin
    perform public.review_term_remediation_v1(v_request, true, null, gen_random_uuid());
    raise exception 'teacher reviewed a remediation request';
  exception when sqlstate '42501' then null;
  end;

  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  v_result := public.review_term_remediation_v1(v_request, true, null, v_client);
  if v_result ->> 'status' <> 'approved'
     or (v_result ->> 'appliedPoints')::integer <> 10
     or (v_result ->> 'balanceAfter')::integer <> 80
     or v_result ->> 'caseStatus' <> 'passed' then
    raise exception 'unexpected review result %', v_result;
  end if;

  if (select balance from public.score_accounts where term_id = pg_temp.t21_id('term_1') and student_id = pg_temp.t21_id('student_1')) <> 80
     or (select balance from public.score_accounts where term_id = pg_temp.t21_id('term_2') and student_id = pg_temp.t21_id('student_1')) <> 95 then
    raise exception 'credit affected the wrong term';
  end if;

  select * into v_ledger from public.score_ledger where id = (v_result ->> 'ledgerId')::bigint;
  if v_ledger.entry_type <> 'remediation_credit'
     or v_ledger.term_id <> pg_temp.t21_id('term_1')
     or v_ledger.remediation_request_id <> v_request
     or (v_ledger.activity_occurred_at at time zone 'Asia/Bangkok')::date < current_date - 30 then
    raise exception 'credit provenance is wrong';
  end if;

  v_replay := public.review_term_remediation_v1(v_request, true, null, v_client);
  if not (v_replay ->> 'replayed')::boolean or v_replay ->> 'ledgerId' <> v_result ->> 'ledgerId' then
    raise exception 'review replay mismatch %', v_replay;
  end if;

  begin
    perform public.review_term_remediation_v1(v_request, false, 'pgTAP21 changed mind', v_client);
    raise exception 'mismatched review replay was accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.review_term_remediation_v1(v_request, true, null, gen_random_uuid());
    raise exception 'request was reviewed twice';
  exception when sqlstate '55000' then null;
  end;

  if (select count(*) from public.score_ledger where remediation_request_id = v_request) <> 1 then
    raise exception 'duplicate remediation credit';
  end if;

  perform pg_temp.t21_act(pg_temp.t21_uid('teacher_a'));
  begin
    perform public.request_term_remediation_v1(pg_temp.t21_id('case_1'), 5::smallint, now(), 'pgTAP21 after pass', gen_random_uuid());
    raise exception 'request accepted for a passed case';
  exception when sqlstate '55000' then null;
  end;
end;
$$;

select pass('approval credits the original term to 80 (passed) while term 2 stays 95, exactly once');

-- ---------------------------------------------------------------------------
-- Late appeal adjustments on the original account re-sync the case
-- ---------------------------------------------------------------------------

do $$
declare
  v_account public.score_accounts%rowtype;
begin
  select * into v_account from public.score_accounts
  where term_id = pg_temp.t21_id('term_1') and student_id = pg_temp.t21_id('student_1');

  update public.score_accounts set balance = 75 where id = v_account.id;
  insert into public.score_ledger (
    score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta,
    balance_before, balance_after, reason, actor_snapshot
  ) values (
    v_account.id, v_account.student_id, v_account.term_id, 'appeal_adjustment', -5, -5, 80, 75,
    'pgTAP21 reopened appeal lowers score', 'pgTAP'
  );
  if (select status from public.term_remediation_cases where id = pg_temp.t21_id('case_1')) <> 'open' then
    raise exception 'case did not reopen after the original balance dropped below 80';
  end if;

  update public.score_accounts set balance = 80 where id = v_account.id;
  insert into public.score_ledger (
    score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta,
    balance_before, balance_after, reason, actor_snapshot
  ) values (
    v_account.id, v_account.student_id, v_account.term_id, 'appeal_adjustment', 5, 5, 75, 80,
    'pgTAP21 appeal restores score', 'pgTAP'
  );
  if (select status from public.term_remediation_cases where id = pg_temp.t21_id('case_1')) <> 'passed'
     or (select closing_balance from public.term_closing_snapshots
         where term_id = pg_temp.t21_id('term_1') and student_id = pg_temp.t21_id('student_1')) <> 70 then
    raise exception 'case did not pass again or the closing snapshot moved';
  end if;
end;
$$;

select pass('late appeal adjustments re-sync case status while the closing snapshot stays 70');

-- ---------------------------------------------------------------------------
-- Scoped reads: student self, teachers, director, roster independence
-- ---------------------------------------------------------------------------

do $$
declare
  v_list jsonb;
  v_history jsonb;
  v_terms jsonb;
begin
  perform pg_temp.t21_act(pg_temp.t21_uid('student_1_user'));
  v_list := public.list_term_remediations_v1();
  if jsonb_array_length(v_list) <> 1
     or (v_list -> 0 -> 'student' ->> 'id')::bigint <> pg_temp.t21_id('student_1')
     or (v_list -> 0 -> 'requests' -> 0) ? 'reason'
     or (v_list -> 0 -> 'requests' -> 0) ? 'requestedBySnapshot' then
    raise exception 'student remediation view is wrong %', v_list;
  end if;

  v_history := public.get_term_history_v1(pg_temp.t21_id('term_1'));
  if jsonb_array_length(v_history -> 'students') <> 1
     or (v_history -> 'students' -> 0 ->> 'closingScore')::integer <> 70
     or (v_history -> 'students' -> 0 ->> 'latestScore')::integer <> 80
     or v_history::text ilike '%actor%' then
    raise exception 'student term history is wrong %', v_history;
  end if;

  v_terms := public.list_academic_terms_v1();
  if not exists (
    select 1 from jsonb_array_elements(v_terms) item
    where (item ->> 'id')::bigint = pg_temp.t21_id('term_1') and item ->> 'status' = 'closed' and item ->> 'closedAt' is not null
  ) or exists (select 1 from jsonb_array_elements(v_terms) item where item ->> 'status' = 'planned') then
    raise exception 'student term list is wrong %', v_terms;
  end if;

  perform pg_temp.t21_act(pg_temp.t21_uid('student_2_user'));
  if jsonb_array_length(public.list_term_remediations_v1()) <> 0 then
    raise exception 'student 2 can see another student''s case';
  end if;

  perform pg_temp.t21_act(pg_temp.t21_uid('teacher_a'));
  if jsonb_array_length(public.list_term_remediations_v1()) <> 1
     or jsonb_array_length(public.get_term_history_v1(pg_temp.t21_id('term_1')) -> 'students') <> 2 then
    raise exception 'assigned teacher scope is wrong';
  end if;

  perform pg_temp.t21_act(pg_temp.t21_uid('teacher_b'));
  if jsonb_array_length(public.list_term_remediations_v1()) <> 0
     or jsonb_array_length(public.get_term_history_v1(pg_temp.t21_id('term_1')) -> 'students') <> 0 then
    raise exception 'unassigned teacher can read remediation or history';
  end if;

  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  perform public.admin_assign_term_remediation_teacher_v1(
    pg_temp.t21_id('case_1'), pg_temp.t21_id('teacher_b_id'), 'pgTAP21 counselor follow-up'
  );

  perform pg_temp.t21_act(pg_temp.t21_uid('teacher_b'));
  v_history := public.get_term_history_v1(pg_temp.t21_id('term_1'));
  if jsonb_array_length(public.list_term_remediations_v1()) <> 1
     or jsonb_array_length(v_history -> 'students') <> 1
     or (v_history -> 'students' -> 0 ->> 'studentId')::bigint <> pg_temp.t21_id('student_1') then
    raise exception 'explicit case responsibility scope is wrong %', v_history;
  end if;

  -- Student 1 leaves the current roster: the case stays visible to admin and
  -- director, and the old roster teacher loses access.
  update public.enrollments set is_active = false
  where term_id = pg_temp.t21_id('term_2') and student_id = pg_temp.t21_id('student_1');

  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  if jsonb_array_length(public.list_term_remediations_v1()) < 1
     or not exists (
       select 1 from jsonb_array_elements(public.list_term_remediations_v1()) item
       where (item ->> 'caseId')::bigint = pg_temp.t21_id('case_1') and item -> 'currentClassroom' = 'null'::jsonb
     ) then
    raise exception 'admin lost a case for a student missing from the current roster';
  end if;

  perform pg_temp.t21_act(pg_temp.t21_uid('director'));
  if not exists (
    select 1 from jsonb_array_elements(public.list_term_remediations_v1()) item
    where (item ->> 'caseId')::bigint = pg_temp.t21_id('case_1') and not (item ->> 'canRequest')::boolean
  ) then
    raise exception 'director cannot read the case read-only';
  end if;

  perform pg_temp.t21_act(pg_temp.t21_uid('teacher_a'));
  if jsonb_array_length(public.list_term_remediations_v1()) <> 0 then
    raise exception 'teacher kept access after the student left the roster';
  end if;
end;
$$;

select pass('remediation and history reads are scoped and independent of the current roster');

-- ---------------------------------------------------------------------------
-- Director cannot mutate; application role cannot touch tables directly
-- ---------------------------------------------------------------------------

do $$
declare
  v_term_1 bigint := pg_temp.t21_id('term_1');
  v_term_2 bigint := pg_temp.t21_id('term_2');
  v_case bigint := pg_temp.t21_id('case_1');
begin
  perform pg_temp.t21_act(pg_temp.t21_uid('director'));
  begin
    perform public.admin_preview_term_transition_v1(v_term_2);
    raise exception 'director previewed a transition';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.admin_assign_term_remediation_teacher_v1(v_case, null, 'pgTAP21 director change');
    raise exception 'director changed case responsibility';
  exception when sqlstate '42501' then null;
  end;

  perform pg_temp.t21_act(pg_temp.t21_uid('admin'));
  begin
    set local role authenticated;
    insert into public.academic_terms (school_year, semester, name, status)
    values (2996, 1, 'pgTAP21 direct insert', 'planned');
    raise exception 'authenticated inserted a term directly';
  exception when insufficient_privilege then null;
  end;
  begin
    set local role authenticated;
    update public.academic_terms set name = 'pgTAP21 direct update' where id = v_term_2;
    raise exception 'authenticated updated a term directly';
  exception when insufficient_privilege then null;
  end;
  begin
    set local role authenticated;
    perform 1 from public.term_remediation_cases where id = v_case;
    raise exception 'authenticated read remediation cases directly';
  exception when insufficient_privilege then null;
  end;
  begin
    set local role authenticated;
    update public.term_closing_snapshots set closing_balance = 100 where term_id = v_term_1;
    raise exception 'authenticated updated a snapshot directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

select pass('director is read-only and application users are denied direct table access');

select * from finish();

rollback;
