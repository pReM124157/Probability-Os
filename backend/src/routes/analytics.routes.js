import express from "express";
import supabase from "../services/supabase.service.js";
import {
  generateConfidenceAnalytics,
  generateGlobalAnalytics,
  generateSectorAnalytics,
  generateStrategyLeaderboard,
  getLatestAnalyticsReport
} from "../services/publicAnalytics.service.js";
import { createTraceId, logError, logEvent } from "../services/telemetry.service.js";

const router = express.Router();

async function loadRows() {
  const { data: outcomes, error } = await supabase
    .from("recommendation_outcomes")
    .select("recommendation_id,symbol,outcome_status,recommendation_created_at,realized_return_pct,unrealized_return_pct,max_drawdown_pct,closed_at,target_hit_at,stop_hit_at");
  if (error) throw error;
  const ids = (outcomes || []).map((o) => o.recommendation_id);
  const { data: audits, error: auditError } = await supabase
    .from("recommendation_audit")
    .select("recommendation_id,confidence,recommendation_type,action,sector,market_regime,created_at")
    .in("recommendation_id", ids.length ? ids : ["__none__"]);
  if (auditError) throw auditError;
  const map = new Map((audits || []).map((a) => [a.recommendation_id, a]));
  return (outcomes || []).map((o) => ({ ...o, audit: map.get(o.recommendation_id) || null }));
}

router.get("/global", async (req, res) => {
  const traceId = req.traceId || createTraceId("analytics_global");
  try {
    const rows = await loadRows();
    const payload = generateGlobalAnalytics(rows, String(req.query.window || "ALL_TIME"));
    return res.json({ success: true, traceId, data: payload });
  } catch (error) {
    logError("analytics.route.global.error", error, { traceId });
    return res.status(503).json({ success: false, traceId, message: "Analytics unavailable" });
  }
});

router.get("/sectors", async (req, res) => {
  const traceId = req.traceId || createTraceId("analytics_sectors");
  try {
    const rows = await loadRows();
    const payload = generateSectorAnalytics(rows);
    return res.json({ success: true, traceId, data: payload });
  } catch (error) {
    logError("analytics.route.sectors.error", error, { traceId });
    return res.status(503).json({ success: false, traceId, message: "Sector analytics unavailable" });
  }
});

router.get("/strategies", async (req, res) => {
  const traceId = req.traceId || createTraceId("analytics_strategies");
  try {
    const rows = await loadRows();
    const payload = generateStrategyLeaderboard(rows);
    return res.json({ success: true, traceId, data: payload });
  } catch (error) {
    logError("analytics.route.strategies.error", error, { traceId });
    return res.status(503).json({ success: false, traceId, message: "Strategy analytics unavailable" });
  }
});

router.get("/calibration", async (req, res) => {
  const traceId = req.traceId || createTraceId("analytics_calibration");
  try {
    const rows = await loadRows();
    const payload = generateConfidenceAnalytics(rows);
    return res.json({ success: true, traceId, data: payload });
  } catch (error) {
    logError("analytics.route.calibration.error", error, { traceId });
    return res.status(503).json({ success: false, traceId, message: "Calibration analytics unavailable" });
  }
});

router.get("/report/latest", async (req, res) => {
  const traceId = req.traceId || createTraceId("analytics_report_latest");
  try {
    const payload = await getLatestAnalyticsReport();
    logEvent("analytics.report.generated", {
      processing_latency_ms: null,
      total_recommendations: payload.total_recommendations || 0,
      sectors_processed: null,
      strategies_processed: null,
      calculation_window: payload.calculation_window
    });
    return res.json({ success: true, traceId, data: payload });
  } catch (error) {
    logError("analytics.route.report.error", error, { traceId });
    return res.status(503).json({ success: false, traceId, message: "Analytics report unavailable" });
  }
});

export default router;
