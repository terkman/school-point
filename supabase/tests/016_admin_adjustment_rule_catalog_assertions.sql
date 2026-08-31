begin;

select plan(8);

select ok(
  exists (
    select 1 from pg_enum enum_value
    join pg_type enum_type on enum_type.oid = enum_value.enumtypid
    where enum_type.typnamespace = 'public'::regnamespace
      and enum_type.typname = 'score_entry_type'
      and enum_value.enumlabel = 'admin_adjustment'
  ),
  'administrator score adjustment has a distinct ledger entry type'
);

select ok(
  exists (
    select 1 from pg_proc routine
    where routine.oid = 'public.admin_adjust_score(uuid,bigint,smallint,timestamptz,text,bigint)'::regprocedure
      and routine.prosecdef
      and 'search_path=""' = any(coalesce(routine.proconfig, array[]::text[]))
  ),
  'administrator score adjustment RPC is security definer with an empty search path'
);

select ok(
  has_function_privilege('authenticated', 'public.admin_adjust_score(uuid,bigint,smallint,timestamptz,text,bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_adjust_score(uuid,bigint,smallint,timestamptz,text,bigint)', 'EXECUTE'),
  'only authenticated sessions can invoke the adjustment RPC before role checks'
);

select ok(
  exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.score_ledger'::regclass
      and constraint_row.conname = 'score_ledger_entry_delta_policy'
      and pg_get_constraintdef(constraint_row.oid) ilike '%admin_adjustment%'
  ),
  'ledger delta policy permits bounded signed administrator corrections'
);

select ok(
  exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.score_ledger'::regclass
      and trigger_row.tgname = 'score_ledger_immutable'
      and not trigger_row.tgisinternal
  ),
  'score ledger remains append-only'
);

select ok(
  not has_table_privilege('authenticated', 'public.behavior_rules', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.positive_behavior_rules', 'INSERT,UPDATE,DELETE'),
  'rule writes are restricted to audited administrator RPCs'
);

select is(
  (select count(*)::integer from public.behavior_rules where rule_code like 'D-CONS-%' and is_active),
  6,
  'six curated deduction rules replace only the reviewed same-score groups'
);

select is(
  (select count(*)::integer from public.positive_behavior_rules where rule_code like 'P-CONS-%' and is_active),
  3,
  'three curated positive rules replace only the reviewed same-score groups'
);

select * from finish();
rollback;
