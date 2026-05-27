-- ============================================================
-- FINSIGHT SCHEMA MIGRATION: v1.1.0
-- Adds missing trend_state column to adaptive_learning_memory
-- ============================================================
-- Run this migration in Supabase Dashboard > SQL Editor
-- Or via: supabase db push (if using Supabase CLI)
-- ============================================================

-- 1. Add trend_state column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'adaptive_learning_memory'
      AND column_name = 'trend_state'
  ) THEN
    ALTER TABLE adaptive_learning_memory
    ADD COLUMN trend_state TEXT DEFAULT 'UNKNOWN';

    COMMENT ON COLUMN adaptive_learning_memory.trend_state IS
      'Market trend state at time of decision: BULLISH | BEARISH | NEUTRAL | UNKNOWN';
  END IF;
END
$$;

-- 2. Backfill existing rows with UNKNOWN
UPDATE adaptive_learning_memory
SET trend_state = 'UNKNOWN'
WHERE trend_state IS NULL;

-- 3. Add NOT NULL constraint after backfill (optional, comment out if too strict)
-- ALTER TABLE adaptive_learning_memory
--   ALTER COLUMN trend_state SET NOT NULL;

-- 4. Add index for analytics queries on trend_state
CREATE INDEX IF NOT EXISTS idx_adaptive_learning_trend_state
  ON adaptive_learning_memory (trend_state);

-- 5. Add index for regime + trend_state combined queries
CREATE INDEX IF NOT EXISTS idx_adaptive_learning_regime_trend
  ON adaptive_learning_memory (regime, trend_state);

-- ============================================================
-- VERIFY: Run these after applying the migration
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'adaptive_learning_memory'
--   ORDER BY ordinal_position;
--
-- SELECT trend_state, COUNT(*) as count
--   FROM adaptive_learning_memory
--   GROUP BY trend_state;
-- ============================================================
