function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function gradeFromTrust(trustScore = 50) {
  if (trustScore >= 85) return "A+";
  if (trustScore >= 75) return "A";
  if (trustScore >= 60) return "B";
  if (trustScore >= 45) return "C";
  return "D";
}

export function computeSystemReliability({ trustScore = 50, driftScore = 0, calibrationError = 0, replayConsistency = 0 }) {
  const penalty = (Number(driftScore) * 0.7) + (Math.abs(Number(calibrationError)) * 0.8);
  const raw = Number(trustScore) + (Number(replayConsistency) * 0.25) - penalty;
  return clamp(raw, 0, 100);
}

export function computeAdaptiveConfidenceMultiplier({ trustScore = 50, driftScore = 0, adaptiveWeight = 1 }) {
  const trustLift = (Number(trustScore) - 50) / 200;
  const driftPenalty = Number(driftScore) / 200;
  return clamp(Number(adaptiveWeight) + trustLift - driftPenalty, 0.5, 1.5);
}

export function buildMetaScore(payload = {}) {
  const trustScore = clamp(Number(payload.trustScore || 50), 0, 100);
  const reliability = computeSystemReliability(payload);
  const adaptiveMultiplier = computeAdaptiveConfidenceMultiplier(payload);
  const recommendationQualityScore = clamp((trustScore * 0.5) + (reliability * 0.5), 0, 100);
  return {
    institutional_trust_grade: gradeFromTrust(trustScore),
    adaptive_confidence_multiplier: adaptiveMultiplier,
    recommendation_quality_score: recommendationQualityScore,
    system_reliability_score: reliability
  };
}
