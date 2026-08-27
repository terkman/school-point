begin;

select plan(3);

select ok(
  not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.incidents'::regclass
      and constraint_row.conname = 'incidents_check1'
  ),
  'the historical recorded_at appeal-deadline constraint is removed'
);

do $$
declare
  v_constraint text;
begin
  select pg_get_constraintdef(constraint_row.oid)
  into v_constraint
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.incidents'::regclass
    and constraint_row.conname = 'incidents_appeal_deadline_from_occurred_check';

  if v_constraint is null
     or position('private.incident_appeal_deadline(occurred_at)' in lower(v_constraint)) = 0 then
    raise exception 'the occurred_at appeal-deadline constraint is missing';
  end if;
end;
$$;

select pass('the occurred_at appeal-deadline constraint remains installed');

do $$
declare
  v_term_id bigint;
  v_classroom_id bigint;
  v_student_id bigint;
  v_rule_id bigint;
  v_rule_severity public.rule_severity;
  v_occurred_at timestamptz := now() - interval '30 days';
  v_recorded_at timestamptz := now();
  v_appeal_deadline timestamptz;
begin
  insert into public.academic_terms (
    school_year, semester, name, starts_on, ends_on, status
  ) values (
    2999, 3, 'pgTAP backdated-incident fixture', date '2999-01-01', date '2999-12-31', 'planned'
  ) returning id into v_term_id;

  insert into public.classrooms (
    term_id, grade_level, room_number, display_name
  ) values (
    v_term_id, 'P1', 'pgTAP', 'pgTAP backdated-incident fixture'
  ) returning id into v_classroom_id;

  insert into public.students (
    student_code, given_name, family_name
  ) values (
    'PGTAP-BACKDATED-INCIDENT', 'Backdated', 'Fixture'
  ) returning id into v_student_id;

  select rule.id, rule.severity
  into v_rule_id, v_rule_severity
  from public.behavior_rules rule
  where rule.is_active
  order by rule.id
  limit 1;

  if v_rule_id is null then
    raise exception 'the seeded active behavior rule required for this test is missing';
  end if;

  insert into public.incidents (
    student_id, term_id, classroom_id, rule_id, rule_snapshot,
    requested_points, applied_points, severity, occurred_at, recorded_at,
    appeal_deadline, recorded_by_snapshot
  ) values (
    v_student_id, v_term_id, v_classroom_id, v_rule_id,
    jsonb_build_object('fixture', 'backdated-appeal-deadline'),
    1, 0, v_rule_severity, v_occurred_at, v_recorded_at,
    v_recorded_at + interval '7 days', 'pgTAP fixture'
  ) returning appeal_deadline into v_appeal_deadline;

  if v_appeal_deadline is distinct from v_occurred_at + interval '7 days'
     or v_appeal_deadline >= v_recorded_at then
    raise exception 'backdated incident did not retain the occurred_at + seven-day deadline';
  end if;
end;
$$;

select pass('a minimal backdated incident inserts with an occurred_at-based deadline');
select * from finish();

rollback;
