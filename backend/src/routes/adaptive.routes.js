import express from "express";
import {
  getAdaptiveDriftEvents,
  getAdaptiveLeaderboard,
  getAdaptiveModelState,
  getAdaptiveRecommendationScore,
  getAdaptiveRegimeIntelligence,
  getAdaptiveTrustSummary
} from "../services/adaptiveIntelligence.service.js";
import { createTraceId, logError } from "../services/telemetry.service.js";

const router = express.Router();

async function runFailClosed(traceId, res, fn, unavailableMessage) {
  try {
    const data = await fn();
    return res.json({ success: true, traceId, data });
  } catch (error) {
    logError("adaptive.route.error", error, { traceId });
    return res.status(503).json({ success: false, traceId, message: unavailableMessage });
  }
}

router.get("/models", async (req, res) => {
  const traceId = req.traceId || createTraceId("adaptive_models");
  return runFailClosed(traceId, res, () => getAdaptiveModelState({ limit: Number(req.query.limit || 200) }), "Adaptive model state unavailable");
});

router.get("/drift", async (req, res) => {
  const traceId = req.traceId || createTraceId("adaptive_drift");
  return runFailClosed(traceId, res, () => getAdaptiveDriftEvents({ limit: Number(req.query.limit || 200) }), "Adaptive drift events unavailable");
});

router.get("/recommendations/:id", async (req, res) => {
  const traceId = req.traceId || createTraceId("adaptive_recommendation");
  return runFailClosed(traceId, res, async () => {
    const row = await getAdaptiveRecommendationScore(req.params.id);
    if (!row) return { recommendation_id: req.params.id, found: false };
    return row;
  }, "Adaptive recommendation score unavailable");
});

router.get("/trust", async (req, res) => {
  const traceId = req.traceId || createTraceId("adaptive_trust");
  return runFailClosed(traceId, res, () => getAdaptiveTrustSummary(), "Adaptive trust summary unavailable");
});

router.get("/regimes", async (req, res) => {
  const traceId = req.traceId || createTraceId("adaptive_regimes");
  return runFailClosed(traceId, res, () => getAdaptiveRegimeIntelligence(), "Adaptive regime intelligence unavailable");
});

router.get("/leaderboard", async (req, res) => {
  const traceId = req.traceId || createTraceId("adaptive_leaderboard");
  return runFailClosed(traceId, res, () => getAdaptiveLeaderboard(), "Adaptive leaderboard unavailable");
});

export default router;
