begin;

set local lock_timeout = '10s';
set local statement_timeout = '90s';

-- Only cumulative balances change width. Opening points, per-action amounts,
-- the passing threshold, and existing ledger entries keep their values.
drop view public.student_current_scores;
drop view public.student_score_history;
drop function public.get_my_score_history();

-- The column-specific trigger depends on the old balance column type.
drop trigger score_accounts_term_lock on public.score_accounts;

alter table public.score_accounts
  drop constraint score_accounts_balance_check,
  alter column balance type integer,
  add constraint score_accounts_balance_check check (balance >= 0);

alter table public.score_ledger
  drop constraint score_ledger_balance_before_check,
  drop constraint score_ledger_balance_after_check,
  alter column balance_before type integer,
  alter column balance_after type integer,
  add constraint score_ledger_balance_before_check check (balance_before >= 0),
  add constraint score_ledger_balance_after_check check (balance_after >= 0);

alter table public.term_closing_snapshots
  drop constraint term_closing_snapshots_check,
  alter column closing_balance type integer,
  add constraint term_closing_snapshots_check check (
    (account_missing and score_account_id is null and closing_balance is null)
    or (not account_missing and score_account_id is not null and closing_balance >= 0)
  );

alter table public.term_remediation_cases
  drop constraint term_remediation_cases_closing_balance_check,
  alter column closing_balance type integer,
  add constraint term_remediation_cases_closing_balance_check check (closing_balance >= 0);

create trigger score_accounts_term_lock
before insert or update of balance on public.score_accounts
for each row execute function private.lock_score_account_term();

create view public.student_current_scores
with (security_barrier = true, security_invoker = true)
as
select account.id as score_account_id,
       account.term_id,
       term.name as term_name,
       account.balance,
       account.updated_at
from public.score_accounts account
join public.students student on student.id = account.student_id
join public.profiles profile on profile.user_id = student.user_id
join public.academic_terms term on term.id = account.term_id
where (select private.has_password_session())
  and student.user_id = (select auth.uid())
  and student.status = 'active'
  and profile.role = 'student'
  and profile.is_active
  and not profile.activation_required;

create view public.student_score_history
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

revoke all on public.student_current_scores, public.student_score_history from public, anon, authenticated;
grant select on public.student_current_scores, public.student_score_history to authenticated;

create function public.get_my_score_history()
returns table (
  id bigint,
  term_id bigint,
  entry_type public.score_entry_type,
  requested_delta smallint,
  applied_delta smallint,
  balance_before integer,
  balance_after integer,
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

-- Patch only the balance declarations and formulas in existing writers to
-- preserve their authorization, locking, audit and idempotency logic. Every
-- replacement requires one exact match so a divergent definition fails the
-- whole migration instead of leaving mixed score behavior in place.
do $migration$
declare
  v_writer record;
  v_definition text;
  v_patched text;
  v_variable text;
  v_marker text;
begin
  for v_writer in
    select * from (values
      ('public.record_deduction(bigint,bigint,timestamptz,text,text)',
       array['v_balance'], null, null),
      ('public.record_deductions_bulk(uuid,text,bigint[],bigint,bigint,timestamptz,text,text,boolean)',
       array['v_balance_before', 'v_balance_after'], null, null),
      ('public.review_deduction_request_v1(bigint,boolean,smallint,text)',
       array['v_balance'], null, null),
      ('public.admin_add_points(bigint,smallint,text,bigint)',
       array['v_balance'],
       'least(p_points::integer, (100 - v_balance)::integer)::smallint', 'p_points'),
      ('public.admin_add_points_detailed(uuid,bigint,bigint,smallint,timestamptz,text,text,bigint)',
       array['v_balance', 'v_existing_before', 'v_existing_after'],
       $formula$least(
    p_points::integer,
    (100 - v_balance)::integer
  )::smallint$formula$, 'p_points'),
      ('public.admin_add_points_bulk(uuid,text,bigint[],bigint,bigint,smallint,timestamptz,text,text,bigint)',
       array['v_balance'],
       'least(p_points::integer, (100 - v_balance)::integer)::smallint', 'p_points'),
      ('public.review_point_addition_v2(bigint,boolean,smallint,text)',
       array['v_balance'],
       $formula$least(
    p_approved_points::integer,
    (100 - v_balance)::integer
  )::smallint$formula$, 'p_approved_points'),
      ('public.review_appeal_v2(bigint,smallint,text)',
       array['v_balance'],
       'least(v_requested_delta::integer, (100 - v_balance)::integer)::smallint',
       'v_requested_delta'),
      ('public.admin_adjust_score(uuid,bigint,smallint,timestamptz,text,bigint)',
       array['v_balance'],
       $formula$greatest(
    least(p_delta::integer, (100 - v_balance)::integer),
    -v_balance::integer
  )::smallint$formula$, 'greatest(p_delta::integer, -v_balance)::smallint'),
      ('public.review_term_remediation_v1(bigint,boolean,text,uuid)',
       array['v_balance'],
       'least(v_request.requested_points::integer, (100 - v_balance)::integer)::smallint',
       'v_request.requested_points')
    ) patches(signature, balance_variables, capped_expression, new_expression)
  loop
    v_definition := replace(pg_get_functiondef(v_writer.signature::regprocedure), E'\r\n', E'\n');
    foreach v_variable in array v_writer.balance_variables loop
      v_marker := v_variable || ' smallint;';
      v_patched := replace(v_definition, v_marker, v_variable || ' integer;');
      if length(v_definition) - length(v_patched) <> length('smallint') - length('integer') then
        raise exception 'Expected one balance declaration for % in %', v_variable, v_writer.signature;
      end if;
      v_definition := v_patched;
    end loop;

    if v_writer.capped_expression is not null then
      v_patched := replace(v_definition, v_writer.capped_expression, v_writer.new_expression);
      if length(v_definition) - length(v_patched) <>
         length(v_writer.capped_expression) - length(v_writer.new_expression) then
        raise exception 'Expected one score cap expression in %', v_writer.signature;
      end if;
      v_definition := v_patched;
    end if;

    execute v_definition;
  end loop;
end;
$migration$;

comment on function public.admin_add_points_detailed(uuid, bigint, bigint, smallint, timestamptz, text, text, bigint) is
  'Add points directly as an administrator with an effective positive rule, staff-only reason/evidence, and UUID idempotency.';

comment on function public.admin_add_points_bulk(uuid, text, bigint[], bigint, bigint, smallint, timestamptz, text, text, bigint) is
  'Atomically add points as an administrator to an exact classroom-scoped roster with evidence, audit, and UUID idempotency.';

comment on function public.review_term_remediation_v1(bigint, boolean, text, uuid) is
  'Administrator decision on a remediation request. Approval credits the original closed-term account.';

commit;
