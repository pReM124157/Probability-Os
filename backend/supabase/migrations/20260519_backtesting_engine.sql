create extension if not exists pgcrypto;

create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  backtest_id text unique not null,
  strategy_name text not null,
  universe text not null,
  start_date date not null,
  end_date date not null,
  total_trades integer,
  wins integer,
  losses integer,
  win_rate numeric,
  expectancy numeric,
  sharpe_ratio numeric,
  sortino_ratio numeric,
  max_drawdown numeric,
  cagr numeric,
  benchmark_return numeric,
  alpha numeric,
  beta numeric,
  volatility numeric,
  profit_factor numeric,
  avg_holding_days numeric,
  total_return_pct numeric,
  final_equity numeric,
  initial_capital numeric,
  trade_log jsonb default '[]'::jsonb,
  equity_curve jsonb default '[]'::jsonb,
  benchmark_curve jsonb default '[]'::jsonb,
  replay_metadata jsonb default '{}'::jsonb,
  calculation_version text,
  created_at timestamptz default now()
);

create table if not exists public.backtest_trade_log (
  id uuid primary key default gen_random_uuid(),
  backtest_id text not null,
  recommendation_id text,
  symbol text,
  action text,
  entry_date timestamptz,
  exit_date timestamptz,
  entry_price numeric,
  exit_price numeric,
  return_pct numeric,
  holding_days numeric,
  outcome_status text,
  strategy_name text,
  market_regime text,
  confidence numeric,
  created_at timestamptz default now()
);

create index if not exists backtest_runs_created_at_desc_idx
  on public.backtest_runs(created_at desc);

create index if not exists backtest_runs_strategy_name_idx
  on public.backtest_runs(strategy_name);

create index if not exists backtest_trade_log_backtest_id_idx
  on public.backtest_trade_log(backtest_id);

create index if not exists backtest_trade_log_symbol_idx
  on public.backtest_trade_log(symbol);
