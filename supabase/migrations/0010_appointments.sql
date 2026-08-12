-- ---------------------------------------------------------------------------
-- appointments: bookings the AI made (or attempted) during a conversation.
-- Nothing writes to this table yet — no calendar integration exists in the
-- conversation pipeline yet (Cal.com is still "Kommer snart" in the widget
-- Settings tab) — but the dashboard's Appointments section and its API are
-- built against this real table now, ready for when that lands.
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid references public.widgets (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  customer_name text,
  appointment_time timestamptz not null,
  status text not null default 'failed' check (status in ('booked', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists appointments_customer_id_idx on public.appointments (customer_id, created_at desc);

alter table public.appointments enable row level security;

create policy "master admin full access on appointments"
  on public.appointments for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own appointments"
  on public.appointments for select
  using (customer_id = public.current_customer_id());
