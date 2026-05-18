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
    expect(createDefs[0].file).toBe("20260518_recommendation_audit_foundation.sql");
    expect(createDefs[0].sql).toMatch(/recommendation_id text unique not null/i);
  });

  it("keeps required infrastructure tables and indexes declared", () => {
    const backtesting = readMigration("20260519_backtesting_engine.sql");
    const adaptive = readMigration("20260519_adaptive_intelligence_engine.sql");
    const analytics = readMigration("20260519_public_analytics_layer.sql");
    expect(backtesting).toMatch(/create table if not exists public\.backtest_runs/i);
    expect(backtesting).toMatch(/create index if not exists backtest_runs_created_at_desc_idx/i);
    expect(adaptive).toMatch(/create table if not exists public\.adaptive_model_state/i);
    expect(adaptive).toMatch(/create index if not exists adaptive_model_state_model_key_idx/i);
    expect(analytics).toMatch(/create table if not exists public\.analytics_snapshots/i);
    expect(analytics).toMatch(/create index if not exists analytics_snapshots_generated_at_desc_idx/i);
  });
});
