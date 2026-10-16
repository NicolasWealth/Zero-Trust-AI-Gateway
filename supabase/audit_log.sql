-- Run once in the Supabase SQL editor.
create table if not exists public.audit_log (
  id                   bigint generated always as identity primary key,
  created_at           timestamptz not null default now(),
  redaction_categories jsonb       not null,
  prompt_hash          text        not null,  -- SHA-256 of the cleaned prompt
  prev_hash            text        not null unique,  -- unique: two writers cannot fork the chain
  entry_hash           text        not null unique   -- SHA-256(prev_hash + created_at + prompt_hash + categories)
);

-- Lock the table. The gateway uses the service key, which bypasses RLS.
-- With RLS on and no policies, the public anon key can read and write nothing.
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
