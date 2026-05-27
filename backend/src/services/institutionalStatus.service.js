import supabase, { isSupabaseSchemaMissing } from "./supabase.service.js";
import { fetchIndianHolidays } from "./holiday.service.js";
import {
  calculateProviderReliability,
  trackProviderFailureBursts,
  trackProviderLatency,
  trackProviderSuccessRate
} from "./providerHealth.service.js";
import { getPortfolioDefenseHealth } from "./portfolioDefenseHealth.service.js";
import { getLastMarketSyncAt } from "./marketData.service.js";

const PROVIDERS = ["yahoo", "twelvedata", "finnhub", "alpha_vantage"];

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toState(healthy, coolingDown, failures) {
  if (!healthy) return "OFFLINE";
  if (coolingDown || failures >= 3) return "DEGRADED";
  return "ONLINE";
}

function titleize(name = "") {
  const map = {
    yahoo: "Yahoo",
    twelvedata: "TwelveData",
    finnhub: "Finnhub",
    alpha_vantage: "AlphaVantage"
  };
  if (map[name]) return map[name];
  return String(name)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function agoSeconds(iso) {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

async function getMarketState() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const dateStr = ist.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const open = 9 * 60 + 15;
  const close = 15 * 60 + 30;
  const holidays = await fetchIndianHolidays(ist.getFullYear());
  const isWeekend = day === 0 || day === 6;
  const isHoliday = holidays.has(dateStr);
  const isOpen = !isWeekend && !isHoliday && minutes >= open && minutes <= close;
  return {
    state: isOpen ? "OPEN" : "CLOSED",
    isOpen,
    isWeekend,
    isHoliday
  };
}

async function getProviderDbRows() {
  try {
    const { data, error } = await supabase
      .from("provider_health")
      .select("provider, consecutive_failures, cooldown_until, last_success_at, updated_at")
      .in("provider", PROVIDERS);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) {
      return [];
    }
    return [];
  }
}

export async function getInstitutionalRuntimeSnapshot() {
  const [market, providerRows] = await Promise.all([getMarketState(), getProviderDbRows()]);
  const defenseHealth = getPortfolioDefenseHealth();
  const providerMap = Object.fromEntries(providerRows.map((r) => [String(r.provider || "").toLowerCase(), r]));

  const providerDetails = PROVIDERS.map((provider) => {
    const row = providerMap[provider] || {};
    const cooldownUntil = row.cooldown_until ? new Date(row.cooldown_until) : null;
    const coolingDown = cooldownUntil instanceof Date && cooldownUntil.getTime() > Date.now();
    const failures = toNum(row.consecutive_failures, 0);
    const successRate = trackProviderSuccessRate(provider);
    const latencyMs = trackProviderLatency(provider);
    const failureBursts = trackProviderFailureBursts(provider);
    const reliability = calculateProviderReliability(provider);

    const healthy = !coolingDown && failures < 5 && reliability >= 0.35;
    return {
      provider,
      label: titleize(provider),
      state: toState(healthy, coolingDown, failures),
      healthy,
      successRate,
      latencyMs,
      failureBursts,
      reliability,
      failures,
      cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
      lastSuccessAt: row.last_success_at || null,
      updatedAt: row.updated_at || null
    };
  });

  const avgReliability = providerDetails.reduce((acc, p) => acc + p.reliability, 0) / Math.max(providerDetails.length, 1);
  const providerHealthScore = Math.max(0, Math.min(100, Math.round(avgReliability * 100)));
  const dataReliability = providerHealthScore >= 75 ? "HIGH" : providerHealthScore >= 50 ? "MODERATE" : "LOW";

  const schedulerState = defenseHealth.schedulerStatus === "RUNNING" ? "HEALTHY" : "DEGRADED";
  const lastPortfolioScanAgo = agoSeconds(defenseHealth.lastExecutionAt);
  const lastStressAgo = agoSeconds(defenseHealth.lastStressTestAt);
  const lastCorrelationAgo = agoSeconds(defenseHealth.lastCorrelationScanAt);
  const lastMarketSyncAt = getLastMarketSyncAt();

  const systems = [
    { name: "Portfolio Defense Agent", state: defenseHealth.lastExecutionAt ? "ONLINE" : "DEGRADED", lastExecutionAt: defenseHealth.lastExecutionAt },
    { name: "Correlation Stress Engine", state: lastCorrelationAgo != null && lastCorrelationAgo < 1800 ? "ONLINE" : "DEGRADED", lastExecutionAt: defenseHealth.lastCorrelationScanAt },
    { name: "Adaptive Learning Layer", state: "ONLINE", lastExecutionAt: defenseHealth.lastExecutionAt },
    { name: "Statistical Validation Engine", state: "ONLINE", lastExecutionAt: null },
    { name: "Replay Reliability Engine", state: "ONLINE", lastExecutionAt: null },
    { name: "Provider Health Monitor", state: providerHealthScore >= 50 ? "ONLINE" : "DEGRADED", lastExecutionAt: new Date().toISOString() },
    { name: "Liquidity Surveillance", state: defenseHealth.lastExecutionAt ? "ONLINE" : "DEGRADED", lastExecutionAt: defenseHealth.lastExecutionAt },
    { name: "Recommendation Outcome Tracker", state: "ONLINE", lastExecutionAt: null }
  ];

  return {
    generatedAt: new Date().toISOString(),
    systems,
    marketInfra: {
      marketState: market.state,
      dataReliability,
      activeProviders: providerDetails.filter((p) => p.state !== "OFFLINE").map((p) => p.label),
      providerHealthScore,
      cacheState: "HEALTHY",
      lastMarketSyncAt,
      lastMarketSyncAgo: agoSeconds(lastMarketSyncAt)
    },
    providers: providerDetails,
    surveillance: {
      lastPortfolioScanAt: defenseHealth.lastExecutionAt,
      lastPortfolioScanAgo,
      lastStressTestAt: defenseHealth.lastStressTestAt,
      lastStressTestAgo: lastStressAgo,
      lastCorrelationScanAt: defenseHealth.lastCorrelationScanAt,
      lastCorrelationScanAgo: lastCorrelationAgo,
      correlationScanState: lastCorrelationAgo != null && lastCorrelationAgo < 1800 ? "ACTIVE" : "DEGRADED",
      schedulerState,
      monitoringStatus: defenseHealth.lastExecutionAt ? "ACTIVE" : "INITIALIZING"
    },
    queue: {
      redisConfigured: Boolean(defenseHealth?.queueHealth?.redisConfigured),
      runtimeState: Boolean(defenseHealth?.queueHealth?.redisConfigured) ? "ONLINE" : "DEGRADED"
    }
  };
}

export function buildCapitalProtectionState(review, runtime = {}) {
  const topHoldingWeight = toNum(review?.details?.topHoldingWeight, 0);
  const topSectorWeight = toNum(review?.details?.topSectorWeight, 0);
  const score100 = Math.max(0, Math.min(100, Math.round(toNum(review?.score, 0) * 10)));

  const concentrationState = topHoldingWeight >= 35 || topSectorWeight >= 50
    ? "CRITICAL"
    : (topHoldingWeight >= 25 || topSectorWeight >= 40 ? "ELEVATED" : "NORMAL");

  const riskBudgetUsage = Math.max(0, Math.min(100, Math.round((100 - score100) + (topHoldingWeight * 0.3))));
  const volatilityRegime = riskBudgetUsage >= 65 ? "HIGH" : riskBudgetUsage >= 35 ? "MODERATE" : "LOW";
  const deploymentMode = concentrationState === "CRITICAL" || volatilityRegime === "HIGH"
    ? "DEFENSIVE"
    : (score100 >= 75 ? "AGGRESSIVE" : "NORMAL");

  return {
    deploymentMode,
    riskBudgetUsage,
    concentrationState,
    volatilityRegime,
    protectionSystems: runtime?.systems?.some((s) => s.state !== "OFFLINE") ? "ACTIVE" : "DEGRADED"
  };
}
