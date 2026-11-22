-- Applied to the personal-dashboard Supabase project on 2026-11-22.
-- Stock ticker gadget: settings, device heartbeat, last-good market data.
-- Only the server (service_role) can read or write; anon/authenticated have no access.
create schema if not exists ticker;

create table ticker.config (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table ticker.device (
  id text primary key,
  last_seen timestamptz not null default now(),
  info jsonb not null default '{}'::jsonb
);

create table ticker.cache (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table ticker.config enable row level security;
alter table ticker.device enable row level security;
alter table ticker.cache  enable row level security;

revoke all on schema ticker from anon, authenticated, public;
revoke all on all tables in schema ticker from anon, authenticated, public;
grant usage on schema ticker to service_role;
grant all on all tables in schema ticker to service_role;
alter default privileges in schema ticker grant all on tables to service_role;

insert into ticker.config (id, data) values (1, '{}'::jsonb) on conflict do nothing;

-- The schema must also be exposed to the API. In the Supabase dashboard:
-- Project Settings > Data API > Exposed schemas, add "ticker".
-- (Was done via: alter role authenticator set pgrst.db_schemas = '..., ticker';)
