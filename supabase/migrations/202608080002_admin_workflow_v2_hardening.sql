begin;

-- Keep the teacher-session authorization check at the public wrapper boundary,
-- even though the delegated legacy RPC repeats the same check. This prevents a
-- future change to the delegated function from silently widening access.
create or replace function public.request_point_addition_v2(
  p_client_request_id uuid,
  p_student_id bigint,
  p_positive_rule_id bigint,
  p_points smallint,
  p_activity_occurred_at timestamptz,
  p_reason text,
  p_evidence_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_result jsonb;
  v_request_id bigint;
begin
  if private.current_role() is distinct from 'teacher'::public.app_role then
    raise exception 'Teacher permission required'
      using errcode = '42501';
  end if;

  select coalesce(
    nullif(btrim(p_reason), ''),
    nullif(btrim(rule.title_th), ''),
    'ไม่ได้ระบุรายละเอียด'
  )
  into v_reason
  from public.positive_behavior_rules rule
  where rule.id = p_positive_rule_id;

  v_reason := coalesce(v_reason, nullif(btrim(p_reason), ''), 'ไม่ได้ระบุรายละเอียด');

  v_result := public.request_point_addition_detailed(
    p_client_request_id,
    p_student_id,
    p_positive_rule_id,
    p_points,
    p_activity_occurred_at,
    v_reason,
    coalesce(v_evidence, 'ไม่มีหลักฐานแนบ')
  );

  v_request_id := (v_result ->> 'requestId')::bigint;
  if v_evidence is null then
    update public.point_addition_requests
    set evidence_note = null
    where id = v_request_id;
  end if;

  return v_result;
end;
$$;

create or replace function public.request_point_additions_bulk_v2(
  p_client_request_id uuid,
  p_scope text,
  p_student_ids bigint[],
  p_classroom_id bigint,
  p_positive_rule_id bigint,
  p_points smallint,
  p_activity_occurred_at timestamptz,
  p_reason text,
  p_evidence_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_evidence text := nullif(btrim(p_evidence_note), '');
  v_result jsonb;
  v_batch_id bigint;
begin
  if private.current_role() is distinct from 'teacher'::public.app_role then
    raise exception 'Teacher permission required'
      using errcode = '42501';
  end if;

  select coalesce(
    nullif(btrim(p_reason), ''),
    nullif(btrim(rule.title_th), ''),
    'ไม่ได้ระบุรายละเอียด'
  )
  into v_reason
  from public.positive_behavior_rules rule
  where rule.id = p_positive_rule_id;

  v_reason := coalesce(v_reason, nullif(btrim(p_reason), ''), 'ไม่ได้ระบุรายละเอียด');

  v_result := public.request_point_additions_bulk(
    p_client_request_id,
    p_scope,
    p_student_ids,
    p_classroom_id,
    p_positive_rule_id,
    p_points,
    p_activity_occurred_at,
    v_reason,
    coalesce(v_evidence, 'ไม่มีหลักฐานแนบ')
  );

  v_batch_id := (v_result ->> 'batchId')::bigint;
  if v_evidence is null then
    update public.point_addition_requests
    set evidence_note = null
    where addition_batch_id = v_batch_id;

    update private.addition_batches
    set evidence_note = null
    where id = v_batch_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.request_point_addition_v2(
  uuid, bigint, bigint, smallint, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_point_addition_v2(
  uuid, bigint, bigint, smallint, timestamptz, text, text
) to authenticated;

revoke all on function public.request_point_additions_bulk_v2(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_point_additions_bulk_v2(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text
) to authenticated;

comment on function public.request_point_addition_v2(
  uuid, bigint, bigint, smallint, timestamptz, text, text
) is 'Teacher-only addition request wrapper with optional description/evidence and direct password-session authorization.';

comment on function public.request_point_additions_bulk_v2(
  uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text
) is 'Teacher-only bulk addition request wrapper with optional description/evidence and direct password-session authorization.';

commit;
