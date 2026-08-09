-- PostgreSQL requires a newly added enum value to be committed before any
-- later migration can reference it in policies, functions, or constraints.
alter type public.score_entry_type
  add value if not exists 'appeal_adjustment';
