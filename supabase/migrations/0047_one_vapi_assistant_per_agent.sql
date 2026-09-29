-- ---------------------------------------------------------------------------
-- One Vapi assistant per agent.
--
-- An agent's assistant id lives in widget_settings.extra->>'vapiAssistantId'
-- (0011_vapi_model.sql), and everything that routes a call, a tool call or a
-- bill back to a customer looks the agent up by it (see
-- lib/vapi/assistant-owner.ts). Two agents on one assistant would each
-- overwrite the other's prompt on every save, and their calls could no
-- longer be told apart. This migration changes no data.
--
-- 1. Customers lose direct UPDATE on widgets and widget_settings.
--    0003_rls.sql let a signed-in customer update their own rows straight
--    through the Supabase API with the public anon key — including setting
--    extra.vapiAssistantId to another customer's assistant, which the next
--    save would then overwrite with their own prompt. Nothing in the app
--    uses those policies: every write goes through the server routes (with
--    the service role), which check ownership and never let a customer
--    choose an assistant. Reading their own rows is unchanged.
--
-- 2. vapiAssistantId becomes unique across agents, where the existing data
--    allows it. If production already has two agents sharing an assistant,
--    the index is NOT created (a failing migration would block every later
--    one) and a warning lists the assistants to fix by hand. The app refuses
--    new duplicates regardless (assertAssistantNotLinkedElsewhere). Find
--    them with:
--
--      select extra->>'vapiAssistantId' as assistant, array_agg(widget_id)
--      from public.widget_settings
--      where coalesce(extra->>'vapiAssistantId', '') <> ''
--      group by 1 having count(*) > 1;
--
--    then run this migration again once they are resolved.
-- ---------------------------------------------------------------------------

drop policy if exists "customer admin can update own widgets" on public.widgets;
drop policy if exists "customer admin can update own widget_settings" on public.widget_settings;

do $$
declare
  duplicates text;
begin
  select string_agg(assistant || ' (' || agents || ' agents)', ', ')
  into duplicates
  from (
    select extra->>'vapiAssistantId' as assistant, count(*) as agents
    from public.widget_settings
    where coalesce(extra->>'vapiAssistantId', '') <> ''
    group by 1
    having count(*) > 1
  ) shared;

  if duplicates is null then
    create unique index if not exists widget_settings_vapi_assistant_id_unique
      on public.widget_settings ((extra->>'vapiAssistantId'))
      where coalesce(extra->>'vapiAssistantId', '') <> '';
  else
    raise warning 'Not enforcing one Vapi assistant per agent yet — these assistants are shared: %', duplicates;
  end if;
end
$$;
