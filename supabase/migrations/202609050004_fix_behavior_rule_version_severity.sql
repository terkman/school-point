begin;

-- PL/pgSQL does not implicitly assign text CASE results to the rule_severity
-- enum. Cast each branch explicitly so point changes can publish a new rule
-- version without failing at runtime.
create or replace function public.admin_update_behavior_rule(
  p_rule_id bigint,
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
  v_old public.behavior_rules%rowtype;
  v_new_id bigint;
  v_severity public.rule_severity;
begin
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;

  select * into v_old
  from public.behavior_rules
  where id = p_rule_id and is_active
  for update;
  if not found then
    raise exception 'Active rule not found' using errcode = 'P0002';
  end if;

  if nullif(btrim(p_title), '') is null
    or char_length(btrim(p_title)) not between 3 and 300
    or p_points is null
    or p_points not between 1 and 100
  then
    raise exception 'Invalid rule values' using errcode = '22023';
  end if;
  if p_description is not null and char_length(btrim(p_description)) > 2000 then
    raise exception 'Rule description is too long' using errcode = '22023';
  end if;

  v_severity := case
    when p_points >= 50 then 'critical'::public.rule_severity
    when p_points >= 25 then 'serious'::public.rule_severity
    when p_points >= 10 then 'medium'::public.rule_severity
    else 'low'::public.rule_severity
  end;

  insert into public.behavior_rules(
    rule_code,
    category,
    title_th,
    description_th,
    default_deduction,
    severity,
    guardian_contact_required,
    is_active,
    effective_from
  ) values (
    'D-AUTO-' || lpad(nextval('private.custom_deduction_rule_code_seq')::text, 6, '0'),
    case v_severity
      when 'critical' then 'ความผิดขั้นร้ายแรงมาก'
      when 'serious' then 'ความผิดขั้นร้ายแรง'
      when 'medium' then 'ความผิดขั้นปานกลาง'
      else 'ความผิดขั้นเบา'
    end,
    btrim(p_title),
    nullif(btrim(p_description), ''),
    p_points,
    v_severity,
    v_severity in ('serious', 'critical'),
    true,
    current_date
  ) returning id into v_new_id;

  update public.behavior_rules
  set is_active = false, effective_to = current_date
  where id = p_rule_id;

  perform private.write_audit(
    'admin_update_behavior_rule',
    'behavior_rules',
    p_rule_id::text,
    to_jsonb(v_old),
    jsonb_build_object('new_id', v_new_id, 'title', p_title, 'points', p_points)
  );
  return jsonb_build_object('ok', true, 'id', v_new_id);
end;
$$;

revoke all on function public.admin_update_behavior_rule(bigint, text, smallint, text)
from public, anon;
grant execute on function public.admin_update_behavior_rule(bigint, text, smallint, text)
to authenticated;

commit;
