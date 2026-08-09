begin;

-- Defense in depth: even an outdated client cannot bypass the approval queue by
-- calling the legacy/direct deduction RPC as a teacher. Administrators retain
-- direct score authority for operational corrections.
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

  if v_role = 'teacher' and v_rule.default_deduction >= 10 then
    raise exception 'Deductions of 10 points or more require administrator approval'
      using errcode = '42501';
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

-- Keep the legacy helper unavailable directly; record_deductions_bulk remains
-- the only authenticated direct-deduction entry point and inherits this guard.
revoke all on function public.record_deduction(bigint,bigint,timestamptz,text,text)
from public, anon, authenticated, service_role;

commit;
