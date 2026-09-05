select plan(12);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'account_activations'
      and column_name = 'password_stage'
  ),
  'account activations track the server-observed password stage'
);

select ok(
  to_regclass('private.account_code_intents') is not null,
  'password-reset purpose survives a partial Edge Function failure'
);

select ok(
  not has_table_privilege('anon', 'private.account_code_intents', 'SELECT')
  and not has_table_privilege('authenticated', 'private.account_code_intents', 'SELECT')
  and not has_table_privilege('service_role', 'private.account_code_intents', 'SELECT'),
  'account-code intent state is not directly exposed'
);

select ok(
  to_regprocedure('private.track_school_account_password_stage()') is not null,
  'password-stage tracker exists'
);

select ok(
  exists (
    select 1
    from pg_trigger trigger_entry
    where trigger_entry.tgrelid = 'auth.users'::regclass
      and trigger_entry.tgname = 'school_point_track_account_password_stage'
      and not trigger_entry.tgisinternal
  ),
  'Auth password changes drive the protected state machine'
);

select ok(
  not has_function_privilege('anon', 'private.track_school_account_password_stage()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.track_school_account_password_stage()', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.track_school_account_password_stage()', 'EXECUTE'),
  'password-stage tracker cannot be called directly'
);

select ok(
  position(
    'personal_password_set'
    in pg_get_functiondef('public.complete_first_password_activation()'::regprocedure)
  ) > 0,
  'activation completion requires the server-observed personal-password stage'
);

select ok(
  position(
    'password_stage = ''awaiting_temporary_password'''
    in pg_get_functiondef('public.service_consume_school_account_code(text,text)'::regprocedure)
  ) > 0,
  'code consumption cannot mark the personal password as complete'
);

select ok(
  position(
    'pending account-code purpose cannot be changed'
    in lower(pg_get_functiondef('public.service_issue_school_account_code(uuid,uuid,text,text,timestamp with time zone)'::regprocedure))
  ) > 0,
  'reissue cannot silently switch a pending reset into a 24-hour activation code'
);

select ok(
  position(
    'on conflict (user_id) do update'
    in lower(pg_get_functiondef('public.service_prepare_school_account_password_reset(uuid,text,text)'::regprocedure))
  ) > 0
  and position(
    'account is already waiting for a one-time code'
    in lower(pg_get_functiondef('public.service_prepare_school_account_password_reset(uuid,text,text)'::regprocedure))
  ) = 0,
  'recovery preparation is safely repeatable while an earlier code is pending'
);

select ok(
  position(
    '''pendingPurpose'''
    in pg_get_functiondef('public.service_get_activation_account(uuid,text)'::regprocedure)
  ) > 0,
  'administrator reissue receives the preserved purpose'
);

select ok(
  has_function_privilege('authenticated', 'public.complete_first_password_activation()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.complete_first_password_activation()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.service_consume_school_account_code(text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.service_consume_school_account_code(text,text)', 'EXECUTE'),
  'public recovery entrypoints remain least-privilege'
);

select * from finish();
