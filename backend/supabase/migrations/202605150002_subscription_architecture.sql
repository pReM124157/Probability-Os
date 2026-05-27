-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Finsight AI — Subscription Architecture Migration
-- Migrates from Payment Links to Razorpay Subscriptions
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ─── 1. Payments audit table ─────────────────────────────
-- Stores every captured payment for history and deduplication.
create table if not exists public.payments (
  id            text primary key,             -- Razorpay payment ID (pay_xxx)
  telegram_chat_id text not null,
  subscription_id  text null,                 -- Razorpay subscription ID (sub_xxx)
  amount        bigint not null,              -- amount in paise
  currency      text not null default 'INR',
  status        text not null default 'captured',
  event_type    text null,                    -- which webhook event wrote this row
  created_at    timestamptz not null default now()
);

create index if not exists payments_chat_idx
  on public.payments (telegram_chat_id);

create index if not exists payments_sub_idx
  on public.payments (subscription_id);


-- ─── 2. Subscription event idempotency table ─────────────
-- Each webhook event is stamped here BEFORE any side effects.
-- Re-delivered events are silently ignored (ON CONFLICT DO NOTHING).
create table if not exists public.subscription_events (
  event_id      text primary key,             -- Razorpay webhook event unique ID
  event_type    text not null,
  subscription_id text null,
  telegram_chat_id text null,
  processed_at  timestamptz not null default now(),
  payload_preview jsonb null                  -- first 1 KB for debugging
);

create index if not exists sub_events_sub_idx
  on public.subscription_events (subscription_id);

create index if not exists sub_events_chat_idx
  on public.subscription_events (telegram_chat_id);


-- ─── 3. Ensure subscribers has required columns ──────────
-- These are added safely; no-op if already present.
alter table public.subscribers
  add column if not exists razorpay_subscription_id text null,
  add column if not exists razorpay_payment_link_id  text null,  -- kept for historical rows
  add column if not exists subscription_started_at   timestamptz null,
  add column if not exists last_payment_at            timestamptz null,
  add column if not exists cancel_at_period_end       boolean not null default false,
  add column if not exists free_usage_count           integer not null default 0,
  add column if not exists usage_started_at           timestamptz null;

-- Unique constraint so findChatIdBySubscriptionId can JOIN quickly
create unique index if not exists subscribers_razorpay_sub_idx
  on public.subscribers (razorpay_subscription_id)
  where razorpay_subscription_id is not null;
