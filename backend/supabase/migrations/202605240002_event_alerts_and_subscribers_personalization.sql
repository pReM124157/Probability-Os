-- Create event_alerts table for Phase 5 News/Event Alerts
CREATE TABLE IF NOT EXISTS event_alerts (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  severity TEXT,
  affected_sectors JSONB,
  delivery_status TEXT DEFAULT 'PENDING',
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_alerts_status
ON event_alerts(delivery_status);

-- Alter subscribers table to add personalized delivery preferences for Phase 6
ALTER TABLE subscribers
ADD COLUMN IF NOT EXISTS preferred_risk TEXT,
ADD COLUMN IF NOT EXISTS preferred_sectors JSONB,
ADD COLUMN IF NOT EXISTS enable_macro_reports BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS enable_trade_updates BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS enable_momentum_alerts BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS delivery_mode TEXT DEFAULT 'NORMAL';

-- Alter recommendation_audit table to add market_regime_snapshot for Phase 2 Live Market Validation
ALTER TABLE recommendation_audit
ADD COLUMN IF NOT EXISTS market_regime_snapshot JSONB;

