function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : null;
}

function parseEnabled(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).trim().toLowerCase() === "true";
}

export function getStrategyZoneConfig(overrides = {}) {
  return {
    enabled: parseEnabled(overrides.enabled ?? process.env.KALSHI_STRATEGY_ZONE_ENABLED, true),
    allowedSide: normalizeSide(
      overrides.allowedSide ??
      process.env.KALSHI_STRATEGY_ALLOWED_SIDE ??
      "YES"
    ),
    // NOTE: edge is intentionally NOT used as a min/max gate inside the zone —
    // market price is the signal in the 80-94c zone. The only edge control is
    // `blockHighEdgeAbovePct` below (a suspiciously high edge => stale quote).
    // The old minEdgePct/maxEdgePct config was never read by the guard and was
    // removed to avoid implying knobs that do nothing.
    minMinutesRemaining: safeNumber(
      overrides.minMinutesRemaining ?? process.env.KALSHI_STRATEGY_MIN_MINUTES_REMAINING,
      8
    ),
    maxMinutesRemaining: safeNumber(
      overrides.maxMinutesRemaining ?? process.env.KALSHI_STRATEGY_MAX_MINUTES_REMAINING,
      12
    ),
    minEntryPrice: safeNumber(
      overrides.minEntryPrice ?? process.env.KALSHI_STRATEGY_MIN_ENTRY_PRICE,
      80
    ),
    maxEntryPrice: safeNumber(
      overrides.maxEntryPrice ?? process.env.KALSHI_STRATEGY_MAX_ENTRY_PRICE,
      94
    ),
    blockHighEdgeAbovePct: safeNumber(
      overrides.blockHighEdgeAbovePct ?? process.env.KALSHI_STRATEGY_BLOCK_HIGH_EDGE_ABOVE_PCT,
      30
    ),
  };
}

export function evaluateStrategyZoneGuard({
  side,
  adjustedEdge,
  minutesRemaining,
  entryProbability,
  config = getStrategyZoneConfig(),
} = {}) {
  if (!config.enabled) {
    return {
      ok: true,
      status: "ALLOWED",
      reason: "STRATEGY_ZONE_DISABLED",
      tags: [],
      config,
    };
  }

  const normalizedSide = normalizeSide(side);
  const edge = safeNumber(adjustedEdge);
  const minutes = safeNumber(minutesRemaining);
  const entry = safeNumber(entryProbability);
  const tags = [];

  if (!normalizedSide) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_MISSING_SIDE",
      tags,
      config,
    };
  }

  if (normalizedSide !== config.allowedSide) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_SIDE_BLOCKED",
      tags: ["blocked_side"],
      config,
    };
  }

  if (edge === null) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_MISSING_EDGE",
      tags,
      config,
    };
  }

  if (edge > config.blockHighEdgeAbovePct) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_HIGH_EDGE_DANGER",
      tags: ["high_edge_danger"],
      config,
    };
  }

  // Strategy simplified 2026-06-28:
  // Market price IS the signal in 80-94c zone.
  // Market error: 5.5% (87.6% avg vs 93.1% actual)
  // Model error: 19.8% (69.1% avg vs 88.9% actual)
  // Edge filter removed — model underestimates at high prices.
  // 29 trades, 93.1% win rate without model filter.

  if (minutes === null) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_MISSING_MINUTES_REMAINING",
      tags,
      config,
    };
  }

  if (minutes < config.minMinutesRemaining || minutes > config.maxMinutesRemaining) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_TIME_BUCKET_BLOCKED",
      tags: ["time_bucket_blocked"],
      config,
    };
  }

  if (entry === null) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_MISSING_ENTRY_PRICE",
      tags,
      config,
    };
  }

  // Price floor tightened 2026-06-28: keep only 80-94c entries.
  // The realized edge is concentrated in high-priced YES contracts late in the window.
  if (entry < config.minEntryPrice) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "PRICE_BELOW_FLOOR",
      tags: ["price_below_floor"],
      config,
    };
  }

  if (entry >= config.maxEntryPrice + 1) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_CROSSED_TARGET_OVERPRICED",
      tags: ["crossed_target_overpriced"],
      config,
    };
  }

  if (entry > config.maxEntryPrice) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_ENTRY_TOO_EXPENSIVE",
      tags: ["entry_too_expensive"],
      config,
    };
  }

  return {
    ok: true,
    status: "ALLOWED",
    reason: "STRATEGY_ZONE_APPROVED",
    tags: ["zone_candidate"],
    config,
  };
}
