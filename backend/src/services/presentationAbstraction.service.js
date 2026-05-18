import { safeString } from "../core/safety.js";

export const STATUS_ABSTRACTION_MAP = {
  INSUFFICIENT_REPLAY_DEPTH: {
    severity: "high",
    message: "Historical reliability remains below institutional confidence thresholds for this market regime."
  },
  INSUFFICIENT_DATA: {
    severity: "high",
    message: "Statistical confidence is limited due to insufficient historical observations."
  },
  NOT_AVAILABLE_IN_THIS_PATH: {
    severity: "medium",
    message: "Benchmark-relative intelligence is unavailable in the current execution context."
  },
  NON_EXECUTABLE_LIVE_PRICE: {
    severity: "high",
    message: "Live execution conditions currently fail institutional tradability requirements."
  },
  TRADABILITY_HOLD_BIAS: {
    severity: "high",
    message: "Current setup lacks sufficient execution conviction for active positioning."
  },
  PARTIAL_DATA: {
    severity: "medium",
    message: "Signal quality is reduced because part of the market or fundamental data set is incomplete."
  },
  EVENT_RISK_OVERRIDE: {
    severity: "high",
    message: "Event-risk controls are active and override aggressive positioning."
  },
  AVAILABLE: {
    severity: "none",
    message: "Institutional reliability conditions are met."
  },
  UNKNOWN: {
    severity: "medium",
    message: "Reliability state is indeterminate in the current execution context."
  }
};

export function abstractStatus(code) {
  const key = safeString(code || "UNKNOWN").trim().toUpperCase();
  return STATUS_ABSTRACTION_MAP[key] || {
    severity: "medium",
    message: "A reliability constraint is active in the current execution context."
  };
}

export function sanitizeInstitutionalAction(action = "") {
  const text = safeString(action).trim();
  if (!text) return "Execution remains gated until tradability and confidence conditions are satisfied.";
  const lower = text.toLowerCase();
  if (lower.includes("wait for confirmation after market opens")) {
    return "Trade activation deferred until post-open liquidity and volume conditions satisfy institutional execution thresholds.";
  }
  if (lower.includes("wait for confirmation")) {
    return "Execution is deferred until price, liquidity, and confidence thresholds validate institutional entry conditions.";
  }
  if (lower.includes("monitor closely")) {
    return "Exposure remains under risk-governance hold until a deterministic activation trigger is satisfied.";
  }
  return text;
}

export function synthesizePrimaryLimitation({
  replayStatus,
  calibrationStatus,
  driftStatus,
  benchmarkStatus,
  warnings
}) {
  const items = [];
  const add = (code, source) => {
    const abstracted = abstractStatus(code);
    if (abstracted.severity === "none") return;
    items.push({
      source,
      code,
      severity: abstracted.severity,
      message: abstracted.message
    });
  };

  if (replayStatus !== "AVAILABLE") add(replayStatus, "replay");
  if (calibrationStatus !== "AVAILABLE") add(calibrationStatus, "calibration");
  if (driftStatus !== "AVAILABLE") add(driftStatus, "drift");
  if (benchmarkStatus !== "AVAILABLE") add(benchmarkStatus, "benchmark");
  for (const w of warnings) add(w, "warning");

  const dedup = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.message)) continue;
    seen.add(item.message);
    dedup.push(item);
  }

  const score = { high: 3, medium: 2, low: 1, none: 0 };
  dedup.sort((a, b) => (score[b.severity] || 0) - (score[a.severity] || 0));

  const primary = dedup[0] || {
    source: "none",
    code: "AVAILABLE",
    severity: "none",
    message: "No material institutional reliability limitation is currently active."
  };

  return {
    primary,
    supporting: dedup.slice(1, 3)
  };
}

