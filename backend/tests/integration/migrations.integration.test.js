import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve("supabase/migrations");

function readMigration(name) {
  return fs.readFileSync(path.join(migrationsDir, name), "utf8");
}

describe("integration: fresh migration replay safety", () => {
  it("has single canonical recommendation_audit create-table definition", () => {
    const files = fs.readdirSync(migrationsDir).sort();
    const createDefs = files
      .map((file) => ({ file, sql: readMigration(file) }))
      .filter(({ sql }) => /create table if not exists public\.recommendation_audit/i.test(sql));
    expect(createDefs.length).toBe(1);
    expect(createDefs[0].file).toBe("202605180001_recommendation_audit_foundation.sql");
    expect(createDefs[0].sql).toMatch(/recommendation_id text unique not null/i);
  });

  it("keeps required infrastructure tables and indexes declared", () => {
    const backtesting = readMigration("202605190003_backtesting_engine.sql");
    const adaptive = readMigration("202605190001_adaptive_intelligence_engine.sql");
    const analytics = readMigration("202605190005_public_analytics_layer.sql");
    const surveillance = readMigration("202605190004_portfolio_surveillance_engine.sql");
    const adaptiveV2 = readMigration("202605190002_adaptive_portfolio_intelligence_v2.sql");
    const realQuant = readMigration("202605190006_real_quantitative_pipeline.sql");

    expect(backtesting).toMatch(/create table if not exists public\.backtest_runs/i);
    expect(backtesting).toMatch(/create index if not exists backtest_runs_created_at_desc_idx/i);
    expect(adaptive).toMatch(/create table if not exists public\.adaptive_model_state/i);
    expect(adaptive).toMatch(/create index if not exists adaptive_model_state_model_key_idx/i);
    expect(analytics).toMatch(/create table if not exists public\.analytics_snapshots/i);
    expect(analytics).toMatch(/create index if not exists analytics_snapshots_generated_at_desc_idx/i);

    expect(surveillance).toMatch(/create table if not exists public\.portfolio_positions/i);
    expect(surveillance).toMatch(/create table if not exists public\.portfolio_alerts/i);
    expect(surveillance).toMatch(/create table if not exists public\.portfolio_history/i);
    expect(surveillance).toMatch(/create index if not exists portfolio_history_created_at_desc_idx/i);

    expect(adaptiveV2).toMatch(/create table if not exists public\.portfolio_correlation_matrix/i);
    expect(adaptiveV2).toMatch(/create table if not exists public\.portfolio_stress_tests/i);
    expect(adaptiveV2).toMatch(/create table if not exists public\.adaptive_learning_memory/i);
    expect(adaptiveV2).toMatch(/create table if not exists public\.reasoning_audit_logs/i);
    expect(realQuant).toMatch(/create table if not exists public\.historical_market_returns/i);
    expect(realQuant).toMatch(/create table if not exists public\.portfolio_covariance_matrix/i);
    expect(realQuant).toMatch(/create table if not exists public\.monte_carlo_forecasts/i);
    expect(realQuant).toMatch(/create table if not exists public\.historical_regime_performance/i);
  });
});
