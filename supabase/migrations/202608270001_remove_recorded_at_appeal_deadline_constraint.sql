begin;

-- The original table-level constraint was auto-named incidents_check1 and
-- required appeal_deadline >= recorded_at. That conflicts with the later
-- forward-only rule of exactly seven days from occurred_at for backdated
-- incidents. Keep the occurred_at-based trigger and exact constraint from the
-- prior migration; remove only the obsolete historical condition.
alter table public.incidents
  drop constraint if exists incidents_check1;

comment on constraint incidents_appeal_deadline_from_occurred_check
on public.incidents is
  'Appeal deadline is exactly seven days from occurred_at, including backdated incidents.';

commit;
