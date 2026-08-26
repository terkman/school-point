begin;

-- Appeal periods are measured from the incident itself, not the later time at
-- which staff record or approve it. Keep this in a forward-only migration so
-- deployed history receives the same correction as future incidents.
create or replace function private.incident_appeal_deadline(p_occurred_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select p_occurred_at + interval '7 days'
$$;

create or replace function private.set_incident_appeal_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.appeal_deadline := private.incident_appeal_deadline(new.occurred_at);
  return new;
end;
$$;

drop trigger if exists incidents_set_appeal_deadline on public.incidents;
create trigger incidents_set_appeal_deadline
before insert or update of occurred_at, appeal_deadline on public.incidents
for each row execute function private.set_incident_appeal_deadline();

alter table public.incidents
  drop constraint if exists incidents_appeal_deadline_check;

update public.incidents
set appeal_deadline = private.incident_appeal_deadline(occurred_at)
where appeal_deadline is distinct from private.incident_appeal_deadline(occurred_at);

alter table public.incidents
  add constraint incidents_appeal_deadline_from_occurred_check
  check (appeal_deadline = private.incident_appeal_deadline(occurred_at));

-- A monotonically increasing revision makes an import preview conditional on
-- the school data it was validated against. Statement triggers cover all
-- ordinary directory/import mutations, and the apply wrapper locks this row
-- before comparing the preview token and writing the batch.
create table if not exists private.import_source_revisions (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0)
);

insert into private.import_source_revisions(singleton, revision)
values (true, 0)
on conflict (singleton) do nothing;

create or replace function private.bump_import_source_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update private.import_source_revisions
  set revision = revision + 1
  where singleton;
  return null;
end;
$$;

create or replace function private.import_preview_token(
  p_payload_fingerprint text,
  p_revision bigint
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    sha256(convert_to(p_payload_fingerprint || ':' || p_revision::text, 'UTF8')),
    'hex'
  )
$$;

create or replace function private.require_current_import_preview_token(
  p_expected_preview_token text,
  p_payload_fingerprint text,
  p_revision bigint
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(lower(btrim(p_expected_preview_token)), '') is distinct from
     private.import_preview_token(p_payload_fingerprint, p_revision) then
    raise exception 'Import preview is stale; preview the file again before applying'
      using errcode = '40001';
  end if;
end;
$$;

drop trigger if exists import_revision_academic_terms on public.academic_terms;
create trigger import_revision_academic_terms
after insert or update or delete on public.academic_terms
for each statement execute function private.bump_import_source_revision();

drop trigger if exists import_revision_classrooms on public.classrooms;
create trigger import_revision_classrooms
after insert or update or delete on public.classrooms
for each statement execute function private.bump_import_source_revision();

drop trigger if exists import_revision_students on public.students;
create trigger import_revision_students
after insert or update or delete on public.students
for each statement execute function private.bump_import_source_revision();

drop trigger if exists import_revision_teachers on public.teachers;
create trigger import_revision_teachers
after insert or update or delete on public.teachers
for each statement execute function private.bump_import_source_revision();

drop trigger if exists import_revision_enrollments on public.enrollments;
create trigger import_revision_enrollments
after insert or update or delete on public.enrollments
for each statement execute function private.bump_import_source_revision();

drop trigger if exists import_revision_teacher_assignments on public.teacher_classroom_assignments;
create trigger import_revision_teacher_assignments
after insert or update or delete on public.teacher_classroom_assignments
for each statement execute function private.bump_import_source_revision();

drop trigger if exists import_revision_student_private_identities on private.student_private_identities;
create trigger import_revision_student_private_identities
after insert or update or delete on private.student_private_identities
for each statement execute function private.bump_import_source_revision();

drop trigger if exists import_revision_guardian_contacts on private.student_guardian_contacts;
create trigger import_revision_guardian_contacts
after insert or update or delete on private.student_guardian_contacts
for each statement execute function private.bump_import_source_revision();

-- Keep the existing three-argument RPC unchanged for a rolling deployment.
-- This versioned wrapper returns a token derived from the canonical payload
-- fingerprint and current revision; applies must return that token while the
-- revision row is locked.
create or replace function public.service_admin_import_school_data_v2(
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
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb) - 'previewToken';
  v_result jsonb;
  v_revision bigint;
  v_payload_fingerprint text;
  v_preview_token text;
  v_expected_preview_token text := nullif(lower(btrim(p_payload ->> 'previewToken')), '');
  v_batch_id bigint;
begin
  if not private.service_actor_is_admin(p_actor_user_id) then
    raise exception 'Administrator permission required'
      using errcode = '42501';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  v_payload_fingerprint := encode(
    sha256(convert_to((v_payload - 'fingerprint')::text, 'UTF8')),
    'hex'
  );

  if p_dry_run then
    v_result := public.admin_import_school_data(v_payload, true);
    select revision into v_revision
    from private.import_source_revisions
    where singleton;
  else
    -- This lock also serializes the statement triggers above. A directory
    -- change that commits between preview and apply either advances revision
    -- before this comparison or waits until the import completes.
    select revision into v_revision
    from private.import_source_revisions
    where singleton
    for update;
  end if;

  v_preview_token := private.import_preview_token(v_payload_fingerprint, v_revision);

  if not p_dry_run then
    perform private.require_current_import_preview_token(
      v_expected_preview_token,
      v_payload_fingerprint,
      v_revision
    );
    v_result := public.admin_import_school_data(v_payload, false);
  end if;

  select batch.id into v_batch_id
  from private.import_batches batch
  where batch.fingerprint = v_payload_fingerprint;

  perform set_config('request.jwt.claim.sub', coalesce(v_previous_subject, ''), true);
  return v_result || jsonb_build_object(
    'payloadFingerprint', v_payload_fingerprint,
    'serverFingerprint', v_preview_token,
    'previewToken', v_preview_token,
    'databaseRevision', v_revision,
    'batchId', v_batch_id
  );
exception
  when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_previous_subject, ''), true);
    raise;
end;
$$;

revoke all on function public.service_admin_import_school_data_v2(uuid, jsonb, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.service_admin_import_school_data_v2(uuid, jsonb, boolean)
to service_role;

comment on function public.service_admin_import_school_data_v2(uuid, jsonb, boolean) is
  'Service-only actor-aware import entry point. Previews are bound to the current relevant-data revision and applies lock and verify that revision before the idempotent batch write.';

commit;
