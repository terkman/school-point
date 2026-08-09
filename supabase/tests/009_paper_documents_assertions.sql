begin;

do $$
begin
  if to_regclass('public.paper_documents') is null
     or to_regclass('public.paper_document_events') is null then
    raise exception 'paper document tables are missing';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = 'public.paper_documents'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_class
    where oid = 'public.paper_document_events'::regclass and relrowsecurity
  ) then
    raise exception 'RLS must be enabled on paper document tables';
  end if;
end
$$;

do $$
declare
  v_function regprocedure;
begin
  foreach v_function in array array[
    'public.issue_paper_document_v1(text,bigint,bigint,bigint,bigint)'::regprocedure,
    'public.list_paper_documents_v1(bigint)'::regprocedure,
    'public.record_paper_document_event_v1(bigint,text,text)'::regprocedure,
    'public.submit_paper_appeal_v1(bigint,text,timestamptz)'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_proc
      where oid = v_function and prosecdef and proconfig @> array['search_path=']
    ) then
      raise exception 'paper RPC % must be SECURITY DEFINER with an empty search_path', v_function;
    end if;
    if has_function_privilege('anon', v_function, 'execute')
       or has_function_privilege('public', v_function, 'execute')
       or not has_function_privilege('authenticated', v_function, 'execute') then
      raise exception 'paper RPC % has unsafe execute privileges', v_function;
    end if;
  end loop;
end
$$;

do $$
begin
  if has_table_privilege('anon', 'public.paper_documents', 'select')
     or has_table_privilege('anon', 'public.paper_document_events', 'select')
     or has_table_privilege('authenticated', 'public.paper_documents', 'insert')
     or has_table_privilege('authenticated', 'public.paper_document_events', 'insert') then
    raise exception 'paper tables expose unsafe direct privileges';
  end if;
  if not has_table_privilege('authenticated', 'public.paper_documents', 'select')
     or not has_table_privilege('authenticated', 'public.paper_document_events', 'select') then
    raise exception 'authenticated users need RLS-filtered read access to paper tables';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.appeals'::regclass
      and attname = 'submission_source' and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.appeals'::regclass
      and attname = 'source_document_id' and not attisdropped
  ) then
    raise exception 'paper appeal source columns are missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'appeals_source_document_unique_idx'
  ) then
    raise exception 'paper appeal document uniqueness index is missing';
  end if;
end
$$;

rollback;
