import supabase from "./supabase.service.js";
import { getHistoricalCandles } from "./marketData.service.js";
import { logEvent } from "./telemetry.service.js";

function classifySample(count) {
  if (count >= 100) return "STRONG";
  if (count >= 30) return "MODERATE";
  return "WEAK";
}

function isClosed(status) {
  return ["TARGET_HIT", "STOP_HIT", "EXPIRED", "CLOSED_MANUAL"].includes(String(status || "").toUpperCase());
}

export async function buildDatasetMaturityReport() {
  const { data: audits, error: auditError } = await supabase
    .from("recommendation_audit")
    .select("recommendation_id,symbol,recommendation_type,sector,market_regime,created_at");
  if (auditError) throw auditError;

  const { data: outcomes, error: outcomeError } = await supabase
    .from("recommendation_outcomes")
    .select("recommendation_id,outcome_status,recommendation_created_at");
  if (outcomeError) throw outcomeError;

  const outcomeMap = new Map((outcomes || []).map((o) => [o.recommendation_id, o]));
  const rows = (audits || []).map((a) => ({ ...a, outcome: outcomeMap.get(a.recommendation_id) || null }));

  const sectors = new Map();
  const strategies = new Map();
  const regimes = new Map();
  let closedCount = 0;

  for (const row of rows) {
    const sector = String(row.sector || "UNKNOWN");
    const strategy = String(row.recommendation_type || "UNKNOWN");
    const regime = String(row.market_regime || "UNKNOWN");
    sectors.set(sector, (sectors.get(sector) || 0) + 1);
    strategies.set(strategy, (strategies.get(strategy) || 0) + 1);
    regimes.set(regime, (regimes.get(regime) || 0) + 1);
    if (isClosed(row.outcome?.outcome_status)) closedCount += 1;
  }

  const report = {
    generated_at: new Date().toISOString(),
    totals: {
      recommendations: rows.length,
      outcomes: (outcomes || []).length,
      closed_outcomes: closedCount
    },
    sector_coverage: Array.from(sectors.entries()).map(([sector, count]) => ({
      sector,
      count,
      class: classifySample(count)
    })).sort((a, b) => b.count - a.count),
    strategy_coverage: Array.from(strategies.entries()).map(([strategy, count]) => ({
      strategy,
      count,
      class: classifySample(count)
    })).sort((a, b) => b.count - a.count),
    regime_coverage: Array.from(regimes.entries()).map(([regime, count]) => ({
      regime,
      count,
      class: classifySample(count)
    })).sort((a, b) => b.count - a.count),
    replay_depth: {
      min_recommended_closed_sample: 30,
      current_closed_sample: closedCount,
      class: classifySample(closedCount)
    }
  };

  logEvent("dataset.maturity.report.generated", {
    recommendations: report.totals.recommendations,
    outcomes: report.totals.outcomes,
    closed_outcomes: report.totals.closed_outcomes
  });
  return report;
}

export async function runHistoricalDatasetEnrichment({ days = 730, limit = 250 } = {}) {
  const { data: audits, error } = await supabase
    .from("recommendation_audit")
    .select("symbol")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const symbols = Array.from(new Set((audits || []).map((r) => String(r.symbol || "").toUpperCase()).filter(Boolean)));
  let hydrated = 0;
  let failed = 0;
  for (const symbol of symbols) {
    try {
      const candles = await getHistoricalCandles(symbol, { days, interval: "1d" });
      if (Array.isArray(candles) && candles.length >= 20) hydrated += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  logEvent("dataset.enrichment.completed", {
    symbols_considered: symbols.length,
    hydrated,
    failed
  });
  return { symbols_considered: symbols.length, hydrated, failed };
}
