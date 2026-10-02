-- ---------------------------------------------------------------------------
-- Stable public id for Pizzi (Valencia)'s agent (seeded in 0049).
--
-- 0049 gave the agent a random public id. The Pizzi website
-- (pizzi-test.vercel.app) starts its calls through POST /api/widget/session
-- with a fixed publicId, so the agent gets a readable, permanent one.
-- Idempotent, and a no-op if another agent already uses the id.
-- ---------------------------------------------------------------------------
update public.widgets w
   set public_id = 'pizzi-valencia'
  from public.customers c
 where c.id = w.customer_id
   and c.email = 'pizzi-valencia@samarbejde.aibooking.dk'
   and w.public_id like 'pizzi%'
   and w.public_id <> 'pizzi-valencia'
   and not exists (select 1 from public.widgets x where x.public_id = 'pizzi-valencia');
