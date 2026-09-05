begin;

-- Explicit, term-scoped operational grant. This never changes profiles.role.
alter table public.staff_permission_grants drop constraint if exists staff_permission_grants_bundle_check;
alter table public.staff_permission_grants add constraint staff_permission_grants_bundle_check
  check (bundle in ('teacher','discipline','executive_read_only','data_manager','admin','score_all_classrooms'));

create or replace function private.can_score_student(p_student_id bigint, p_term_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.teacher_has_student(p_student_id, p_term_id);
$$;

drop policy if exists classrooms_score_all_select on public.classrooms;
create policy classrooms_score_all_select
on public.classrooms
for select
to authenticated
using (
  (select private.current_role()) = 'teacher'::public.app_role
  and exists (
    select 1 from public.staff_permission_grants permission_grant
    where permission_grant.user_id = (select auth.uid())
      and permission_grant.bundle = 'score_all_classrooms'
      and permission_grant.term_id = classrooms.term_id
      and permission_grant.revoked_at is null
  )
);

-- Existing scoring RPCs all use this helper, so the grant applies consistently
-- to single, bulk, deduction-request, and addition-request paths.
create or replace function private.teacher_has_student(p_student_id bigint, p_term_id bigint default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.has_password_session()) and exists (
    select 1
    from public.teachers teacher
    join public.profiles profile
      on profile.user_id = teacher.user_id
     and profile.role = 'teacher'::public.app_role
     and profile.is_active
     and not profile.activation_required
    where teacher.user_id = (select auth.uid())
      and teacher.status = 'active'
      and teacher.intended_role = 'teacher'::public.app_role
      and (
        exists (
          select 1
          from public.teacher_classroom_assignments assignment
          join public.enrollments enrollment
            on enrollment.classroom_id = assignment.classroom_id
           and enrollment.term_id = assignment.term_id
           and enrollment.is_active
          join public.academic_terms term
            on term.id = enrollment.term_id
           and term.status = 'active'
          where assignment.teacher_id = teacher.id
            and assignment.is_active
            and enrollment.student_id = p_student_id
            and (p_term_id is null or enrollment.term_id = p_term_id)
        )
        or exists (
          select 1
          from public.staff_permission_grants permission_grant
          join public.enrollments enrollment
            on enrollment.term_id = permission_grant.term_id
           and enrollment.is_active
          join public.academic_terms term
            on term.id = enrollment.term_id
           and term.status = 'active'
          where permission_grant.user_id = teacher.user_id
            and permission_grant.bundle = 'score_all_classrooms'
            and permission_grant.scope_type = 'classrooms'
            and permission_grant.revoked_at is null
            and enrollment.student_id = p_student_id
            and (p_term_id is null or enrollment.term_id = p_term_id)
        )
      )
  );
$$;

create or replace function public.admin_set_score_all_classrooms_grant(p_user_id uuid, p_term_id bigint, p_reason text)
returns bigint language plpgsql security definer set search_path='' as $$ declare v bigint;
begin if not private.is_admin() then raise exception 'Administrator permission required' using errcode='42501'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'Grant reason required' using errcode='22023'; end if;
 if not exists (select 1 from public.teachers t join public.profiles p on p.user_id=t.user_id
   join public.teacher_classroom_assignments a on a.teacher_id=t.id and a.term_id=p_term_id and a.is_active and a.subject_name='ประจำชั้น'
   where t.user_id=p_user_id and t.status='active' and p.role='teacher'::public.app_role and p.is_active and not p.activation_required)
 then raise exception 'Active homeroom teacher required' using errcode='22023'; end if;
 update public.staff_permission_grants set revoked_by=(select auth.uid()),revoked_at=now(),revoke_reason='แทนที่สิทธิ์เดิมเมื่อเริ่มภาคเรียนใหม่'
 where user_id=p_user_id and bundle='score_all_classrooms' and revoked_at is null;
 insert into public.staff_permission_grants(user_id,bundle,scope_type,term_id,reason,granted_by)
 values(p_user_id,'score_all_classrooms','classrooms',p_term_id,btrim(p_reason),(select auth.uid())) returning id into v; return v; end $$;
create or replace function public.admin_revoke_score_all_classrooms_grant(p_grant_id bigint, p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() then raise exception 'Administrator permission required' using errcode='42501'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'Revoke reason required' using errcode='22023'; end if;
 update public.staff_permission_grants set revoked_by=(select auth.uid()),revoked_at=now(),revoke_reason=btrim(p_reason)
 where id=p_grant_id and bundle='score_all_classrooms' and revoked_at is null;
 if not found then raise exception 'Active score grant not found' using errcode='P0002'; end if; end $$;
revoke all on function public.admin_set_score_all_classrooms_grant(uuid,bigint,text),public.admin_revoke_score_all_classrooms_grant(bigint,text) from public,anon;
grant execute on function public.admin_set_score_all_classrooms_grant(uuid,bigint,text),public.admin_revoke_score_all_classrooms_grant(bigint,text) to authenticated;
revoke all on function private.can_score_student(bigint,bigint) from public, anon, authenticated;
grant execute on function private.can_score_student(bigint,bigint) to authenticated;

create table public.teacher_rule_proposals (
  id bigint generated always as identity primary key,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('deduction','positive')),
  title_th text not null check (char_length(btrim(title_th)) between 3 and 300),
  description_th text,
  points smallint not null check (points between 1 and 100),
  is_discretionary boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index teacher_rule_proposals_author_history_idx
  on public.teacher_rule_proposals(proposed_by, created_at desc);
create index teacher_rule_proposals_pending_idx
  on public.teacher_rule_proposals(created_at desc)
  where status = 'pending';
alter table public.teacher_rule_proposals enable row level security;
alter table public.teacher_rule_proposals force row level security;
create policy teacher_rule_proposals_select on public.teacher_rule_proposals for select to authenticated
  using (((select private.current_role()) = 'teacher'::public.app_role and proposed_by = (select auth.uid())) or private.is_admin());
revoke all on table public.teacher_rule_proposals from public, anon, authenticated;
grant select on public.teacher_rule_proposals to authenticated;

create or replace function public.teacher_propose_rule(p_kind text, p_title text, p_points smallint,
  p_description text default null, p_is_discretionary boolean default false) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_role public.app_role := private.current_role();
begin
  if v_role is distinct from 'teacher'::public.app_role then raise exception 'Teacher permission required' using errcode='42501'; end if;
  if p_kind not in ('deduction','positive') then raise exception 'Invalid rule kind' using errcode='22023'; end if;
  insert into public.teacher_rule_proposals(proposed_by,kind,title_th,description_th,points,is_discretionary)
  values ((select auth.uid()),p_kind,btrim(p_title),nullif(btrim(p_description),''),p_points,coalesce(p_is_discretionary,false)) returning id into v_id;
  perform private.write_audit('teacher_propose_rule','teacher_rule_proposal',v_id::text,null,null);
  return v_id;
end; $$;
revoke all on function public.teacher_propose_rule(text,text,smallint,text,boolean) from public,anon;
grant execute on function public.teacher_propose_rule(text,text,smallint,text,boolean) to authenticated;

-- Admin review publishes through the existing audited catalog RPCs.
create or replace function public.admin_review_teacher_rule(p_proposal_id bigint, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.teacher_rule_proposals%rowtype; v_result jsonb;
begin
  if not private.is_admin() then raise exception 'Administrator permission required' using errcode='42501'; end if;
  select * into v from public.teacher_rule_proposals where id=p_proposal_id and status='pending' for update;
  if not found then raise exception 'Pending proposal not found' using errcode='P0002'; end if;
  if not p_approve and nullif(btrim(p_note),'') is null then
    raise exception 'Rejection note required' using errcode='22023';
  end if;
  if p_approve then
    if v.kind='deduction' then v_result := public.admin_create_behavior_rule(v.title_th,v.points,v.description_th);
    else v_result := public.admin_create_positive_rule(v.title_th,v.points,v.is_discretionary,v.description_th); end if;
  end if;
  update public.teacher_rule_proposals set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=(select auth.uid()),reviewed_at=now(),review_note=nullif(btrim(p_note),'') where id=v.id;
  return jsonb_build_object('ok',true,'status',case when p_approve then 'approved' else 'rejected' end,'published',coalesce(v_result,'null'::jsonb));
end; $$;
revoke all on function public.admin_review_teacher_rule(bigint,boolean,text) from public,anon;
grant execute on function public.admin_review_teacher_rule(bigint,boolean,text) to authenticated;

-- Versioned edits publish a new row and archive the prior row; ledger/request
-- foreign keys and snapshots therefore retain the exact historical wording.
create or replace function public.admin_update_behavior_rule(p_rule_id bigint,p_title text,p_points smallint,p_description text default null)
returns jsonb language plpgsql security definer set search_path='' as $$ declare o public.behavior_rules%rowtype; n bigint; s public.rule_severity; begin
 if not private.is_admin() then raise exception 'Administrator permission required' using errcode='42501'; end if;
 select * into o from public.behavior_rules where id=p_rule_id and is_active for update; if not found then raise exception 'Active rule not found' using errcode='P0002'; end if;
 if nullif(btrim(p_title),'') is null or char_length(btrim(p_title)) not between 3 and 300 or p_points is null or p_points not between 1 and 100 then raise exception 'Invalid rule values' using errcode='22023'; end if;
 if p_description is not null and char_length(btrim(p_description)) > 2000 then raise exception 'Rule description is too long' using errcode='22023'; end if;
 s:=case when p_points>=50 then 'critical' when p_points>=25 then 'serious' when p_points>=10 then 'medium' else 'low' end;
 insert into public.behavior_rules(rule_code,category,title_th,description_th,default_deduction,severity,guardian_contact_required,is_active,effective_from)
 values('D-AUTO-'||lpad(nextval('private.custom_deduction_rule_code_seq')::text,6,'0'),case s when 'critical' then 'ความผิดขั้นร้ายแรงมาก' when 'serious' then 'ความผิดขั้นร้ายแรง' when 'medium' then 'ความผิดขั้นปานกลาง' else 'ความผิดขั้นเบา' end,btrim(p_title),nullif(btrim(p_description),''),p_points,s,s in ('serious','critical'),true,current_date) returning id into n;
 update public.behavior_rules set is_active=false,effective_to=current_date where id=p_rule_id;
 perform private.write_audit('admin_update_behavior_rule','behavior_rules',p_rule_id::text,to_jsonb(o),jsonb_build_object('new_id',n,'title',p_title,'points',p_points)); return jsonb_build_object('ok',true,'id',n); end $$;

create or replace function public.admin_update_positive_rule(p_rule_id bigint,p_title text,p_points smallint,p_is_discretionary boolean default false,p_description text default null)
returns jsonb language plpgsql security definer set search_path='' as $$ declare o public.positive_behavior_rules%rowtype; n bigint; begin
 if not private.is_admin() then raise exception 'Administrator permission required' using errcode='42501'; end if;
 select * into o from public.positive_behavior_rules where id=p_rule_id and is_active for update; if not found then raise exception 'Active positive rule not found' using errcode='P0002'; end if;
 if nullif(btrim(p_title),'') is null or char_length(btrim(p_title)) not between 3 and 300 or p_points is null or p_points not between 1 and 100 then raise exception 'Invalid rule values' using errcode='22023'; end if;
 if p_description is not null and char_length(btrim(p_description)) > 2000 then raise exception 'Rule description is too long' using errcode='22023'; end if;
 insert into public.positive_behavior_rules(rule_code,category,title_th,description_th,default_addition,max_addition,is_discretionary,is_active,effective_from)
 values('P-AUTO-'||lpad(nextval('private.custom_positive_rule_code_seq')::text,6,'0'),o.category,btrim(p_title),nullif(btrim(p_description),''),case when p_is_discretionary then null else p_points end,p_points,coalesce(p_is_discretionary,false),true,current_date) returning id into n;
 update public.positive_behavior_rules set is_active=false,effective_to=current_date where id=p_rule_id;
 perform private.write_audit('admin_update_positive_rule','positive_behavior_rules',p_rule_id::text,to_jsonb(o),jsonb_build_object('new_id',n,'title',p_title,'points',p_points)); return jsonb_build_object('ok',true,'id',n); end $$;
revoke all on function public.admin_update_behavior_rule(bigint,text,smallint,text),public.admin_update_positive_rule(bigint,text,smallint,boolean,text) from public,anon;
grant execute on function public.admin_update_behavior_rule(bigint,text,smallint,text),public.admin_update_positive_rule(bigint,text,smallint,boolean,text) to authenticated;

commit;
