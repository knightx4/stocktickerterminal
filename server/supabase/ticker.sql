-- Applied to the personal-dashboard Supabase project on 2026-11-22.
-- Stock ticker gadget: settings, device heartbeat, last-good market data.
-- Tables are closed to anon/authenticated; see the RPC migration at the end.
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

-- ---------------------------------------------------------------------------
-- Migration ticker_rpc_access (2026-11-22): the server uses the publishable
-- key, so the tables stay closed and two SECURITY DEFINER functions open them
-- to callers that present TICKER_DB_SECRET (stored only as a SHA-256 hash).
create table if not exists ticker.secret (
  id smallint primary key default 1 check (id = 1),
  sha256 text not null
);
alter table ticker.secret enable row level security;
revoke all on ticker.secret from anon, authenticated, public;

create or replace function ticker.check_secret(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or not exists (
    select 1 from ticker.secret
    where sha256 = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end $$;

create or replace function ticker.get_row(p_token text, p_table text, p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform ticker.check_secret(p_token);
  if p_table = 'config' then
    select to_jsonb(c) into r from ticker.config c where c.id = p_id::smallint;
  elsif p_table = 'device' then
    select to_jsonb(d) into r from ticker.device d where d.id = p_id;
  elsif p_table = 'cache' then
    select to_jsonb(k) into r from ticker.cache k where k.key = p_id;
  else
    raise exception 'unknown table %', p_table;
  end if;
  return r;
end $$;

create or replace function ticker.put_row(p_token text, p_table text, p_id text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform ticker.check_secret(p_token);
  if p_table = 'config' then
    insert into ticker.config (id, data, updated_at) values (p_id::smallint, p_data, now())
    on conflict (id) do update set data = excluded.data, updated_at = now();
  elsif p_table = 'device' then
    insert into ticker.device (id, info, last_seen) values (p_id, p_data, now())
    on conflict (id) do update set info = excluded.info, last_seen = now();
  elsif p_table = 'cache' then
    insert into ticker.cache (key, data, updated_at) values (p_id, p_data, now())
    on conflict (key) do update set data = excluded.data, updated_at = now();
  else
    raise exception 'unknown table %', p_table;
  end if;
end $$;

revoke all on function ticker.check_secret(text) from public, anon, authenticated;
revoke all on function ticker.get_row(text, text, text) from public;
revoke all on function ticker.put_row(text, text, text, jsonb) from public;
grant usage on schema ticker to anon;
grant execute on function ticker.get_row(text, text, text) to anon;
grant execute on function ticker.put_row(text, text, text, jsonb) to anon;

-- Then set the secret (hash only):
-- insert into ticker.secret (id, sha256) values (1, encode(extensions.digest('SECRET', 'sha256'), 'hex'));
