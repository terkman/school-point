begin;

select plan(4);

create temp table t23_appeals (
  fixture text primary key,
  admin_user uuid not null,
  student_user uuid not null,
  term_id bigint not null,
  classroom_id bigint not null,
  rule_id bigint not null,
  student_id bigint not null,
  account_id bigint not null,
  appeal_id bigint not null,
  prior_decision_id bigint not null,
  prior_ledger_id bigint not null,
  activity_at timestamptz not null
) on commit drop;

create function pg_temp.t23_act(p_user uuid) returns void language plpgsql as $$
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
  v_admin uuid := '23000000-0000-4000-8000-000000000001';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_activity_at timestamptz := (v_today - 2 + time '12:00') at time zone 'Asia/Bangkok';
  v_active_term bigint;
  v_term bigint;
  v_classroom bigint;
  v_rule bigint;
  v_student_user uuid;
  v_student bigint;
  v_incident bigint;
  v_account bigint;
  v_appeal bigint;
  v_decision bigint;
  v_ledger bigint;
begin
  select id into v_active_term from public.academic_terms where status = 'active';
  if v_active_term is not null then
    insert into private.term_write_authorizations (txid, kind, ref_id)
    values (txid_current(), 'close_term', v_active_term);
    update public.academic_terms set status = 'closed' where id = v_active_term;
    delete from private.term_write_authorizations where txid = txid_current();
  end if;

  insert into auth.users (id, aud, role, email)
  values (v_admin, 'authenticated', 'authenticated', 'pgtap23-admin@example.invalid');
  insert into public.profiles (user_id, role, display_name, is_active, activation_required)
  values (v_admin, 'admin', 'pgTAP23 Admin', true, false);
  insert into public.academic_terms (school_year, semester, name, starts_on, ends_on, status)
  values (2996, 1, 'pgTAP23 Original term', v_today - 60, v_today - 1, 'planned') returning id into v_term;
  insert into public.classrooms (term_id, grade_level, room_number, display_name)
  values (v_term, 'M1', '23', 'pgTAP23 M1/23') returning id into v_classroom;
  insert into public.behavior_rules (rule_code, category, title_th, default_deduction, severity, guardian_contact_required)
  values ('PGTAP23-D', 'Test', 'pgTAP23 Deduction', 30, 'serious', true) returning id into v_rule;

  perform pg_temp.t23_act(v_admin);
  perform public.admin_activate_term(v_term);

  for i in 1..2 loop
    v_student_user := gen_random_uuid();
    insert into auth.users (id, aud, role, email)
    values (v_student_user, 'authenticated', 'authenticated', format('pgtap23-student-%s@example.invalid', i));
    insert into public.profiles (user_id, role, display_name, is_active, activation_required)
    values (v_student_user, 'student', format('pgTAP23 Student %s', i), true, false);
    insert into public.students (user_id, student_code, given_name, family_name)
    values (v_student_user, format('PGTAP23-%s', i), 'Student', i::text) returning id into v_student;
    insert into public.enrollments (term_id, classroom_id, student_id, student_number)
    values (v_term, v_classroom, v_student, i::smallint);

    v_incident := (public.record_deductions_bulk(
      gen_random_uuid(), 'single', array[v_student], v_rule, v_classroom, v_activity_at, null, 'pgTAP23 deduction reason'
    ) -> 'results' -> 0 ->> 'incidentId')::bigint;
    perform public.admin_adjust_score(
      gen_random_uuid(), v_student, 25::smallint, v_activity_at, 'pgTAP23 prior correction', v_term
    );
    select id into strict v_account from public.score_accounts where student_id = v_student and term_id = v_term;

    -- Reproduce the rows written when a 20-point approval could add only 5.
    -- The pre-v2 appeal has a backfilled decision but its reversal is unlinked.
    insert into public.appeals (
      incident_id, student_id, reason, status, decision_note, decided_by, decided_at,
      restored_points, public_explanation, review_version
    ) values (
      v_incident, v_student, 'pgTAP23 original appeal', 'accepted', 'pgTAP23 capped decision', v_admin, now(),
      20, 'pgTAP23 capped decision', 1
    ) returning id into v_appeal;
    insert into private.appeal_decisions (
      appeal_id, version, outcome, restored_points, requested_score_delta, applied_score_delta, public_explanation, decided_by
    ) values (v_appeal, 1, 'accepted', 20, 20, 5, 'pgTAP23 capped decision', v_admin) returning id into v_decision;
    update public.score_accounts set balance = 100 where id = v_account;
    insert into public.score_ledger (
      score_account_id, student_id, term_id, entry_type, requested_delta, applied_delta, balance_before, balance_after,
      incident_id, appeal_decision_id, reason, actor_user_id, actor_snapshot
    ) values (
      v_account, v_student, v_term,
      (case when i = 1 then 'appeal_reversal' else 'appeal_adjustment' end)::public.score_entry_type,
      20, 5, 95, 100, v_incident, case when i = 1 then null else v_decision end, 'pgTAP23 original credit', v_admin, 'pgTAP23 Admin'
    ) returning id into v_ledger;

    insert into t23_appeals values (
      case when i = 1 then 'legacy' else 'v2' end, v_admin, v_student_user, v_term,
      v_classroom, v_rule, v_student, v_account, v_appeal, v_decision, v_ledger, v_activity_at
    );
  end loop;
end;
$$;

do $$
declare
  f t23_appeals%rowtype;
  v_other_incident bigint;
  v_other_appeal bigint;
  v_result jsonb;
begin
  select * into strict f from t23_appeals where fixture = 'v2';
  perform pg_temp.t23_act(f.admin_user);
  v_other_incident := (public.record_deductions_bulk(
    gen_random_uuid(), 'single', array[f.student_id], f.rule_id, f.classroom_id, f.activity_at, null, 'pgTAP23 another deduction'
  ) -> 'results' -> 0 ->> 'incidentId')::bigint;
  perform pg_temp.t23_act(f.student_user);
  v_other_appeal := public.submit_appeal(v_other_incident, 'pgTAP23 different appeal on same account');
  perform pg_temp.t23_act(f.admin_user);
  perform public.review_appeal_v2(v_other_appeal, 2::smallint, 'pgTAP23 other decision');
  perform public.admin_adjust_score(
    gen_random_uuid(), f.student_id, 28::smallint, f.activity_at, 'pgTAP23 balance before revision', f.term_id
  );

  perform public.reopen_appeal_v2(f.appeal_id, 'pgTAP23 revise capped approval');
  v_result := public.review_appeal_v2(f.appeal_id, 12::smallint, 'pgTAP23 partial approval');
  if (v_result->>'appliedScoreDelta')::integer is distinct from 7
     or (v_result->>'balanceBefore')::integer is distinct from 100
     or (v_result->>'balanceAfter')::integer is distinct from 107
     or not exists (select 1 from public.score_ledger where id = f.prior_ledger_id and applied_delta = 5)
     or not exists (select 1 from private.appeal_decisions where id = f.prior_decision_id and restored_points = 20 and applied_score_delta = 5) then
    raise exception 'revised approval did not target 12 minus the original 5 or modified immutable history: %', v_result;
  end if;
end;
$$;

select pass('a capped approval is adjusted against its actual credit, excluding other appeals on the same account');

do $$
declare
  f t23_appeals%rowtype;
  v_result jsonb;
begin
  select * into strict f from t23_appeals where fixture = 'v2';
  perform pg_temp.t23_act(f.admin_user);
  perform public.admin_adjust_score(
    gen_random_uuid(), f.student_id, (-100)::smallint, f.activity_at, 'pgTAP23 consumed returned points', f.term_id
  );
  perform public.admin_adjust_score(
    gen_random_uuid(), f.student_id, (-4)::smallint, f.activity_at, 'pgTAP23 balance near zero', f.term_id
  );
  perform public.reopen_appeal_v2(f.appeal_id, 'pgTAP23 reject after review');
  v_result := public.review_appeal_v2(f.appeal_id, 0::smallint, 'pgTAP23 reject at floor');
  if (v_result->>'balanceBefore')::integer is distinct from 3
     or (v_result->>'balanceAfter')::integer is distinct from 0
     or not exists (select 1 from private.appeal_decisions where id = (v_result->>'decisionId')::bigint
       and requested_score_delta = -12 and applied_score_delta = -3) then
    raise exception 'withdrawal did not stop at the zero floor: %', v_result;
  end if;

  perform public.reopen_appeal_v2(f.appeal_id, 'pgTAP23 reconsider after floor');
  v_result := public.review_appeal_v2(f.appeal_id, 10::smallint, 'pgTAP23 target 10 after floor');
  if (v_result->>'appliedScoreDelta')::integer is distinct from 1
     or (v_result->>'balanceAfter')::integer is distinct from 1 then
    raise exception 'review did not account for the 9-point residual actual credit: %', v_result;
  end if;
end;
$$;

select pass('the zero floor limits the actual debit and the next review uses the residual posted credit');

do $$
declare
  f t23_appeals%rowtype;
  v_result jsonb;
begin
  select * into strict f from t23_appeals where fixture = 'v2';
  perform pg_temp.t23_act(f.admin_user);
  begin
    perform public.review_appeal_v2(f.appeal_id, 10::smallint, 'pgTAP23 repeated submission');
    raise exception 'a second submission without reopen was allowed';
  exception when sqlstate '55000' then null;
  end;
  perform public.reopen_appeal_v2(f.appeal_id, 'pgTAP23 confirm the same points');
  v_result := public.review_appeal_v2(f.appeal_id, 10::smallint, 'pgTAP23 same restoration');
  if (v_result->>'appliedScoreDelta')::integer is distinct from 0
     or (v_result->>'balanceAfter')::integer is distinct from 1
     or v_result->>'ledgerId' is not null then
    raise exception 'a repeated restoration added points again: %', v_result;
  end if;
end;
$$;

select pass('a second decision requires reopening and repeating a reconciled restoration does not post twice');

do $$
declare
  f t23_appeals%rowtype;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_next bigint;
  v_result jsonb;
begin
  select * into strict f from t23_appeals where fixture = 'legacy';
  perform pg_temp.t23_act(f.admin_user);
  v_next := (public.admin_prepare_next_term_v1(
    2996::smallint, 2::smallint, 'pgTAP23 New term', v_today, v_today + 60
  ) -> 'term' ->> 'id')::bigint;
  perform public.admin_transition_term_v1(f.term_id, v_next, gen_random_uuid());

  perform public.reopen_appeal_v2(f.appeal_id, 'pgTAP23 reopen legacy appeal');
  v_result := public.review_appeal_v2(f.appeal_id, 0::smallint, 'pgTAP23 reject legacy appeal');
  if (v_result->>'appliedScoreDelta')::integer is distinct from -5
     or (select balance from public.score_accounts where id = f.account_id) is distinct from 95
     or (select balance from public.score_accounts where term_id = v_next and student_id = f.student_id) is distinct from 100
     or (select closing_balance from public.term_closing_snapshots where term_id = f.term_id and student_id = f.student_id) is distinct from 100
     or not exists (select 1 from public.score_ledger where id = f.prior_ledger_id and applied_delta = 5 and appeal_decision_id is null) then
    raise exception 'legacy rejection changed something other than the 5 points posted to the original term: %', v_result;
  end if;
end;
$$;

select pass('an unlinked pre-v2 reversal is counted exactly once on the original term, preserving the closing snapshot');

select * from finish();
rollback;
