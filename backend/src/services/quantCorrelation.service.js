function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function mean(arr = []) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function calculateRollingCorrelation(seriesA = [], seriesB = [], window = 20) {
  const n = Math.min(seriesA.length, seriesB.length, window);
  if (n < 3) return 0;
  const a = seriesA.slice(-n);
  const b = seriesB.slice(-n);
  const ma = mean(a);
  const mb = mean(b);
  const cov = a.reduce((acc, v, i) => acc + (v - ma) * (b[i] - mb), 0) / (n - 1);
  const sda = Math.sqrt(a.reduce((acc, v) => acc + (v - ma) ** 2, 0) / (n - 1));
  const sdb = Math.sqrt(b.reduce((acc, v) => acc + (v - mb) ** 2, 0) / (n - 1));
  if (!sda || !sdb) return 0;
  return Number((cov / (sda * sdb)).toFixed(4));
}

export function calculateCovarianceMatrix(returnMap = {}) {
  const tickers = Object.keys(returnMap);
  const matrix = {};
  tickers.forEach((a) => {
    matrix[a] = {};
    tickers.forEach((b) => {
      matrix[a][b] = calculateRollingCorrelation(returnMap[a], returnMap[b], 30);
    });
  });
  return matrix;
}

export function detectHiddenExposureClusters(positions = [], corrMatrix = {}) {
  const clusters = [];
  positions.forEach((p) => {
    const related = positions
      .filter((q) => q.ticker !== p.ticker && Math.abs(corrMatrix[p.ticker]?.[q.ticker] || 0) > 0.72)
      .map((q) => q.ticker);
    if (related.length >= 2) clusters.push({ ticker: p.ticker, cluster: related });
  });
  return clusters;
}

export function detectFactorConcentration(positions = []) {
  const map = {};
  positions.forEach((p) => {
    const factor = p.factor || p.sector || "UNKNOWN";
    map[factor] = (map[factor] || 0) + Number(p.weight || 0);
  });
  const maxFactor = Object.entries(map).sort((a, b) => b[1] - a[1])[0] || ["UNKNOWN", 0];
  return {
    factorWeights: map,
    dominantFactor: maxFactor[0],
    concentrationScore: Number(clamp(maxFactor[1] / 0.4, 0, 1).toFixed(4))
  };
}

export function detectBetaStacking(positions = []) {
  const stacked = positions.filter((p) => Number(p.beta || 1) > 1.3).reduce((acc, p) => acc + Number(p.weight || 0), 0);
  return Number(clamp(stacked / 0.45, 0, 1).toFixed(4));
}

export function calculatePortfolioDependencyGraph(positions = [], corrMatrix = {}) {
  return positions.map((p) => ({
    ticker: p.ticker,
    dependencies: positions
      .filter((q) => q.ticker !== p.ticker && Math.abs(corrMatrix[p.ticker]?.[q.ticker] || 0) > 0.6)
      .map((q) => ({ ticker: q.ticker, corr: corrMatrix[p.ticker][q.ticker] }))
  }));
}

export function detectMacroExposureOverlap(positions = []) {
  const macro = positions.reduce((acc, p) => {
    const theme = p.macroTheme || "RISK_ASSETS";
    acc[theme] = (acc[theme] || 0) + Number(p.weight || 0);
    return acc;
  }, {});
  const overlap = Object.values(macro).reduce((acc, v) => acc + (v > 0.35 ? v : 0), 0);
  return {
    macroWeights: macro,
    overlapScore: Number(clamp(overlap, 0, 1).toFixed(4))
  };
}

export function calculateCrossAssetCorrelation(positions = [], corrMatrix = {}) {
  const pairs = [];
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const a = positions[i];
      const b = positions[j];
      pairs.push({
        tickerA: a.ticker,
        tickerB: b.ticker,
        corr: corrMatrix[a.ticker]?.[b.ticker] || 0
      });
    }
  }
  const avgAbs = pairs.length ? pairs.reduce((acc, p) => acc + Math.abs(p.corr), 0) / pairs.length : 0;
  return { pairs, averageAbsoluteCorrelation: Number(avgAbs.toFixed(4)) };
}

export function generateCorrelationHeatmap(corrMatrix = {}) {
  return Object.entries(corrMatrix).map(([ticker, row]) => ({ ticker, ...row }));
}

export function generateCorrelationIntel({ positions = [], returnMap = {} } = {}) {
  const corrMatrix = calculateCovarianceMatrix(returnMap);
  const clusters = detectHiddenExposureClusters(positions, corrMatrix);
  const factors = detectFactorConcentration(positions);
  const betaStacking = detectBetaStacking(positions);
  const macroOverlap = detectMacroExposureOverlap(positions);
  const crossAsset = calculateCrossAssetCorrelation(positions, corrMatrix);

  const fragility = clamp(
    factors.concentrationScore * 0.3 +
    betaStacking * 0.2 +
    macroOverlap.overlapScore * 0.25 +
    clamp(crossAsset.averageAbsoluteCorrelation / 0.75, 0, 1) * 0.25,
    0,
    1
  );

  return {
    correlationMatrix: corrMatrix,
    heatmap: generateCorrelationHeatmap(corrMatrix),
    dependencyGraph: calculatePortfolioDependencyGraph(positions, corrMatrix),
    hiddenExposureClusters: clusters,
    factorDependencyAlerts: factors,
    hiddenConcentrationWarnings: clusters.map((c) => `${c.ticker} clustered with ${c.cluster.join(",")}`),
    diversificationScore: Number(((1 - fragility) * 100).toFixed(2)),
    portfolioFragilityScore: Number((fragility * 100).toFixed(2))
  };
}
