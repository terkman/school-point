-- Extend the trusted school-data import contract used by the admin web uploader.
-- The original importer remains server-only and atomic. These narrow changes add
-- the director role, preserve an existing lifecycle status when the spreadsheet
-- cell is blank, and allow ordered guardian contacts instead of only order 1.

do $$
declare
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.admin_import_school_data(jsonb,boolean)'::regprocedure
  ) into v_definition;
  v_patched := v_definition;

  v_old := 'or coalesce(v_item ->> ''role'', '''') not in (''teacher'', ''admin'') then';
  v_new := 'or coalesce(v_item ->> ''role'', '''') not in (''teacher'', ''director'', ''admin'') then';
  if strpos(v_patched, v_old) = 0 then
    raise exception 'admin import role validation patch point not found';
  end if;
  v_patched := replace(v_patched, v_old, v_new);

  v_old := $needle$
        status = case
          when public.teachers.status = 'graduated' then public.teachers.status
          else excluded.status
        end,
$needle$;
  v_new := $replacement$
        status = case
          when public.teachers.status = 'graduated' then public.teachers.status
          when not (v_item ? 'isActive') then public.teachers.status
          else excluded.status
        end,
$replacement$;
  if strpos(v_patched, v_old) = 0 then
    raise exception 'admin import staff status patch point not found';
  end if;
  v_patched := replace(v_patched, v_old, v_new);

  v_old := $needle$
        status = case
          when public.students.status = 'graduated' then public.students.status
          else excluded.status
        end
$needle$;
  v_new := $replacement$
        status = case
          when public.students.status = 'graduated' then public.students.status
          when not (v_item ? 'isActive') then public.students.status
          else excluded.status
        end
$replacement$;
  if strpos(v_patched, v_old) = 0 then
    raise exception 'admin import student status patch point not found';
  end if;
  v_patched := replace(v_patched, v_old, v_new);

  v_old := $needle$
        classroom_id = excluded.classroom_id,
        student_number = coalesce(excluded.student_number, public.enrollments.student_number),
        is_active = excluded.is_active;
$needle$;
  v_new := $replacement$
        classroom_id = excluded.classroom_id,
        student_number = coalesce(excluded.student_number, public.enrollments.student_number),
        is_active = case
          when v_item ? 'isActive' then excluded.is_active
          else public.enrollments.is_active
        end;
$replacement$;
  if strpos(v_patched, v_old) = 0 then
    raise exception 'admin import enrollment status patch point not found';
  end if;
  v_patched := replace(v_patched, v_old, v_new);

  v_old := $needle$
          v_student_id,
          1,
          nullif(btrim(v_item ->> 'name'), ''),
          nullif(btrim(v_item ->> 'relationship'), ''),
          nullif(btrim(v_item ->> 'phone'), ''),
          true,
          true
$needle$;
  v_new := $replacement$
          v_student_id,
          coalesce(private.try_smallint(v_item ->> 'contactOrder'), 1),
          nullif(btrim(v_item ->> 'name'), ''),
          nullif(btrim(v_item ->> 'relationship'), ''),
          nullif(btrim(v_item ->> 'phone'), ''),
          coalesce(private.try_smallint(v_item ->> 'contactOrder'), 1) = 1,
          true
$replacement$;
  if strpos(v_patched, v_old) = 0 then
    raise exception 'admin import guardian order patch point not found';
  end if;
  v_patched := replace(v_patched, v_old, v_new);

  v_old := $needle$
          phone_number = coalesce(excluded.phone_number, private.student_guardian_contacts.phone_number),
          is_primary = true,
          is_active = true;
$needle$;
  v_new := $replacement$
          phone_number = coalesce(excluded.phone_number, private.student_guardian_contacts.phone_number),
          is_primary = excluded.is_primary,
          is_active = true;
$replacement$;
  if strpos(v_patched, v_old) = 0 then
    raise exception 'admin import guardian primary patch point not found';
  end if;
  v_patched := replace(v_patched, v_old, v_new);

  execute v_patched;
end;
$$;

comment on function public.admin_import_school_data(jsonb, boolean) is
  'Server-only atomic import used by the admin Excel uploader; blank status fields preserve existing lifecycle state.';
