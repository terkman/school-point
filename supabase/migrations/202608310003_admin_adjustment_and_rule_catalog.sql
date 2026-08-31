begin;

-- Keep administrator corrections distinct from behavior events so reporting can
-- exclude accounting fixes while every balance change remains append-only.
alter table public.score_ledger
  drop constraint if exists score_ledger_entry_delta_policy;

alter table public.score_ledger
  add constraint score_ledger_entry_delta_policy
  check (
    (entry_type = 'deduction' and requested_delta < 0 and applied_delta between -100 and 0)
    or (
      entry_type = 'semester_opening'
      and requested_delta = 100
      and applied_delta = 100
      and balance_before = 0
      and balance_after = 100
    )
    or (
      entry_type in ('teacher_request_approved', 'admin_addition', 'appeal_reversal')
      and requested_delta > 0
      and applied_delta between 0 and 100
    )
    or (
      entry_type in ('appeal_adjustment', 'admin_adjustment')
      and requested_delta between -100 and 100
      and requested_delta <> 0
      and (
        (requested_delta > 0 and applied_delta between 0 and requested_delta)
        or (requested_delta < 0 and applied_delta between requested_delta and 0)
      )
    )
  );

-- The existing idempotency-detail constraint only allowed administrator
-- additions. Reuse the same protected columns for signed administrator
-- corrections; evidence and a positive rule are intentionally not required.
alter table public.score_ledger
  drop constraint if exists score_ledger_direct_addition_details;

alter table public.score_ledger
  add constraint score_ledger_idempotent_details
  check (
    client_request_id is null
    or (
      entry_type = 'admin_addition'
      and actor_user_id is not null
      and positive_rule_id is not null
      and positive_rule_snapshot is not null
      and activity_occurred_at is not null
      and nullif(btrim(internal_reason), '') is not null
      and char_length(btrim(internal_reason)) between 5 and 2000
      and nullif(btrim(evidence_note), '') is not null
      and char_length(btrim(evidence_note)) between 5 and 4000
    )
    or (
      entry_type = 'admin_adjustment'
      and actor_user_id is not null
      and positive_rule_id is null
      and positive_rule_snapshot is null
      and activity_occurred_at is not null
      and nullif(btrim(internal_reason), '') is not null
      and char_length(btrim(internal_reason)) between 5 and 2000
    )
  );

create or replace function public.admin_adjust_score(
  p_client_request_id uuid,
  p_student_id bigint,
  p_delta smallint,
  p_activity_occurred_at timestamptz,
  p_reason text,
  p_term_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_term public.academic_terms%rowtype;
  v_account_id bigint;
  v_balance smallint;
  v_applied smallint;
  v_ledger_id bigint;
  v_existing public.score_ledger%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_payload jsonb;
  v_payload_hash text;
  v_activity_date date;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;

  if p_client_request_id is null
     or p_student_id is null or p_student_id <= 0
     or p_term_id is null or p_term_id <= 0
     or p_activity_occurred_at is null then
    raise exception 'Request ID, student, term, and adjustment time are required'
      using errcode = '22023';
  end if;

  if p_delta is null or p_delta = 0 or p_delta not between -100 and 100 then
    raise exception 'Adjustment must be a non-zero integer from -100 to 100'
      using errcode = '22023';
  end if;

  if v_reason is null or char_length(v_reason) not between 5 and 2000 then
    raise exception 'Reason must contain between 5 and 2000 characters'
      using errcode = '22023';
  end if;

  if p_activity_occurred_at > now() + interval '5 minutes' then
    raise exception 'Adjustment time cannot be in the future'
      using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'operation', 'admin_adjust_score',
    'student_id', p_student_id,
    'term_id', p_term_id,
    'delta', p_delta,
    'activity_occurred_at_epoch', extract(epoch from p_activity_occurred_at),
    'reason', v_reason
  );
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin-adjustment:' || v_uid::text || ':' || p_client_request_id::text,
      0
    )
  );

  select ledger.*
  into v_existing
  from public.score_ledger ledger
  where ledger.actor_user_id = v_uid
    and ledger.client_request_id = p_client_request_id;

  if found then
    if v_existing.entry_type <> 'admin_adjustment'
       or v_existing.request_payload_hash is distinct from v_payload_hash then
      raise exception 'Client request ID was already used for a different score action'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'ledgerId', v_existing.id,
      'studentId', v_existing.student_id,
      'requestedDelta', v_existing.requested_delta,
      'appliedDelta', v_existing.applied_delta,
      'balanceBefore', v_existing.balance_before,
      'balanceAfter', v_existing.balance_after
    );
  end if;

  select term.*
  into v_term
  from public.academic_terms term
  join public.enrollments enrollment
    on enrollment.term_id = term.id
   and enrollment.student_id = p_student_id
   and enrollment.is_active
  join public.students student
    on student.id = enrollment.student_id
   and student.status = 'active'
  where term.id = p_term_id
    and term.status = 'active'
  for share of term, enrollment, student;

  if not found then
    raise exception 'Student has no active enrollment in the active term'
      using errcode = 'P0002';
  end if;

  v_activity_date := (p_activity_occurred_at at time zone 'Asia/Bangkok')::date;
  if v_term.starts_on is null
     or v_term.ends_on is null
     or v_activity_date < v_term.starts_on
     or v_activity_date > v_term.ends_on then
    raise exception 'Adjustment time must be inside the active term'
      using errcode = '22023';
  end if;

  v_account_id := private.ensure_score_account(p_student_id, v_term.id, v_uid);

  select account.balance
  into v_balance
  from public.score_accounts account
  where account.id = v_account_id
  for update;

  v_applied := greatest(
    least(p_delta::integer, (100 - v_balance)::integer),
    -v_balance::integer
  )::smallint;

  update public.score_accounts
  set balance = balance + v_applied
  where id = v_account_id;

  insert into public.score_ledger (
    score_account_id,
    student_id,
    term_id,
    entry_type,
    requested_delta,
    applied_delta,
    balance_before,
    balance_after,
    activity_occurred_at,
    internal_reason,
    client_request_id,
    request_payload_hash,
    reason,
    actor_user_id,
    actor_snapshot
  ) values (
    v_account_id,
    p_student_id,
    v_term.id,
    'admin_adjustment',
    p_delta,
    v_applied,
    v_balance,
    v_balance + v_applied,
    p_activity_occurred_at,
    v_reason,
    p_client_request_id,
    v_payload_hash,
    v_reason,
    v_uid,
    private.actor_snapshot(v_uid)
  ) returning id into v_ledger_id;

  perform private.write_audit(
    'admin_adjust_score',
    'score_ledger',
    v_ledger_id::text,
    null,
    jsonb_build_object(
      'student_id', p_student_id,
      'term_id', v_term.id,
      'adjustment_occurred_at', p_activity_occurred_at,
      'requested_delta', p_delta,
      'applied_delta', v_applied,
      'balance_before', v_balance,
      'balance_after', v_balance + v_applied,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'ledgerId', v_ledger_id,
    'studentId', p_student_id,
    'requestedDelta', p_delta,
    'appliedDelta', v_applied,
    'balanceBefore', v_balance,
    'balanceAfter', v_balance + v_applied
  );
end;
$$;

comment on function public.admin_adjust_score(uuid, bigint, smallint, timestamptz, text, bigint) is
  'Append an idempotent signed administrator score correction without editing prior ledger history.';

-- Show the effective date selected by the administrator while continuing to
-- hide staff identity and the private rule/evidence fields from students.
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
       case
         when ledger.entry_type in ('teacher_request_approved', 'admin_addition')
           then coalesce(
             nullif(btrim(ledger.positive_rule_snapshot ->> 'title_th'), ''),
             'กิจกรรมเพิ่มคะแนน'
           )
         else ledger.reason
       end as reason,
       ledger.incident_id,
       ledger.created_at,
       ledger.activity_occurred_at
from public.score_ledger ledger
join public.students student on student.id = ledger.student_id
join public.profiles profile on profile.user_id = student.user_id
where (select private.has_password_session())
  and student.user_id = (select auth.uid())
  and student.status = 'active'
  and profile.role = 'student'
  and profile.is_active
  and not profile.activation_required;

drop function if exists public.get_my_score_history();
create function public.get_my_score_history()
returns table (
  id bigint,
  term_id bigint,
  entry_type public.score_entry_type,
  requested_delta smallint,
  applied_delta smallint,
  balance_before smallint,
  balance_after smallint,
  reason text,
  incident_id bigint,
  created_at timestamptz,
  activity_occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_id bigint := private.current_student_id();
begin
  if v_student_id is null then
    raise exception 'Active student permission required' using errcode = '42501';
  end if;

  return query
  select ledger.id,
         ledger.term_id,
         ledger.entry_type,
         ledger.requested_delta,
         ledger.applied_delta,
         ledger.balance_before,
         ledger.balance_after,
         case
           when ledger.entry_type in ('teacher_request_approved', 'admin_addition')
             then coalesce(
               nullif(btrim(ledger.positive_rule_snapshot ->> 'title_th'), ''),
               'กิจกรรมเพิ่มคะแนน'
             )
           else ledger.reason
         end,
         ledger.incident_id,
         ledger.created_at,
         ledger.activity_occurred_at
  from public.score_ledger ledger
  where ledger.student_id = v_student_id
  order by ledger.created_at desc, ledger.id desc;
end;
$$;

revoke all on function public.get_my_score_history() from public, anon;
grant execute on function public.get_my_score_history() to authenticated;

-- Rule codes are generated by the database so administrators never need to
-- invent or coordinate identifiers.
create sequence if not exists private.custom_deduction_rule_code_seq;
create sequence if not exists private.custom_positive_rule_code_seq;

create or replace function public.admin_create_behavior_rule(
  p_title text,
  p_points smallint,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(p_description), '');
  v_code text;
  v_category text;
  v_severity public.rule_severity;
  v_rule public.behavior_rules%rowtype;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if v_title is null or char_length(v_title) not between 3 and 300 then
    raise exception 'Rule title must contain between 3 and 300 characters' using errcode = '22023';
  end if;
  if p_points is null or p_points not between 1 and 100 then
    raise exception 'Deduction points must be between 1 and 100' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'Rule description is too long' using errcode = '22023';
  end if;

  v_severity := case
    when p_points >= 50 then 'critical'::public.rule_severity
    when p_points >= 25 then 'serious'::public.rule_severity
    when p_points >= 10 then 'medium'::public.rule_severity
    else 'low'::public.rule_severity
  end;
  v_category := case v_severity
    when 'critical' then 'ความผิดขั้นร้ายแรงมาก'
    when 'serious' then 'ความผิดขั้นร้ายแรง'
    when 'medium' then 'ความผิดขั้นปานกลาง'
    else 'ความผิดขั้นเบา'
  end;
  v_code := 'D-AUTO-' || lpad(nextval('private.custom_deduction_rule_code_seq')::text, 6, '0');

  insert into public.behavior_rules (
    rule_code, category, title_th, description_th, default_deduction,
    severity, guardian_contact_required, is_active
  ) values (
    v_code, v_category, v_title, v_description, p_points,
    v_severity, v_severity in ('serious', 'critical'), true
  ) returning * into v_rule;

  perform private.write_audit(
    'admin_create_behavior_rule', 'behavior_rules', v_rule.id::text, null,
    jsonb_build_object('rule_code', v_rule.rule_code, 'title', v_rule.title_th, 'points', v_rule.default_deduction)
  );

  return jsonb_build_object('ok', true, 'id', v_rule.id, 'code', v_rule.rule_code);
end;
$$;

create or replace function public.admin_create_positive_rule(
  p_title text,
  p_points smallint,
  p_is_discretionary boolean default false,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(p_description), '');
  v_code text;
  v_rule public.positive_behavior_rules%rowtype;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if v_title is null or char_length(v_title) not between 3 and 300 then
    raise exception 'Rule title must contain between 3 and 300 characters' using errcode = '22023';
  end if;
  if p_points is null or p_points not between 1 and 100 then
    raise exception 'Addition points must be between 1 and 100' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'Rule description is too long' using errcode = '22023';
  end if;

  v_code := 'P-AUTO-' || lpad(nextval('private.custom_positive_rule_code_seq')::text, 6, '0');
  insert into public.positive_behavior_rules (
    rule_code, category, title_th, description_th, default_addition,
    max_addition, is_discretionary, is_active
  ) values (
    v_code,
    'เกณฑ์การเพิ่มคะแนนความประพฤติ',
    v_title,
    v_description,
    case when coalesce(p_is_discretionary, false) then null else p_points end,
    p_points,
    coalesce(p_is_discretionary, false),
    true
  ) returning * into v_rule;

  perform private.write_audit(
    'admin_create_positive_rule', 'positive_behavior_rules', v_rule.id::text, null,
    jsonb_build_object('rule_code', v_rule.rule_code, 'title', v_rule.title_th, 'max_points', v_rule.max_addition)
  );

  return jsonb_build_object('ok', true, 'id', v_rule.id, 'code', v_rule.rule_code);
end;
$$;

create or replace function public.admin_remove_behavior_rule(p_rule_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.behavior_rules%rowtype;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  select * into v_rule from public.behavior_rules where id = p_rule_id for update;
  if not found then
    raise exception 'Behavior rule not found' using errcode = 'P0002';
  end if;

  -- Published school rules remain as inactive historical master data. Only a
  -- never-used custom rule may be physically removed.
  if v_rule.rule_code like 'D-AUTO-%'
     and not exists (select 1 from public.incidents where rule_id = v_rule.id)
     and not exists (select 1 from public.deduction_approval_requests where rule_id = v_rule.id)
     and not exists (select 1 from private.deduction_batches where rule_id = v_rule.id) then
    delete from public.behavior_rules where id = v_rule.id;
    perform private.write_audit('admin_delete_behavior_rule', 'behavior_rules', v_rule.id::text, to_jsonb(v_rule), null);
    return jsonb_build_object('ok', true, 'outcome', 'deleted');
  end if;

  update public.behavior_rules
  set is_active = false, effective_to = coalesce(effective_to, current_date)
  where id = v_rule.id;
  perform private.write_audit(
    'admin_archive_behavior_rule', 'behavior_rules', v_rule.id::text,
    jsonb_build_object('is_active', v_rule.is_active), jsonb_build_object('is_active', false)
  );
  return jsonb_build_object('ok', true, 'outcome', 'archived');
end;
$$;

create or replace function public.admin_remove_positive_rule(p_rule_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.positive_behavior_rules%rowtype;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  select * into v_rule from public.positive_behavior_rules where id = p_rule_id for update;
  if not found then
    raise exception 'Positive rule not found' using errcode = 'P0002';
  end if;

  if v_rule.rule_code like 'P-AUTO-%'
     and not exists (select 1 from public.point_addition_requests where positive_rule_id = v_rule.id)
     and not exists (select 1 from public.score_ledger where positive_rule_id = v_rule.id) then
    delete from public.positive_behavior_rules where id = v_rule.id;
    perform private.write_audit('admin_delete_positive_rule', 'positive_behavior_rules', v_rule.id::text, to_jsonb(v_rule), null);
    return jsonb_build_object('ok', true, 'outcome', 'deleted');
  end if;

  update public.positive_behavior_rules
  set is_active = false, effective_to = coalesce(effective_to, current_date)
  where id = v_rule.id;
  perform private.write_audit(
    'admin_archive_positive_rule', 'positive_behavior_rules', v_rule.id::text,
    jsonb_build_object('is_active', v_rule.is_active), jsonb_build_object('is_active', false)
  );
  return jsonb_build_object('ok', true, 'outcome', 'archived');
end;
$$;

-- Curated consolidation is deliberately a data migration, not an end-user
-- feature. Old rules are only hidden from new selection; their IDs and all
-- historical snapshots remain untouched.
create or replace function private.consolidate_2569_score_rules()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.behavior_rules (
    rule_code, category, title_th, description_th, default_deduction,
    severity, guardian_contact_required, is_active
  ) values
    ('D-CONS-001', 'ความผิดขั้นเบา', 'แต่งกาย เครื่องแบบ รองเท้า หรือเครื่องประดับไม่ถูกระเบียบ', 'รวมข้อกำหนดเรื่องเครื่องแต่งกายนักเรียน เครื่องแบบลูกเสือ ชุดพละ การแต่งกายมาติดต่อราชการ เครื่องประดับ และรองเท้า', 2, 'low', false, true),
    ('D-CONS-002', 'ความผิดขั้นเบา', 'ทรงผม หนวดเครา หรืออุปกรณ์แต่งผมไม่ถูกระเบียบ', 'รวมข้อกำหนดเรื่องทรงผมนักเรียนชายและหญิง หนวดเครา การถักเปีย และอุปกรณ์ติดผม', 2, 'low', false, true),
    ('D-CONS-003', 'ความผิดขั้นเบา', 'ไม่รักษาความสะอาดหรือไม่ทำความสะอาดพื้นที่ที่รับผิดชอบ', 'ครอบคลุมการทิ้งขยะ ห้องเรียน ห้องน้ำ โรงอาหาร และเขตพื้นที่รับผิดชอบ', 2, 'low', false, true),
    ('D-CONS-004', 'ความผิดขั้นเบา', 'ใช้คำพูด การเขียน กิริยา หรือท่าทางไม่สุภาพต่อผู้อื่น', 'ครอบคลุมถ้อยคำ การเขียน และท่าทางที่หยาบคาย ไม่สุภาพ หรือก้าวร้าวโดยไม่ก่อให้เกิดความเสียหาย', 3, 'low', false, true),
    ('D-CONS-005', 'ความผิดขั้นปานกลาง', 'ไม่แสดงความเคารพหรือใช้กิริยาและวาจาไม่สุภาพต่อครู', 'รวมการไม่มีสัมมาคารวะและการแสดงกิริยา วาจา หรือท่าทางก้าวร้าวต่อครูหรืออาจารย์', 10, 'medium', false, true),
    ('D-CONS-006', 'ความผิดขั้นปานกลาง', 'กระทำความผิดตามพระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์', 'ครอบคลุมมาตรา 5–16 ตามที่ระบุไว้ในระเบียบโรงเรียน โดยพิจารณาข้อเท็จจริงประกอบ', 10, 'medium', false, true)
  on conflict (rule_code) do update
  set category = excluded.category,
      title_th = excluded.title_th,
      description_th = excluded.description_th,
      default_deduction = excluded.default_deduction,
      severity = excluded.severity,
      guardian_contact_required = excluded.guardian_contact_required,
      is_active = true,
      effective_to = null;

  update public.behavior_rules
  set is_active = false, effective_to = coalesce(effective_to, current_date)
  where rule_code = any (array[
    'D2569-L-010','D2569-L-011','D2569-L-012','D2569-L-013','D2569-L-014','D2569-L-015','D2569-L-016',
    'D2569-L-017','D2569-L-018','D2569-L-019',
    'D2569-L-020','D2569-L-021','D2569-L-022','D2569-L-023','D2569-L-024',
    'D2569-L-028','D2569-L-029',
    'D2569-M-005','D2569-M-014',
    'D2569-M-008','D2569-M-016'
  ]);

  insert into public.positive_behavior_rules (
    rule_code, category, title_th, description_th, default_addition,
    max_addition, is_discretionary, is_active
  ) values
    ('P-CONS-001', 'เกณฑ์การเพิ่มคะแนนความประพฤติ', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่ผู้นำนักเรียนหรือคณะกรรมการระดับชั้นและกลุ่มสี', 'รวมหน้าที่รองหัวหน้าชั้นเรียนและคณะกรรมการฝ่ายต่าง ๆ ในกลุ่มเขตรับผิดชอบหรือกลุ่มสี', 10, 10, false, true),
    ('P-CONS-002', 'เกณฑ์การเพิ่มคะแนนความประพฤติ', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่ผู้นำนักเรียนระดับหัวหน้าชั้น คณะกรรมการนักเรียน หรือรองประธานคณะสี', 'รวมตำแหน่งหัวหน้าชั้นเรียน คณะกรรมการนักเรียนฝ่ายต่าง ๆ และรองประธานคณะสี', 15, 15, false, true),
    ('P-CONS-003', 'เกณฑ์การเพิ่มคะแนนความประพฤติ', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่ผู้นำนักเรียนระดับประธานหรือรองประธาน', 'รวมตำแหน่งรองประธานคณะกรรมการนักเรียนและประธานคณะสี', 20, 20, false, true)
  on conflict (rule_code) do update
  set category = excluded.category,
      title_th = excluded.title_th,
      description_th = excluded.description_th,
      default_addition = excluded.default_addition,
      max_addition = excluded.max_addition,
      is_discretionary = excluded.is_discretionary,
      is_active = true,
      effective_to = null;

  update public.positive_behavior_rules
  set is_active = false, effective_to = coalesce(effective_to, current_date)
  where rule_code = any (array[
    'P2569-004','P2569-005',
    'P2569-009','P2569-010','P2569-011',
    'P2569-012','P2569-013'
  ]);
end;
$$;

select private.consolidate_2569_score_rules();

revoke all on function public.admin_adjust_score(uuid, bigint, smallint, timestamptz, text, bigint) from public, anon;
revoke all on function public.admin_create_behavior_rule(text, smallint, text) from public, anon;
revoke all on function public.admin_create_positive_rule(text, smallint, boolean, text) from public, anon;
revoke all on function public.admin_remove_behavior_rule(bigint) from public, anon;
revoke all on function public.admin_remove_positive_rule(bigint) from public, anon;
grant execute on function public.admin_adjust_score(uuid, bigint, smallint, timestamptz, text, bigint) to authenticated;
grant execute on function public.admin_create_behavior_rule(text, smallint, text) to authenticated;
grant execute on function public.admin_create_positive_rule(text, smallint, boolean, text) to authenticated;
grant execute on function public.admin_remove_behavior_rule(bigint) to authenticated;
grant execute on function public.admin_remove_positive_rule(bigint) to authenticated;

revoke insert, update, delete on public.behavior_rules from authenticated;
revoke insert, update, delete on public.positive_behavior_rules from authenticated;

revoke all on function private.consolidate_2569_score_rules() from public, anon, authenticated;
revoke all on sequence private.custom_deduction_rule_code_seq from public, anon, authenticated;
revoke all on sequence private.custom_positive_rule_code_seq from public, anon, authenticated;

commit;
