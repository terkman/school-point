do $$
declare
  v_function regprocedure := to_regprocedure(
    'public.admin_import_school_data(jsonb,boolean)'
  );
  v_definition text;
begin
  if v_function is null then
    raise exception 'admin_import_school_data is missing';
  end if;

  select pg_get_functiondef(v_function) into v_definition;

  if strpos(v_definition, '(''teacher'', ''director'', ''admin'')') = 0 then
    raise exception 'web import must support the director role';
  end if;

  if strpos(v_definition, 'when not (v_item ? ''isActive'') then public.students.status') = 0
     or strpos(v_definition, 'when not (v_item ? ''isActive'') then public.teachers.status') = 0 then
    raise exception 'blank spreadsheet status must preserve the existing person status';
  end if;

  if strpos(v_definition, 'private.try_smallint(v_item ->> ''contactOrder'')') = 0
     or strpos(v_definition, 'is_primary = excluded.is_primary') = 0 then
    raise exception 'web import must support ordered guardian contacts';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.admin_import_school_data(jsonb,boolean)',
    'EXECUTE'
  ) then
    raise exception 'authenticated users must not call the trusted import RPC directly';
  end if;
end;
$$;
