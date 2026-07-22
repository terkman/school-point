begin;

-- Views exposed to students must evaluate both table privileges and RLS as the
-- caller. Keeping security_barrier prevents predicates from being pushed past
-- the privacy boundary while security_invoker avoids owner-privilege bypasses.
alter view public.student_current_scores
  set (security_barrier = true, security_invoker = true);

alter view public.student_score_history
  set (security_barrier = true, security_invoker = true);

alter view public.student_incident_history
  set (security_barrier = true, security_invoker = true);

-- Supabase's automatic-RLS event trigger invokes this function by OID. API
-- roles never need direct EXECUTE and must not be able to call the definer
-- function through the Data API.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

commit;
