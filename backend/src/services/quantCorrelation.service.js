import supabase from "./supabase.service.js";

function mean(arr = []) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function covariance(a = [], b = []) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const x = a.slice(-n); const y = b.slice(-n);
  const mx = mean(x); const my = mean(y);
  return x.reduce((acc, v, i) => acc + ((v - mx) * (y[i] - my)), 0) / (n - 1);
}
function variance(a = []) { return covariance(a, a); }
function corr(a = [], b = []) {
  const cov = covariance(a, b); const va = variance(a); const vb = variance(b);
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}

export function buildRollingCovarianceMatrix(returnMap = {}, window = 60) {
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

export function calculateEigenRisk(covMatrix = {}) {
  const tickers = Object.keys(covMatrix);
  if (!tickers.length) return { dominantEigenApprox: 0, concentration: 0 };
  const rowSums = tickers.map((t) => Object.values(covMatrix[t] || {}).reduce((a, b) => a + Math.abs(Number(b || 0)), 0));
  const dominant = Math.max(...rowSums, 0);
  const total = rowSums.reduce((a, b) => a + b, 0) || 1;
  return {
    dominantEigenApprox: Number(dominant.toFixed(8)),
    concentration: Number((dominant / total).toFixed(6))
  };
}

export function runPCAFactorDecomposition(covMatrix = {}, factorCount = 3) {
  const tickers = Object.keys(covMatrix);
  if (!tickers.length) return { factors: [], explainedVariance: [] };
  const rowSums = tickers.map((t) => Object.values(covMatrix[t] || {}).map((v) => Math.abs(Number(v || 0))).reduce((a, b) => a + b, 0));
  const total = rowSums.reduce((a, b) => a + b, 0) || 1;
  const sorted = tickers.map((t, i) => ({ ticker: t, score: rowSums[i] / total })).sort((a, b) => b.score - a.score);
  const factors = sorted.slice(0, factorCount);
  return {
    factors,
    explainedVariance: factors.map((f) => Number(f.score.toFixed(6)))
  };
}

export function calculateFactorBetas(positions = [], returnMap = {}) {
  const marketProxy = Object.values(returnMap)[0] || [];
  const mVar = variance(marketProxy) || 1e-8;
  return positions.map((p) => {
    const series = returnMap[p.ticker] || [];
    const beta = covariance(series, marketProxy) / mVar;
    return { ticker: p.ticker, beta: Number(beta.toFixed(6)) };
  });
}

export function detectFactorDominance(pca = {}) {
  const top = Number(pca.explainedVariance?.[0] || 0);
  return { dominant: top > 0.35, topFactorExplained: top };
}

export function calculateMarginalRiskContribution(positions = [], covMatrix = {}, weights = {}) {
  return positions.map((p) => {
    const w = Number(weights[p.ticker] ?? p.weight ?? 0);
    const row = covMatrix[p.ticker] || {};
    const mrc = Object.entries(row).reduce((acc, [k, v]) => acc + (Number(v || 0) * Number(weights[k] ?? 0)), 0) * w;
    return { ticker: p.ticker, marginalRisk: Number(mrc.toFixed(8)) };
  });
}

export function calculateComponentVaR(mrc = [], portfolioVaR = 0) {
  const total = mrc.reduce((a, x) => a + Math.abs(Number(x.marginalRisk || 0)), 0) || 1;
  return mrc.map((r) => ({ ticker: r.ticker, componentVaR: Number((Math.abs(r.marginalRisk) / total * portfolioVaR).toFixed(6)) }));
}

export function calculateVolatilityContagion(corrMatrix = {}) {
  const vals = [];
  for (const a of Object.keys(corrMatrix)) {
    for (const b of Object.keys(corrMatrix[a] || {})) if (a !== b) vals.push(Math.abs(Number(corrMatrix[a][b] || 0)));
  }
  const score = mean(vals);
  return Number(score.toFixed(6));
}

export function calculateCrossSectorDependency(positions = [], corrMatrix = {}) {
  const bySector = new Map();
  for (const p of positions) {
    const s = p.sector || "UNKNOWN";
    if (!bySector.has(s)) bySector.set(s, []);
    bySector.get(s).push(p.ticker);
  }

  const sectors = [...bySector.keys()];
  const dependencies = [];
  for (let i = 0; i < sectors.length; i += 1) {
    for (let j = i + 1; j < sectors.length; j += 1) {
      const aTickers = bySector.get(sectors[i]);
      const bTickers = bySector.get(sectors[j]);
      const vals = [];
      for (const a of aTickers) for (const b of bTickers) vals.push(Math.abs(Number(corrMatrix[a]?.[b] || 0)));
      dependencies.push({ sectorA: sectors[i], sectorB: sectors[j], dependency: Number(mean(vals).toFixed(6)) });
    }
  }
  return dependencies;
}

export function detectCorrelationBreakdown(returnMap = {}) {
  const tickers = Object.keys(returnMap);
  if (tickers.length < 2) return { broken: false, shift: 0 };
  const a = returnMap[tickers[0]] || [];
  const b = returnMap[tickers[1]] || [];
  const short = corr(a.slice(-20), b.slice(-20));
  const long = corr(a.slice(-120), b.slice(-120));
  const shift = Math.abs(short - long);
  return { broken: shift > 0.35, shift: Number(shift.toFixed(6)), short: Number(short.toFixed(6)), long: Number(long.toFixed(6)) };
}

export async function persistPortfolioCovarianceMatrix(rows = []) {
  if (!rows.length) return;
  const { error } = await supabase.from("portfolio_covariance_matrix").insert(rows);
  if (error) console.warn("[CORR] persistPortfolioCovarianceMatrix failed:", error.message);
}

export async function generateCorrelationIntel({ positions = [], returnMap = {} } = {}) {
  const covarianceMatrix = buildRollingCovarianceMatrix(returnMap, 90);
  const correlationMatrix = {};
  Object.keys(covarianceMatrix).forEach((a) => {
    correlationMatrix[a] = {};
    Object.keys(covarianceMatrix[a]).forEach((b) => {
      correlationMatrix[a][b] = Number(corr(returnMap[a] || [], returnMap[b] || []).toFixed(6));
    });
  });

  const pca = runPCAFactorDecomposition(covarianceMatrix, 3);
  const factorBetas = calculateFactorBetas(positions, returnMap);
  const eigenRisk = calculateEigenRisk(covarianceMatrix);
  const breakdown = detectCorrelationBreakdown(returnMap);
  const volatilityContagion = calculateVolatilityContagion(correlationMatrix);
  const crossSectorDependency = calculateCrossSectorDependency(positions, correlationMatrix);

  const weights = Object.fromEntries(positions.map((p) => [p.ticker, Number(p.weight || 0)]));
  const mrc = calculateMarginalRiskContribution(positions, covarianceMatrix, weights);
  const componentVaR = calculateComponentVaR(mrc, 0.06);

  const rows = [];
  Object.keys(correlationMatrix).forEach((a) => {
    Object.keys(correlationMatrix[a]).forEach((b) => {
      rows.push({ ticker_a: a, ticker_b: b, covariance: covarianceMatrix[a][b], rolling_correlation: correlationMatrix[a][b], created_at: new Date().toISOString() });
    });
  });
  await persistPortfolioCovarianceMatrix(rows);

  return {
    covarianceMatrix,
    correlationMatrix,
    eigenRisk,
    pca,
    factorBetas,
    factorDominance: detectFactorDominance(pca),
    marginalRiskContribution: mrc,
    componentVaR,
    volatilityContagion,
    crossSectorDependency,
    correlationBreakdown: breakdown,
    portfolioFragilityScore: Number((Math.min(1, volatilityContagion * 1.15 + eigenRisk.concentration * 0.8) * 100).toFixed(2))
  };
}
