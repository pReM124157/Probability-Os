/**
 * FINSIGHT AI MACRO INTELLIGENCE SERVICE
 *
 * Generates three report types:
 *  1. DAILY AI MACRO INTELLIGENCE — pre-market, institutionally formatted
 *  2. WEEKLY INSTITUTIONAL INTELLIGENCE — deep, FII/DII aware
 *  3. HIGH MACRO RISK ALERT — event-driven only, elevated volatility
 *
 * Design goals:
 *  - Institutional feel: not retail news spam, not generic AI paragraphs
 *  - Answers: "What is smart money likely seeing right now?"
 *  - Deterministic formatting — same structure every time
 *  - AI used only for intelligence synthesis, not filler content
 */

import Groq from "groq-sdk";
import { getIndianIndices, getIndianSectors, getIndianMarketNews } from "./marketData.service.js";
import { logError, logEvent } from "./telemetry.service.js";
import { formatMacro } from "./telegramFormatter.service.js";

const primaryGroq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;
const backupGroq = process.env.GROQ_API_KEY_BACKUP
  ? new Groq({ apiKey: process.env.GROQ_API_KEY_BACKUP })
  : null;

if (!primaryGroq) {
  console.warn("[MACRO] Primary Groq disabled: missing GROQ_API_KEY");
}

if (!backupGroq) {
  console.warn("[MACRO] Backup Groq disabled: missing GROQ_API_KEY_BACKUP");
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: MARKET DATA COLLECTION
// ─────────────────────────────────────────────────────────────────────────────

async function collectMacroMarketData() {
  try {
    const [indices, sectors, headlines] = await Promise.allSettled([
      getIndianIndices(),
      getIndianSectors(),
      getIndianMarketNews()
    ]);

    const indicesData  = indices.status  === "fulfilled" ? indices.value  : null;
    const sectorsData  = sectors.status  === "fulfilled" ? sectors.value  : null;
    const headlinesData = headlines.status === "fulfilled" ? headlines.value : [];

    return { indicesData, sectorsData, headlinesData };
  } catch (error) {
    logError("macro.data_collection.error", error);
    return { indicesData: null, sectorsData: null, headlinesData: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: MARKET BIAS COMPUTATION (deterministic, no AI needed)
// ─────────────────────────────────────────────────────────────────────────────

function computeMarketBias(indicesData) {
  const niftyChange = Number(indicesData?.nifty?.change || 0);
  const sensexChange = Number(indicesData?.sensex?.change || 0);
  const avgChange = (niftyChange + sensexChange) / 2;

  if (avgChange >= 1.0)  return "Bullish";
  if (avgChange >= 0.3)  return "Moderately Bullish";
  if (avgChange <= -1.0) return "Bearish";
  if (avgChange <= -0.3) return "Moderately Bearish";
  return "Neutral";
}

function computeMacroRisk(indicesData, headlinesData) {
  const niftyChange = Math.abs(Number(indicesData?.nifty?.change || 0));
  const headlineCount = Array.isArray(headlinesData) ? headlinesData.length : 0;

  // Simple scoring: volatility + negative headline density
  const negativeCount = Array.isArray(headlinesData)
    ? headlinesData.filter((h) => {
        const text = String(h?.title || h?.headline || "").toLowerCase();
        return text.includes("risk") || text.includes("fall") || text.includes("crash")
          || text.includes("concern") || text.includes("uncertainty") || text.includes("pressure");
      }).length
    : 0;

  const riskScore = (niftyChange > 1.5 ? 2 : niftyChange > 0.8 ? 1 : 0)
    + (negativeCount > 3 ? 2 : negativeCount > 1 ? 1 : 0);

  if (riskScore >= 3) return "Elevated";
  if (riskScore >= 1) return "Moderate";
  return "Low";
}

function classifySectors(sectorsData) {
  if (!Array.isArray(sectorsData) || !sectorsData.length) {
    return { strong: [], weak: [] };
  }

  const sorted = [...sectorsData].sort((a, b) =>
    Number(b.change || b.changePercent || 0) - Number(a.change || a.changePercent || 0)
  );

  const strong = sorted
    .filter((s) => Number(s.change || s.changePercent || 0) > 0.3)
    .slice(0, 3)
    .map((s) => String(s.name || s.sector || "Unknown"));

  const weak = sorted
    .filter((s) => Number(s.change || s.changePercent || 0) < -0.3)
    .slice(-3)
    .reverse()
    .map((s) => String(s.name || s.sector || "Unknown"));

  return { strong, weak };
}

function deriveGlobalContext(indicesData) {
  const niftyChange = Number(indicesData?.nifty?.change || 0);
  const lines = [];

  if (niftyChange > 0) {
    lines.push("Indian futures point positive");
  } else if (niftyChange < 0) {
    lines.push("Indian futures under modest pressure");
  } else {
    lines.push("Indian futures broadly stable");
  }

  // These are structural inferences — we don't have live US/Asia data without extra APIs
  // So we synthesize from available Indian market context
  lines.push("Global risk appetite: watch for Asian cues at open");
  lines.push("Crude and bond yield dynamics in focus");

  return lines;
}

function deriveInstitutionalPositioning(sectorsData, marketBias) {
  const { strong, weak } = classifySectors(sectorsData);
  const lines = [];

  if (strong.length) {
    strong.forEach((s) => lines.push(`${s}: accumulation visible`));
  }
  if (weak.length) {
    weak.forEach((s) => lines.push(`${s}: distribution pressure`));
  }

  if (!lines.length) {
    if (marketBias.includes("Bullish")) {
      lines.push("Broad-based accumulation across large caps");
    } else if (marketBias.includes("Bearish")) {
      lines.push("Selective selling, defensive rotation underway");
    } else {
      lines.push("Mixed positioning — no dominant sector leadership");
    }
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: AI SYNTHESIS (used to generate Expected Market Behavior only)
// ─────────────────────────────────────────────────────────────────────────────

async function generateExpectedBehavior(context) {
  const { marketBias, macroRisk, niftyLevel, niftyChange, globalContext, institutionalPositioning } = context;

  const prompt = `
You are an institutional macro intelligence analyst for Indian equity markets.
Write ONE precise, data-driven sentence (max 20 words) describing expected market behavior based on:

Market Bias: ${marketBias}
Macro Risk: ${macroRisk}
Nifty Level: ${niftyLevel || "N/A"}
Nifty Change: ${niftyChange > 0 ? "+" : ""}${niftyChange?.toFixed(2) || 0}%
Global Context: ${globalContext.join(", ")}
Institutional Positioning: ${institutionalPositioning.slice(0, 2).join(", ")}

Rules:
- ONE sentence only
- Include a specific Nifty level reference if available
- Use institutional language: "momentum continuation", "range-bound", "defensive bias", "breakout watch"
- NO generic filler: not "market may move" or "stocks could rise"
- Response must be that single sentence only, nothing else.
`.trim();

  const call = async (client, model) => {
    if (!client) {
      throw new Error("Groq client not configured");
    }

    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.15,
      max_tokens: 80
    });
    return String(res?.choices?.[0]?.message?.content || "").trim();
  };

  try {
    return await call(primaryGroq, "llama-3.3-70b-versatile");
  } catch {
    try {
      return await call(backupGroq, "llama-3.1-8b-instant");
    } catch {
      return marketBias.includes("Bullish")
        ? `Momentum continuation likely if Nifty sustains current levels.`
        : marketBias.includes("Bearish")
        ? `Defensive positioning preferred; watch for support holding.`
        : `Range-bound trading likely; await breakout for directional clarity.`;
    }
  }
}

async function generateWeeklyInstitutionalNarrative(context) {
  const { marketBias, sectorStrong, sectorWeak, macroRisk } = context;

  const prompt = `
You are a senior institutional market strategist writing a weekly macro intelligence brief for fund managers.
Write a 2-sentence macro narrative (max 35 words total) covering:

Strongest Sectors: ${sectorStrong.join(", ") || "Not clearly identified"}
Weakest Sectors: ${sectorWeak.join(", ") || "Not clearly identified"}
Weekly Bias: ${marketBias}
Macro Risk: ${macroRisk}

Rules:
- TWO sentences maximum
- Institutional tone: FII flows, DII accumulation, liquidity, bond yields
- NO generic phrases like "markets performed well" or "stocks gained"
- Focus on what SMART MONEY is doing or likely doing
- Response must be only those two sentences, nothing else.
`.trim();

  const call = async (client, model) => {
    if (!client) {
      throw new Error("Groq client not configured");
    }

    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.15,
      max_tokens: 120
    });
    return String(res?.choices?.[0]?.message?.content || "").trim();
  };

  try {
    return await call(primaryGroq, "llama-3.3-70b-versatile");
  } catch {
    try {
      return await call(backupGroq, "llama-3.1-8b-instant");
    } catch {
      return "Institutional flows remain selectively constructive with sector rotation in progress. Smart money appears to be accumulating quality names on dips.";
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: REPORT FORMATTERS — deterministic, institutionally structured
// ─────────────────────────────────────────────────────────────────────────────

export function formatDailyMacroReport(args) {
  return formatMacro({ ...args, reportType: "DAILY_MACRO" });
}

export function formatWeeklyInstitutionalReport(args) {
  return formatMacro({ ...args, reportType: "WEEKLY_INSTITUTIONAL" });
}

export function formatMacroRiskAlert(args) {
  return formatMacro({ ...args, reportType: "MACRO_RISK_ALERT" });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: MAIN GENERATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate Daily AI Macro Intelligence Report
 * Called pre-market every trading day
 */
export async function generateDailyMacroReport() {
  console.log("=== MACRO REPORT SCHEDULER RUNNING ===");
  console.log(new Date().toISOString());
  logEvent("macro.report.daily.generating", { ts: new Date().toISOString() });

  const { indicesData, sectorsData, headlinesData } = await collectMacroMarketData();

  const marketBias = computeMarketBias(indicesData);
  const macroRisk  = computeMacroRisk(indicesData, headlinesData);
  const globalContext = deriveGlobalContext(indicesData);
  const institutionalPositioning = deriveInstitutionalPositioning(sectorsData, marketBias);

  const niftyLevel  = Number(indicesData?.nifty?.price || indicesData?.nifty?.value || 0);
  const niftyChange = Number(indicesData?.nifty?.change || 0);

  const expectedBehavior = await generateExpectedBehavior({
    marketBias, macroRisk, niftyLevel, niftyChange, globalContext, institutionalPositioning
  });

  const generatedAt = new Date().toISOString();
  const reportText  = formatDailyMacroReport({
    marketBias, globalContext, institutionalPositioning, macroRisk, expectedBehavior, generatedAt
  });

  console.log("=== MACRO REPORT GENERATED ===");
  console.log(reportText);

  logEvent("macro.report.daily.generated", {
    marketBias,
    macroRisk,
    expectedBehavior: expectedBehavior.slice(0, 80)
  });

  return {
    reportType: "DAILY_MACRO",
    generatedAt,
    reportText,
    marketBias,
    macroRisk,
    summary: `Bias: ${marketBias} | Risk: ${macroRisk}`
  };
}

/**
 * Generate Weekly Institutional Intelligence Report
 * Called on Friday evening or weekend
 */
export async function generateWeeklyInstitutionalReport() {
  console.log("=== MACRO REPORT SCHEDULER RUNNING ===");
  console.log(new Date().toISOString());
  logEvent("macro.report.weekly.generating", { ts: new Date().toISOString() });

  const { indicesData, sectorsData, headlinesData } = await collectMacroMarketData();

  const marketBias = computeMarketBias(indicesData);
  const macroRisk  = computeMacroRisk(indicesData, headlinesData);
  const { strong: sectorStrong, weak: sectorWeak } = classifySectors(sectorsData);

  // Infer FII/DII positioning from market bias + sector strength
  let fiiBias = "Mixed — await official data";
  let diiActivity = "Supportive accumulation on dips";

  if (marketBias.includes("Bullish")) {
    fiiBias = "Net Buyers (inferred from positive breadth)";
    diiActivity = "Supportive accumulation visible";
  } else if (marketBias.includes("Bearish")) {
    fiiBias = "Mild selling (inferred from negative breadth)";
    diiActivity = "Counter-cyclical buying expected";
  }

  // Weekly macro drivers — structural, not headline-based
  const macroDrivers = [
    "RBI liquidity stance in focus",
    "Bond yield trajectory — INR stability",
    "USD strength vs EM currency dynamics",
    "Global risk appetite from US + China macro"
  ];

  const weeklyBias = marketBias.includes("Bullish") ? "Moderately Bullish"
    : marketBias.includes("Bearish") ? "Cautiously Bearish"
    : "Neutral — watch for breakout catalyst";

  const narrative = await generateWeeklyInstitutionalNarrative({
    marketBias, sectorStrong, sectorWeak, macroRisk
  });

  const generatedAt = new Date().toISOString();
  const reportText  = formatWeeklyInstitutionalReport({
    fiiBias, diiActivity, sectorStrong, sectorWeak,
    macroDrivers, weeklyBias, narrative, generatedAt
  });

  console.log("=== MACRO REPORT GENERATED ===");
  console.log(reportText);

  logEvent("macro.report.weekly.generated", {
    weeklyBias,
    sectorStrong: sectorStrong.join(", "),
    macroRisk
  });

  return {
    reportType: "WEEKLY_INSTITUTIONAL",
    generatedAt,
    reportText,
    weeklyBias,
    macroRisk,
    summary: `Weekly Bias: ${weeklyBias} | Risk: ${macroRisk}`
  };
}

/**
 * Generate Macro Risk Alert (event-driven only)
 * Called when macro risk threshold is breached
 */
export async function generateMacroRiskAlert(drivers = [], recommendation = null) {
  const generatedAt = new Date().toISOString();

  const defaultDrivers = drivers.length ? drivers : [
    "Elevated market volatility detected",
    "Unusual institutional flow patterns",
    "Global risk-off signals active"
  ];

  const defaultRecommendation = recommendation
    || "Reduce aggressive exposure. Prioritize capital protection until clarity emerges.";

  const reportText = formatMacroRiskAlert({
    drivers: defaultDrivers,
    recommendation: defaultRecommendation,
    generatedAt
  });

  console.log("=== MACRO REPORT GENERATED ===");
  console.log(reportText);

  logEvent("macro.report.risk_alert.generated", {
    drivers: defaultDrivers.join(" | ")
  });

  return {
    reportType: "MACRO_RISK_ALERT",
    generatedAt,
    reportText,
    summary: `Risk Alert: ${defaultDrivers[0]}`
  };
}

/**
 * Check if current market conditions warrant a Risk Alert
 * Returns { shouldAlert, drivers, recommendation } or null
 */
export async function assessMacroRiskThreshold() {
  const { indicesData, headlinesData } = await collectMacroMarketData();
  const macroRisk = computeMacroRisk(indicesData, headlinesData);

  if (macroRisk !== "Elevated") {
    return { shouldAlert: false };
  }

  const niftyChange = Number(indicesData?.nifty?.change || 0);
  const drivers = [];

  if (Math.abs(niftyChange) > 2) {
    drivers.push(`Nifty moved ${niftyChange > 0 ? "+" : ""}${niftyChange.toFixed(2)}% — abnormal session volatility`);
  }

  // Structural risk drivers (always included when elevated)
  drivers.push("RBI policy or US Fed meeting proximity");
  drivers.push("Crude oil price instability");
  drivers.push("US bond yield spike risk");

  return {
    shouldAlert: true,
    drivers: drivers.slice(0, 4),
    recommendation: "Reduce aggressive exposure. Avoid leveraged positions until volatility normalizes."
  };
}
