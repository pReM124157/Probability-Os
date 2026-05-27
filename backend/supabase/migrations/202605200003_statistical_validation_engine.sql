create extension if not exists pgcrypto;

create table if not exists public.recommendation_statistics (
  id uuid primary key default gen_random_uuid(),
  calculation_window text not null,
  total_recommendations integer not null,
  closed_recommendations integer not null,
  win_rate numeric not null,
  avg_return_pct numeric not null,
  median_return_pct numeric not null,
  avg_max_upside_pct numeric not null,
  avg_max_drawdown_pct numeric not null,
  avg_holding_days numeric not null,
  target_hit_rate numeric not null,
  stop_hit_rate numeric not null,
  expectancy numeric not null,
  sharpe_ratio numeric not null,
  profit_factor numeric not null,
  calculation_version text not null default 'stats-v1',
  source_recommendation_count integer not null,
  replay_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.confidence_calibration (
  id uuid primary key default gen_random_uuid(),
  confidence_bucket text not null,
  total_predictions integer not null,
  actual_win_rate numeric not null,
  avg_return_pct numeric not null,
  avg_drawdown_pct numeric not null,
  calibration_error numeric not null,
  calculation_version text not null default 'stats-v1',
  source_recommendation_count integer not null,
  replay_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.strategy_performance (
  id uuid primary key default gen_random_uuid(),
  strategy_name text not null,
  sector text not null,
  market_regime text not null,
  total_recommendations integer not null,
  win_rate numeric not null,
  avg_return_pct numeric not null,
  expectancy numeric not null,
  target_hit_rate numeric not null,
  stop_hit_rate numeric not null,
  calculation_version text not null default 'stats-v1',
  source_recommendation_count integer not null,
  replay_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.recommendation_outcomes
  add column if not exists recommendation_quality_grade text null;

create index if not exists recommendation_statistics_created_at_desc_idx
  on public.recommendation_statistics(created_at desc);

create index if not exists confidence_calibration_created_at_desc_idx
  on public.confidence_calibration(created_at desc);

create index if not exists strategy_performance_created_at_desc_idx
  on public.strategy_performance(created_at desc);
