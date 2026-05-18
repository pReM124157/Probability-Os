create extension if not exists pgcrypto;

create table if not exists public.recommendation_outcomes (
  id uuid primary key default gen_random_uuid(),
  recommendation_id text unique not null,
  symbol text not null,
  entry_price numeric not null,
  recommendation_created_at timestamptz not null,
  latest_price numeric null,
  latest_price_at timestamptz null,
  outcome_status text not null,
  unrealized_return_pct numeric null,
  realized_return_pct numeric null,
  max_upside_pct numeric null,
  max_drawdown_pct numeric null,
  target_hit_at timestamptz null,
  stop_hit_at timestamptz null,
  expiry_at timestamptz null,
  closed_at timestamptz null,
  rr_ratio numeric null,
  volatility_at_entry numeric null,
  candles_processed integer not null default 0,
  last_tracking_run timestamptz null,
  tracking_version text null,
  provider_metadata jsonb null,
  created_at timestamptz not null default now(),
  constraint recommendation_outcomes_status_chk
    check (outcome_status in ('OPEN','TARGET_HIT','STOP_HIT','EXPIRED','CLOSED_MANUAL')),
  constraint recommendation_outcomes_recommendation_fk
    foreign key (recommendation_id)
    references public.recommendation_audit(recommendation_id)
    on delete restrict
);

create index if not exists recommendation_outcomes_status_idx
  on public.recommendation_outcomes(outcome_status);

create index if not exists recommendation_outcomes_symbol_status_idx
  on public.recommendation_outcomes(symbol, outcome_status);

create index if not exists recommendation_outcomes_last_tracking_run_desc_idx
  on public.recommendation_outcomes(last_tracking_run desc);

create index if not exists recommendation_outcomes_recommendation_created_desc_idx
  on public.recommendation_outcomes(recommendation_created_at desc);
