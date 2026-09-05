begin;

-- Account codes are only a handoff into a forced personal-password change. A
-- password AMR alone is insufficient because the Edge Function deliberately
-- creates a temporary password-authenticated session after code verification.
alter table private.account_activations
  add column if not exists password_stage text not null default 'code_issued';

alter table private.account_activations
  drop constraint if exists account_activations_password_stage_check;
alter table private.account_activations
  add constraint account_activations_password_stage_check
  check (password_stage in (
    'code_issued',
    'awaiting_temporary_password',
    'temporary_password_set',
    'personal_password_set',
    'completed',
    'superseded'
  ));

create index if not exists account_activations_pending_stage_idx
  on private.account_activations(user_id, created_at desc)
  where password_stage not in ('completed', 'superseded');

-- Keep the requested recovery purpose durable even if Auth password
-- invalidation succeeds but code generation has to be retried.
create table if not exists private.account_code_intents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('activation', 'password-reset')),
  prepared_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.account_code_intents enable row level security;
alter table private.account_code_intents force row level security;
revoke all on table private.account_code_intents
from public, anon, authenticated, service_role;

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
  v_required_purpose text;
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

  select intent.purpose
  into v_required_purpose
  from private.account_code_intents intent
  where intent.user_id = p_user_id
  for update;

  if not found then
    select activation.purpose
    into v_required_purpose
    from private.account_activations activation
    where activation.user_id = p_user_id
      and activation.password_stage not in ('completed', 'superseded')
    order by activation.created_at desc, activation.id desc
    limit 1
    for update;
  end if;

  if v_required_purpose is not null and v_required_purpose <> p_purpose then
    raise exception 'Pending account-code purpose cannot be changed'
      using errcode = '55000';
  end if;

  update private.account_activations
  set used_at = coalesce(used_at, now()),
      password_stage = 'superseded'
  where user_id = p_user_id
    and password_stage not in ('completed', 'superseded');

  insert into private.account_activations(
    user_id, token_hash, expires_at, issued_by, purpose, password_stage
  ) values (
    p_user_id, decode(p_token_hash_hex, 'hex'), p_expires_at,
    p_actor_user_id, p_purpose, 'code_issued'
  )
  returning id into v_id;

  delete from private.account_code_intents where user_id = p_user_id;

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
  where activation.user_id = v_user_id
    and activation.used_at is null
    and activation.password_stage = 'code_issued'
  order by activation.created_at desc, activation.id desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  if v_activation.expires_at <= now() or v_activation.failed_attempts >= 10 then
    update private.account_activations
    set used_at = now(), password_stage = 'superseded'
    where id = v_activation.id;
    return jsonb_build_object('ok', false);
  end if;

  if v_activation.token_hash <> decode(p_token_hash_hex, 'hex') then
    update private.account_activations
    set failed_attempts = least(20, failed_attempts + 1),
        used_at = case when failed_attempts + 1 >= 10 then now() else used_at end,
        password_stage = case
          when failed_attempts + 1 >= 10 then 'superseded'
          else password_stage
        end
    where id = v_activation.id;
    return jsonb_build_object('ok', false);
  end if;

  update private.account_activations
  set used_at = now(),
      password_stage = 'awaiting_temporary_password'
  where id = v_activation.id;

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

-- Auth owns the password hash. Observing its server-side transitions lets the
-- database distinguish the Edge-created random password from the next password
-- selected by the account holder without trusting editable user metadata.
create or replace function private.track_school_account_password_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation_id bigint;
  v_previous_stage text;
  v_next_stage text;
begin
  if old.encrypted_password is not distinct from new.encrypted_password then
    return new;
  end if;

  select activation.id, activation.password_stage
  into v_activation_id, v_previous_stage
  from private.account_activations activation
  where activation.user_id = new.id
    and activation.password_stage in (
      'awaiting_temporary_password', 'temporary_password_set'
    )
    and exists (
      select 1
      from public.profiles profile
      where profile.user_id = new.id
        and profile.is_active
        and profile.activation_required
    )
  order by activation.created_at desc, activation.id desc
  limit 1
  for update;

  if not found then
    return new;
  end if;

  v_next_stage := case v_previous_stage
    when 'awaiting_temporary_password' then 'temporary_password_set'
    else 'personal_password_set'
  end;

  update private.account_activations
  set password_stage = v_next_stage
  where id = v_activation_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, after_state)
  values (
    null,
    'advance_school_account_password_stage',
    'profile',
    new.id::text,
    jsonb_build_object('from', v_previous_stage, 'to', v_next_stage)
  );

  return new;
end;
$$;

revoke all on function private.track_school_account_password_stage()
from public, anon, authenticated, service_role;

drop trigger if exists school_point_track_account_password_stage on auth.users;
create trigger school_point_track_account_password_stage
after update of encrypted_password on auth.users
for each row execute function private.track_school_account_password_stage();

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
  v_activation_id bigint;
  v_purpose text;
begin
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
    ) into v_has_password_amr;
  end if;
  if not v_has_password_amr then
    raise exception 'Fresh password authentication required'
      using errcode = '42501';
  end if;

  select activation.id, activation.purpose
  into v_activation_id, v_purpose
  from private.account_activations activation
  where activation.user_id = v_user_id
    and activation.password_stage = 'personal_password_set'
  order by activation.created_at desc, activation.id desc
  limit 1
  for update;

  if not found then
    raise exception 'Fresh personal password required'
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

  update private.account_activations
  set password_stage = 'completed'
  where id = v_activation_id
    and password_stage = 'personal_password_set';
  if not found then
    raise exception 'Account password state changed; retry'
      using errcode = '40001';
  end if;

  perform private.write_audit(
    'complete_first_password_activation',
    'profile',
    v_user_id::text,
    jsonb_build_object('activation_required', true),
    jsonb_build_object(
      'activation_required', false,
      'authentication_method', 'password',
      'purpose', v_purpose
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
  'Clears the account gate only after the database observes both the temporary-password and personal-password transitions plus a password-authenticated session.';

revoke all on function public.complete_first_password_activation()
from public, anon, authenticated, service_role;
grant execute on function public.complete_first_password_activation()
to authenticated;

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
    raise exception 'School username is invalid' using errcode = '22023';
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
    raise exception 'Active school account not found' using errcode = 'P0002';
  end if;

  -- Invalidate every prior handoff before the Edge Function replaces the old
  -- Auth password. This makes immediate recovery reissue safe and predictable.
  update private.account_activations
  set used_at = coalesce(used_at, now()),
      password_stage = 'superseded'
  where user_id = v_user_id
    and password_stage not in ('completed', 'superseded');

  insert into private.account_code_intents(
    user_id, purpose, prepared_by, created_at, updated_at
  ) values (
    v_user_id, 'password-reset', p_actor_user_id, now(), now()
  )
  on conflict (user_id) do update
  set purpose = excluded.purpose,
      prepared_by = excluded.prepared_by,
      updated_at = now();

  update public.profiles
  set activation_required = true
  where user_id = v_user_id
    and is_active
    and not activation_required;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, before_state, after_state
  ) values (
    p_actor_user_id,
    'prepare_school_account_password_reset',
    'profile',
    v_user_id::text,
    jsonb_build_object('activation_required', v_activation_required),
    jsonb_build_object(
      'activation_required', true,
      'already_pending', v_activation_required,
      'reason', v_reason,
      'username', v_username,
      'purpose', 'password-reset'
    )
  );

  return jsonb_build_object(
    'userId', v_user_id,
    'username', v_username,
    'alreadyPending', v_activation_required,
    'pendingPurpose', 'password-reset'
  );
end;
$$;

comment on function public.service_prepare_school_account_password_reset(uuid, text, text) is
  'Service-only, admin-authorized and repeatable recovery gate that invalidates prior handoffs, preserves reset purpose and audits the required reason before Auth password replacement.';

revoke all on function public.service_prepare_school_account_password_reset(uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.service_prepare_school_account_password_reset(uuid, text, text)
to service_role;

create or replace function public.service_get_activation_account(
  p_actor_user_id uuid,
  p_username text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'userId', profile.user_id,
    'username', identity.username,
    'active', profile.is_active,
    'activationRequired', profile.activation_required,
    'pendingPurpose', coalesce(
      (select intent.purpose
       from private.account_code_intents intent
       where intent.user_id = profile.user_id),
      (select activation.purpose
       from private.account_activations activation
       where activation.user_id = profile.user_id
         and activation.password_stage not in ('completed', 'superseded')
       order by activation.created_at desc, activation.id desc
       limit 1),
      'activation'
    )
  )
  into v_result
  from private.login_identities identity
  join public.profiles profile on profile.user_id = identity.user_id
  where identity.username_normalized = lower(btrim(p_username));

  if v_result is null then
    raise exception 'School account not found' using errcode = 'P0002';
  end if;
  if not (v_result ->> 'active')::boolean then
    raise exception 'School account is inactive' using errcode = '55000';
  end if;
  if not (v_result ->> 'activationRequired')::boolean then
    raise exception 'Account has already been activated' using errcode = '55000';
  end if;
  return v_result;
end;
$$;

revoke all on function public.service_get_activation_account(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.service_get_activation_account(uuid, text)
to service_role;

-- The vulnerable custom handoff first shipped on 2026-09-05. Re-arm only
-- accounts whose custom code was consumed after that release so any temporary
-- session is blocked immediately. The original purpose remains available for
-- a same-purpose reissue by an administrator.
with affected_accounts as materialized (
  select distinct profile.user_id
  from public.profiles profile
  join public.audit_logs audit
    on audit.entity_type = 'profile'
   and audit.entity_id = profile.user_id::text
   and audit.action = 'consume_school_account_code'
   and audit.created_at >= timestamptz '2026-09-05 02:00:00+00'
  where profile.is_active
    and not profile.activation_required
), rearmed_accounts as (
  update public.profiles profile
  set activation_required = true
  from affected_accounts affected
  where profile.user_id = affected.user_id
  returning profile.user_id
)
insert into public.audit_logs(
  actor_user_id, action, entity_type, entity_id, before_state, after_state
)
select
  null,
  'rearm_unsafe_password_handoff',
  'profile',
  rearmed.user_id::text,
  jsonb_build_object('activation_required', false),
  jsonb_build_object(
    'activation_required', true,
    'reason', 'temporary password handoff required personal-password verification'
  )
from rearmed_accounts rearmed;

revoke all on function public.service_issue_school_account_code(uuid, uuid, text, text, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.service_consume_school_account_code(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.service_issue_school_account_code(uuid, uuid, text, text, timestamptz)
to service_role;
grant execute on function public.service_consume_school_account_code(text, text)
to service_role;

commit;
