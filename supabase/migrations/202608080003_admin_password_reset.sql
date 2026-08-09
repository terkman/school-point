begin;

-- The Edge Function uses this service-only RPC to arm the durable access gate
-- before it changes the Auth password. This fail-closed order means an old JWT
-- cannot continue reading school data while recovery is in progress.
create or replace function public.service_prepare_school_account_password_reset(
  p_actor_user_id uuid,
  p_username text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(pg_catalog.btrim(coalesce(p_username, '')));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_user_id uuid;
  v_activation_required boolean;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  if v_username = '' or pg_catalog.char_length(v_username) > 80 then
    raise exception 'School username is invalid'
      using errcode = '22023';
  end if;
  if pg_catalog.char_length(v_reason) < 5
     or pg_catalog.char_length(v_reason) > 500 then
    raise exception 'Password reset reason must contain 5 to 500 characters'
      using errcode = '22023';
  end if;

  select profile.user_id, profile.activation_required
  into v_user_id, v_activation_required
  from private.login_identities identity
  join public.profiles profile on profile.user_id = identity.user_id
  where identity.username_normalized = v_username
    and profile.is_active
  for update of profile;

  if not found then
    raise exception 'Active school account not found'
      using errcode = 'P0002';
  end if;
  if v_activation_required then
    raise exception 'Account is already waiting for a one-time code'
      using errcode = '55000';
  end if;

  update public.profiles
  set activation_required = true
  where user_id = v_user_id
    and is_active
    and not activation_required;

  if not found then
    raise exception 'Account recovery state changed; retry'
      using errcode = '40001';
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, before_state, after_state
  ) values (
    p_actor_user_id,
    'prepare_school_account_password_reset',
    'profile',
    v_user_id::text,
    jsonb_build_object('activation_required', false),
    jsonb_build_object(
      'activation_required', true,
      'reason', v_reason,
      'username', v_username
    )
  );

  return jsonb_build_object(
    'userId', v_user_id,
    'username', v_username
  );
end;
$$;

comment on function public.service_prepare_school_account_password_reset(uuid, text, text) is
  'Service-only, admin-authorized recovery gate that blocks school data access and audits the required reason before Auth password replacement.';

revoke all on function public.service_prepare_school_account_password_reset(uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.service_prepare_school_account_password_reset(uuid, text, text)
to service_role;

commit;
