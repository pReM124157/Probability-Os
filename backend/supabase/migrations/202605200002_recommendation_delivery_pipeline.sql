ALTER TABLE recommendation_audit
  ADD COLUMN IF NOT EXISTS telegram_delivery_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS telegram_delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS telegram_delivery_last_attempt timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_delivery_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_delivery_error text,
  ADD COLUMN IF NOT EXISTS telegram_delivery_message_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'recommendation_audit_telegram_delivery_status_check'
  ) THEN
    ALTER TABLE recommendation_audit
      ADD CONSTRAINT recommendation_audit_telegram_delivery_status_check
      CHECK (telegram_delivery_status IN ('PENDING', 'SENT', 'FAILED', 'RETRY_SCHEDULED', 'SUPPRESSED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recommendation_delivery_status
  ON recommendation_audit (telegram_delivery_status);

CREATE INDEX IF NOT EXISTS idx_recommendation_delivery_attempts
  ON recommendation_audit (telegram_delivery_attempts);

CREATE INDEX IF NOT EXISTS idx_recommendation_delivery_sent_at
  ON recommendation_audit (telegram_delivery_sent_at DESC);
