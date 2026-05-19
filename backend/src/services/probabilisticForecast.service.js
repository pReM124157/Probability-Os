import supabase from "./supabase.service.js";

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function mean(values = []) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stddev(values = []) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((acc, x) => acc + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(v, 0));
}

function sampleNormal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulateFuturePricePaths({ currentPrice, mu, sigma, horizonDays = 21, paths = 1000 }) {
  const dt = 1 / 252;
  const out = [];

  for (let p = 0; p < paths; p += 1) {
    let price = currentPrice;
    const path = [price];
    for (let t = 0; t < horizonDays; t += 1) {
      const z = sampleNormal();
      price = price * Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z);
      path.push(price);
    }
    out.push(path);
  }
  return out;
}

export function calculateDistributionCurves(paths = []) {
  const terminal = paths.map((p) => p[p.length - 1]).filter((x) => Number.isFinite(x));
  return {
    terminal,
    mean: Number(mean(terminal).toFixed(4)),
    stddev: Number(stddev(terminal).toFixed(4))
  };
}

export function calculateConfidenceIntervals(terminal = [], levels = [0.1, 0.5, 0.9]) {
  const out = {};
  levels.forEach((q) => { out[q] = Number(quantile(terminal, q).toFixed(2)); });
  return {
    low: out[0.1] || 0,
    median: out[0.5] || 0,
    high: out[0.9] || 0
  };
}

export function generateScenarioProbabilities(terminal = [], currentPrice = 0) {
  if (!terminal.length || currentPrice <= 0) {
    return { upsideProbability: 0, downsideProbability: 0, flatProbability: 1 };
  }
  const up = terminal.filter((p) => p >= currentPrice * 1.05).length / terminal.length;
  const down = terminal.filter((p) => p <= currentPrice * 0.95).length / terminal.length;
  return {
    upsideProbability: Number(clamp(up).toFixed(4)),
    downsideProbability: Number(clamp(down).toFixed(4)),
    flatProbability: Number(clamp(1 - up - down).toFixed(4))
  };
}

export function calculateVolatilityAdjustedForecast({ mu, sigma, regimeDanger = 0 }) {
  const adjMu = mu * (1 - clamp(regimeDanger, 0, 0.7));
  const adjSigma = sigma * (1 + clamp(regimeDanger, 0, 1) * 0.6);
  return { mu: adjMu, sigma: adjSigma };
}

export function calculateExpectedValueDistribution(terminal = []) {
  return Number(mean(terminal).toFixed(2));
}

export function generateMonteCarloForecast({ currentPrice, historicalReturns = [], regimeDanger = 0, horizonDays = 21, paths = 1000 }) {
  const mu = mean(historicalReturns) * 252;
  const sigma = stddev(historicalReturns) * Math.sqrt(252);
  const adjusted = calculateVolatilityAdjustedForecast({ mu, sigma, regimeDanger });
  const pricePaths = simulateFuturePricePaths({
    currentPrice,
    mu: adjusted.mu,
    sigma: Math.max(0.05, adjusted.sigma),
    horizonDays,
    paths
  });

  const dist = calculateDistributionCurves(pricePaths);
  const intervals = calculateConfidenceIntervals(dist.terminal);
  const scenario = generateScenarioProbabilities(dist.terminal, currentPrice);

  return {
    paths: pricePaths,
    intervals,
    probabilities: scenario,
    expectedValue: calculateExpectedValueDistribution(dist.terminal),
    downsideAsymmetry: Number((scenario.downsideProbability - scenario.upsideProbability).toFixed(4))
  };
}

export async function persistMonteCarloForecast({ ticker, intervals, probabilities }) {
  const { error } = await supabase.from("monte_carlo_forecasts").insert({
    ticker,
    expected_range_low: intervals.low,
    expected_range_high: intervals.high,
    downside_probability: probabilities.downsideProbability,
    upside_probability: probabilities.upsideProbability,
    created_at: new Date().toISOString()
  });
  if (error) console.warn("[MC] persistMonteCarloForecast failed:", error.message);
}

export async function generateProbabilisticOutlook({ ticker, currentPrice, historicalReturns = [], regimeDanger = 0, horizonDays = 21, paths = 1000 }) {
  const forecast = generateMonteCarloForecast({ currentPrice, historicalReturns, regimeDanger, horizonDays, paths });
  await persistMonteCarloForecast({ ticker, intervals: forecast.intervals, probabilities: forecast.probabilities });
  return forecast;
}
