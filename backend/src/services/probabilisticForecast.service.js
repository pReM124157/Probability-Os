import supabase from "./supabase.service.js";

const DAY_TRADING = 252;

function clamp(v, min = 0, max = 1) { return Math.min(Math.max(Number(v) || 0, min), max); }
function mean(values = []) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function stddev(values = []) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const varx = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, varx));
}
function quantile(values = [], q = 0.5) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const i = Math.floor(pos);
  const d = pos - i;
  return sorted[i + 1] == null ? sorted[i] : sorted[i] + d * (sorted[i + 1] - sorted[i]);
}
function sampleNormal() {
  let u = 0; let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulateGeometricBrownianMotion({ s0, mu, sigma, dt = 1 / DAY_TRADING, z }) {
  return s0 * Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z);
}

export function simulateStochasticVolatility({ currentVol, longRunVol, volOfVol, dt = 1 / DAY_TRADING, z }) {
  const next = Math.max(0.02, currentVol + (longRunVol - currentVol) * 0.12 * dt + volOfVol * Math.sqrt(dt) * z);
  return next;
}

export function simulateJumpDiffusion({ lambda = 0.03, jumpMean = -0.02, jumpStd = 0.04 }) {
  const trigger = Math.random() < lambda;
  if (!trigger) return 0;
  return jumpMean + jumpStd * sampleNormal();
}

export function generate10kPricePaths({ currentPrice, drift, sigma, horizonDays = 21, paths = 10000, realizedVol = null, regimeWeight = 1 }) {
  const out = [];
  const baseVol = Math.max(0.05, Number(realizedVol || sigma || 0.2));
  const mu = Number(drift || 0);

  for (let p = 0; p < paths; p += 1) {
    let price = currentPrice;
    let vol = baseVol;
    const path = [price];
    for (let t = 0; t < horizonDays; t += 1) {
      const zP = sampleNormal();
      const zV = sampleNormal();
      vol = simulateStochasticVolatility({ currentVol: vol, longRunVol: baseVol, volOfVol: baseVol * 0.55, z: zV });
      const jump = simulateJumpDiffusion({ lambda: 0.02 * regimeWeight, jumpMean: -0.015 * regimeWeight, jumpStd: 0.05 });
      price = simulateGeometricBrownianMotion({ s0: price, mu, sigma: vol, z: zP }) * (1 + jump);
      price = Math.max(0.01, price);
      path.push(price);
    }
    out.push(path);
  }
  return out;
}

export function calculateTailProbability(terminal = [], referencePrice = 0) {
  if (!terminal.length || referencePrice <= 0) return 0;
  const tail = terminal.filter((p) => p <= referencePrice * 0.85).length;
  return Number((tail / terminal.length).toFixed(4));
}

export function calculateDistributionSkew(values = []) {
  if (values.length < 3) return 0;
  const m = mean(values);
  const s = stddev(values);
  if (s === 0) return 0;
  const n = values.length;
  const acc = values.reduce((a, x) => a + (((x - m) / s) ** 3), 0);
  return Number((acc / n).toFixed(6));
}

export function calculateVaR(returns = [], confidence = 0.95) {
  const q = quantile(returns, 1 - confidence);
  return Number(Math.abs(q).toFixed(6));
}

export function calculateCVaR(returns = [], confidence = 0.95) {
  const var95 = -calculateVaR(returns, confidence);
  const tail = returns.filter((r) => r <= var95);
  if (!tail.length) return 0;
  return Number(Math.abs(mean(tail)).toFixed(6));
}

export function calculateExpectedShortfall(returns = [], confidence = 0.95) {
  return calculateCVaR(returns, confidence);
}

export function calculatePathVolatility(paths = []) {
  const vols = paths.map((p) => {
    const rets = [];
    for (let i = 1; i < p.length; i += 1) rets.push(Math.log(p[i] / p[i - 1]));
    return stddev(rets) * Math.sqrt(DAY_TRADING);
  });
  return Number(mean(vols).toFixed(6));
}

export function calculateDownsideAsymmetry(terminal = [], currentPrice = 0) {
  if (!terminal.length || currentPrice <= 0) return 0;
  const down = terminal.filter((v) => v < currentPrice).map((v) => (currentPrice - v) / currentPrice);
  const up = terminal.filter((v) => v >= currentPrice).map((v) => (v - currentPrice) / currentPrice);
  return Number((mean(down) - mean(up)).toFixed(6));
}

export function clusterSimulationPaths(paths = [], buckets = 5) {
  const terminals = paths.map((p, idx) => ({ idx, v: p[p.length - 1] })).sort((a, b) => a.v - b.v);
  const size = Math.max(1, Math.floor(terminals.length / buckets));
  const clusters = [];
  for (let i = 0; i < terminals.length; i += size) {
    const chunk = terminals.slice(i, i + size);
    clusters.push({
      count: chunk.length,
      min: chunk[0]?.v || 0,
      max: chunk[chunk.length - 1]?.v || 0,
      mean: mean(chunk.map((c) => c.v))
    });
  }
  return clusters;
}

export function runMonteCarloSimulation({
  currentPrice,
  historicalReturns = [],
  regimeDanger = 0,
  horizonDays = 21,
  paths = 10000
} = {}) {
  const drift = mean(historicalReturns) * DAY_TRADING * (1 - clamp(regimeDanger, 0, 0.8));
  const histVol = stddev(historicalReturns) * Math.sqrt(DAY_TRADING);
  const rolling = stddev(historicalReturns.slice(-60)) * Math.sqrt(DAY_TRADING);
  const realizedVol = Math.max(0.05, (histVol * 0.6 + rolling * 0.4) * (1 + regimeDanger * 0.6));

  const pricePaths = generate10kPricePaths({
    currentPrice,
    drift,
    sigma: realizedVol,
    realizedVol,
    horizonDays,
    paths: Math.max(1000, paths),
    regimeWeight: 1 + regimeDanger
  });

  const terminal = pricePaths.map((p) => p[p.length - 1]);
  const simulatedReturns = terminal.map((t) => (t - currentPrice) / Math.max(currentPrice, 0.01));
  const intervals = {
    p05: Number(quantile(terminal, 0.05).toFixed(4)),
    p25: Number(quantile(terminal, 0.25).toFixed(4)),
    p50: Number(quantile(terminal, 0.5).toFixed(4)),
    p75: Number(quantile(terminal, 0.75).toFixed(4)),
    p95: Number(quantile(terminal, 0.95).toFixed(4))
  };

  return {
    paths: pricePaths,
    simulationCount: pricePaths.length,
    intervals,
    probabilities: {
      upsideProbability: Number((terminal.filter((t) => t > currentPrice).length / terminal.length).toFixed(4)),
      downsideProbability: Number((terminal.filter((t) => t < currentPrice).length / terminal.length).toFixed(4)),
      tailProbability: calculateTailProbability(terminal, currentPrice)
    },
    risk: {
      var95: calculateVaR(simulatedReturns, 0.95),
      cvar95: calculateCVaR(simulatedReturns, 0.95),
      expectedShortfall95: calculateExpectedShortfall(simulatedReturns, 0.95)
    },
    skewness: calculateDistributionSkew(simulatedReturns),
    pathVolatility: calculatePathVolatility(pricePaths),
    downsideAsymmetry: calculateDownsideAsymmetry(terminal, currentPrice),
    clusters: clusterSimulationPaths(pricePaths),
    expectedValue: Number(mean(terminal).toFixed(4))
  };
}

export function generateMonteCarloForecast(input = {}) {
  return runMonteCarloSimulation(input);
}

export async function persistMonteCarloForecast({ ticker, forecast }) {
  const { error } = await supabase.from("monte_carlo_results").insert({
    ticker,
    simulation_count: Number(forecast.simulationCount || 0),
    var_95: Number(forecast.risk?.var95 || 0),
    cvar_95: Number(forecast.risk?.cvar95 || 0),
    tail_probability: Number(forecast.probabilities?.tailProbability || 0),
    expected_distribution: forecast.intervals || {},
    created_at: new Date().toISOString()
  });
  if (error) console.warn("[MC] persistMonteCarloForecast failed:", error.message);
}

export async function generateProbabilisticOutlook({ ticker, ...rest } = {}) {
  const forecast = runMonteCarloSimulation(rest);
  await persistMonteCarloForecast({ ticker, forecast });
  return forecast;
}
