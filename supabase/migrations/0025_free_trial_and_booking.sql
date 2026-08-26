-- Add free trial tracking to widgets
alter table widgets 
add column if not exists free_trial_seconds int default 300 not null,
add column if not exists booking_enabled boolean default false not null,
add column constraint booking_enabled_check check (booking_enabled in (true, false));

-- Add booking setup status and related fields to widget_settings
alter table widget_settings 
add column if not exists booking_setup_status text default 'not_started' check (booking_setup_status in ('not_started', 'in_progress', 'completed', 'failed')),
add column if not exists booking_setup_started_at timestamp with time zone,
add column if not exists booking_setup_completed_at timestamp with time zone,
add column if not exists booking_setup_error text;

-- Track trial usage per widget (separate from overall usage)
-- This is referenced by usage_sessions to enforce per-widget trial limits
-- Usage enforcement happens server-side in lib/credits before usage_session creation

-- Add is_trial_usage flag to usage_sessions to track free trial vs paid usage
alter table usage_sessions 
add column if not exists is_trial_usage boolean default false not null;

-- Index for finding trial-exceeded widgets
create index if not exists idx_widgets_booking on widgets(customer_id, booking_enabled);

-- Table for tracking booking setup requests (admin/support workflow)
create table if not exists booking_setup_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  widget_id uuid not null references widgets(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  request_details jsonb,
  created_by uuid references profiles(id),
  assigned_to uuid references profiles(id),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique(widget_id)
);

create index if not exists idx_booking_setup_requests_customer on booking_setup_requests(customer_id);
create index if not exists idx_booking_setup_requests_status on booking_setup_requests(status);

-- Add calendar_timezone to widget_settings for proper availability queries
alter table widget_settings 
add column if not exists calendar_timezone text default 'Europe/Copenhagen';

-- Enable row-level security on booking_setup_requests
alter table booking_setup_requests enable row level security;

-- RLS policy: customers can see their own booking setup requests
create policy if not exists booking_setup_requests_customer_access
  on booking_setup_requests
  for select
  using (customer_id = (select customer_id from auth.users where auth.users.id = auth.uid()));
