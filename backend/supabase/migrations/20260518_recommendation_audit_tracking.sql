create table if not exists public.recommendation_audit (
  recommendation_id uuid primary key default gen_random_uuid(),
  symbol text not null,
  ts timestamptz not null default now(),
  model text not null,
  confidence numeric not null,
  recommendation text not null,
  entry_price numeric null,
  stop_loss numeric null,
  target numeric null,
  sector text null,
  rationale text null,
  supporting_signals jsonb not null default '{}'::jsonb,
  market_regime text null,
  prompt_context jsonb null,
  output_payload jsonb null,
  market_snapshot jsonb null,
  provider_sources jsonb null
);

create index if not exists recommendation_audit_symbol_ts_idx
  on public.recommendation_audit(symbol, ts desc);

create index if not exists recommendation_audit_recommendation_idx
  on public.recommendation_audit(recommendation);
