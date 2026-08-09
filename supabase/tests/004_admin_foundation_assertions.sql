do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'staff_permission_grants',
    'staff_permission_grant_classrooms',
    'student_paper_documents',
    'student_paper_document_events'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'public.% is missing', v_table;
    end if;
    if not (
      select class.relrowsecurity
      from pg_class class
      where class.oid = to_regclass(format('public.%I', v_table))
    ) then
      raise exception 'RLS is not enabled on public.%', v_table;
    end if;
    if not has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') then
      raise exception 'authenticated cannot select public.%', v_table;
    end if;
    if has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE')
    then
      raise exception 'authenticated has an unsafe direct write privilege on public.%', v_table;
    end if;
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'staff_permission_grants_one_active_bundle_idx'
  ) then
    raise exception 'active permission bundle partial index is missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'student_paper_documents_student_term_date_idx'
  ) then
    raise exception 'paper document student/term index is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.student_paper_document_events'::regclass
      and tgname = 'student_paper_document_events_immutable'
      and not tgisinternal
  ) then
    raise exception 'paper document events are not append-only';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.student_paper_documents'::regclass
      and tgname = 'student_paper_documents_assign_code'
      and not tgisinternal
  ) then
    raise exception 'paper document auto-code trigger is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'student_paper_documents'
      and policyname = 'student_paper_documents_staff_select'
  ) then
    raise exception 'paper document staff select policy is missing';
  end if;
end;
$$;
