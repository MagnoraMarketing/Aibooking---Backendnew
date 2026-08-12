-- Self-service signup lets a new company pick a preferred profile language
-- (used for the account/dashboard going forward, distinct from an
-- individual widget's own `language` column which controls what the AI
-- speaks to end users).
alter table public.profiles add column if not exists language text not null default 'da';
