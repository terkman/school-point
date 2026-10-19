-- PostgreSQL requires a newly added enum value to be committed before any
-- later migration can reference it in policies, functions, or constraints.
-- remediation_credit is a positive credit posted to a CLOSED term's score
-- account through the term-remediation review workflow only.
alter type public.score_entry_type
  add value if not exists 'remediation_credit';
