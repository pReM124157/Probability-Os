/**
 * CENTRALIZED TELEGRAM MESSAGE FORMATTER SERVICE
 *
 * Enforces standardized templates for all Finsight Telegram communications:
 * 1. Recommendations (Live & Pending)
 * 2. Macro Intelligence
 * 3. Trade Lifecycle Updates (Target Hit, SL Hit, Trailing SL, Breakeven Shift, etc.)
 * 4. Subscriptions (Activation, Renewal, Expiration)
 * 5. News / Event Alerts
 *
 * Structure:
 * - HEADER (Category + Status)
 * - BODY (Specific details)
 * - FOOTER (IST Timestamp + Finsight AI Intelligence signature)
 */


// Helper to convert date to IST: e.g. "9:42 AM IST"
export function formatISTTime(dateInput) {
  const date = dateInput ? new Date(dateInput) : new Date();
  return date.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }) + " IST";
}

// Formatting helpers
function formatCurrency(val) {
  if (val === undefined || val === null) return "N/A";
  const num = Number(val);
  if (isNaN(num)) return "N/A";
  return `₹${num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatPercent(val) {
  if (val === undefined || val === null) return "N/A";
  const num = Number(val);
  if (isNaN(num)) return "N/A";
  // If value is a fraction (e.g. 0.054), multiply by 100
  const isFraction = num > -1 && num < 1 && num !== 0;
  const displayVal = isFraction ? num * 100 : num;
  const sign = displayVal > 0 ? "+" : "";
  return `${sign}${displayVal.toFixed(2)}%`;
}

function formatRatio(val) {
  if (val === undefined || val === null) return "N/A";
  const num = Number(val);
  if (isNaN(num)) return "N/A";
  return num.toFixed(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. RECOMMENDATION FORMATTER
// ─────────────────────────────────────────────────────────────────────────────
export function formatRecommendation(row) {
  const action = String(row.action || "").toUpperCase();
  const recType = String(row.recommendation_type || "BUY").toUpperCase();
  const marketRegime = String(row.market_regime || row.marketRegime || "").toUpperCase();
  
  const isPending = action === "PENDING_EXECUTION" || 
                    marketRegime === "CLOSED" || 
                    marketRegime === "POST_MARKET" || 
                    marketRegime === "PRE_MARKET" || 
                    (row.market_snapshot && row.market_snapshot.marketOpen === false) ||
                    row.execution_status === "PENDING_EXECUTION";

  const displayAction = isPending ? recType : (action === "PENDING_EXECUTION" ? recType : action);
  
  const header = isPending ? "⏳ PENDING SIGNAL (MARKET CLOSED)" : "🚨 INSTITUTIONAL SIGNAL";

  // Build Entry Zone range (e.g. Entry - Entry + 0.5% execution buffer)
  const entryPrice = row.entry_price || row?.reasoning_snapshot?.entryTiming?.entryPrice || row?.market_snapshot?.currentPrice || 0;
  let entryZoneStr = formatCurrency(entryPrice);
  if (entryPrice > 0) {
    const upperBuffer = Math.round(entryPrice * 1.005);
    entryZoneStr = `${formatCurrency(entryPrice)} – ${formatCurrency(upperBuffer)}`;
  }

  const confidenceVal = Number(row.confidence || 0);
  const confidenceStr = confidenceVal > 0 ? `${confidenceVal}%` : "80%";

  const rrRatioVal = Number(row.rr_ratio || row.rrRatio || 0);
  const rrStr = rrRatioVal > 0 ? formatRatio(rrRatioVal) : "2.5";

  const catalyst = row.ai_summary || row.catalyst || "Breakout with institutional accumulation and strong momentum confirmation.";
  const execution = row.execution_guidance || row.reasoning_snapshot?.entryTiming?.guidance || "Await continuation above VWAP after open.";

  const timestamp = formatISTTime(row.created_at);

  return [
    header,
    "━━━━━━━━━━",
    `Stock: ${row.symbol}`,
    `Action: ${displayAction}`,
    `Confidence: ${confidenceStr}`,
    `Risk/Reward: ${rrStr}`,
    "",
    "Entry Zone:",
    entryZoneStr,
    "",
    "Target:",
    formatCurrency(row.target_price || row?.reasoning_snapshot?.entryTiming?.initialTarget),
    "",
    "Stop Loss:",
    formatCurrency(row.stop_loss || row?.reasoning_snapshot?.entryTiming?.stopLoss),
    "",
    "Catalyst:",
    catalyst,
    "",
    "Execution:",
    execution,
    "━━━━━━━━━━",
    `🕒 ${timestamp}`,
    "Finsight AI Intelligence"
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MACRO INTELLIGENCE FORMATTER
// ─────────────────────────────────────────────────────────────────────────────
export function formatMacro(report) {
  if (report.reportType === "WEEKLY_INSTITUTIONAL") {
    const timestamp = formatISTTime(report.generatedAt);
    const strongSects = Array.isArray(report.sectorStrong) ? report.sectorStrong.join(", ") : (report.sectorStrong || "Neutral");
    const weakSects = Array.isArray(report.sectorWeak) ? report.sectorWeak.join(", ") : (report.sectorWeak || "None");
    const drivers = Array.isArray(report.macroDrivers) ? report.macroDrivers.join("\n• ") : (report.macroDrivers || "");
    return [
      "📊 WEEKLY INSTITUTIONAL INTELLIGENCE",
      "━━━━━━━━━━",
      "Weekly Institutional Bias:",
      report.weeklyBias || "Neutral",
      "",
      "FII Positioning:",
      report.fiiBias || "Mixed",
      "",
      "DII Activity:",
      report.diiActivity || "Supportive",
      "",
      "Strongest Sectors:",
      strongSects,
      "",
      "Weakest Sectors:",
      weakSects,
      "",
      "Macro Drivers:",
      "• " + drivers,
      "",
      report.narrative || "",
      "━━━━━━━━━━",
      `🕒 ${timestamp}`,
      "Finsight AI Intelligence"
    ].join("\n");
  }

  if (report.reportType === "MACRO_RISK_ALERT") {
    const timestamp = formatISTTime(report.generatedAt);
    const drivers = Array.isArray(report.drivers) ? report.drivers.join("\n• ") : (report.drivers || "");
    return [
      "⚠️ MACRO RISK ALERT",
      "━━━━━━━━━━",
      "Elevated market volatility expected.",
      "",
      "Drivers:",
      "• " + drivers,
      "",
      "Recommendation:",
      report.recommendation || "Reduce aggressive exposure.",
      "━━━━━━━━━━",
      `🕒 ${timestamp}`,
      "Finsight AI Intelligence"
    ].join("\n");
  }

  const bias = report.marketBias || report.niftyBias || "Neutral";
  
  // Format sectors
  const formatSectors = (secs) => {
    if (!secs) return "Neutral / Mixed";
    if (Array.isArray(secs)) return secs.join(", ");
    return String(secs);
  };

  const strongSectors = formatSectors(report.strongSectors || report.sectorStrong);
  const weakSectors = formatSectors(report.weakSectors || report.sectorWeak);

  // Format positioning
  let positioning = "Neutral / Watching";
  const pos = report.positioning || report.institutionalPositioning;
  if (pos) {
    if (Array.isArray(pos)) {
      positioning = pos.map(p => p.replace(/^•\s*/, "")).join(", ");
    } else {
      positioning = String(pos);
    }
  }

  // Sentiment mapping
  const sentiment = report.globalSentiment || (bias.includes("Bullish") ? "Positive" : bias.includes("Bearish") ? "Negative" : "Neutral");

  const risk = report.keyRisk || report.macroRisk || "Low";
  const timestamp = formatISTTime(report.generatedAt);

  return [
    "🌍 DAILY MACRO INTELLIGENCE",
    "━━━━━━━━━━",
    "Nifty Bias:",
    bias,
    "",
    "Global Sentiment:",
    sentiment,
    "",
    "Strong Sectors:",
    strongSectors,
    "",
    "Weak Sectors:",
    weakSectors,
    "",
    "Institutional Positioning:",
    positioning,
    "",
    "Key Risk:",
    risk,
    "━━━━━━━━━━",
    `🕒 ${timestamp}`,
    "Finsight AI Intelligence"
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TRADE LIFECYCLE FORMATTER
// ─────────────────────────────────────────────────────────────────────────────
export function formatLifecycle(event) {
  const { eventType, symbol, exchange, entryPrice, targetPrice, exitPrice, pnl, previousSL, newSL, duration, outcomeText } = event;
  
  const displayExchange = exchange ? ` (${exchange})` : " (NSE)";
  const formattedSymbol = String(symbol || "").toUpperCase();
  
  const formattedEntry = formatCurrency(entryPrice);
  const formattedTarget = formatCurrency(targetPrice);
  const formattedExit = formatCurrency(exitPrice || newSL);
  
  // Format returns/pnl
  const pnlStr = formatPercent(pnl);

  const timestamp = formatISTTime(event.timestamp);

  if (eventType === "TARGET_HIT") {
    return [
      "✅ TARGET HIT",
      `${formattedSymbol}${displayExchange}`,
      `Entry: ${formattedEntry}`,
      `Target Achieved: ${formattedTarget}`,
      `Return: ${pnlStr}`,
      "Action:",
      "Move Stop Loss to Cost",
      "━━━━━━━━━━",
      `🕒 ${timestamp}`,
      "Finsight AI Intelligence"
    ].join("\n");
  }

  if (eventType === "STOP_HIT" || eventType === "STOP_LOSS_HIT") {
    const label = pnl >= 0 ? "Return" : "Loss";
    return [
      "❌ STOP LOSS HIT",
      `${formattedSymbol}${displayExchange}`,
      `Entry: ${formattedEntry}`,
      `Exit: ${formattedExit}`,
      `${label}: ${pnlStr}`,
      "Trade Closed.",
      "━━━━━━━━━━",
      `🕒 ${timestamp}`,
      "Finsight AI Intelligence"
    ].join("\n");
  }

  if (eventType === "TRAILING_SL_UPDATE" || eventType === "STOP_LOSS_TRAILED" || eventType === "TRAILING_SL_UPDATED") {
    return [
      "🔄 STOP LOSS UPDATED",
      `${formattedSymbol}${displayExchange}`,
      `Previous SL: ${formatCurrency(previousSL)}`,
      `New SL: ${formatCurrency(newSL)}`,
      "Momentum continuation confirmed.",
      "━━━━━━━━━━",
      `🕒 ${timestamp}`,
      "Finsight AI Intelligence"
    ].join("\n");
  }

  if (eventType === "TRADE_CLOSED") {
    return [
      "🏁 TRADE CLOSED",
      `${formattedSymbol}${displayExchange}`,
      `Final Return: ${pnlStr}`,
      "Trade Duration:",
      duration || "1 Day",
      "Outcome:",
      outcomeText || "Successful breakout continuation.",
      "━━━━━━━━━━",
      `🕒 ${timestamp}`,
      "Finsight AI Intelligence"
    ].join("\n");
  }

  // Fallback default
  let header = "🔄 STATUS UPDATE";
  return [
    header,
    "━━━━━━━━━━",
    `${formattedSymbol}${displayExchange}`,
    outcomeText || "Lifecycle status updated.",
    "━━━━━━━━━━",
    `🕒 ${timestamp}`,
    "Finsight AI Intelligence"
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SUBSCRIPTION FORMATTER
// ─────────────────────────────────────────────────────────────────────────────
export function formatSubscription(sub) {
  const { status, days, renewalDate, plan, expiryDate } = sub;
  
  let header = "🔔 SUBSCRIPTION RENEWAL REMINDER";
  if (status === "activated") header = "✅ SUBSCRIPTION ACTIVATED";
  else if (status === "expired") header = "❌ SUBSCRIPTION EXPIRED";
  else if (status === "cancelled") header = "❌ SUBSCRIPTION CANCELLED";

  const lines = [
    header,
    "━━━━━━━━━━"
  ];

  if (status === "renewal_reminder") {
    lines.push(
      `Your Finsight Pro plan renews in ${days || 3} days.`,
      "",
      "Renewal Date:",
      renewalDate || "N/A",
      "",
      "Premium Access Includes:",
      "• Live Signals",
      "• Institutional Reports",
      "• Trade Lifecycle Updates"
    );
  } else if (status === "activated") {
    lines.push(
      "Welcome to Finsight Pro!",
      "",
      `Plan: ${plan || "PRO"}`,
      `Expiry Date: ${expiryDate || "N/A"}`,
      "",
      "Premium Access Active."
    );
  } else {
    lines.push(
      `Your Finsight ${plan || "PRO"} subscription has expired.`,
      "",
      "Plan: Pro",
      "Status: Expired",
      "",
      "Upgrade now to regain access to Live Signals and Reports."
    );
  }

  const timestamp = formatISTTime();

  lines.push(
    "━━━━━━━━━━",
    `🕒 ${timestamp}`,
    "Finsight AI Intelligence"
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. NEWS / EVENT FORMATTER
// ─────────────────────────────────────────────────────────────────────────────
export function formatNewsAlert(news) {
  const { title, summary, reaction, severity, bias } = news;

  const timestamp = formatISTTime(news.createdAt);

  return [
    "⚠️ MARKET EVENT ALERT",
    "━━━━━━━━━━",
    "Event:",
    title || "Market event detected.",
    "",
    "Market Impact:",
    summary || "Evaluating potential market impact.",
    "",
    "Expected Reaction:",
    reaction || "Evaluate sector index for cues.",
    "",
    "Institutional Bias:",
    bias || severity || "Neutral",
    "━━━━━━━━━━",
    `🕒 ${timestamp}`,
    "Finsight AI Intelligence"
  ].join("\n");
}
