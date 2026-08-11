-- ---------------------------------------------------------------------------
-- Seed data: default package, LLM models, and Danish ElevenLabs voices.
-- Nothing here is hardcoded into the application — admin can edit/replace
-- any of these rows later without a migration.
-- ---------------------------------------------------------------------------

insert into public.packages (package_name, monthly_price, currency, included_minutes, overage_price_per_minute, renewal_type, active, is_default)
values ('AIbooking 999', 999.00, 'DKK', 150, 6.66, 'automatic', true, true)
on conflict do nothing;

-- Claude models (cost/performance abstraction — admin can enable more, or
-- change the default, without a code change). Prices in DKK per 1M tokens,
-- approximate — admin should keep these current from the Anthropic price list.
insert into public.llm_models (provider, model_name, display_name, input_price_per_million, output_price_per_million, max_tokens, active, is_default)
values
  ('anthropic', 'claude-haiku-4-5', 'Claude Haiku (hurtig, billig)', 6.50, 32.50, 1024, true, true),
  ('anthropic', 'claude-sonnet-5', 'Claude Sonnet (balanceret)', 20.50, 102.50, 1024, true, false),
  ('anthropic', 'claude-opus-5', 'Claude Opus (mest kapabel)', 102.50, 512.50, 1024, true, false)
on conflict (model_name) do nothing;

-- 10 Danish ElevenLabs voices. provider_voice_id values are placeholders —
-- admin replaces them with real ElevenLabs voice IDs from the dashboard.
insert into public.voice_models (provider, provider_voice_id, name, language, gender, active, is_default)
values
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-1', 'Freja', 'da', 'female', true, true),
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-2', 'Mikkel', 'da', 'male', true, false),
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-3', 'Sofie', 'da', 'female', true, false),
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-4', 'Anders', 'da', 'male', true, false),
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-5', 'Clara', 'da', 'female', true, false),
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-6', 'Frederik', 'da', 'male', true, false),
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-7', 'Ida', 'da', 'female', true, false),
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-8', 'Lukas', 'da', 'male', true, false),
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-9', 'Emma', 'da', 'female', true, false),
  ('elevenlabs', 'replace-with-elevenlabs-voice-id-10', 'Oskar', 'da', 'male', true, false)
on conflict do nothing;
