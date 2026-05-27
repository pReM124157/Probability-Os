export function computeCompositeScores({
  factorBreakdown = {},
  marketOpen = false,
  marketRegimeState = "",
  replayStatus = "INSUFFICIENT_REPLAY_DEPTH",
  governanceBlocked = false
} = {}) {
  const fundamentals = Number(factorBreakdown.fundamentals || 0);
  const technicals = Number(factorBreakdown.technicals || 0);
  const execution = Number(factorBreakdown.execution || 0);
  const intelligence = Number(factorBreakdown.intelligence || 0);
  const total = Number(factorBreakdown.total || 0);

  const technicalSetupScore = Math.round(Math.max(0, Math.min(100, (technicals / 30) * 100)));
  const analyticalScore = Math.round(Math.max(0, Math.min(100, fundamentals + technicals + intelligence)));

  let executionReadiness = Math.round(
    Math.max(0, Math.min(100, execution + (marketOpen ? 20 : 10) + (marketRegimeState ? 10 : 0)))
  );
  if (replayStatus !== "AVAILABLE") executionReadiness = Math.max(0, executionReadiness - 20);

  const deploymentBlocked = executionReadiness < 40 || governanceBlocked;
  const deploymentReadiness = deploymentBlocked ? "RESTRICTED" : "ACTIVE";

  return {
    institutionalCompletenessScore: Math.round(Math.max(0, Math.min(100, total))),
    analyticalScore,
    technicalSetupScore,
    executionReadiness,
    deploymentBlocked,
    deploymentReadiness,
    calibrationConfidence: intelligence
  };
}

