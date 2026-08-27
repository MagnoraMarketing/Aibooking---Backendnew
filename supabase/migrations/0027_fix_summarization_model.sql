-- Fix invalid summarization model ID in platform_settings
-- The old seed migration used 'claude-sonnet-5' which is not a valid Anthropic model ID.
-- Update to the correct model ID for all instances.

update platform_settings
set value = '"claude-3-5-sonnet-20241022"'::jsonb
where key = 'summarization_model_name'
  and value = '"claude-sonnet-5"'::jsonb;
