function toNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") {
    return 0;
  }
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeSector(sector) {
  const upper = String(sector || "Unknown").trim().toUpperCase();
  const aliases = {
    TECHNOLOGY: "IT",
    "INFORMATION TECHNOLOGY": "IT",
    BANKS: "BANKING",
    BANKING: "BANKING",
    "FINANCIAL SERVICES": "FINANCIALS",
    FINANCIAL: "FINANCIALS",
    INSURANCE: "FINANCIALS",
    AUTO: "AUTO",
    AUTOMOBILE: "AUTO",
    AUTOMOBILES: "AUTO",
    "OIL & GAS": "ENERGY",
    OILGAS: "ENERGY",
    HEALTHCARE: "PHARMA",
    PHARMACEUTICALS: "PHARMA"
  };
  return aliases[upper] || upper.replace(/[^A-Z]/g, "_");
}

function scoreFromBands(value, bands, fallback = 5) {
  for (const band of bands) {
    if (band.test(value)) return band.score;
  }
  return fallback;
}

export function computeFundamentalsScore(companyData = {}) {
  const pe = toNumber(companyData.PERatio);
  const roe = toNumber(companyData.ReturnOnEquityTTM);
  const growth = toNumber(companyData.QuarterlyRevenueGrowthYOY);
  const margin = toNumber(companyData.ProfitMargin);
  const debtToEquity = toNumber(companyData.DebtToEquityRatio);

  const peScore = pe <= 0
    ? 5
    : scoreFromBands(pe, [
        { test: (v) => v <= 15, score: 9.5 },
        { test: (v) => v <= 22, score: 8.2 },
        { test: (v) => v <= 30, score: 6.8 },
        { test: (v) => v <= 40, score: 5.2 },
        { test: () => true, score: 3.4 }
      ]);
  const roeScore = scoreFromBands(roe, [
    { test: (v) => v >= 22, score: 9.5 },
    { test: (v) => v >= 18, score: 8.2 },
    { test: (v) => v >= 12, score: 6.8 },
    { test: (v) => v >= 8, score: 5.5 },
    { test: () => true, score: 3.5 }
  ]);
  const growthScore = scoreFromBands(growth, [
    { test: (v) => v >= 18, score: 9.5 },
    { test: (v) => v >= 12, score: 8.2 },
    { test: (v) => v >= 6, score: 6.8 },
    { test: (v) => v >= 0, score: 5.2 },
    { test: () => true, score: 3.2 }
  ]);
  const marginScore = scoreFromBands(margin, [
    { test: (v) => v >= 20, score: 9.0 },
    { test: (v) => v >= 12, score: 7.6 },
    { test: (v) => v >= 6, score: 6.0 },
    { test: (v) => v >= 0, score: 4.5 },
    { test: () => true, score: 3.0 }
  ]);
  const leverageScore = scoreFromBands(debtToEquity, [
    { test: (v) => v === 0, score: 5.5 },
    { test: (v) => v <= 0.5, score: 9.0 },
    { test: (v) => v <= 1.0, score: 7.8 },
    { test: (v) => v <= 2.0, score: 6.2 },
    { test: (v) => v <= 3.0, score: 4.5 },
    { test: () => true, score: 2.8 }
  ]);

  return Number((((peScore + roeScore + growthScore + marginScore + leverageScore) / 5)).toFixed(2));
}

export function computeConvictionScore({
  trend,
  rsi,
  volumeRatio,
  sectorScore,
  fundamentalsScore,
  newsScore,
  relativeStrengthScore
}) {
  const trendScore =
    trend === "BULLISH" ? 8.5 : trend === "BEARISH" ? 3.5 : 5.5;
  const rsiScore = scoreFromBands(toNumber(rsi), [
    { test: (v) => v >= 52 && v <= 66, score: 8.8 },
    { test: (v) => v >= 45 && v < 52, score: 7.2 },
    { test: (v) => v > 66 && v <= 72, score: 6.2 },
    { test: (v) => v >= 38 && v < 45, score: 5.3 },
    { test: () => true, score: 3.8 }
  ]);
  const volumeScore = scoreFromBands(toNumber(volumeRatio), [
    { test: (v) => v >= 1.8, score: 9.5 },
    { test: (v) => v >= 1.2, score: 8.4 },
    { test: (v) => v >= 1.0, score: 6.9 },
    { test: (v) => v >= 0.8, score: 5.4 },
    { test: () => true, score: 3.6 }
  ]);

  const score =
    (trendScore * 0.20) +
    (rsiScore * 0.10) +
    (volumeScore * 0.15) +
    (Number(sectorScore || 5) * 0.15) +
    (Number(fundamentalsScore || 5) * 0.20) +
    (Number(newsScore || 5) * 0.10) +
    (Number(relativeStrengthScore || 5) * 0.10);

  return Number(score.toFixed(2));
}

export function classifyConviction(score) {
  if (score >= 8) return "HIGH";
  if (score >= 6) return "MEDIUM";
  return "LOW";
}

export function computeRelativeStrengthScore(relativeStrength) {
  const key = String(relativeStrength || "").toUpperCase();
  if (key.includes("OUTPERFORM") || key.includes("STRONG")) return 8.5;
  if (key.includes("LEADING") || key.includes("MODERATE")) return 7.0;
  if (key.includes("UNDERPERFORM") || key.includes("WEAK")) return 3.8;
  return 5.2;
}

export function computeSectorScore(sectorBias) {
  const key = String(sectorBias || "").toUpperCase();
  if (key.includes("STRONG_BULLISH")) return 8.8;
  if (key.includes("BULLISH")) return 7.4;
  if (key.includes("BEARISH")) return 4.0;
  return 5.4;
}

export function computeNewsScore(sentiment) {
  const key = String(sentiment || "").toUpperCase();
  if (key === "POSITIVE") return 7.8;
  if (key === "NEGATIVE") return 3.8;
  return 5.3;
}

export function buildTickerThesis(stock) {
  const parts = [
    `${stock.ticker} is ${stock.trend.toLowerCase()} with RSI at ${stock.rsi}`,
    `volume is ${stock.volumeRatio}x average`,
    `${stock.relativeStrength.toLowerCase().replace(/_/g, " ")} versus the index`
  ];
  if (stock.newsSentiment === "POSITIVE") {
    parts.push("recent headlines support the setup");
  } else if (stock.newsSentiment === "NEGATIVE") {
    parts.push("headline risk is capping conviction");
  }
  return `${parts.join(", ")}.`;
}

export { toNumber };
