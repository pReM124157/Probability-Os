export function detectDriftSignals(metrics = {}) {
  const signals = [];
  const winRateDrop = Number(metrics.win_rate_drop || 0);
  const calibrationError = Math.abs(Number(metrics.calibration_error || 0));
  const volatility = Number(metrics.volatility || 0);
  const alphaDecay = Number(metrics.alpha_decay || 0);
  const confidenceStd = Number(metrics.confidence_std || 0);

  if (winRateDrop >= 20) signals.push({ type: "performance_degradation", severity: "HIGH" });
  if (winRateDrop >= 35) signals.push({ type: "performance_degradation", severity: "CRITICAL" });
  if (calibrationError >= 15) signals.push({ type: "confidence_inflation", severity: "MEDIUM" });
  if (calibrationError >= 25) signals.push({ type: "confidence_inflation", severity: "HIGH" });
  if (volatility >= 2.5) signals.push({ type: "volatility_explosion", severity: "HIGH" });
  if (alphaDecay <= -5) signals.push({ type: "alpha_collapse", severity: "HIGH" });
  if (confidenceStd >= 18) signals.push({ type: "confidence_instability", severity: "MEDIUM" });

  if (!signals.length) return [{ type: "stable", severity: "LOW" }];
  return signals;
}

export function detectModelDrift(metrics = {}) {
  const signals = detectDriftSignals(metrics);
  const severityOrder = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  let maxSeverity = "LOW";
  for (const s of signals) {
    if (severityOrder.indexOf(s.severity) > severityOrder.indexOf(maxSeverity)) maxSeverity = s.severity;
  }

  const events = [];
  if (maxSeverity === "MEDIUM") events.push("DRIFT_WARNING");
  if (maxSeverity === "HIGH") events.push("DRIFT_WARNING", "RECALIBRATION_REQUIRED", "STRATEGY_DEGRADED");
  if (maxSeverity === "CRITICAL") events.push("DRIFT_CRITICAL", "RECALIBRATION_REQUIRED", "STRATEGY_DEGRADED");

  return {
    severity: maxSeverity,
    signals,
    events: Array.from(new Set(events))
  };
}
