-- ---------------------------------------------------------------------------
-- phone_numbers.source = 'vapi' — a number Vapi hands out directly.
--
-- Inbound no longer involves Twilio at all: the agent is given a number from
-- Vapi (lib/vapi/phone-numbers.ts's createVapiManagedNumber), and the customer
-- forwards their own existing line to it. Nobody has to own a Twilio account,
-- and nobody has to move the number their customers already call.
--
-- 'platform_twilio' and 'byo_twilio' stay: outbound campaigns and the dialer
-- still place calls through Twilio, and numbers attached that way before this
-- keep working exactly as they did (see 0015_platform_phone_numbers.sql).
-- ---------------------------------------------------------------------------

-- The original constraint was declared inline (0015), so its name is whatever
-- Postgres generated. Dropped by what it checks rather than by a name this
-- migration would be guessing at.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'phone_numbers'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%byo_twilio%'
  loop
    execute format('alter table public.phone_numbers drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.phone_numbers
  add constraint phone_numbers_source_check
  check (source in ('byo_twilio', 'platform_twilio', 'vapi'));
