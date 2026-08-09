-- Paper documents are a parallel access channel for students who cannot use a phone.
-- Every page belongs to one student and contains only student-visible information.

create sequence if not exists public.paper_document_number_seq;

create table if not exists public.paper_documents (
  id bigint generated always as identity primary key,
  document_number text not null unique default (
    'SP-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMMDD') || '-'
    || lpad(nextval('public.paper_document_number_seq')::text, 6, '0')
  ),
  document_type text not null check (document_type in (
    'behavior_score_summary', 'score_appeal_form', 'appeal_decision_notice'
  )),
  status text not null default 'generated' check (status in (
    'generated', 'printed', 'received', 'delivered', 'delivery_failed', 'voided'
  )),
  student_id bigint not null references public.students(id) on delete restrict,
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  incident_id bigint references public.incidents(id) on delete restrict,
  appeal_id bigint references public.appeals(id) on delete restrict,
  content_snapshot jsonb not null,
  issued_by uuid references auth.users(id) on delete set null,
  issued_by_snapshot text not null,
  issued_at timestamptz not null default now(),
  printed_at timestamptz,
  received_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (document_type = 'behavior_score_summary' and incident_id is null and appeal_id is null)
    or (document_type = 'score_appeal_form' and incident_id is not null and appeal_id is null)
    or (document_type = 'appeal_decision_notice' and incident_id is not null and appeal_id is not null)
  )
);

create table if not exists public.paper_document_events (
  id bigint generated always as identity primary key,
  document_id bigint not null references public.paper_documents(id) on delete restrict,
  event_type text not null check (event_type in (
    'generated', 'printed', 'received', 'delivered', 'delivery_failed', 'voided', 'paper_appeal_entered'
  )),
  note text check (note is null or char_length(note) <= 2000),
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_snapshot text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists paper_documents_student_term_idx
  on public.paper_documents (student_id, term_id, issued_at desc);
create index if not exists paper_documents_term_issued_idx
  on public.paper_documents (term_id, issued_at desc);
create index if not exists paper_documents_incident_idx
  on public.paper_documents (incident_id) where incident_id is not null;
create index if not exists paper_documents_appeal_idx
  on public.paper_documents (appeal_id) where appeal_id is not null;
create index if not exists paper_document_events_document_idx
  on public.paper_document_events (document_id, occurred_at desc);

alter table public.appeals
  add column if not exists submission_source text not null default 'student_portal';
alter table public.appeals
  add column if not exists source_document_id bigint references public.paper_documents(id) on delete restrict;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appeals_submission_source_check'
      and conrelid = 'public.appeals'::regclass
  ) then
    alter table public.appeals
      add constraint appeals_submission_source_check
      check (submission_source in ('student_portal', 'paper'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'appeals_paper_source_check'
      and conrelid = 'public.appeals'::regclass
  ) then
    alter table public.appeals
      add constraint appeals_paper_source_check
      check (
        (submission_source = 'paper' and source_document_id is not null)
        or (submission_source = 'student_portal' and source_document_id is null)
      );
  end if;
end
$$;

create unique index if not exists appeals_source_document_unique_idx
  on public.appeals (source_document_id) where source_document_id is not null;

alter table public.paper_documents enable row level security;
alter table public.paper_document_events enable row level security;

drop policy if exists paper_documents_select on public.paper_documents;
create policy paper_documents_select on public.paper_documents
for select to authenticated
using (
  (select private.is_admin())
  or private.teacher_has_student(student_id, term_id)
);

drop policy if exists paper_document_events_select on public.paper_document_events;
create policy paper_document_events_select on public.paper_document_events
for select to authenticated
using (
  exists (
    select 1 from public.paper_documents document
    where document.id = paper_document_events.document_id
      and ((select private.is_admin()) or private.teacher_has_student(document.student_id, document.term_id))
  )
);

drop policy if exists password_session_required on public.paper_documents;
create policy password_session_required on public.paper_documents
as restrictive for all to authenticated
using ((select private.has_password_session()))
with check ((select private.has_password_session()));

drop policy if exists password_session_required on public.paper_document_events;
create policy password_session_required on public.paper_document_events
as restrictive for all to authenticated
using ((select private.has_password_session()))
with check ((select private.has_password_session()));

create or replace function private.paper_document_payload(p_document_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', document.id,
    'documentNumber', document.document_number,
    'documentType', document.document_type,
    'status', document.status,
    'studentId', document.student_id,
    'termId', document.term_id,
    'incidentId', document.incident_id,
    'appealId', document.appeal_id,
    'issuedAt', document.issued_at,
    'snapshot', document.content_snapshot
  )
  from public.paper_documents document
  where document.id = p_document_id
$$;

revoke all on function private.paper_document_payload(bigint) from public, anon, authenticated, service_role;

create or replace function private.build_paper_document_snapshot(
  p_student_id bigint,
  p_term_id bigint,
  p_incident_id bigint default null,
  p_appeal_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  select jsonb_build_object(
    'student', jsonb_build_object(
      'id', student.id,
      'code', student.student_code,
      'name', concat_ws(' ', nullif(student.title, ''), student.given_name, student.family_name),
      'classroomName', classroom.display_name,
      'gradeLevel', classroom.grade_level,
      'roomNumber', classroom.room_number
    ),
    'term', jsonb_build_object(
      'id', term.id,
      'schoolYear', term.school_year,
      'semester', term.semester,
      'name', term.name
    ),
    'score', coalesce(account.balance, 100),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ledger.id,
        'occurredAt', coalesce(incident.occurred_at, ledger.created_at),
        'reason', ledger.reason,
        'appliedDelta', ledger.applied_delta,
        'scoreBefore', ledger.balance_before,
        'scoreAfter', ledger.balance_after
      ) order by ledger.created_at desc, ledger.id desc)
      from public.score_ledger ledger
      left join public.incidents incident on incident.id = ledger.incident_id
      where ledger.student_id = p_student_id and ledger.term_id = p_term_id
    ), '[]'::jsonb),
    'incident', case when p_incident_id is null then null else (
      select jsonb_build_object(
        'id', incident.id,
        'occurredAt', incident.occurred_at,
        'reason', coalesce(
          nullif(incident.rule_snapshot ->> 'title_th', ''),
          nullif(incident.rule_snapshot ->> 'title', ''),
          'รายการตัดคะแนน'
        ),
        'appliedPoints', incident.applied_points,
        'appealDeadline', incident.appeal_deadline
      )
      from public.incidents incident
      where incident.id = p_incident_id
        and incident.student_id = p_student_id
        and incident.term_id = p_term_id
    ) end,
    'appeal', case when p_appeal_id is null then null else (
      select jsonb_build_object(
        'id', appeal.id,
        'incidentId', appeal.incident_id,
        'status', appeal.status,
        'statement', appeal.reason,
        'restoredPoints', coalesce(appeal.restored_points, 0),
        'publicExplanation', appeal.public_explanation,
        'createdAt', appeal.created_at,
        'decidedAt', appeal.decided_at
      )
      from public.appeals appeal
      where appeal.id = p_appeal_id and appeal.student_id = p_student_id
    ) end
  ) into v_snapshot
  from public.students student
  join public.enrollments enrollment
    on enrollment.student_id = student.id and enrollment.term_id = p_term_id and enrollment.is_active
  join public.classrooms classroom
    on classroom.id = enrollment.classroom_id and classroom.term_id = enrollment.term_id
  join public.academic_terms term on term.id = enrollment.term_id
  left join public.score_accounts account
    on account.student_id = student.id and account.term_id = term.id
  where student.id = p_student_id;

  if v_snapshot is null then
    raise exception 'Student is not enrolled in this term' using errcode = 'P0002';
  end if;
  if p_incident_id is not null and v_snapshot -> 'incident' = 'null'::jsonb then
    raise exception 'Incident does not belong to the selected student and term' using errcode = 'P0002';
  end if;
  if p_appeal_id is not null and v_snapshot -> 'appeal' = 'null'::jsonb then
    raise exception 'Appeal does not belong to the selected student' using errcode = 'P0002';
  end if;
  return v_snapshot;
end;
$$;

revoke all on function private.build_paper_document_snapshot(bigint,bigint,bigint,bigint)
from public, anon, authenticated, service_role;

create or replace function public.issue_paper_document_v1(
  p_document_type text,
  p_student_id bigint,
  p_term_id bigint,
  p_incident_id bigint default null,
  p_appeal_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_type text := lower(btrim(coalesce(p_document_type, '')));
  v_incident_id bigint := p_incident_id;
  v_document_id bigint;
  v_snapshot jsonb;
begin
  if v_uid is null or not ((select private.is_admin()) or private.teacher_has_student(p_student_id, p_term_id)) then
    raise exception 'Paper document permission required' using errcode = '42501';
  end if;
  if v_type not in ('behavior_score_summary', 'score_appeal_form', 'appeal_decision_notice') then
    raise exception 'Unsupported paper document type' using errcode = '22023';
  end if;

  if v_type = 'behavior_score_summary' then
    if p_incident_id is not null or p_appeal_id is not null then
      raise exception 'Score summary cannot be linked to an incident or appeal' using errcode = '22023';
    end if;
  elsif v_type = 'score_appeal_form' then
    if p_incident_id is null or p_appeal_id is not null then
      raise exception 'Appeal form requires one incident' using errcode = '22023';
    end if;
  else
    if p_appeal_id is null then
      raise exception 'Decision notice requires one appeal' using errcode = '22023';
    end if;
    select appeal.incident_id into v_incident_id
    from public.appeals appeal
    where appeal.id = p_appeal_id and appeal.student_id = p_student_id
      and appeal.status in ('accepted', 'rejected');
    if not found then
      raise exception 'A decided appeal is required for the notice' using errcode = 'P0002';
    end if;
  end if;

  v_snapshot := private.build_paper_document_snapshot(
    p_student_id, p_term_id, v_incident_id, p_appeal_id
  );

  insert into public.paper_documents(
    document_type, student_id, term_id, incident_id, appeal_id,
    content_snapshot, issued_by, issued_by_snapshot
  ) values (
    v_type, p_student_id, p_term_id, v_incident_id, p_appeal_id,
    v_snapshot, v_uid, private.actor_snapshot(v_uid)
  ) returning id into v_document_id;

  insert into public.paper_document_events(
    document_id, event_type, actor_user_id, actor_snapshot
  ) values (
    v_document_id, 'generated', v_uid, private.actor_snapshot(v_uid)
  );

  perform private.write_audit(
    'issue_paper_document_v1', 'paper_document', v_document_id::text, null,
    jsonb_build_object(
      'document_type', v_type, 'student_id', p_student_id,
      'term_id', p_term_id, 'incident_id', v_incident_id, 'appeal_id', p_appeal_id
    )
  );
  return private.paper_document_payload(v_document_id);
end;
$$;

create or replace function public.list_paper_documents_v1(p_term_id bigint)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return query
  select private.paper_document_payload(document.id)
  from public.paper_documents document
  where document.term_id = p_term_id
    and ((select private.is_admin()) or private.teacher_has_student(document.student_id, document.term_id))
  order by document.issued_at desc, document.id desc
  limit 100;
end;
$$;

create or replace function public.record_paper_document_event_v1(
  p_document_id bigint,
  p_event_type text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_document public.paper_documents%rowtype;
  v_event text := lower(btrim(coalesce(p_event_type, '')));
  v_note text := nullif(btrim(p_note), '');
  v_next_status text;
begin
  select document.* into v_document
  from public.paper_documents document
  where document.id = p_document_id
  for update;
  if not found then raise exception 'Paper document not found' using errcode = 'P0002'; end if;
  if v_uid is null or not ((select private.is_admin()) or private.teacher_has_student(v_document.student_id, v_document.term_id)) then
    raise exception 'Paper document permission required' using errcode = '42501';
  end if;
  if char_length(coalesce(v_note, '')) > 2000 then
    raise exception 'Document event note is too long' using errcode = '22023';
  end if;

  v_next_status := case v_event
    when 'printed' then 'printed'
    when 'received' then 'received'
    when 'delivered' then 'delivered'
    when 'delivery_failed' then 'delivery_failed'
    when 'voided' then 'voided'
    else null
  end;
  if v_next_status is null then
    raise exception 'Unsupported document event' using errcode = '22023';
  end if;
  if v_document.status = 'voided' then
    raise exception 'Voided document cannot be updated' using errcode = '55000';
  end if;
  if v_event = 'received' and (v_document.document_type <> 'score_appeal_form' or v_document.status not in ('printed', 'received')) then
    raise exception 'Only a printed appeal form can be received' using errcode = '55000';
  end if;
  if v_event in ('delivered', 'delivery_failed') and (
    v_document.document_type <> 'appeal_decision_notice'
    or v_document.status not in ('printed', 'delivered', 'delivery_failed')
  ) then
    raise exception 'Only a printed decision notice can be delivered' using errcode = '55000';
  end if;

  update public.paper_documents
  set status = v_next_status,
      printed_at = case when v_event = 'printed' then coalesce(printed_at, now()) else printed_at end,
      received_at = case when v_event = 'received' then coalesce(received_at, now()) else received_at end,
      delivered_at = case when v_event = 'delivered' then now() else delivered_at end,
      updated_at = now()
  where id = v_document.id;

  insert into public.paper_document_events(
    document_id, event_type, note, actor_user_id, actor_snapshot
  ) values (
    v_document.id, v_event, v_note, v_uid, private.actor_snapshot(v_uid)
  );
  perform private.write_audit(
    'record_paper_document_event_v1', 'paper_document', v_document.id::text,
    jsonb_build_object('status', v_document.status),
    jsonb_build_object('status', v_next_status, 'event_type', v_event, 'note', v_note)
  );
  return private.paper_document_payload(v_document.id);
end;
$$;

create or replace function public.submit_paper_appeal_v1(
  p_document_id bigint,
  p_reason text,
  p_received_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_document public.paper_documents%rowtype;
  v_incident public.incidents%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_appeal_id bigint;
begin
  if v_uid is null or not (select private.is_admin()) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if char_length(coalesce(v_reason, '')) < 5 or char_length(v_reason) > 2000 then
    raise exception 'Paper appeal reason must contain 5 to 2000 characters' using errcode = '22023';
  end if;
  if p_received_at is null or p_received_at > now() then
    raise exception 'A valid received time is required' using errcode = '22023';
  end if;

  select document.* into v_document
  from public.paper_documents document
  where document.id = p_document_id
  for update;
  if not found or v_document.document_type <> 'score_appeal_form' then
    raise exception 'Paper appeal form not found' using errcode = 'P0002';
  end if;
  if v_document.status not in ('printed', 'received') then
    raise exception 'The appeal form must be printed before intake' using errcode = '55000';
  end if;

  select incident.* into v_incident
  from public.incidents incident
  where incident.id = v_document.incident_id
  for update;
  if not found or v_incident.is_voided or p_received_at > v_incident.appeal_deadline then
    raise exception 'Appeal period expired or incident corrected' using errcode = '22023';
  end if;
  if exists (select 1 from public.appeals appeal where appeal.incident_id = v_incident.id) then
    raise exception 'An appeal already exists for this incident' using errcode = '23505';
  end if;

  insert into public.appeals(
    incident_id, student_id, reason, submission_source, source_document_id, created_at
  ) values (
    v_incident.id, v_incident.student_id, v_reason, 'paper', v_document.id, p_received_at
  ) returning id into v_appeal_id;

  update public.paper_documents
  set status = 'received', received_at = coalesce(received_at, p_received_at), updated_at = now()
  where id = v_document.id;

  if not exists (
    select 1 from public.paper_document_events event
    where event.document_id = v_document.id and event.event_type = 'received'
  ) then
    insert into public.paper_document_events(
      document_id, event_type, note, actor_user_id, actor_snapshot, occurred_at
    ) values (
      v_document.id, 'received', 'รับแบบฟอร์มอุทธรณ์กลับ', v_uid, private.actor_snapshot(v_uid), p_received_at
    );
  end if;
  insert into public.paper_document_events(
    document_id, event_type, metadata, actor_user_id, actor_snapshot
  ) values (
    v_document.id, 'paper_appeal_entered', jsonb_build_object('appeal_id', v_appeal_id),
    v_uid, private.actor_snapshot(v_uid)
  );

  perform private.write_audit(
    'submit_paper_appeal_v1', 'appeal', v_appeal_id::text, null,
    jsonb_build_object(
      'incident_id', v_incident.id, 'student_id', v_incident.student_id,
      'submission_source', 'paper', 'source_document_id', v_document.id,
      'received_at', p_received_at
    )
  );
  return jsonb_build_object('ok', true, 'appealId', v_appeal_id, 'documentId', v_document.id);
end;
$$;

revoke all on table public.paper_documents from public, anon, authenticated, service_role;
revoke all on table public.paper_document_events from public, anon, authenticated, service_role;
grant select on table public.paper_documents to authenticated;
grant select on table public.paper_document_events to authenticated;

revoke all on function public.issue_paper_document_v1(text,bigint,bigint,bigint,bigint)
from public, anon, authenticated, service_role;
grant execute on function public.issue_paper_document_v1(text,bigint,bigint,bigint,bigint)
to authenticated;
revoke all on function public.list_paper_documents_v1(bigint)
from public, anon, authenticated, service_role;
grant execute on function public.list_paper_documents_v1(bigint)
to authenticated;
revoke all on function public.record_paper_document_event_v1(bigint,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.record_paper_document_event_v1(bigint,text,text)
to authenticated;
revoke all on function public.submit_paper_appeal_v1(bigint,text,timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.submit_paper_appeal_v1(bigint,text,timestamptz)
to authenticated;
