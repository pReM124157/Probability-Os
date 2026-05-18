create extension if not exists pgcrypto;

create table if not exists public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_type text not null,
  calculation_window text not null,
  generated_at timestamptz not null default now(),
  total_recommendations integer null,
  closed_recommendations integer null,
  win_rate numeric null,
  avg_return_pct numeric null,
  median_return_pct numeric null,
  sharpe_ratio numeric null,
  expectancy numeric null,
  profit_factor numeric null,
  calibration_drift numeric null,
  best_sector text null,
  worst_sector text null,
  best_strategy text null,
  worst_strategy text null,
  high_confidence_win_rate numeric null,
  medium_confidence_win_rate numeric null,
  low_confidence_win_rate numeric null,
  snapshot_metadata jsonb not null default '{}'::jsonb,
  analytics_version text null,
  generated_by text null
);

create table if not exists public.sector_performance (
  id uuid primary key default gen_random_uuid(),
  sector text not null,
  total_trades integer not null,
  win_rate numeric not null,
  avg_return_pct numeric not null,
  profit_factor numeric not null,
  sharpe_ratio numeric not null,
  expectancy numeric not null,
  last_updated timestamptz not null default now()
);

create table if not exists public.strategy_leaderboard (
  id uuid primary key default gen_random_uuid(),
  strategy_name text not null,
  total_trades integer not null,
  wins integer not null,
  losses integer not null,
  win_rate numeric not null,
  avg_return_pct numeric not null,
  expectancy numeric not null,
  sharpe_ratio numeric not null,
  profit_factor numeric not null,
  statistical_grade text null,
  last_updated timestamptz not null default now()
);

create index if not exists sector_performance_sector_idx
  on public.sector_performance(sector);

create index if not exists strategy_leaderboard_strategy_name_idx
  on public.strategy_leaderboard(strategy_name);

create index if not exists analytics_snapshots_generated_at_desc_idx
  on public.analytics_snapshots(generated_at desc);
