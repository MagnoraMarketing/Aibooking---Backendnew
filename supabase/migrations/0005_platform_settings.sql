-- Singleton-style key/value store for platform-wide admin-configurable
-- defaults (e.g. default system prompt for new widgets) that don't warrant
-- their own table and must never be hardcoded in the frontend.
create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.platform_settings;
create trigger set_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

alter table public.platform_settings enable row level security;

create policy "master admin full access on platform_settings"
  on public.platform_settings for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "authenticated can view platform_settings"
  on public.platform_settings for select
  using (auth.uid() is not null);

insert into public.platform_settings (key, value)
values (
  'default_system_prompt',
  '"Du er AI-assistent for virksomheden. Din opgave er at hjælpe besøgende, besvare spørgsmål og skabe bookinger. Tal naturligt og kortfattet. Hvis du ikke kender svaret, må du ikke opfinde information."'::jsonb
)
on conflict (key) do nothing;
