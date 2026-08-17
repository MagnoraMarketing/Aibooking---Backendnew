-- ---------------------------------------------------------------------------
-- Vapi becomes the only voice option in the customer-facing create-agent
-- flow: hide Standard/Expert from the picker (existing widgets already on
-- either keep working exactly as before — this only affects what's offered
-- to *new* agents going forward), and relabel the Vapi row as "Claude"
-- since that's the only choice the customer actually makes now — the
-- Vapi-specific wiring (transcriber/voice/assistant) is provisioned
-- automatically, see app/api/customer/widgets/route.ts and
-- lib/vapi/assistants.ts.
--
-- is_default is deliberately left untouched on claude-sonnet-5: it still
-- means "the system's default Anthropic model" wherever that's read
-- independent of create-flow visibility (lib/vapi/assistants.ts's
-- getDefaultAnthropicModelName, the admin-onboarding default widget in
-- lib/customers/onboarding.ts, conversation summarization).
-- ---------------------------------------------------------------------------

update public.llm_models set show_in_create_flow = false
  where model_name in ('claude-sonnet-5', 'gpt-realtime-2.1');

update public.llm_models set show_in_create_flow = true, display_name = 'Claude'
  where model_name = 'vapi-voice-agent';
