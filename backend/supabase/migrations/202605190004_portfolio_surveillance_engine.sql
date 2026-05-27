create table if not exists public.portfolio_positions (
  ticker text primary key,
  quantity numeric not null default 0,
  avg_price numeric not null default 0,
  current_price numeric not null default 0,
  unrealized_pnl numeric not null default 0,
  sector text,
  beta numeric not null default 1,
  volatility numeric not null default 0,
  trend_state text,
  risk_score numeric not null default 0,
  correlation_risk numeric not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists portfolio_positions_sector_idx
  on public.portfolio_positions (sector);
create index if not exists portfolio_positions_updated_at_desc_idx
  on public.portfolio_positions (updated_at desc);

create table if not exists public.portfolio_alerts (
  id bigserial primary key,
  ticker text not null,
  alert_type text not null,
  urgency text not null,
  action text not null,
  quantity numeric not null default 0,
  reasoning text not null,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_alerts_created_at_desc_idx
  on public.portfolio_alerts (created_at desc);
create index if not exists portfolio_alerts_ticker_idx
  on public.portfolio_alerts (ticker);

create table if not exists public.portfolio_history (
  id bigserial primary key,
  portfolio_value numeric not null default 0,
  drawdown numeric not null default 0,
  volatility numeric not null default 0,
  concentration numeric not null default 0,
  heat_score numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_history_created_at_desc_idx
  on public.portfolio_history (created_at desc);
