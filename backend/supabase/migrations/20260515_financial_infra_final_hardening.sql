create table if not exists public.scheduler_leases (
  lease_name text primary key,
  owner_id text not null,
  lease_until timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.distributed_state (
  state_key text primary key,
  state_value jsonb not null default '{}'::jsonb,
  expires_at timestamptz null,
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_health (
  provider text primary key,
  consecutive_failures integer not null default 0,
  cooldown_until timestamptz null,
  last_success_at timestamptz null,
  last_failure_at timestamptz null,
  last_error text null,
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_cache (
  cache_key text primary key,
  cache_group text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.execution_audit_logs (
  id bigint generated always as identity primary key,
  trace_id text not null,
  action_key text not null unique,
  action_type text not null,
  status text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb null,
  failure_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.alert_memory
  add column if not exists claim_owner text null,
  add column if not exists claim_expires_at timestamptz null;

create unique index if not exists alert_memory_chat_symbol_type_idx
  on public.alert_memory (chat_id, symbol, alert_type);

create index if not exists shared_cache_group_expiry_idx
  on public.shared_cache (cache_group, expires_at);

create or replace function public.claim_scheduler_lease(
  p_lease_name text,
  p_owner_id text,
  p_ttl_seconds integer
) returns boolean
language plpgsql
security definer
as $$
declare
  v_claimed boolean := false;
begin
  insert into public.scheduler_leases (lease_name, owner_id, lease_until, heartbeat_at, updated_at)
  values (p_lease_name, p_owner_id, now() + make_interval(secs => p_ttl_seconds), now(), now())
  on conflict (lease_name)
  do update
    set owner_id = excluded.owner_id,
        lease_until = excluded.lease_until,
        heartbeat_at = now(),
        updated_at = now()
  where public.scheduler_leases.lease_until <= now()
     or public.scheduler_leases.owner_id = excluded.owner_id;

  select owner_id = p_owner_id and lease_until > now()
    into v_claimed
  from public.scheduler_leases
  where lease_name = p_lease_name;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.renew_scheduler_lease(
  p_lease_name text,
  p_owner_id text,
  p_ttl_seconds integer
) returns boolean
language plpgsql
security definer
as $$
begin
  update public.scheduler_leases
     set lease_until = now() + make_interval(secs => p_ttl_seconds),
         heartbeat_at = now(),
         updated_at = now()
   where lease_name = p_lease_name
     and owner_id = p_owner_id
     and lease_until > now();

  return found;
end;
$$;

create or replace function public.release_scheduler_lease(
  p_lease_name text,
  p_owner_id text
) returns boolean
language plpgsql
security definer
as $$
begin
  delete from public.scheduler_leases
   where lease_name = p_lease_name
     and owner_id = p_owner_id;

  return found;
end;
$$;

create or replace function public.claim_ephemeral_key(
  p_state_key text,
  p_owner_id text,
  p_ttl_seconds integer
) returns boolean
language plpgsql
security definer
as $$
declare
  v_claimed boolean := false;
begin
  insert into public.distributed_state (state_key, state_value, expires_at, updated_at)
  values (
    p_state_key,
    jsonb_build_object('owner_id', p_owner_id, 'claimed_at', now()),
    now() + make_interval(secs => p_ttl_seconds),
    now()
  )
  on conflict (state_key)
  do update
    set state_value = excluded.state_value,
        expires_at = excluded.expires_at,
        updated_at = now()
  where public.distributed_state.expires_at is null
        or public.distributed_state.expires_at <= now()
        or public.distributed_state.state_value ->> 'owner_id' = p_owner_id;

  select (state_value ->> 'owner_id') = p_owner_id
         and (expires_at is null or expires_at > now())
    into v_claimed
  from public.distributed_state
  where state_key = p_state_key;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.put_distributed_state(
  p_state_key text,
  p_state_value jsonb,
  p_ttl_seconds integer default null
) returns void
language plpgsql
security definer
as $$
begin
  insert into public.distributed_state (state_key, state_value, expires_at, updated_at)
  values (
    p_state_key,
    coalesce(p_state_value, '{}'::jsonb),
    case when p_ttl_seconds is null then null else now() + make_interval(secs => p_ttl_seconds) end,
    now()
  )
  on conflict (state_key)
  do update
    set state_value = excluded.state_value,
        expires_at = excluded.expires_at,
        updated_at = now();
end;
$$;

create or replace function public.consume_distributed_state(
  p_state_key text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_payload jsonb;
begin
  delete from public.distributed_state
   where state_key = p_state_key
     and (expires_at is null or expires_at > now())
  returning state_value into v_payload;

  return v_payload;
end;
$$;

create or replace function public.append_chat_memory(
  p_state_key text,
  p_user_message text,
  p_assistant_message text,
  p_ttl_seconds integer,
  p_limit integer default 4
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_existing jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  select case
           when expires_at is null or expires_at > now() then coalesce(state_value -> 'messages', '[]'::jsonb)
           else '[]'::jsonb
         end
    into v_existing
  from public.distributed_state
  where state_key = p_state_key;

  v_result := (
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    from (
      select value
      from jsonb_array_elements(
        v_existing ||
        jsonb_build_array(
          jsonb_build_object('role', 'user', 'content', p_user_message),
          jsonb_build_object('role', 'assistant', 'content', p_assistant_message)
        )
      ) with ordinality as e(value, ord)
      order by ord desc
      limit greatest(p_limit * 2, 2)
    ) latest
  );

  v_result := (
    select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
    from jsonb_array_elements(v_result) with ordinality as e(value, ord)
  );

  perform public.put_distributed_state(
    p_state_key,
    jsonb_build_object('messages', v_result),
    p_ttl_seconds
  );

  return v_result;
end;
$$;

create or replace function public.claim_alert_delivery(
  p_chat_id text,
  p_symbol text,
  p_alert_type text,
  p_owner_id text,
  p_claim_ttl_seconds integer,
  p_cooldown_hours integer
) returns boolean
language plpgsql
security definer
as $$
declare
  v_claimed boolean := false;
begin
  insert into public.alert_memory (chat_id, symbol, alert_type, claim_owner, claim_expires_at, last_sent_at)
  values (
    p_chat_id,
    p_symbol,
    p_alert_type,
    p_owner_id,
    now() + make_interval(secs => p_claim_ttl_seconds),
    null
  )
  on conflict (chat_id, symbol, alert_type)
  do update
    set claim_owner = excluded.claim_owner,
        claim_expires_at = excluded.claim_expires_at
  where (
          public.alert_memory.last_sent_at is null
          or public.alert_memory.last_sent_at <= now() - make_interval(hours => p_cooldown_hours)
        )
    and (
          public.alert_memory.claim_expires_at is null
          or public.alert_memory.claim_expires_at <= now()
          or public.alert_memory.claim_owner = excluded.claim_owner
        );

  select claim_owner = p_owner_id
         and (claim_expires_at is null or claim_expires_at > now())
         and (
           last_sent_at is null
           or last_sent_at <= now() - make_interval(hours => p_cooldown_hours)
         )
    into v_claimed
  from public.alert_memory
  where chat_id = p_chat_id
    and symbol = p_symbol
    and alert_type = p_alert_type;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.finalize_alert_delivery(
  p_chat_id text,
  p_symbol text,
  p_alert_type text,
  p_owner_id text
) returns boolean
language plpgsql
security definer
as $$
begin
  update public.alert_memory
     set last_sent_at = now(),
         claim_owner = null,
         claim_expires_at = null
   where chat_id = p_chat_id
     and symbol = p_symbol
     and alert_type = p_alert_type
     and claim_owner = p_owner_id;

  return found;
end;
$$;

create or replace function public.release_alert_delivery_claim(
  p_chat_id text,
  p_symbol text,
  p_alert_type text,
  p_owner_id text
) returns boolean
language plpgsql
security definer
as $$
begin
  update public.alert_memory
     set claim_owner = null,
         claim_expires_at = null
   where chat_id = p_chat_id
     and symbol = p_symbol
     and alert_type = p_alert_type
     and claim_owner = p_owner_id;

  return found;
end;
$$;

create or replace function public.claim_execution_action(
  p_trace_id text,
  p_action_key text,
  p_action_type text,
  p_request_payload jsonb
) returns boolean
language plpgsql
security definer
as $$
begin
  insert into public.execution_audit_logs (
    trace_id,
    action_key,
    action_type,
    status,
    request_payload,
    created_at,
    updated_at
  )
  values (
    p_trace_id,
    p_action_key,
    p_action_type,
    'CLAIMED',
    coalesce(p_request_payload, '{}'::jsonb),
    now(),
    now()
  )
  on conflict (action_key) do nothing;

  return found;
end;
$$;
