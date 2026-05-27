alter table public.recommendation_audit
  add column if not exists updated_at timestamptz;

create or replace function public.block_recommendation_audit_mutation()
returns trigger
language plpgsql
as $$
declare
  old_core jsonb;
  new_core jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception 'recommendation_audit is append-only; % is not allowed', tg_op;
  end if;

  if tg_op = 'UPDATE' then
    old_core := to_jsonb(old) - array[
      'telegram_delivery_status',
      'telegram_delivery_attempts',
      'telegram_delivery_message_id',
      'telegram_delivery_error',
      'telegram_delivery_last_attempt',
      'telegram_delivery_sent_at',
      'updated_at'
    ];
    new_core := to_jsonb(new) - array[
      'telegram_delivery_status',
      'telegram_delivery_attempts',
      'telegram_delivery_message_id',
      'telegram_delivery_error',
      'telegram_delivery_last_attempt',
      'telegram_delivery_sent_at',
      'updated_at'
    ];

    if new_core <> old_core then
      raise exception 'recommendation_audit is append-only; % is not allowed', tg_op;
    end if;

    new.updated_at := now();
    return new;
  end if;

  raise exception 'recommendation_audit is append-only; % is not allowed', tg_op;
end;
$$;

update public.recommendation_audit
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;