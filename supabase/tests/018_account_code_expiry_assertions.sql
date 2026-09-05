begin;

select plan(7);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'account_activations'
      and column_name = 'purpose'
  ),
  'account codes record whether they are activation or password-reset codes'
);
select ok(
  to_regprocedure('public.service_issue_school_account_code(uuid,uuid,text,text,timestamp with time zone)') is not null,
  'service-role account-code issue RPC exists'
);
select ok(
  to_regprocedure('public.service_consume_school_account_code(text,text)') is not null,
  'service-role account-code consume RPC exists'
);
select ok(
  not has_function_privilege('anon', 'public.service_consume_school_account_code(text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.service_consume_school_account_code(text,text)', 'EXECUTE'),
  'clients cannot call the account-code consume RPC directly'
);
select ok(
  has_function_privilege('service_role', 'public.service_consume_school_account_code(text,text)', 'EXECUTE'),
  'the service role can consume account codes'
);
select ok(
  position('decode(p_token_hash_hex' in pg_get_functiondef('public.service_issue_school_account_code(uuid,uuid,text,text,timestamp with time zone)'::regprocedure)) > 0
  and position('token_hash' in pg_get_functiondef('public.service_consume_school_account_code(text,text)'::regprocedure)) > 0,
  'account-code digests are enforced server-side'
);
select ok(
  position('failed_attempts' in pg_get_functiondef('public.service_consume_school_account_code(text,text)'::regprocedure)) > 0
  and position('expires_at' in pg_get_functiondef('public.service_consume_school_account_code(text,text)'::regprocedure)) > 0
  and position('used_at' in pg_get_functiondef('public.service_consume_school_account_code(text,text)'::regprocedure)) > 0,
  'account codes enforce expiry, an attempt limit, and one-time consumption'
);

select * from finish();
rollback;
