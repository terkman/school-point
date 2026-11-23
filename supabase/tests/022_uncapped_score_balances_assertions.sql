begin;

select plan(5);

create temp table t22_fixture (
  admin_user uuid not null,
  teacher_user uuid not null,
  student_a_user uuid not null,
  student_b_user uuid not null,
  student_a bigint not null,
  student_b bigint not null,
  student_c bigint not null,
  term_id bigint not null,
  classroom_id bigint not null,
  positive_rule_id bigint not null,
  deduction_rule_id bigint not null,
  activity_at timestamptz not null
) on commit drop;

create function pg_temp.t22_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password'))
  )::text, true);
end;
$$;

do $$
declare
  v_admin uuid := '22000000-0000-4000-8000-000000000001';
  v_teacher uuid := '22000000-0000-4000-8000-000000000002';
  v_student_a_user uuid := '22000000-0000-4000-8000-000000000003';
  v_student_b_user uuid := '22000000-0000-4000-8000-000000000004';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_teacher_id bigint;
  v_student_a bigint;
  v_student_b bigint;
  v_student_c bigint;
  v_active_term bigint;
  v_term bigint;
  v_classroom bigint;
  v_positive_rule bigint;
  v_deduction_rule bigint;
begin
  select id into v_active_term from public.academic_terms where status = 'active';
  if v_active_term is not null then
    insert into private.term_write_authorizations (txid, kind, ref_id)
    values (txid_current(), 'close_term', v_active_term);
    update public.academic_terms set status = 'closed' where id = v_active_term;
    delete from private.term_write_authorizations where txid = txid_current();
  end if;

  insert into auth.users (id, aud, role, email) values
    (v_admin, 'authenticated', 'authenticated', 'pgtap22-admin@example.invalid'),
    (v_teacher, 'authenticated', 'authenticated', 'pgtap22-teacher@example.invalid'),
    (v_student_a_user, 'authenticated', 'authenticated', 'pgtap22-student-a@example.invalid'),
    (v_student_b_user, 'authenticated', 'authenticated', 'pgtap22-student-b@example.invalid');
  insert into public.profiles (user_id, role, display_name, is_active, activation_required) values
    (v_admin, 'admin', 'pgTAP22 Admin', true, false),
    (v_teacher, 'teacher', 'pgTAP22 Teacher', true, false),
    (v_student_a_user, 'student', 'pgTAP22 Student A', true, false),
    (v_student_b_user, 'student', 'pgTAP22 Student B', true, false);
  insert into public.teachers (user_id, employee_code, given_name, family_name, status, intended_role)
  values (v_teacher, 'PGTAP22-T', 'Test', 'Teacher', 'active', 'teacher') returning id into v_teacher_id;
  insert into public.students (user_id, student_code, given_name, family_name)
  values (v_student_a_user, 'PGTAP22-A', 'Student', 'A') returning id into v_student_a;
  insert into public.students (user_id, student_code, given_name, family_name)
  values (v_student_b_user, 'PGTAP22-B', 'Student', 'B') returning id into v_student_b;
  insert into public.students (student_code, given_name, family_name)
  values ('PGTAP22-C', 'Student', 'C') returning id into v_student_c;

  insert into public.academic_terms (school_year, semester, name, starts_on, ends_on, status)
  values (2995, 1, 'pgTAP22 Term 1', v_today - 60, v_today - 1, 'planned') returning id into v_term;
  insert into public.classrooms (term_id, grade_level, room_number, display_name)
  values (v_term, 'M1', '22', 'pgTAP22 M1/22') returning id into v_classroom;
  insert into public.enrollments (term_id, classroom_id, student_id, student_number) values
    (v_term, v_classroom, v_student_a, 1), (v_term, v_classroom, v_student_b, 2),
    (v_term, v_classroom, v_student_c, 3);
  insert into public.teacher_classroom_assignments (term_id, classroom_id, teacher_id)
  values (v_term, v_classroom, v_teacher_id);
  insert into public.positive_behavior_rules (rule_code, category, title_th, default_addition, max_addition)
  values ('PGTAP22-P', 'Test', 'pgTAP22 Addition', 20, 20) returning id into v_positive_rule;
  insert into public.behavior_rules (rule_code, category, title_th, default_deduction, severity, guardian_contact_required)
  values ('PGTAP22-D', 'Test', 'pgTAP22 Deduction', 30, 'serious', true) returning id into v_deduction_rule;

  insert into t22_fixture values (
    v_admin, v_teacher, v_student_a_user, v_student_b_user, v_student_a, v_student_b, v_student_c,
    v_term, v_classroom, v_positive_rule, v_deduction_rule,
    (v_today - 2 + time '12:00') at time zone 'Asia/Bangkok'
  );
  perform pg_temp.t22_act(v_admin);
  perform public.admin_activate_term(v_term);
  perform public.initialize_term_scores(v_term);
end;
$$;

select is(
  (select count(*)::integer from public.score_accounts where term_id = (select term_id from t22_fixture) and balance = 100),
  3,
  'each student starts the semester with 100 points'
);

do $$
declare
  f t22_fixture%rowtype;
  v_result jsonb;
  v_request bigint;
  v_incident bigint;
  v_appeal bigint;
begin
  select * into strict f from t22_fixture;
  perform pg_temp.t22_act(f.admin_user);
  perform public.admin_adjust_score(gen_random_uuid(), f.student_a, (-5)::smallint, f.activity_at,
    'pgTAP22 starting correction', f.term_id);

  perform pg_temp.t22_act(f.teacher_user);
  v_result := public.request_point_addition_v2(gen_random_uuid(), f.student_a, f.positive_rule_id, 20::smallint,
    f.activity_at, 'pgTAP22 activity', 'pgTAP22 evidence');
  v_request := (v_result ->> 'requestId')::bigint;
  if (select balance from public.score_accounts where term_id = f.term_id and student_id = f.student_a) is distinct from 95 then
    raise exception 'the pending bonus changed the score before approval';
  end if;

  perform pg_temp.t22_act(f.admin_user);
  v_result := public.review_point_addition_v2(v_request, true, 20::smallint);
  if (v_result ->> 'appliedPoints')::integer is distinct from 20
     or not exists (select 1 from public.score_ledger where id = (v_result ->> 'ledgerId')::bigint
        and requested_delta = 20 and applied_delta = 20 and balance_before = 95 and balance_after = 115) then
    raise exception 'the approved bonus did not post 95 + 20 = 115: %', v_result;
  end if;

  v_result := public.record_deductions_bulk(gen_random_uuid(), 'single', array[f.student_a], f.deduction_rule_id,
    f.classroom_id, f.activity_at, null, 'pgTAP22 internal reason');
  v_incident := (v_result -> 'results' -> 0 ->> 'incidentId')::bigint;
  if (v_result -> 'results' -> 0 ->> 'balanceAfter')::integer is distinct from 85 then
    raise exception 'the deduction did not post 115 - 30 = 85: %', v_result;
  end if;

  perform pg_temp.t22_act(f.student_a_user);
  v_appeal := public.submit_appeal(v_incident, 'pgTAP22 appeal');
  perform pg_temp.t22_act(f.admin_user);
  begin
    perform public.review_appeal_v2(v_appeal, 31::smallint, 'pgTAP22 over-refund');
    raise exception 'appeal restored more points than were deducted';
  exception when sqlstate '22023' then null;
  end;
  v_result := public.review_appeal_v2(v_appeal, 30::smallint, 'pgTAP22 accepted restoration');
  if (v_result ->> 'appliedScoreDelta')::integer is distinct from 30
     or (v_result ->> 'balanceAfter')::integer is distinct from 115
     or (select balance from public.score_accounts where term_id = f.term_id and student_id = f.student_a) is distinct from 115 then
    raise exception 'the appeal did not post 85 + 30 = 115: %', v_result;
  end if;
end;
$$;

select pass('approval, deduction and appeal use the actual cumulative balance and preserve the appeal refund limit');

do $$
declare
  f t22_fixture%rowtype;
  v_request uuid := gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
begin
  select * into strict f from t22_fixture;
  perform pg_temp.t22_act(f.admin_user);
  begin
    perform public.admin_add_points_bulk(gen_random_uuid(), 'selected', array[f.student_a, f.student_b],
      f.classroom_id, f.positive_rule_id, 21::smallint, f.activity_at, 'pgTAP22 bulk reason', 'pgTAP22 evidence', f.term_id);
    raise exception 'bulk bonus exceeded the configured positive rule';
  exception when sqlstate '22023' then null;
  end;

  v_result := public.admin_add_points_bulk(v_request, 'selected', array[f.student_a, f.student_b],
    f.classroom_id, f.positive_rule_id, 20::smallint, f.activity_at, 'pgTAP22 bulk reason', 'pgTAP22 evidence', f.term_id);
  v_replay := public.admin_add_points_bulk(v_request, 'selected', array[f.student_a, f.student_b],
    f.classroom_id, f.positive_rule_id, 20::smallint, f.activity_at, 'pgTAP22 bulk reason', 'pgTAP22 evidence', f.term_id);
  if (v_result ->> 'totalAppliedPoints')::integer is distinct from 40
     or (v_replay ->> 'replayed')::boolean is distinct from true
     or v_replay -> 'results' is distinct from v_result -> 'results'
     or (select balance from public.score_accounts where term_id = f.term_id and student_id = f.student_a) is distinct from 135
     or (select balance from public.score_accounts where term_id = f.term_id and student_id = f.student_b) is distinct from 120 then
    raise exception 'bulk credits should post 20 to each account exactly once: %, %', v_result, v_replay;
  end if;
end;
$$;

select pass('bulk additions continue above 100 and replays do not apply credits twice');

do $$
declare
  f t22_fixture%rowtype;
  v_request uuid := gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
  v_ledger bigint;
  v_deduction_request bigint;
begin
  select * into strict f from t22_fixture;
  perform pg_temp.t22_act(f.admin_user);

  -- Simulate a long score history without posting hundreds of unrelated credits.
  update public.score_accounts set balance = 33000 where term_id = f.term_id and student_id = f.student_b;
  v_result := public.admin_add_points_detailed(v_request, f.student_b, f.positive_rule_id, 20::smallint,
    f.activity_at, 'pgTAP22 detailed bonus', 'pgTAP22 evidence', f.term_id);
  v_replay := public.admin_add_points_detailed(v_request, f.student_b, f.positive_rule_id, 20::smallint,
    f.activity_at, 'pgTAP22 detailed bonus', 'pgTAP22 evidence', f.term_id);
  v_ledger := (v_result ->> 'ledgerId')::bigint;
  if (v_result ->> 'balanceBefore')::integer is distinct from 33000
     or (v_result ->> 'balanceAfter')::integer is distinct from 33020
     or (v_replay ->> 'replayed')::boolean is distinct from true
     or (v_replay ->> 'ledgerId')::bigint is distinct from v_ledger then
    raise exception 'single addition or replay narrowed the balance: %, %', v_result, v_replay;
  end if;

  v_result := public.admin_adjust_score(gen_random_uuid(), f.student_b, (-15)::smallint, f.activity_at,
    'pgTAP22 large balance adjustment', f.term_id);
  if (v_result ->> 'balanceAfter')::integer is distinct from 33005 then
    raise exception 'admin correction narrowed the balance: %', v_result;
  end if;

  perform pg_temp.t22_act(f.teacher_user);
  v_result := public.request_deductions_bulk_v1(gen_random_uuid(), 'single', array[f.student_b],
    f.deduction_rule_id, f.classroom_id, f.activity_at, null, 'pgTAP22 internal reason');
  v_deduction_request := (v_result -> 'requests' -> 0 ->> 'requestId')::bigint;
  perform pg_temp.t22_act(f.admin_user);
  v_result := public.review_deduction_request_v1(v_deduction_request, true, 30::smallint);
  if (v_result ->> 'appliedPoints')::integer is distinct from 30
     or not exists (select 1 from public.score_ledger where deduction_request_id = v_deduction_request
        and balance_before = 33005 and balance_after = 32975) then
    raise exception 'approval of a deduction narrowed the balance: %', v_result;
  end if;

  perform pg_temp.t22_act(f.student_b_user);
  if not exists (select 1 from public.get_my_score_history()
    where id = v_ledger and balance_before = 33000 and balance_after = 33020) then
    raise exception 'student ledger history did not preserve the full stored balance';
  end if;

  perform pg_temp.t22_act(f.admin_user);
  perform public.admin_adjust_score(gen_random_uuid(), f.student_c, (-90)::smallint, f.activity_at,
    'pgTAP22 before reaching zero', f.term_id);
  v_result := public.admin_adjust_score(gen_random_uuid(), f.student_c, (-30)::smallint, f.activity_at,
    'pgTAP22 reach zero', f.term_id);
  if (v_result ->> 'appliedDelta')::integer is distinct from -10
     or (v_result ->> 'balanceAfter')::integer is distinct from 0 then
    raise exception 'deductions should still stop at zero: %', v_result;
  end if;
  perform public.admin_adjust_score(gen_random_uuid(), f.student_c, 70::smallint, f.activity_at,
    'pgTAP22 low closing score', f.term_id);
end;
$$;

select pass('balances beyond smallint survive credits, correction, replay and student history while deductions still stop at zero');

do $$
declare
  f t22_fixture%rowtype;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_next bigint;
  v_case bigint;
  v_result jsonb;
  v_request bigint;
  v_review uuid := gen_random_uuid();
begin
  select * into strict f from t22_fixture;
  perform pg_temp.t22_act(f.admin_user);
  v_result := public.admin_prepare_next_term_v1(2995::smallint, 2::smallint, 'pgTAP22 Term 2', v_today, v_today + 60);
  v_next := (v_result -> 'term' ->> 'id')::bigint;
  v_result := public.admin_transition_term_v1(f.term_id, v_next, gen_random_uuid());
  if (v_result ->> 'threshold')::integer is distinct from 80
     or (v_result ->> 'remediationCaseCount')::integer is distinct from 1
     or (select closing_balance from public.term_closing_snapshots where term_id = f.term_id and student_id = f.student_b) is distinct from 32975
     or (select count(*) from public.score_accounts where term_id = v_next and balance = 100) <> 3 then
    raise exception 'transition must snapshot the full balance, keep the threshold at 80 and start the next term at 100: %', v_result;
  end if;

  select id into strict v_case from public.term_remediation_cases
  where source_term_id = f.term_id and student_id = f.student_c;
  v_result := public.request_term_remediation_v1(v_case, 45::smallint, now(), 'pgTAP22 remediation activity', gen_random_uuid());
  v_request := (v_result ->> 'requestId')::bigint;
  v_result := public.review_term_remediation_v1(v_request, true, null, v_review);
  if (v_result ->> 'appliedPoints')::integer is distinct from 45
     or (v_result ->> 'balanceAfter')::integer is distinct from 115
     or v_result ->> 'caseStatus' is distinct from 'passed'
     or (select balance from public.score_accounts where term_id = v_next and student_id = f.student_c) is distinct from 100
     or (select closing_balance from public.term_closing_snapshots where term_id = f.term_id and student_id = f.student_c) is distinct from 70 then
    raise exception 'remediation must credit the old account fully and leave its original snapshot and the new term intact: %', v_result;
  end if;
end;
$$;

select pass('term closing preserves all balances, starts anew at 100, and remediation can credit the prior term beyond 100');

select * from finish();
rollback;
