create table if not exists public.historical_market_returns (
  id bigserial primary key,
  ticker text not null,
  timeframe text not null,
  returns jsonb not null default '[]'::jsonb,
  volatility numeric not null default 0,
  beta numeric not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists historical_market_returns_ticker_timeframe_idx
  on public.historical_market_returns (ticker, timeframe);

create table if not exists public.portfolio_covariance_matrix (
  id bigserial primary key,
  ticker_a text not null,
  ticker_b text not null,
  covariance numeric not null default 0,
  rolling_correlation numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_covariance_matrix_created_at_desc_idx
  on public.portfolio_covariance_matrix (created_at desc);

create table if not exists public.monte_carlo_forecasts (
  id bigserial primary key,
  ticker text not null,
  expected_range_low numeric not null default 0,
  expected_range_high numeric not null default 0,
  downside_probability numeric not null default 0,
  upside_probability numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists monte_carlo_forecasts_created_at_desc_idx
  on public.monte_carlo_forecasts (created_at desc);

create table if not exists public.historical_regime_performance (
  id bigserial primary key,
  regime text not null,
  strategy text not null,
  win_rate numeric not null default 0,
  avg_return numeric not null default 0,
  avg_drawdown numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists historical_regime_performance_created_at_desc_idx
  on public.historical_regime_performance (created_at desc);
