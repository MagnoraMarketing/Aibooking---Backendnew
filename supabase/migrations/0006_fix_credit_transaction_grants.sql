-- Supabase grants EXECUTE on new public-schema functions to anon/authenticated
-- by default (ALTER DEFAULT PRIVILEGES), which silently overrode the
-- "revoke all from public" in 0002_functions.sql for this function: anon and
-- authenticated could call record_credit_transaction directly via PostgREST
-- RPC and mutate any customer's credit balance. Revoke explicitly so only
-- service_role can execute it.
revoke execute on function public.record_credit_transaction(uuid, bigint, text, text, uuid, text, uuid) from anon, authenticated, public;
grant execute on function public.record_credit_transaction(uuid, bigint, text, text, uuid, text, uuid) to service_role;
