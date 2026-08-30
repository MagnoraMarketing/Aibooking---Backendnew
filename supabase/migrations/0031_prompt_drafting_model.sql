-- ---------------------------------------------------------------------------
-- Gives the wizard's "Generér prompt" step its own model setting.
--
-- It previously reused summarization_model_name, which also decides which
-- model every Vapi assistant runs on (lib/vapi/assistants.ts) — so the model
-- drafting a one-off text field couldn't be changed without also changing
-- the model handling live calls. Haiku 4.5 is the cheap end of the range and
-- is plenty for a draft the customer edits anyway.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value)
values ('prompt_drafting_model_name', '"claude-haiku-4-5"'::jsonb)
on conflict (key) do nothing;
