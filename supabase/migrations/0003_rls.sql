-- ---------------------------------------------------------------------------
-- Row Level Security: tenant isolation.
-- Master admin: full access everywhere.
-- Customer admin: read (and limited write) scoped to their own customer_id.
-- Public/anon (widget end users): no direct table access — the widget/*
-- API routes use the service_role key and enforce their own scoping.
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.profiles enable row level security;
alter table public.packages enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.llm_models enable row level security;
alter table public.voice_models enable row level security;
alter table public.widgets enable row level security;
alter table public.widget_settings enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_summaries enable row level security;
alter table public.usage_sessions enable row level security;
alter table public.api_usage enable row level security;
alter table public.audit_logs enable row level security;
alter table public.stripe_events enable row level security;

-- customers ------------------------------------------------------------
create policy "master admin full access on customers"
  on public.customers for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own customer"
  on public.customers for select
  using (id = public.current_customer_id());

create policy "customer admin can update own customer"
  on public.customers for update
  using (id = public.current_customer_id())
  with check (id = public.current_customer_id());

-- profiles ---------------------------------------------------------------
create policy "master admin full access on profiles"
  on public.profiles for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "user can view own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "user can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- packages (public pricing catalog: everyone signed in may read active ones)
create policy "master admin full access on packages"
  on public.packages for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "authenticated can view active packages"
  on public.packages for select
  using (active = true or public.current_customer_id() is not null);

-- subscriptions ------------------------------------------------------------
create policy "master admin full access on subscriptions"
  on public.subscriptions for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own subscription"
  on public.subscriptions for select
  using (customer_id = public.current_customer_id());

-- credit_accounts (read-only for customers; all writes via service_role RPC)
create policy "master admin full access on credit_accounts"
  on public.credit_accounts for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own credit account"
  on public.credit_accounts for select
  using (customer_id = public.current_customer_id());

-- credit_transactions (read-only ledger for customers)
create policy "master admin full access on credit_transactions"
  on public.credit_transactions for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own credit transactions"
  on public.credit_transactions for select
  using (customer_id = public.current_customer_id());

-- llm_models / voice_models (admin manages; everyone signed-in reads active)
create policy "master admin full access on llm_models"
  on public.llm_models for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "authenticated can view active llm_models"
  on public.llm_models for select
  using (active = true or public.is_master_admin());

create policy "master admin full access on voice_models"
  on public.voice_models for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "authenticated can view active voice_models"
  on public.voice_models for select
  using (active = true or public.is_master_admin());

-- widgets --------------------------------------------------------------
create policy "master admin full access on widgets"
  on public.widgets for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own widgets"
  on public.widgets for select
  using (customer_id = public.current_customer_id());

create policy "customer admin can update own widgets"
  on public.widgets for update
  using (customer_id = public.current_customer_id())
  with check (customer_id = public.current_customer_id());

-- widget_settings --------------------------------------------------------
create policy "master admin full access on widget_settings"
  on public.widget_settings for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own widget_settings"
  on public.widget_settings for select
  using (
    widget_id in (select id from public.widgets where customer_id = public.current_customer_id())
  );

create policy "customer admin can update own widget_settings"
  on public.widget_settings for update
  using (
    widget_id in (select id from public.widgets where customer_id = public.current_customer_id())
  )
  with check (
    widget_id in (select id from public.widgets where customer_id = public.current_customer_id())
  );

-- conversations ------------------------------------------------------------
create policy "master admin full access on conversations"
  on public.conversations for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own conversations"
  on public.conversations for select
  using (customer_id = public.current_customer_id());

-- conversation_messages ------------------------------------------------------------
create policy "master admin full access on conversation_messages"
  on public.conversation_messages for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own conversation_messages"
  on public.conversation_messages for select
  using (
    conversation_id in (select id from public.conversations where customer_id = public.current_customer_id())
  );

-- conversation_summaries ------------------------------------------------------------
create policy "master admin full access on conversation_summaries"
  on public.conversation_summaries for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own conversation_summaries"
  on public.conversation_summaries for select
  using (
    conversation_id in (select id from public.conversations where customer_id = public.current_customer_id())
  );

-- usage_sessions ------------------------------------------------------------
create policy "master admin full access on usage_sessions"
  on public.usage_sessions for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own usage_sessions"
  on public.usage_sessions for select
  using (customer_id = public.current_customer_id());

-- api_usage (cost data: master admin only, customers never see raw cost)
create policy "master admin full access on api_usage"
  on public.api_usage for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

-- audit_logs (master admin only)
create policy "master admin full access on audit_logs"
  on public.audit_logs for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

-- stripe_events (service_role only; no policies -> RLS denies all others)
