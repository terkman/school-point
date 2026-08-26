begin;

-- Text-to-date casts are STABLE, not IMMUTABLE, because PostgreSQL date parsing
-- can depend on session settings. The ISO shape guard remains unchanged.
alter function private.try_iso_date(text) stable;

comment on function private.try_iso_date(text) is
  'Parses an ISO-shaped date without claiming independence from session date settings.';

commit;
