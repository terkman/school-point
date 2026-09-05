begin;

alter table private.account_activations
  add column if not exists purpose text not null default 'activation';

alter table private.account_activations
  drop constraint if exists account_activations_purpose_check;
alter table private.account_activations
  add constraint account_activations_purpose_check
  check (purpose in ('activation', 'password-reset'));

create index if not exists account_activations_open_lookup_idx
  on private.account_activations(user_id, created_at desc)
  where used_at is null;

create or replace function public.service_issue_school_account_code(
  p_actor_user_id uuid,
  p_user_id uuid,
  p_token_hash_hex text,
  p_purpose text,
  p_expires_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_max_expiry interval;
begin
  if p_actor_user_id is not null and not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_purpose not in ('activation', 'password-reset') then
    raise exception 'Invalid account-code purpose' using errcode = '22023';
  end if;
  if p_token_hash_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid account-code digest' using errcode = '22023';
  end if;
  v_max_expiry := case when p_purpose = 'activation' then interval '24 hours 5 minutes' else interval '1 hour 5 minutes' end;
  if p_expires_at <= now() or p_expires_at > now() + v_max_expiry then
    raise exception 'Invalid account-code expiry' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.user_id = p_user_id and profile.is_active and profile.activation_required
  ) then
    raise exception 'Account is not eligible for a one-time code' using errcode = '55000';
  end if;

  update private.account_activations
  set used_at = now()
  where user_id = p_user_id and used_at is null;

  insert into private.account_activations(user_id, token_hash, expires_at, issued_by, purpose)
  values (p_user_id, decode(p_token_hash_hex, 'hex'), p_expires_at, p_actor_user_id, p_purpose)
  returning id into v_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, after_state)
  values (
    p_actor_user_id,
    'issue_school_account_code',
    'profile',
    p_user_id::text,
    jsonb_build_object('purpose', p_purpose, 'expiresAt', p_expires_at)
  );
  return v_id;
end;
$$;

create or replace function public.service_consume_school_account_code(
  p_username text,
  p_token_hash_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_username text;
  v_activation private.account_activations%rowtype;
begin
  if p_token_hash_hex !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false);
  end if;

  select identity.user_id, identity.username
  into v_user_id, v_username
  from private.login_identities identity
  join public.profiles profile on profile.user_id = identity.user_id
  where identity.username_normalized = lower(btrim(p_username))
    and profile.is_active
    and profile.activation_required;

  if v_user_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select activation.*
  into v_activation
  from private.account_activations activation
  where activation.user_id = v_user_id and activation.used_at is null
  order by activation.created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  if v_activation.expires_at <= now() or v_activation.failed_attempts >= 10 then
    update private.account_activations set used_at = now() where id = v_activation.id;
    return jsonb_build_object('ok', false);
  end if;

  if v_activation.token_hash <> decode(p_token_hash_hex, 'hex') then
    update private.account_activations
    set failed_attempts = least(20, failed_attempts + 1),
        used_at = case when failed_attempts + 1 >= 10 then now() else used_at end
    where id = v_activation.id;
    return jsonb_build_object('ok', false);
  end if;

  update private.account_activations set used_at = now() where id = v_activation.id;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, after_state)
  values (
    null,
    'consume_school_account_code',
    'profile',
    v_user_id::text,
    jsonb_build_object('purpose', v_activation.purpose)
  );
  return jsonb_build_object(
    'ok', true,
    'userId', v_user_id,
    'username', v_username,
    'purpose', v_activation.purpose
  );
end;
$$;

revoke all on function public.service_issue_school_account_code(uuid, uuid, text, text, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.service_consume_school_account_code(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.service_issue_school_account_code(uuid, uuid, text, text, timestamptz)
to service_role;
grant execute on function public.service_consume_school_account_code(text, text)
to service_role;

commit;
