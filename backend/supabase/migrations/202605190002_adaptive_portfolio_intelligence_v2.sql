create table if not exists public.portfolio_correlation_matrix (
  id bigserial primary key,
  user_id text not null,
  ticker_a text not null,
  ticker_b text not null,
  rolling_correlation numeric not null default 0,
  covariance numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_correlation_matrix_created_at_desc_idx
  on public.portfolio_correlation_matrix (created_at desc);

create table if not exists public.portfolio_stress_tests (
  id bigserial primary key,
  user_id text not null,
  scenario text not null,
  expected_drawdown numeric not null default 0,
  survival_probability numeric not null default 0,
  volatility_projection numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_stress_tests_created_at_desc_idx
  on public.portfolio_stress_tests (created_at desc);

create table if not exists public.adaptive_learning_memory (
  id bigserial primary key,
  strategy_type text not null,
  regime text not null,
  confidence_score numeric not null default 0,
  historical_accuracy numeric not null default 0,
  recalibrated_weight numeric not null default 0,
  prediction_accuracy numeric not null default 0,
  exit_quality numeric not null default 0,
  unrealized_profit_captured numeric not null default 0,
  downside_avoided numeric not null default 0,
  trend_state text,
  sector text,
  volatility_regime text,
  created_at timestamptz not null default now()
);

create index if not exists adaptive_learning_memory_created_at_desc_idx
  on public.adaptive_learning_memory (created_at desc);

create table if not exists public.reasoning_audit_logs (
  id bigserial primary key,
  user_id text not null,
  decision_type text not null,
  reasoning text not null,
  mathematical_basis text not null,
  confidence numeric not null default 0,
  regime_assumptions jsonb not null default '{}'::jsonb,
  model_assumptions jsonb not null default '{}'::jsonb,
  outcome_accuracy numeric,
  created_at timestamptz not null default now()
);

create index if not exists reasoning_audit_logs_created_at_desc_idx
  on public.reasoning_audit_logs (created_at desc);

alter table if exists public.portfolio_history
  add column if not exists user_id text,
  add column if not exists regime text,
  add column if not exists notes text;
