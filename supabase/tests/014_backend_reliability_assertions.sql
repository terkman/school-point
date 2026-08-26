begin;

select plan(4);

select is(
  private.incident_appeal_deadline('2026-08-26 17:30:00+00'::timestamptz),
  '2026-09-02 17:30:00+00'::timestamptz,
  'the appeal deadline includes the exact seven-day boundary from occurred_at'
);

do $$
declare
  v_constraint text;
begin
  select pg_get_constraintdef(constraint_row.oid)
  into v_constraint
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.incidents'::regclass
    and constraint_row.conname = 'incidents_appeal_deadline_from_occurred_check';

  if v_constraint is null
     or position('private.incident_appeal_deadline(occurred_at)' in lower(v_constraint)) = 0
     or not exists (
       select 1 from pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.incidents'::regclass
         and trigger_row.tgname = 'incidents_set_appeal_deadline'
         and not trigger_row.tgisinternal
     ) then
    raise exception 'incident appeal deadlines are not enforced from occurred_at';
  end if;
end;
$$;

select pass('appeal deadline source and trigger are installed');

do $$
declare
  v_payload_fingerprint text := repeat('a', 64);
  v_preview_token text;
begin
  v_preview_token := private.import_preview_token(v_payload_fingerprint, 41);
  begin
    perform private.require_current_import_preview_token(
      v_preview_token,
      v_payload_fingerprint,
      42
    );
    raise exception 'a stale preview token was accepted';
  exception
    when sqlstate '40001' then null;
  end;
end;
$$;

select pass('a stale import preview token is rejected before apply');

do $$
declare
  v_function regprocedure := 'public.service_admin_import_school_data_v2(uuid,jsonb,boolean)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_function) into v_definition;
  if position('previewtoken' in lower(v_definition)) = 0
     or position('for update' in lower(v_definition)) = 0
     or position('import_source_revisions' in lower(v_definition)) = 0
     or position('batchid' in lower(v_definition)) = 0 then
    raise exception 'import apply is not bound to and locked against a preview revision';
  end if;
end;
$$;

select pass('import preview revision contract is installed');
select * from finish();

rollback;
