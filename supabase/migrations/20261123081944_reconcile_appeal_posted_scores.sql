begin;

set local lock_timeout = '10s';
set local statement_timeout = '90s';

create or replace function public.review_appeal_v2(
  p_appeal_id bigint,
  p_restored_points smallint,
  p_public_explanation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appeal public.appeals%rowtype;
  v_incident public.incidents%rowtype;
  v_account_id bigint;
  v_balance integer;
  v_previously_applied bigint;
  v_delta bigint;
  v_requested_delta smallint;
  v_applied_delta smallint;
  v_version smallint;
  v_outcome text;
  v_explanation text := nullif(btrim(p_public_explanation), '');
  v_decision_id bigint;
  v_ledger_id bigint;
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if p_appeal_id is null
     or p_restored_points is null
     or p_restored_points not between 0 and 100 then
    raise exception 'Appeal and restored points from 0 to 100 are required'
      using errcode = '22023';
  end if;

  if v_explanation is null or char_length(v_explanation) not between 5 and 2000 then
    raise exception 'Public explanation must contain 5 to 2000 characters'
      using errcode = '22023';
  end if;

  select appeal.*
  into v_appeal
  from public.appeals appeal
  where appeal.id = p_appeal_id
  for update;

  if not found then
    raise exception 'Appeal not found'
      using errcode = 'P0002';
  end if;

  if v_appeal.status not in ('submitted', 'reviewing') then
    raise exception 'Appeal already decided; reopen it before another decision'
      using errcode = '55000';
  end if;

  select incident.*
  into v_incident
  from public.incidents incident
  where incident.id = v_appeal.incident_id
  for update;

  if not found then
    raise exception 'Appeal incident not found'
      using errcode = 'P0002';
  end if;

  if p_restored_points > v_incident.applied_points then
    raise exception 'Restored points exceed the points deducted by this incident'
      using errcode = '22023';
  end if;

  v_account_id := private.ensure_score_account(
    v_incident.student_id,
    v_incident.term_id,
    v_uid
  );

  select account.balance
  into v_balance
  from public.score_accounts account
  where account.id = v_account_id
  for update;

  -- Approval, the old balance ceiling and the zero floor can all produce
  -- different amounts. Count only posted changes on this appeal's original
  -- account. Each incident has at most one appeal and one legacy reversal;
  -- a reversal without a decision link still belongs to that appeal.
  select coalesce(sum(ledger.applied_delta), 0)
  into v_previously_applied
  from public.score_ledger ledger
  left join private.appeal_decisions decision on decision.id = ledger.appeal_decision_id
  where ledger.score_account_id = v_account_id
    and ledger.student_id = v_incident.student_id
    and ledger.term_id = v_incident.term_id
    and ledger.incident_id = v_incident.id
    and ledger.entry_type in ('appeal_reversal', 'appeal_adjustment')
    and (
      decision.appeal_id = v_appeal.id
      or (ledger.entry_type = 'appeal_reversal' and ledger.appeal_decision_id is null)
    );

  v_delta := p_restored_points - v_previously_applied;
  if v_delta not between -100 and 100 then
    raise exception 'Historical appeal score changes require manual reconciliation before a new decision'
      using errcode = '55000';
  end if;

  v_requested_delta := v_delta::smallint;
  v_applied_delta := greatest(v_delta, -v_balance)::smallint;
  v_version := (v_appeal.review_version + 1)::smallint;
  v_outcome := case when p_restored_points > 0 then 'accepted' else 'rejected' end;

  insert into private.appeal_decisions(
    appeal_id,
    version,
    outcome,
    restored_points,
    requested_score_delta,
    applied_score_delta,
    public_explanation,
    decided_by
  ) values (
    v_appeal.id,
    v_version,
    v_outcome,
    p_restored_points,
    v_requested_delta,
    v_applied_delta,
    v_explanation,
    v_uid
  ) returning id into v_decision_id;

  if v_applied_delta <> 0 then
    update public.score_accounts
    set balance = balance + v_applied_delta
    where id = v_account_id;

    insert into public.score_ledger(
      score_account_id,
      student_id,
      term_id,
      entry_type,
      requested_delta,
      applied_delta,
      balance_before,
      balance_after,
      incident_id,
      appeal_decision_id,
      reason,
      actor_user_id,
      actor_snapshot
    ) values (
      v_account_id,
      v_incident.student_id,
      v_incident.term_id,
      'appeal_adjustment',
      v_requested_delta,
      v_applied_delta,
      v_balance,
      v_balance + v_applied_delta,
      v_incident.id,
      v_decision_id,
      format('ปรับคะแนนตามผลอุทธรณ์ ครั้งที่ %s', v_version),
      v_uid,
      private.actor_snapshot(v_uid)
    ) returning id into v_ledger_id;
  end if;

  update public.appeals
  set status = v_outcome::public.appeal_status,
      restored_points = p_restored_points,
      public_explanation = v_explanation,
      decision_note = v_explanation,
      decided_by = v_uid,
      decided_at = now(),
      review_version = v_version
  where id = v_appeal.id;

  perform private.write_audit(
    'review_appeal_v2',
    'appeal',
    v_appeal.id::text,
    to_jsonb(v_appeal),
    jsonb_build_object(
      'status', v_outcome,
      'review_version', v_version,
      'restored_points', p_restored_points,
      'previously_applied_score_delta', v_previously_applied,
      'requested_score_delta', v_requested_delta,
      'applied_score_delta', v_applied_delta,
      'decision_id', v_decision_id,
      'ledger_id', v_ledger_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'appealId', v_appeal.id,
    'status', v_outcome,
    'reviewVersion', v_version,
    'restoredPoints', p_restored_points,
    'appliedScoreDelta', v_applied_delta,
    'balanceBefore', v_balance,
    'balanceAfter', v_balance + v_applied_delta,
    'decisionId', v_decision_id,
    'ledgerId', v_ledger_id
  );
end;
$$;

comment on function public.review_appeal_v2(bigint, smallint, text) is
  'Review an appeal and reconcile its original account against already-posted appeal ledger changes.';

commit;
