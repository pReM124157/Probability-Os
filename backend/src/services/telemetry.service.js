import crypto from "crypto";

export function createTraceId(prefix = "trace") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function logEvent(event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...details
  };
  console.log(JSON.stringify(payload));
}

export function logMetric(metric, value, details = {}) {
  logEvent("metric", {
    metric,
    value,
    ...details
  });
}

export function logError(event, error, details = {}) {
  logEvent(event, {
    ...details,
    message: error?.message || "Unknown error",
    code: error?.code || null,
    stack: error?.stack || null
  });
}
