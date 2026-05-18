create extension if not exists pgcrypto;

create table if not exists public.recommendation_audit (
  id uuid primary key default gen_random_uuid(),
  recommendation_id text unique not null,
  symbol text not null,
  exchange text null,
  recommendation_type text not null,
  action text not null,
  confidence numeric not null,
  conviction text null,
  entry_price numeric null,
  stop_loss numeric null,
  target_price numeric null,
  rr_ratio numeric null,
  horizon text null,
  sector text null,
  market_regime text null,
  valuation_score numeric null,
  technical_score numeric null,
  risk_score numeric null,
  liquidity_score numeric null,
  volatility_score numeric null,
  ai_summary text null,
  reasoning_snapshot jsonb null,
  indicator_snapshot jsonb null,
  market_snapshot jsonb null,
  provider_metadata jsonb null,
  analysis_version text null,
  generated_by text null,
  user_id text null,
  telegram_chat_id text null,
  created_at timestamptz not null default now()
);

alter table public.recommendation_audit
  add column if not exists recommendation_id text,
  add column if not exists symbol text,
  add column if not exists exchange text,
  add column if not exists recommendation_type text,
  add column if not exists action text,
  add column if not exists confidence numeric,
  add column if not exists conviction text,
  add column if not exists entry_price numeric,
  add column if not exists stop_loss numeric,
  add column if not exists target_price numeric,
  add column if not exists rr_ratio numeric,
  add column if not exists horizon text,
  add column if not exists sector text,
  add column if not exists market_regime text,
  add column if not exists valuation_score numeric,
  add column if not exists technical_score numeric,
  add column if not exists risk_score numeric,
  add column if not exists liquidity_score numeric,
  add column if not exists volatility_score numeric,
  add column if not exists ai_summary text,
  add column if not exists reasoning_snapshot jsonb,
  add column if not exists indicator_snapshot jsonb,
  add column if not exists market_snapshot jsonb,
  add column if not exists provider_metadata jsonb,
  add column if not exists analysis_version text,
  add column if not exists generated_by text,
  add column if not exists user_id text,
  add column if not exists telegram_chat_id text,
  add column if not exists created_at timestamptz;

alter table public.recommendation_audit
  alter column recommendation_id set not null,
  alter column symbol set not null,
  alter column recommendation_type set not null,
  alter column action set not null,
  alter column confidence set not null,
  alter column created_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recommendation_audit_confidence_chk'
  ) then
    alter table public.recommendation_audit
      add constraint recommendation_audit_confidence_chk
      check (confidence between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'recommendation_audit_action_chk'
  ) then
    alter table public.recommendation_audit
      add constraint recommendation_audit_action_chk
      check (action in ('BUY','SELL','HOLD','AVOID'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'recommendation_audit_rr_ratio_chk'
  ) then
    alter table public.recommendation_audit
      add constraint recommendation_audit_rr_ratio_chk
      check (rr_ratio is null or rr_ratio >= 0);
  end if;
end $$;

create unique index if not exists recommendation_audit_recommendation_id_uidx
  on public.recommendation_audit(recommendation_id);

create index if not exists recommendation_audit_created_at_desc_idx
  on public.recommendation_audit(created_at desc);

create index if not exists recommendation_audit_symbol_created_at_idx
  on public.recommendation_audit(symbol, created_at desc);

create index if not exists recommendation_audit_confidence_desc_idx
  on public.recommendation_audit(confidence desc);

create index if not exists recommendation_audit_sector_idx
  on public.recommendation_audit(sector);

create index if not exists recommendation_audit_recommendation_type_idx
  on public.recommendation_audit(recommendation_type);

create or replace function public.block_recommendation_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'recommendation_audit is append-only; % is not allowed', tg_op;
end;
$$;

drop trigger if exists recommendation_audit_no_update on public.recommendation_audit;
create trigger recommendation_audit_no_update
before update on public.recommendation_audit
for each row
execute function public.block_recommendation_audit_mutation();

drop trigger if exists recommendation_audit_no_delete on public.recommendation_audit;
create trigger recommendation_audit_no_delete
before delete on public.recommendation_audit
for each row
execute function public.block_recommendation_audit_mutation();

create or replace function public.get_recommendation_by_id(p_recommendation_id text)
returns setof public.recommendation_audit
language sql
security definer
as $$
  select *
  from public.recommendation_audit
  where recommendation_id = p_recommendation_id
  order by created_at desc
  limit 1;
$$;
