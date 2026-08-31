-- Commit the enum value before later migrations reference it in constraints
-- and functions. PostgreSQL does not allow a newly-added enum value to be
-- consumed safely until the transaction that created it has committed.
alter type public.score_entry_type
  add value if not exists 'admin_adjustment';
