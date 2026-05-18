/**
 * INSTITUTIONAL INTERPRETATION ENGINE
 * Converts raw metrics → weighted institutional intelligence
 * Bloomberg x institutional PM briefing grade output
 */

// ─── CONVICTION CLASSIFIER ────────────────────────────────────────────────────

export function classifyInstitutionalConfidence(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return { label: "NON-DEPLOYABLE", tier: 0 };
  if (s >= 85) return { label: "HIGH CONVICTION", tier: 5 };
  if (s >= 70) return { label: "MODERATE CONVICTION", tier: 4 };
  if (s >= 55) return { label: "CONDITIONAL", tier: 3 };
  if (s >= 40) return { label: "LOW CONFIDENCE", tier: 2 };
  return { label: "NON-DEPLOYABLE", tier: 1 };
}

// ─── FUNDAMENTAL QUALITY SCORE ────────────────────────────────────────────────

export function computeFundamentalQualityScore({ roe, profitMargin, revenueGrowth, earningsGrowth, debtEquity, pe }) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const roeN = n(roe);
  const marginN = n(profitMargin);
  const revGN = n(revenueGrowth);
  const epsGN = n(earningsGrowth);
  const deN = n(debtEquity);
  const peN = n(pe);

  const drivers = [];
  const risks = [];
  let score = 50; // base

  // ROE (max +20)
  if (roeN !== null) {
    if (roeN >= 30) { score += 20; drivers.push(`ROE ${roeN.toFixed(1)}% → Exceptional capital efficiency`); }
    else if (roeN >= 20) { score += 14; drivers.push(`ROE ${roeN.toFixed(1)}% → Strong capital returns`); }
    else if (roeN >= 12) { score += 8; drivers.push(`ROE ${roeN.toFixed(1)}% → Adequate returns`); }
    else if (roeN >= 0) { score += 2; risks.push(`ROE ${roeN.toFixed(1)}% → Below institutional quality threshold`); }
    else { score -= 10; risks.push(`ROE ${roeN.toFixed(1)}% → Capital destruction — institutional flag`); }
  }

  // Profit Margin (max +15)
  if (marginN !== null) {
    if (marginN >= 20) { score += 15; drivers.push(`Profit Margin ${marginN.toFixed(1)}% → Premium operational quality`); }
    else if (marginN >= 12) { score += 10; drivers.push(`Profit Margin ${marginN.toFixed(1)}% → Strong operational quality`); }
    else if (marginN >= 6) { score += 5; drivers.push(`Profit Margin ${marginN.toFixed(1)}% → Adequate margins`); }
    else if (marginN >= 0) { score += 0; risks.push(`Profit Margin ${marginN.toFixed(1)}% → Thin margins — watch for compression`); }
    else { score -= 8; risks.push(`Profit Margin ${marginN.toFixed(1)}% → Operational losses detected`); }
  }

  // Earnings Growth (max +10)
  if (epsGN !== null) {
    if (epsGN >= 20) { score += 10; drivers.push(`Earnings Growth +${epsGN.toFixed(1)}% → High-velocity earnings expansion`); }
    else if (epsGN >= 10) { score += 6; drivers.push(`Earnings Growth +${epsGN.toFixed(1)}% → Solid earnings trajectory`); }
    else if (epsGN >= 0) { score += 2; }
    else { score -= 6; risks.push(`Earnings Growth ${epsGN.toFixed(1)}% → Earnings contraction — elevated caution`); }
  }

  // Revenue Growth (max +8)
  if (revGN !== null) {
    if (revGN >= 15) { score += 8; drivers.push(`Revenue Growth +${revGN.toFixed(1)}% → Strong topline expansion`); }
    else if (revGN >= 8) { score += 5; drivers.push(`Revenue Growth +${revGN.toFixed(1)}% → Healthy topline growth`); }
    else if (revGN >= 0) { score += 1; }
    else { score -= 4; risks.push(`Revenue Growth ${revGN.toFixed(1)}% → Topline contraction — red flag`); }
  }

  // Leverage / D/E (max +7, min -10)
  if (deN !== null) {
    if (deN <= 0.1) { score += 7; drivers.push(`Debt/Equity ${deN.toFixed(2)} → Conservatively financed`); }
    else if (deN <= 0.5) { score += 4; drivers.push(`Debt/Equity ${deN.toFixed(2)} → Healthy leverage profile`); }
    else if (deN <= 1.5) { score += 0; }
    else if (deN <= 3) { score -= 5; risks.push(`Debt/Equity ${deN.toFixed(2)} → Elevated leverage — monitor refinancing risk`); }
    else { score -= 10; risks.push(`Debt/Equity ${deN.toFixed(2)} → Excessive leverage — institutional solvency concern`); }
  }

  // Valuation sanity (max +5, min -5)
  if (peN !== null && peN > 0) {
    if (peN <= 15) { score += 5; drivers.push(`P/E ${peN.toFixed(1)} → Value zone relative to peers`); }
    else if (peN <= 25) { score += 2; }
    else if (peN <= 45) { score -= 2; risks.push(`P/E ${peN.toFixed(1)} → Premium valuation — growth must justify`); }
    else { score -= 5; risks.push(`P/E ${peN.toFixed(1)} → Expensive — limited margin of safety`); }
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  let quality_class;
  let institutional_bias;
  if (score >= 80) { quality_class = "INSTITUTIONAL GRADE"; institutional_bias = "Fundamentally Strong"; }
  else if (score >= 65) { quality_class = "INVESTMENT GRADE"; institutional_bias = "Fundamentally Sound"; }
  else if (score >= 50) { quality_class = "WATCH GRADE"; institutional_bias = "Mixed Fundamentals"; }
  else if (score >= 35) { quality_class = "CAUTION GRADE"; institutional_bias = "Fundamentally Weak"; }
  else { quality_class = "AVOID GRADE"; institutional_bias = "Fundamentally Deteriorating"; }

  return { score, quality_class, institutional_bias, drivers, risks };
}

// ─── VALUATION INTERPRETATION ─────────────────────────────────────────────────

export function computeValuationInterpretation({ pe, sector, marketCap }) {
  const peN = Number(pe);
  if (!Number.isFinite(peN) || peN <= 0) {
    return { classification: "INSUFFICIENT DATA", label: "P/E data unavailable for valuation classification", color: "neutral" };
  }

  const isIT = /tech|software|it service/i.test(sector || "");
  const isBanking = /bank|financial|nbfc/i.test(sector || "");
  const isLargeCap = /large/i.test(marketCap || "");

  // Sector-aware thresholds
  let thresholds = { cheap: 12, reasonable: 22, stretched: 35 };
  if (isIT) thresholds = { cheap: 18, reasonable: 30, stretched: 50 };
  if (isBanking) thresholds = { cheap: 8, reasonable: 14, stretched: 22 };

  const peerLabel = isIT ? "large-cap IT peers" : isBanking ? "banking sector peers" : "sector peers";

  let classification, label;
  if (peN <= thresholds.cheap) {
    classification = "UNDERVALUED";
    label = `P/E ${peN.toFixed(1)} → Undervalued relative to ${peerLabel} — margin of safety present`;
  } else if (peN <= thresholds.reasonable) {
    classification = "REASONABLE";
    label = `P/E ${peN.toFixed(1)} → Reasonable relative to ${peerLabel}`;
  } else if (peN <= thresholds.stretched) {
    classification = "STRETCHED";
    label = `P/E ${peN.toFixed(1)} → Stretched — growth premium embedded in price`;
  } else {
    classification = "EXPENSIVE";
    label = `P/E ${peN.toFixed(1)} → Expensive — requires exceptional earnings delivery to justify`;
  }

  return { classification, label, pe: peN, peerLabel };
}

// ─── BALANCE SHEET INTERPRETATION ────────────────────────────────────────────

export function computeBalanceSheetInterpretation({ debtEquity, sector }) {
  const deN = Number(debtEquity);
  const isBanking = /bank|financial|nbfc/i.test(sector || "");

  if (!Number.isFinite(deN)) {
    return {
      leverage_quality: "UNKNOWN",
      financing_risk: "INDETERMINATE",
      institutional_interpretation: "Balance sheet data unavailable for leverage assessment."
    };
  }

  let leverage_quality, financing_risk, institutional_interpretation, stress = false;

  if (isBanking) {
    // Banks operate with higher leverage by design
    if (deN <= 8) { leverage_quality = "CONSERVATIVELY GEARED"; financing_risk = "LOW"; institutional_interpretation = `D/E ${deN.toFixed(2)} → Within institutional norms for banking sector`; }
    else if (deN <= 15) { leverage_quality = "NORMALLY GEARED"; financing_risk = "MEDIUM"; institutional_interpretation = `D/E ${deN.toFixed(2)} → Moderate leverage — acceptable for banking operations`; }
    else { leverage_quality = "HIGHLY GEARED"; financing_risk = "HIGH"; stress = true; institutional_interpretation = `D/E ${deN.toFixed(2)} → Elevated leverage for banking — stress scenario monitoring required`; }
  } else {
    if (deN <= 0.1) { leverage_quality = "DEBT-FREE PROFILE"; financing_risk = "MINIMAL"; institutional_interpretation = `D/E ${deN.toFixed(2)} → Conservatively financed — no leverage stress detected`; }
    else if (deN <= 0.5) { leverage_quality = "LOW LEVERAGE"; financing_risk = "LOW"; institutional_interpretation = `D/E ${deN.toFixed(2)} → Healthy balance sheet — well within institutional comfort zone`; }
    else if (deN <= 1.5) { leverage_quality = "MODERATE LEVERAGE"; financing_risk = "MEDIUM"; institutional_interpretation = `D/E ${deN.toFixed(2)} → Manageable leverage — refinancing risk is contained`; }
    else if (deN <= 3) { leverage_quality = "ELEVATED LEVERAGE"; financing_risk = "HIGH"; stress = true; institutional_interpretation = `D/E ${deN.toFixed(2)} → Above institutional comfort — monitor debt servicing capacity`; }
    else { leverage_quality = "EXCESSIVE LEVERAGE"; financing_risk = "CRITICAL"; stress = true; institutional_interpretation = `D/E ${deN.toFixed(2)} → Institutional solvency concern — leverage at distressed levels`; }
  }

  return { leverage_quality, financing_risk, institutional_interpretation, stress };
}

// ─── GROWTH INTERPRETATION ────────────────────────────────────────────────────

export function computeGrowthInterpretation({ revenueGrowth, earningsGrowth }) {
  const revN = Number(revenueGrowth);
  const epsN = Number(earningsGrowth);
  const hasRev = Number.isFinite(revN);
  const hasEps = Number.isFinite(epsN);

  if (!hasRev && !hasEps) {
    return { growth_class: "UNKNOWN", narrative: "Growth data unavailable for this period.", acceleration: false, marginExpansion: false };
  }

  const lines = [];
  let growth_class = "MODERATE";
  let acceleration = false;
  let marginExpansion = false;

  if (hasEps) {
    if (epsN >= 20) { lines.push(`Earnings Growth +${epsN.toFixed(1)}% YoY`); growth_class = "HIGH VELOCITY"; }
    else if (epsN >= 10) { lines.push(`Earnings Growth +${epsN.toFixed(1)}% YoY`); growth_class = "SOLID"; }
    else if (epsN >= 0) { lines.push(`Earnings Growth +${epsN.toFixed(1)}% YoY`); growth_class = "MODERATE"; }
    else { lines.push(`Earnings Growth ${epsN.toFixed(1)}% YoY`); growth_class = "CONTRACTING"; }
  }

  if (hasRev) {
    if (revN >= 15) lines.push(`Revenue Growth +${revN.toFixed(1)}% YoY`);
    else if (revN >= 5) lines.push(`Revenue Growth +${revN.toFixed(1)}% YoY`);
    else if (revN >= 0) lines.push(`Revenue Growth +${revN.toFixed(1)}% YoY`);
    else lines.push(`Revenue Growth ${revN.toFixed(1)}% YoY`);
  }

  // Margin expansion detection
  if (hasRev && hasEps && epsN > revN + 3) {
    marginExpansion = true;
    lines.push("Earnings currently outpacing topline growth — margin expansion in evidence");
    acceleration = true;
  } else if (hasRev && hasEps && epsN < revN - 5) {
    lines.push("Revenue growing faster than earnings — margin compression detected");
  }

  return { growth_class, narrative: lines.join("\n"), acceleration, marginExpansion, lines };
}

// ─── FACTOR WEIGHT MODEL ──────────────────────────────────────────────────────

export function computeInstitutionalFactorWeights({
  roe, profitMargin, debtEquity, revenueGrowth, earningsGrowth,
  technicalTrend, technicalMomentum, volumeConfirmation,
  sectorAlignment, relativeStrength,
  adaptiveScore, replayStatus, calibrationStatus, driftStatus
}) {
  const n = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
  const positive_drivers = [];
  const negative_drivers = [];

  // Fundamentals (max 35 pts)
  const roeScore = Math.min(n(roe) / 30 * 12, 12);
  const marginScore = Math.min(n(profitMargin) / 20 * 8, 8);
  const growthScore = Math.min((n(earningsGrowth) + n(revenueGrowth)) / 40 * 10, 10);
  const leverageScore = n(debtEquity) <= 0.5 ? 5 : n(debtEquity) <= 1.5 ? 3 : 0;
  const fundamentalTotal = Math.max(0, roeScore + marginScore + growthScore + leverageScore);
  if (fundamentalTotal >= 20) positive_drivers.push(`Fundamentals: Strong composite (${fundamentalTotal.toFixed(1)}/35)`);
  else if (fundamentalTotal < 10) negative_drivers.push(`Fundamentals: Weak composite (${fundamentalTotal.toFixed(1)}/35)`);

  // Technicals (max 30 pts)
  const trendScore = n(technicalTrend, 0);
  const momScore = n(technicalMomentum, 0);
  const volScore = n(volumeConfirmation, 0);
  const technicalTotal = Math.min(trendScore + momScore + volScore, 30);
  if (technicalTotal >= 18) positive_drivers.push(`Technicals: Constructive regime (${technicalTotal.toFixed(1)}/30)`);
  else if (technicalTotal < 10) negative_drivers.push(`Technicals: Weak regime (${technicalTotal.toFixed(1)}/30)`);

  // Execution (max 20 pts)
  const secScore = n(sectorAlignment, 0);
  const rsScore = n(relativeStrength, 0);
  const executionTotal = Math.min(secScore + rsScore, 20);

  // Intelligence (max 15 pts)
  const replayOk = replayStatus === "AVAILABLE";
  const calibOk = calibrationStatus === "AVAILABLE";
  const driftOk = driftStatus === "AVAILABLE";
  const intelPenalty = (!replayOk ? -5 : 0) + (!calibOk ? -3 : 0) + (!driftOk ? -2 : 0);
  const intelBase = n(adaptiveScore, 50) / 100 * 15;
  const intelTotal = Math.max(0, intelBase + intelPenalty);
  if (!replayOk) negative_drivers.push("Replay reliability below institutional threshold");
  if (!calibOk) negative_drivers.push("Calibration quality insufficient");

  const total = Math.min(100, Math.max(0, fundamentalTotal + technicalTotal + executionTotal + intelTotal));

  return {
    factor_breakdown: {
      fundamentals: parseFloat(fundamentalTotal.toFixed(1)),
      technicals: parseFloat(technicalTotal.toFixed(1)),
      execution: parseFloat(executionTotal.toFixed(1)),
      intelligence: parseFloat(intelTotal.toFixed(1)),
      total: parseFloat(total.toFixed(1))
    },
    positive_drivers,
    negative_drivers,
    confidence_contribution: parseFloat(total.toFixed(1))
  };
}

// ─── INSTITUTIONAL FUNDAMENTAL NARRATIVE ──────────────────────────────────────

export function buildInstitutionalFundamentalNarrative({ rawMetrics, adaptiveScore, technicalRegime, sector }) {
  const { pe, roe, profitMargin, debtEquity, revenueGrowth, earningsGrowth } = rawMetrics || {};

  const quality = computeFundamentalQualityScore({ roe, profitMargin, revenueGrowth, earningsGrowth, debtEquity, pe });
  const valuation = computeValuationInterpretation({ pe, sector });
  const balanceSheet = computeBalanceSheetInterpretation({ debtEquity, sector });
  const growth = computeGrowthInterpretation({ revenueGrowth, earningsGrowth });

  // Institutional conclusion
  const conviction = classifyInstitutionalConfidence(adaptiveScore);
  const regime = String(technicalRegime || "NEUTRAL").toUpperCase();
  const isBearish = regime.includes("BEAR") || regime.includes("WEAK") || regime.includes("DOWN");
  const isNonDeployable = conviction.tier <= 2;

  let institutional_conclusion;
  if (quality.score >= 70 && isNonDeployable) {
    institutional_conclusion = [
      `Fundamentals support long-term accumulation bias.`,
      `Current ${conviction.label} verdict is driven by ${isBearish ? "weak technical regime" : "insufficient system confidence"} — not deterioration in company quality.`
    ].join(" ");
  } else if (quality.score >= 70 && !isNonDeployable) {
    institutional_conclusion = `Strong fundamental foundation supports deployment. Conviction class: ${conviction.label}.`;
  } else if (quality.score < 50) {
    institutional_conclusion = `Fundamental quality is below institutional threshold. Technical and adaptive factors cannot compensate for weak business quality.`;
  } else {
    institutional_conclusion = `Mixed fundamental profile. Monitor for quality improvement before institutional-grade deployment.`;
  }

  return {
    quality_summary: {
      score: quality.score,
      class: quality.quality_class,
      bias: quality.institutional_bias,
      drivers: quality.drivers,
      risks: quality.risks
    },
    valuation_summary: valuation,
    growth_summary: growth,
    balance_sheet_summary: balanceSheet,
    institutional_conclusion
  };
}

// ─── EVIDENCE CONSTRAINT SUMMARY ─────────────────────────────────────────────

export function buildEvidenceConstraintSummary({ replayStatus, calibrationStatus, driftStatus, benchmarkStatus }) {
  const constraints = [];
  if (replayStatus !== "AVAILABLE") constraints.push("limited replay depth");
  if (calibrationStatus !== "AVAILABLE") constraints.push("incomplete calibration data");
  if (driftStatus !== "AVAILABLE") constraints.push("drift monitoring not yet active");
  if (benchmarkStatus !== "AVAILABLE") constraints.push("incomplete benchmark context for the current regime window");

  if (!constraints.length) {
    return "Institutional reliability conditions are fully satisfied across all evidence dimensions.";
  }

  return `Institutional reliability remains constrained due to ${constraints.join(", ")}. Confidence scores carry proportional uncertainty and should be interpreted within stated conviction class boundaries.`;
}

// ─── GOVERNANCE EXPLANATION ───────────────────────────────────────────────────

export function buildGovernanceExplanation({ replayStatus, adaptiveScore, isLive, tradabilityHold, eventRisk, calibrationStatus }) {
  const reasons = [];

  if (replayStatus !== "AVAILABLE") reasons.push("replay reliability insufficient — historical win-rate data below institutional minimum");
  if (!isLive) reasons.push("post-open liquidity not confirmed — market is closed or price is non-executable");
  const score = Number(adaptiveScore);
  if (Number.isFinite(score) && score < 55) reasons.push(`adaptive confidence ${Math.round(score)}/100 below institutional deployment threshold (55)`);
  if (tradabilityHold) reasons.push("technical tradability conditions not satisfied — trend, momentum, and volume unconfirmed");
  if (eventRisk === "HIGH" || eventRisk === "CRITICAL") reasons.push(`active ${eventRisk.toLowerCase()} event risk override in effect`);
  if (calibrationStatus !== "AVAILABLE") reasons.push("confidence calibration quality is insufficient for capital deployment");

  if (!reasons.length) return null;

  return {
    blocked: true,
    reasons,
    formatted: `Trade deployment blocked because:\n${reasons.map((r) => `• ${r}`).join("\n")}`
  };
}

// ─── DECISION TRACE BUILDER ───────────────────────────────────────────────────

export function buildDecisionTrace({ replayStatus, adaptiveScore, technicalTrend, fundamentalScore, calibrationStatus, isLive, tradabilityHold }) {
  const trace = [];
  const score = Number(adaptiveScore);

  if (replayStatus !== "AVAILABLE") trace.push("Replay reliability below institutional threshold");
  if (Number.isFinite(score) && score < 55) trace.push(`Adaptive confidence ${Math.round(score)}/100 below deployment minimum (55)`);
  if (!isLive) trace.push("Non-executable market state — live price not confirmed");
  if (tradabilityHold) trace.push("Technical trend bearish or unconfirmed");
  if (calibrationStatus !== "AVAILABLE") trace.push("Statistical calibration insufficient");
  if (fundamentalScore >= 70) trace.push(`Fundamental quality remains strong (${Math.round(fundamentalScore)}/100)`);
  else if (fundamentalScore < 50) trace.push(`Fundamental quality below institutional threshold (${Math.round(fundamentalScore)}/100)`);

  return trace;
}
