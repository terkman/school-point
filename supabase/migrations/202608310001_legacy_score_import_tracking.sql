begin;

create table if not exists private.legacy_score_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_sha256 text not null unique check (char_length(source_sha256) = 64),
  plan_fingerprint text not null unique check (char_length(plan_fingerprint) = 64),
  source_label text not null check (nullif(btrim(source_label), '') is not null),
  term_id bigint not null references public.academic_terms(id) on delete restrict,
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_by_snapshot text not null check (nullif(btrim(imported_by_snapshot), '') is not null),
  planned_rows smallint not null check (planned_rows between 1 and 10000),
  imported_rows smallint not null check (imported_rows between 0 and planned_rows),
  pending_rows smallint not null check (pending_rows between 0 and planned_rows),
  explicitly_skipped_rows smallint not null check (explicitly_skipped_rows between 0 and 10000),
  deduction_points integer not null check (deduction_points between 0 and 1000000),
  addition_points integer not null check (addition_points between 0 and 1000000),
  replaced_incident_count integer not null default 0 check (replaced_incident_count between 0 and 1000000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  imported_at timestamptz not null default now(),
  check (imported_rows + pending_rows = planned_rows)
);

create table if not exists private.legacy_score_import_rows (
  import_batch_id uuid not null references private.legacy_score_import_batches(id) on delete restrict,
  source_key text not null check (char_length(source_key) = 64),
  source_kind text not null check (source_kind in ('deduction', 'addition')),
  source_row smallint not null check (source_row between 1 and 10000),
  student_id bigint references public.students(id) on delete restrict,
  rule_code text not null check (nullif(btrim(rule_code), '') is not null),
  points smallint not null check (points between 1 and 100),
  occurred_at timestamptz not null,
  status text not null check (status in ('imported', 'pending')),
  incident_id bigint references public.incidents(id) on delete restrict,
  ledger_id bigint references public.score_ledger(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  primary key (import_batch_id, source_key),
  unique (source_key),
  check (
    (status = 'imported' and student_id is not null and ledger_id is not null)
    or (status = 'pending' and student_id is null and incident_id is null and ledger_id is null)
  ),
  check (
    (source_kind = 'deduction' and status = 'imported' and incident_id is not null)
    or source_kind = 'addition'
    or status = 'pending'
  )
);

create table if not exists private.legacy_score_replaced_incidents (
  import_batch_id uuid not null references private.legacy_score_import_batches(id) on delete restrict,
  old_incident_id bigint not null,
  student_id bigint not null references public.students(id) on delete restrict,
  incident_snapshot jsonb not null check (jsonb_typeof(incident_snapshot) = 'object'),
  ledger_snapshot jsonb not null check (jsonb_typeof(ledger_snapshot) = 'array'),
  deduction_batch_snapshot jsonb,
  workflow_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(workflow_snapshot) = 'object'),
  audit_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(audit_snapshot) = 'array'),
  archived_at timestamptz not null default now(),
  primary key (import_batch_id, old_incident_id),
  check (deduction_batch_snapshot is null or jsonb_typeof(deduction_batch_snapshot) = 'object')
);

alter table private.legacy_score_import_batches enable row level security;
alter table private.legacy_score_import_batches force row level security;
alter table private.legacy_score_import_rows enable row level security;
alter table private.legacy_score_import_rows force row level security;
alter table private.legacy_score_replaced_incidents enable row level security;
alter table private.legacy_score_replaced_incidents force row level security;

create index if not exists legacy_score_import_rows_student_date_idx
  on private.legacy_score_import_rows(student_id, occurred_at desc)
  where student_id is not null;
create index if not exists legacy_score_replaced_incidents_student_idx
  on private.legacy_score_replaced_incidents(student_id, old_incident_id);

drop trigger if exists legacy_score_import_batches_immutable on private.legacy_score_import_batches;
create trigger legacy_score_import_batches_immutable
before update or delete on private.legacy_score_import_batches
for each row execute function private.reject_immutable_change();

drop trigger if exists legacy_score_import_rows_immutable on private.legacy_score_import_rows;
create trigger legacy_score_import_rows_immutable
before update or delete on private.legacy_score_import_rows
for each row execute function private.reject_immutable_change();

drop trigger if exists legacy_score_replaced_incidents_immutable on private.legacy_score_replaced_incidents;
create trigger legacy_score_replaced_incidents_immutable
before update or delete on private.legacy_score_replaced_incidents
for each row execute function private.reject_immutable_change();

comment on table private.legacy_score_import_batches is
  'Immutable batch header for one reviewed historical score import. Stores fingerprints and counts, never raw source PII.';
comment on table private.legacy_score_import_rows is
  'Immutable source-key map from historical score rows to their canonical incident or ledger record.';
comment on table private.legacy_score_replaced_incidents is
  'Private immutable archive of incorrect partial-import incidents replaced by a canonical historical import.';

commit;
