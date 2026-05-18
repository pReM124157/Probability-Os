-- Compatibility migration: recommendation_audit canonical schema is defined in
-- 20260518_recommendation_audit_foundation.sql.
--
-- This migration intentionally avoids redefining recommendation_audit with an
-- incompatible primary key/type shape (legacy uuid recommendation_id + ts/model/
-- recommendation columns). Redefinition causes migration replay fragility and
-- schema cache inconsistencies.
--
-- Preserve useful index intent against canonical columns.
create index if not exists recommendation_audit_symbol_ts_idx
  on public.recommendation_audit(symbol, created_at desc);

create index if not exists recommendation_audit_recommendation_idx
  on public.recommendation_audit(action);
