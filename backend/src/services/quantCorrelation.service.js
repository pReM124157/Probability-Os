import supabase from "./supabase.service.js";

function clamp(value, min = -1, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function mean(arr = []) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function covariance(a = [], b = []) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = mean(x);
  const my = mean(y);
  return x.reduce((acc, v, i) => acc + ((v - mx) * (y[i] - my)), 0) / (n - 1);
}

function variance(a = []) {
  return covariance(a, a);
}

export function calculateRollingCorrelation(seriesA = [], seriesB = [], window = 20) {
  const cov = covariance(seriesA.slice(-window), seriesB.slice(-window));
  const va = variance(seriesA.slice(-window));
  const vb = variance(seriesB.slice(-window));
  if (va <= 0 || vb <= 0) return 0;
  return Number(clamp(cov / Math.sqrt(va * vb)).toFixed(4));
}

export function calculateCovarianceMatrix(returnMap = {}, window = 60) {
  const tickers = Object.keys(returnMap);
  const matrix = {};
  for (const a of tickers) {
    matrix[a] = {};
    for (const b of tickers) {
      matrix[a][b] = Number(covariance((returnMap[a] || []).slice(-window), (returnMap[b] || []).slice(-window)).toFixed(8));
    }
  }
  return matrix;
}

export function calculateBetaAdjustedCorrelation(seriesA = [], seriesB = [], betaA = 1, betaB = 1, window = 60) {
  const corr = calculateRollingCorrelation(seriesA, seriesB, window);
  const betaAdjustment = Math.sqrt(Math.max(betaA, 0.2) * Math.max(betaB, 0.2));
  return Number(clamp(corr / betaAdjustment).toFixed(4));
}

export function calculateVolatilityAdjustedCorrelation(seriesA = [], seriesB = [], volA = 0.2, volB = 0.2, window = 60) {
  const corr = calculateRollingCorrelation(seriesA, seriesB, window);
  const volAdj = Math.max(0.4, Math.min(2.5, (volA + volB) / 0.4));
  return Number(clamp(corr * volAdj).toFixed(4));
}

export function calculateDynamicCorrelationWindows(seriesA = [], seriesB = [], windows = [20, 60, 120]) {
  return windows.map((w) => ({ window: w, correlation: calculateRollingCorrelation(seriesA, seriesB, w) }));
}

export function detectHistoricalCorrelationSpikes(seriesA = [], seriesB = [], window = 20, threshold = 0.75) {
  const spikes = [];
  const n = Math.min(seriesA.length, seriesB.length);
  for (let i = window; i <= n; i += 1) {
    const corr = calculateRollingCorrelation(seriesA.slice(0, i), seriesB.slice(0, i), window);
    if (Math.abs(corr) >= threshold) spikes.push({ index: i - 1, correlation: corr });
  }
  return spikes;
}

export function detectCorrelationRegimeShifts(seriesA = [], seriesB = []) {
  const short = calculateRollingCorrelation(seriesA, seriesB, 20);
  const medium = calculateRollingCorrelation(seriesA, seriesB, 60);
  const long = calculateRollingCorrelation(seriesA, seriesB, 120);
  const shift = Math.abs(short - long);
  return {
    short,
    medium,
    long,
    shift: Number(shift.toFixed(4)),
    shifted: shift > 0.25
  };
}

export function detectHiddenExposureClusters(positions = [], corrMatrix = {}) {
  return positions
    .map((p) => {
      const linked = positions
        .filter((q) => q.ticker !== p.ticker && Math.abs(corrMatrix[p.ticker]?.[q.ticker] || 0) > 0.72)
        .map((q) => q.ticker);
      return { ticker: p.ticker, cluster: linked };
    })
    .filter((r) => r.cluster.length >= 2);
}

export async function persistPortfolioCovarianceMatrix(rows = []) {
  if (!rows.length) return;
  const { error } = await supabase.from("portfolio_covariance_matrix").insert(rows);
  if (error) console.warn("[CORR] persistPortfolioCovarianceMatrix failed:", error.message);
}

export async function generateCorrelationIntel({ positions = [], returnMap = {} } = {}) {
  const covarianceMatrix = calculateCovarianceMatrix(returnMap, 60);
  const correlationMatrix = {};

  Object.keys(covarianceMatrix).forEach((a) => {
    correlationMatrix[a] = {};
    Object.keys(covarianceMatrix[a]).forEach((b) => {
      const corr = calculateRollingCorrelation(returnMap[a] || [], returnMap[b] || [], 60);
      correlationMatrix[a][b] = corr;
    });
  });

  const clusters = detectHiddenExposureClusters(positions, correlationMatrix);
  const rows = [];
  Object.keys(correlationMatrix).forEach((a) => {
    Object.keys(correlationMatrix[a]).forEach((b) => {
      rows.push({
        ticker_a: a,
        ticker_b: b,
        covariance: covarianceMatrix[a][b],
        rolling_correlation: correlationMatrix[a][b],
        created_at: new Date().toISOString()
      });
    });
  });
  await persistPortfolioCovarianceMatrix(rows);

  const avgAbs = rows.length ? rows.reduce((acc, r) => acc + Math.abs(Number(r.rolling_correlation || 0)), 0) / rows.length : 0;
  const fragility = Math.min(1, avgAbs * 1.2 + (clusters.length / Math.max(positions.length, 1)) * 0.35);

  return {
    covarianceMatrix,
    correlationMatrix,
    hiddenExposureClusters: clusters,
    diversificationScore: Number(((1 - fragility) * 100).toFixed(2)),
    portfolioFragilityScore: Number((fragility * 100).toFixed(2)),
    hiddenConcentrationWarnings: clusters.map((c) => `${c.ticker} has high historical co-movement with ${c.cluster.join(",")}`)
  };
}
