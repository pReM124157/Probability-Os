function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function evaluateTargetDistanceGuard({
  currentPrice,
  targetPrice,
  yesAsk,
  minutesRemaining = 15,
  maxDistanceBps = 25,
  maxDistanceUsd = 150,
  hardRejectDistanceBps = 40,
  hardRejectDistanceUsd = 250,
} = {}) {
  const current = safeNumber(currentPrice);
  const target = safeNumber(targetPrice);
  const normalizedYesAsk = safeNumber(yesAsk);
  const minutes = safeNumber(minutesRemaining, 15);

  // Distance guard skipped for 80-94c zone (2026-06-28)
  // In this zone BTC is already above target.
  // Distance to target is irrelevant - continuation is the signal.
  if (normalizedYesAsk !== null && normalizedYesAsk >= 80) {
    return {
      ok: true,
      approved: true,
      status: "APPROVED",
      reason: "DISTANCE_GUARD_SKIPPED_HIGH_PRICE_ZONE",
      skipped: true,
    };
  }

  if (!current || !target || current <= 0 || target <= 0) {
    return {
      ok: false,
      approved: false,
      status: "REJECTED",
      reason: "INVALID_DISTANCE_INPUT",
    };
  }

  const distanceUsd = Math.abs(target - current);
  const distanceBps = (distanceUsd / current) * 10000;

  const normalizedMinutes = Math.max(1, minutes);
  const timeScale = Math.sqrt(normalizedMinutes / 15);

  const scaledMaxDistanceUsd = maxDistanceUsd * timeScale;
  const scaledMaxDistanceBps = maxDistanceBps * timeScale;
  const scaledHardRejectUsd = hardRejectDistanceUsd * timeScale;
  const scaledHardRejectBps = hardRejectDistanceBps * timeScale;

  if (
    distanceUsd >= scaledHardRejectUsd ||
    distanceBps >= scaledHardRejectBps
  ) {
    return {
      ok: false,
      approved: false,
      status: "REJECTED",
      reason: "TARGET_TOO_FAR_HARD_REJECT",
      distanceUsd: Number(distanceUsd.toFixed(2)),
      distanceBps: Number(distanceBps.toFixed(2)),
      maxAllowedDistanceUsd: Number(scaledMaxDistanceUsd.toFixed(2)),
      maxAllowedDistanceBps: Number(scaledMaxDistanceBps.toFixed(2)),
      hardRejectDistanceUsd: Number(scaledHardRejectUsd.toFixed(2)),
      hardRejectDistanceBps: Number(scaledHardRejectBps.toFixed(2)),
      explanation:
        `Target is too far away. BTC must move $${distanceUsd.toFixed(2)} ` +
        `(${distanceBps.toFixed(2)} bps) in ${minutes} minutes.`,
    };
  }

  if (
    distanceUsd > scaledMaxDistanceUsd ||
    distanceBps > scaledMaxDistanceBps
  ) {
    return {
      ok: false,
      approved: false,
      status: "WATCH_ONLY",
      reason: "TARGET_TOO_FAR_WATCH_ONLY",
      distanceUsd: Number(distanceUsd.toFixed(2)),
      distanceBps: Number(distanceBps.toFixed(2)),
      maxAllowedDistanceUsd: Number(scaledMaxDistanceUsd.toFixed(2)),
      maxAllowedDistanceBps: Number(scaledMaxDistanceBps.toFixed(2)),
      hardRejectDistanceUsd: Number(scaledHardRejectUsd.toFixed(2)),
      hardRejectDistanceBps: Number(scaledHardRejectBps.toFixed(2)),
      explanation:
        `Target is far for the time window. BTC must move $${distanceUsd.toFixed(2)} ` +
        `(${distanceBps.toFixed(2)} bps) in ${minutes} minutes. Downgrade to WATCH.`,
    };
  }

  return {
    ok: true,
    approved: true,
    status: "APPROVED",
    reason: "TARGET_DISTANCE_OK",
    distanceUsd: Number(distanceUsd.toFixed(2)),
    distanceBps: Number(distanceBps.toFixed(2)),
    maxAllowedDistanceUsd: Number(scaledMaxDistanceUsd.toFixed(2)),
    maxAllowedDistanceBps: Number(scaledMaxDistanceBps.toFixed(2)),
    hardRejectDistanceUsd: Number(scaledHardRejectUsd.toFixed(2)),
    hardRejectDistanceBps: Number(scaledHardRejectBps.toFixed(2)),
    explanation:
      `Target distance is acceptable. BTC must move $${distanceUsd.toFixed(2)} ` +
      `(${distanceBps.toFixed(2)} bps) in ${minutes} minutes.`,
  };
}
