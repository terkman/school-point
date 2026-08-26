begin;

-- Keep the established snapshot implementation, but put a NULL-safe guard in
-- front of it. SQL's three-valued logic made `NULL NOT IN (...)` evaluate to
-- NULL, so the original guard could fall through for an unauthorised session.
alter function public.school_directory_snapshot() set schema private;

revoke all on function private.school_directory_snapshot()
from public, anon, authenticated, service_role;

create or replace function public.school_directory_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := private.current_role()::text;
begin
  if coalesce(v_role, '') not in ('admin', 'director') then
    raise exception 'Administrator or director permission required'
      using errcode = '42501';
  end if;

  return private.school_directory_snapshot();
end;
$$;

revoke all on function public.school_directory_snapshot()
from public, anon, authenticated, service_role;
grant execute on function public.school_directory_snapshot() to authenticated;

comment on function public.school_directory_snapshot() is
  'NULL-safe authenticated admin/director wrapper around the private directory snapshot implementation.';

-- Permission tables were added after the shared password-session migration.
-- Restrictive SELECT policies make the password AMR check an AND-condition on
-- their existing owner/admin policies.
drop policy if exists password_session_required
on public.staff_permission_grants;
create policy password_session_required
on public.staff_permission_grants
as restrictive
for select
to authenticated
using ((select private.has_password_session()));

drop policy if exists password_session_required
on public.staff_permission_grant_classrooms;
create policy password_session_required
on public.staff_permission_grant_classrooms
as restrictive
for select
to authenticated
using ((select private.has_password_session()));

-- The legacy two-argument RPCs remain service-role callable for existing CLI
-- automation. Edge Functions use these actor-aware wrappers instead. The actor
-- parameter is supplied only from the Auth-verified user and is revalidated
-- against the current active administrator profile before any legacy work runs.
-- Setting the transaction-local Auth subject lets the unchanged import and
-- account-link implementations write the human actor through their existing
-- auth.uid()-based import_batches and audit_logs paths.
create or replace function public.service_admin_import_school_data(
  p_actor_user_id uuid,
  p_payload jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_subject text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  v_result := public.admin_import_school_data(p_payload, p_dry_run);
  perform set_config('request.jwt.claim.sub', coalesce(v_previous_subject, ''), true);
  return v_result;
exception
  when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_previous_subject, ''), true);
    raise;
end;
$$;

create or replace function public.service_admin_link_provisioned_account(
  p_actor_user_id uuid,
  p_username text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_subject text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  v_result := public.admin_link_provisioned_account(p_username, p_user_id);
  perform set_config('request.jwt.claim.sub', coalesce(v_previous_subject, ''), true);
  return v_result;
exception
  when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_previous_subject, ''), true);
    raise;
end;
$$;

revoke all on function public.service_admin_import_school_data(uuid, jsonb, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.service_admin_link_provisioned_account(uuid, text, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.service_admin_import_school_data(uuid, jsonb, boolean)
to service_role;
grant execute on function public.service_admin_link_provisioned_account(uuid, text, uuid)
to service_role;

comment on function public.service_admin_import_school_data(uuid, jsonb, boolean) is
  'Service-only actor-aware import entry point. The supplied actor must be a current active administrator.';
comment on function public.service_admin_link_provisioned_account(uuid, text, uuid) is
  'Service-only actor-aware account-link entry point. The supplied actor must be a current active administrator.';

commit;
