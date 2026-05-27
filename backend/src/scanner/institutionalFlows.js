export function buildInstitutionalFlows({ marketOverview, sectorRotation, rankedStocks }) {
  const safeSectorRotation = Array.isArray(sectorRotation) ? sectorRotation : [];
  const safeRanked = Array.isArray(rankedStocks) ? rankedStocks : [];

  const topSector = safeSectorRotation[0] || null;
  const weakestSector = safeSectorRotation[safeSectorRotation.length - 1] || null;
  const highConviction = safeRanked.filter((stock) => stock?.conviction === "HIGH").length;
  const positiveNews = safeRanked.filter((stock) => stock?.newsSentiment === "POSITIVE").length;

  let flowBias = "BALANCED";
  if (highConviction >= 3 || marketOverview?.regime === "RISK_ON") {
    flowBias = "ACCUMULATION";
  } else if (marketOverview?.regime === "RISK_OFF") {
    flowBias = "DEFENSIVE";
  }

  return {
    flowBias,
    topSector: topSector?.sector || "NONE",
    weakestSector: weakestSector?.sector || "NONE",
    positiveNewsBreadth: positiveNews,
    convictionBreadth: highConviction,
    note:
      flowBias === "ACCUMULATION"
        ? `Institutional flow appears constructive with leadership in ${topSector?.sector || "key sectors"}.`
        : flowBias === "DEFENSIVE"
        ? `Flows look defensive with pressure concentrated in ${weakestSector?.sector || "lagging sectors"}.`
        : "Flow picture is mixed with selective participation."
  };
}
