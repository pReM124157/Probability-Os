create extension if not exists pgcrypto;

create table if not exists public.adaptive_model_state (
  id uuid primary key default gen_random_uuid(),
  model_key text unique not null,
  model_type text not null,
  sector text,
  strategy_name text,
  regime text,
  confidence_multiplier numeric default 1,
  trust_score numeric default 50,
  drift_score numeric default 0,
  stability_score numeric default 0,
  calibration_error numeric default 0,
  rolling_win_rate numeric default 0,
  rolling_expectancy numeric default 0,
  rolling_sharpe numeric default 0,
  rolling_alpha numeric default 0,
  rolling_drawdown numeric default 0,
  sample_size integer default 0,
  decay_factor numeric default 1,
  adaptive_weight numeric default 1,
  reward_score numeric default 0,
  penalty_score numeric default 0,
  replay_consistency numeric default 0,
  institutional_grade text,
  last_retrained_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  version text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.model_drift_events (
  id uuid primary key default gen_random_uuid(),
  model_key text not null,
  drift_type text not null,
  previous_score numeric,
  current_score numeric,
  severity text,
  triggered_by text,
  detection_window text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.adaptive_recommendation_scores (
  id uuid primary key default gen_random_uuid(),
  recommendation_id text not null,
  original_confidence numeric,
  adjusted_confidence numeric,
  confidence_delta numeric,
  adaptive_weight numeric,
  trust_score numeric,
  drift_penalty numeric,
  calibration_adjustment numeric,
  sector_adjustment numeric,
  strategy_adjustment numeric,
  regime_adjustment numeric,
  final_score numeric,
  scoring_version text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists adaptive_model_state_model_key_idx
  on public.adaptive_model_state(model_key);

create index if not exists adaptive_model_state_model_type_idx
  on public.adaptive_model_state(model_type);

create index if not exists model_drift_events_model_key_idx
  on public.model_drift_events(model_key);

create index if not exists adaptive_recommendation_scores_recommendation_id_idx
  on public.adaptive_recommendation_scores(recommendation_id);
