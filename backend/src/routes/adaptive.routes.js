import express from "express";
import {
  getAdaptiveDriftEvents,
  getAdaptiveLeaderboard,
  getAdaptiveModelState,
  getAdaptiveRecommendationScore,
  getAdaptiveRegimeIntelligence,
  getAdaptiveTrustSummary
} from "../services/adaptiveIntelligence.service.js";
import { createTraceId, logError, logEvent } from "../services/telemetry.service.js";

const router = express.Router();
const ROUTE_AUTH_TOKEN = process.env.INTERNAL_API_TOKEN || process.env.ADMIN_API_TOKEN || "";

function authorizeProtectedRoute(req, res, next) {
  const traceId = req.traceId || createTraceId("adaptive_auth");
  const authHeader = String(req.headers.authorization || "");
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const apiKey = String(req.headers["x-api-key"] || "");
  const providedToken = bearerToken || apiKey;

  if (!ROUTE_AUTH_TOKEN) {
    logEvent("security.route_auth.rejected", {
      traceId,
      routeGroup: "adaptive",
      reason: "server_auth_not_configured"
    });
    return res.status(503).json({ success: false, traceId, message: "Route auth is not configured" });
  }

  if (!providedToken) {
    logEvent("security.route_auth.rejected", {
      traceId,
      routeGroup: "adaptive",
      reason: "missing_token"
    });
    return res.status(401).json({ success: false, traceId, message: "Unauthorized" });
  }

  if (providedToken !== ROUTE_AUTH_TOKEN) {
    logEvent("security.route_auth.rejected", {
      traceId,
      routeGroup: "adaptive",
      reason: "invalid_token"
    });
    return res.status(403).json({ success: false, traceId, message: "Forbidden" });
  }

  return next();
}

router.use(authorizeProtectedRoute);

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
