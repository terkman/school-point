begin;

-- Supabase Auth may populate encrypted_password even when an admin creates a
-- passwordless user. The hash transition is therefore not proof that the user
-- has chosen and authenticated with a personal password.
drop trigger if exists school_point_clear_activation_after_password on auth.users;
drop function if exists private.clear_activation_after_first_password();

-- The service-role fallback had the same invalid encrypted_password assumption.
-- Activation is now completed only by the account holder after a password login.
drop function if exists public.admin_mark_account_activated(uuid);

create or replace function public.complete_first_password_activation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_jwt jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_amr jsonb;
  v_has_password_amr boolean := false;
  v_profile_is_active boolean;
  v_activation_required boolean;
begin
  -- Keep this explicit in addition to the EXECUTE grant. A definer function
  -- must not rely on the normal gated role helper, which intentionally returns
  -- NULL while activation_required is true.
  if v_user_id is null
     or coalesce((select auth.role()), '') <> 'authenticated' then
    raise exception 'Authenticated account required' using errcode = '42501';
  end if;

  select profile.is_active, profile.activation_required
  into v_profile_is_active, v_activation_required
  from public.profiles profile
  where profile.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if not v_profile_is_active then
    raise exception 'Inactive account cannot be activated' using errcode = '42501';
  end if;

  -- An already-completed retry is harmless and does not create another audit
  -- record. This also makes a client retry safe after a lost network response.
  if not v_activation_required then
    return jsonb_build_object(
      'ok', true,
      'activated', false,
      'alreadyActivated', true
    );
  end if;

  v_amr := v_jwt -> 'amr';
  if jsonb_typeof(v_amr) = 'array' then
    select exists (
      select 1
      from jsonb_array_elements(v_amr) as amr_entry(value)
      where amr_entry.value ->> 'method' = 'password'
    )
    into v_has_password_amr;
  end if;

  if not v_has_password_amr then
    raise exception 'Fresh password authentication required'
      using errcode = '42501';
  end if;

  update public.profiles
  set activation_required = false
  where user_id = v_user_id
    and is_active
    and activation_required;

  if not found then
    raise exception 'Account activation state changed; retry'
      using errcode = '40001';
  end if;

  perform private.write_audit(
    'complete_first_password_activation',
    'profile',
    v_user_id::text,
    jsonb_build_object('activation_required', true),
    jsonb_build_object(
      'activation_required', false,
      'authentication_method', 'password'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'activated', true,
    'alreadyActivated', false
  );
end;
$$;

comment on function public.complete_first_password_activation() is
  'Clears the first-login gate only for an active account authenticated with password AMR.';

revoke all on function public.complete_first_password_activation()
  from public, anon, authenticated, service_role;
grant execute on function public.complete_first_password_activation()
  to authenticated;

commit;
