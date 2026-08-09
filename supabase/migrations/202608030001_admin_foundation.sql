begin;

-- Phase 0 only establishes durable permission and paper-document records.
-- Existing role checks remain authoritative until the guarded grant RPCs and
-- scope-aware RLS helpers are introduced in a later phase.
create table public.staff_permission_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  bundle text not null check (bundle in (
    'teacher',
    'discipline',
    'executive_read_only',
    'data_manager',
    'admin'
  )),
  scope_type text not null check (scope_type in ('school', 'classrooms')),
  term_id bigint references public.academic_terms(id) on delete restrict,
  reason text not null check (nullif(btrim(reason), '') is not null),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  unique (id, term_id),
  check (
    (scope_type = 'school' and term_id is null)
    or (scope_type = 'classrooms' and term_id is not null)
  ),
  check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (
      revoked_at is not null
      and revoked_by is not null
      and nullif(btrim(revoke_reason), '') is not null
    )
  )
);

create table public.staff_permission_grant_classrooms (
  grant_id bigint not null,
  term_id bigint not null,
  classroom_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (grant_id, classroom_id),
  foreign key (grant_id, term_id)
    references public.staff_permission_grants(id, term_id) on delete restrict,
  foreign key (classroom_id, term_id)
    references public.classrooms(id, term_id) on delete restrict
);

create unique index staff_permission_grants_one_active_bundle_idx
  on public.staff_permission_grants(user_id, bundle)
  where revoked_at is null;
create index staff_permission_grants_user_history_idx
  on public.staff_permission_grants(user_id, granted_at desc);
create index staff_permission_grants_term_idx
  on public.staff_permission_grants(term_id)
  where term_id is not null;
create index staff_permission_grants_granted_by_idx
  on public.staff_permission_grants(granted_by)
  where granted_by is not null;
create index staff_permission_grants_revoked_by_idx
  on public.staff_permission_grants(revoked_by)
  where revoked_by is not null;
create index staff_permission_grant_classrooms_class_idx
  on public.staff_permission_grant_classrooms(classroom_id, term_id);

create or replace function private.guard_permission_grant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'staff_permission_grants is history-preserving; revoke the grant instead'
      using errcode = '55000';
  end if;

  if old.revoked_at is not null
    or new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.bundle is distinct from old.bundle
    or new.scope_type is distinct from old.scope_type
    or new.term_id is distinct from old.term_id
    or new.reason is distinct from old.reason
    or new.granted_by is distinct from old.granted_by
    or new.granted_at is distinct from old.granted_at
    or new.revoked_at is null
    or new.revoked_by is null
    or nullif(btrim(new.revoke_reason), '') is null
  then
    raise exception 'permission grants are immutable except for a complete revocation'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger staff_permission_grants_guard_change
before update or delete on public.staff_permission_grants
for each row execute function private.guard_permission_grant_change();

create trigger staff_permission_grant_classrooms_immutable
before update or delete on public.staff_permission_grant_classrooms
for each row execute function private.reject_immutable_change();

create sequence private.student_paper_document_code_seq;

create table public.student_paper_documents (
  id bigint generated always as identity primary key,
  document_code text not null unique,
  document_type text not null check (document_type in (
    'behavior_score_summary',
    'score_appeal_form',
    'appeal_decision_notice'
  )),
  student_id bigint not null references public.students(id) on delete restrict,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  incident_id bigint references public.incidents(id) on delete restrict,
  appeal_id bigint references public.appeals(id) on delete restrict,
  appeal_version smallint not null default 1 check (appeal_version > 0),
  status text not null default 'generated' check (status in (
    'generated',
    'printed',
    'received',
    'delivered',
    'delivery_failed',
    'voided'
  )),
  generated_by uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (document_type = 'behavior_score_summary' and incident_id is null and appeal_id is null)
    or (document_type = 'score_appeal_form' and incident_id is not null and appeal_id is null)
    or (document_type = 'appeal_decision_notice' and appeal_id is not null)
  )
);

create unique index student_paper_appeal_form_incident_idx
  on public.student_paper_documents(incident_id)
  where document_type = 'score_appeal_form';
create unique index student_paper_appeal_notice_version_idx
  on public.student_paper_documents(appeal_id, appeal_version)
  where document_type = 'appeal_decision_notice';
create index student_paper_documents_student_term_date_idx
  on public.student_paper_documents(student_id, term_id, generated_at desc);
create index student_paper_documents_term_idx
  on public.student_paper_documents(term_id);
create index student_paper_documents_incident_idx
  on public.student_paper_documents(incident_id)
  where incident_id is not null;
create index student_paper_documents_appeal_idx
  on public.student_paper_documents(appeal_id)
  where appeal_id is not null;
create index student_paper_documents_status_date_idx
  on public.student_paper_documents(status, generated_at desc);
create index student_paper_documents_generated_by_idx
  on public.student_paper_documents(generated_by)
  where generated_by is not null;

create table public.student_paper_document_events (
  id bigint generated always as identity primary key,
  document_id bigint not null references public.student_paper_documents(id) on delete restrict,
  event_type text not null check (event_type in (
    'generated',
    'printed',
    'received',
    'delivered',
    'delivery_failed',
    'voided',
    'paper_appeal_entered'
  )),
  actor_user_id uuid references auth.users(id) on delete set null,
  note text,
  occurred_at timestamptz not null default now()
);

create index student_paper_document_events_document_date_idx
  on public.student_paper_document_events(document_id, occurred_at desc);
create index student_paper_document_events_actor_date_idx
  on public.student_paper_document_events(actor_user_id, occurred_at desc)
  where actor_user_id is not null;

create or replace function private.assign_student_paper_document_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
begin
  if nullif(btrim(new.document_code), '') is not null then
    raise exception 'paper document codes are generated by the system'
      using errcode = '22023';
  end if;

  v_prefix := case new.document_type
    when 'behavior_score_summary' then 'BSS'
    when 'score_appeal_form' then 'APF'
    when 'appeal_decision_notice' then 'ADN'
    else 'DOC'
  end;
  new.document_code := format(
    '%s-%s-%s',
    v_prefix,
    to_char(clock_timestamp() at time zone 'Asia/Bangkok', 'YYYYMMDD'),
    lpad(nextval('private.student_paper_document_code_seq')::text, 8, '0')
  );
  return new;
end;
$$;

create or replace function private.log_student_paper_document_generated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.student_paper_document_events(
    document_id,
    event_type,
    actor_user_id,
    occurred_at
  ) values (
    new.id,
    'generated',
    new.generated_by,
    new.generated_at
  );
  return new;
end;
$$;

create trigger student_paper_documents_assign_code
before insert on public.student_paper_documents
for each row execute function private.assign_student_paper_document_code();

create trigger student_paper_documents_log_generated
after insert on public.student_paper_documents
for each row execute function private.log_student_paper_document_generated();

create trigger student_paper_documents_set_updated_at
before update on public.student_paper_documents
for each row execute function private.set_updated_at();

create trigger student_paper_documents_reject_delete
before delete on public.student_paper_documents
for each row execute function private.reject_immutable_change();

create trigger student_paper_document_events_immutable
before update or delete on public.student_paper_document_events
for each row execute function private.reject_immutable_change();

alter table public.staff_permission_grants enable row level security;
alter table public.staff_permission_grant_classrooms enable row level security;
alter table public.student_paper_documents enable row level security;
alter table public.student_paper_document_events enable row level security;

create policy staff_permission_grants_select
on public.staff_permission_grants
for select
to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy staff_permission_grant_classrooms_select
on public.staff_permission_grant_classrooms
for select
to authenticated
using (
  exists (
    select 1
    from public.staff_permission_grants permission_grant
    where permission_grant.id = staff_permission_grant_classrooms.grant_id
      and (
        permission_grant.user_id = (select auth.uid())
        or (select private.is_admin())
      )
  )
);

create policy student_paper_documents_staff_select
on public.student_paper_documents
for select
to authenticated
using (
  (select private.is_admin())
  or private.teacher_has_student(student_id, term_id)
);

create policy student_paper_document_events_staff_select
on public.student_paper_document_events
for select
to authenticated
using (
  exists (
    select 1
    from public.student_paper_documents document
    where document.id = student_paper_document_events.document_id
      and (
        (select private.is_admin())
        or private.teacher_has_student(document.student_id, document.term_id)
      )
  )
);

revoke all on table
  public.staff_permission_grants,
  public.staff_permission_grant_classrooms,
  public.student_paper_documents,
  public.student_paper_document_events
from public, anon, authenticated;

grant select on table
  public.staff_permission_grants,
  public.staff_permission_grant_classrooms,
  public.student_paper_documents,
  public.student_paper_document_events
to authenticated;

revoke all on function
  private.guard_permission_grant_change(),
  private.assign_student_paper_document_code(),
  private.log_student_paper_document_generated()
from public, anon, authenticated, service_role;

commit;
