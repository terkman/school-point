begin;

-- The activation issuer checks only these fields before creating a one-time
-- code. New sb_secret keys assume the service_role database role, which still
-- needs explicit column privileges even though it bypasses RLS.
grant usage on schema public to service_role;
grant select (user_id, is_active, activation_required)
on table public.profiles
to service_role;

commit;
