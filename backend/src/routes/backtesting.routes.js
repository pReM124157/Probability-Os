import express from "express";
import supabase from "../services/supabase.service.js";
import { rankStrategies } from "../services/backtesting.service.js";
import { createTraceId, logError, logEvent } from "../services/telemetry.service.js";

const router = express.Router();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.BACKTEST_ROUTE_RPM || 60);
const buckets = new Map();

router.use((req, res, next) => {
  const key = `${req.ip || "unknown"}:${req.path}`;
  const now = Date.now();
  const bucket = buckets.get(key) || { count: 0, start: now };
  if (now - bucket.start > WINDOW_MS) {
    bucket.count = 0;
    bucket.start = now;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > MAX_PER_WINDOW) return res.status(429).json({ success: false, message: "Rate limit exceeded" });
  return next();
});

async function safeQuery(traceId, fn) {
  try {
    return await fn();
  } catch (error) {
    logError("backtesting.route.error", error, { traceId });
    return null;
  }
}

router.get("/latest", async (req, res) => {
  const traceId = req.traceId || createTraceId("backtesting_latest");
  const data = await safeQuery(traceId, async () => {
    const { data: row, error } = await supabase
      .from("backtest_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return row;
  });
  if (!data) return res.status(503).json({ success: false, traceId, message: "Backtesting unavailable" });
  return res.json({ success: true, traceId, data });
});

router.get("/runs", async (req, res) => {
  const traceId = req.traceId || createTraceId("backtesting_runs");
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const data = await safeQuery(traceId, async () => {
    const { data: rows, error } = await supabase
      .from("backtest_runs")
      .select("backtest_id,strategy_name,universe,start_date,end_date,total_trades,win_rate,sharpe_ratio,max_drawdown,cagr,alpha,total_return_pct,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return rows || [];
  });
  if (!data) return res.status(503).json({ success: false, traceId, message: "Backtesting unavailable" });
  return res.json({ success: true, traceId, data });
});

router.get("/strategies/ranking", async (req, res) => {
  const traceId = req.traceId || createTraceId("backtesting_rank");
  const startDate = String(req.query.startDate || new Date(Date.now() - (365 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10));
  const endDate = String(req.query.endDate || new Date().toISOString().slice(0, 10));
  const universe = String(req.query.universe || "ALL");

  try {
    const data = await rankStrategies({ startDate, endDate, universe, initialCapital: Number(req.query.initialCapital || 100000) });
    logEvent("backtest.metrics.generated", {
      traceId,
      processing_latency_ms: null,
      trades_processed: null,
      total_return_pct: null,
      sharpe_ratio: null,
      max_drawdown: null,
      cagr: null,
      alpha: null
    });
    return res.json({ success: true, traceId, data });
  } catch (error) {
    logError("backtesting.route.ranking.error", error, { traceId });
    return res.status(503).json({ success: false, traceId, message: "Strategy ranking unavailable" });
  }
});

router.get("/:id/equity", async (req, res) => {
  const traceId = req.traceId || createTraceId("backtesting_equity");
  const data = await safeQuery(traceId, async () => {
    const { data: row, error } = await supabase
      .from("backtest_runs")
      .select("backtest_id,equity_curve,benchmark_curve,replay_metadata")
      .eq("backtest_id", req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;
    return {
      backtest_id: row.backtest_id,
      equity_curve: row.equity_curve || [],
      benchmark_curve: row.benchmark_curve || [],
      drawdown_curve: (row.equity_curve || []).map((p) => ({ timestamp: p.timestamp, drawdown: p.drawdown })),
      rolling_cagr: row.replay_metadata?.rolling_cagr || [],
      rolling_sharpe: row.replay_metadata?.rolling_sharpe || []
    };
  });

  if (!data) return res.status(404).json({ success: false, traceId, message: "Backtest not found" });
  return res.json({ success: true, traceId, data });
});

router.get("/:id/trades", async (req, res) => {
  const traceId = req.traceId || createTraceId("backtesting_trades");
  const data = await safeQuery(traceId, async () => {
    const { data: rows, error } = await supabase
      .from("backtest_trade_log")
      .select("*")
      .eq("backtest_id", req.params.id)
      .order("entry_date", { ascending: true });
    if (error) throw error;
    return {
      trades: rows || [],
      trade_distribution_histogram: rowHistogram(rows || []),
      sector_heatmap: buildSectorHeatmap(rows || [])
    };
  });

  if (!data) return res.status(503).json({ success: false, traceId, message: "Trade log unavailable" });
  return res.json({ success: true, traceId, data });
});

router.get("/:id", async (req, res) => {
  const traceId = req.traceId || createTraceId("backtesting_one");
  const data = await safeQuery(traceId, async () => {
    const { data: row, error } = await supabase
      .from("backtest_runs")
      .select("*")
      .eq("backtest_id", req.params.id)
      .maybeSingle();
    if (error) throw error;
    return row;
  });
  if (!data) return res.status(404).json({ success: false, traceId, message: "Backtest not found" });
  return res.json({ success: true, traceId, data });
});

function rowHistogram(trades) {
  const bins = ["<-5", "-5..0", "0..5", "5..10", ">10"];
  const counts = new Map(bins.map((b) => [b, 0]));
  for (const t of trades) {
    const r = Number(t.return_pct || 0);
    if (r < -5) counts.set("<-5", counts.get("<-5") + 1);
    else if (r < 0) counts.set("-5..0", counts.get("-5..0") + 1);
    else if (r < 5) counts.set("0..5", counts.get("0..5") + 1);
    else if (r < 10) counts.set("5..10", counts.get("5..10") + 1);
    else counts.set(">10", counts.get(">10") + 1);
  }
  return bins.map((b) => ({ bucket: b, count: counts.get(b) }));
}

function buildSectorHeatmap(trades) {
  const m = new Map();
  for (const t of trades) {
    const sector = String(t.market_regime || "UNKNOWN");
    const bucket = m.get(sector) || { label: sector, count: 0, avg_return_pct: 0, wins: 0 };
    const r = Number(t.return_pct || 0);
    bucket.count += 1;
    bucket.avg_return_pct += r;
    if (r > 0) bucket.wins += 1;
    m.set(sector, bucket);
  }
  return Array.from(m.values()).map((x) => ({
    label: x.label,
    count: x.count,
    avg_return_pct: x.count ? x.avg_return_pct / x.count : 0,
    win_rate: x.count ? (x.wins / x.count) * 100 : 0
  }));
}

export default router;
