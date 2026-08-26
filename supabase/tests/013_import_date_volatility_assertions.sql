begin;

select plan(2);

select is(
  (
    select procedure.provolatile::text
    from pg_proc procedure
    where procedure.oid = 'private.try_iso_date(text)'::regprocedure
  ),
  's',
  'try_iso_date uses the correct STABLE volatility'
);

select is(
  private.try_iso_date('2026-08-26'),
  date '2026-08-26',
  'try_iso_date still parses an ISO date'
);

select * from finish();

rollback;
