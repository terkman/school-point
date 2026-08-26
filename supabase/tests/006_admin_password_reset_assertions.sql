select plan(1);

do $$
declare
  v_signature regprocedure := to_regprocedure(
    'public.service_prepare_school_account_password_reset(uuid,text,text)'
  );
  v_definition text;
  v_security_definer boolean;
  v_config text[];
begin
  if v_signature is null then
    raise exception 'admin password-reset preparation RPC is missing';
  end if;
  if has_function_privilege('anon', v_signature, 'EXECUTE')
     or has_function_privilege('authenticated', v_signature, 'EXECUTE')
     or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
    raise exception 'admin password-reset RPC privileges are not least-privilege';
  end if;

  select pg_get_functiondef(v_signature), procedure.prosecdef, procedure.proconfig
  into v_definition, v_security_definer, v_config
  from pg_proc procedure
  where procedure.oid = v_signature;

  if not v_security_definer
     or not ('search_path=""' = any(coalesce(v_config, array[]::text[]))) then
    raise exception 'admin password-reset RPC must be SECURITY DEFINER with empty search_path';
  end if;
  if position('private.service_actor_is_admin' in lower(v_definition)) = 0
     or position('for update of profile' in lower(v_definition)) = 0
     or position('activation_required = true' in lower(v_definition)) = 0
     or position('audit_logs' in lower(v_definition)) = 0
     or position('char_length(v_reason) < 5' in lower(v_definition)) = 0 then
    raise exception 'admin password-reset RPC is missing authorization, locking, durable gating, audit, or reason validation';
  end if;
end;
$$;

select pass('admin password reset assertions completed');
select * from finish();
