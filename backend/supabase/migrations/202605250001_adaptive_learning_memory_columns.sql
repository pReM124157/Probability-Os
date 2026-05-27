alter table if exists public.adaptive_learning_memory
  add column if not exists trend_state text,
  add column if not exists volatility_regime text;

