create table if not exists public.provider_health (
  provider text primary key,
  success_rate double precision default 0,
  avg_latency double precision default 0,
  reliability_score double precision default 0,
  cooldown_score double precision default 0,
  timeout_rate double precision default 0,
  consecutive_failures integer default 0,
  cooldown_until timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  updated_at timestamptz default now()
);

create table if not exists public.shared_cache (
  cache_key text primary key,
  cache_group text not null,
  payload jsonb not null,
  ttl_seconds integer default 300,
  expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.queue_health_metrics (
  id bigserial primary key,
  queue_name text not null,
  backlog integer default 0,
  avg_latency double precision default 0,
  worker_failures integer default 0,
  retries integer default 0,
  worker_count integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.monte_carlo_results (
  id bigserial primary key,
  ticker text not null,
  simulation_count integer not null,
  var_95 double precision,
  cvar_95 double precision,
  tail_probability double precision,
  expected_distribution jsonb,
  created_at timestamptz default now()
);
