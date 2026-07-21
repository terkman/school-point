-- Migrations create this trusted routine and run it once. Calling it again here
-- keeps `supabase db reset` and explicit seed runs idempotent without maintaining
-- a duplicate copy of the 83 deduction and 17 positive-behavior rows.
begin;

select private.seed_2569_behavior_rules();

commit;
