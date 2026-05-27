-- =====================================================================
-- MACRO REPORT DELIVERY PERSISTENCE
-- Stores AI macro intelligence report delivery state for:
--   - Duplicate suppression (same report type + day cannot resend)
--   - Replay-safe state restoration
--   - Audit trail of delivered reports
-- =====================================================================

CREATE TABLE IF NOT EXISTS macro_report_deliveries (
  id                    BIGSERIAL PRIMARY KEY,
  report_type           TEXT NOT NULL,              -- 'DAILY_MACRO' | 'WEEKLY_INSTITUTIONAL' | 'MACRO_RISK_ALERT'
  idempotency_key       TEXT NOT NULL UNIQUE,       -- e.g. 'DAILY_MACRO:2026-05-24'
  scheduler_source      TEXT NOT NULL,              -- 'scheduler:macro_daily' etc.
  delivery_status       TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'SENT' | 'FAILED' | 'SUPPRESSED'
  attempts              INTEGER NOT NULL DEFAULT 0,
  subscriber_count      INTEGER,
  report_summary        TEXT,                       -- truncated preview of the generated report
  sent_at               TIMESTAMPTZ,
  last_attempt_at       TIMESTAMPTZ,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast idempotency lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_macro_report_deliveries_idempotency_key
  ON macro_report_deliveries (idempotency_key);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_macro_report_deliveries_status
  ON macro_report_deliveries (delivery_status, report_type);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_macro_report_deliveries_created_at
  ON macro_report_deliveries (created_at DESC);

-- RLS: allow service role full access
ALTER TABLE macro_report_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON macro_report_deliveries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_macro_report_deliveries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_macro_report_deliveries_updated_at ON macro_report_deliveries;
CREATE TRIGGER trg_macro_report_deliveries_updated_at
  BEFORE UPDATE ON macro_report_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION update_macro_report_deliveries_updated_at();
