// agents/entryTiming.agent.js
import { getLiveMarketData } from "../services/marketData.service.js";
import { safeString, safeSubstring } from "../core/safety.js";

function formatPrice(value) {
    return `₹${Math.round(value)}`;
}

function formatRange(lower, upper) {
    return `${formatPrice(lower)} – ${formatPrice(upper)}`;
}

function toNumber(value) {
    if (value === null || value === undefined || value === "" || value === "-") return 0;
    const parsed = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildDeterministicEntryReason({
    activePrice,
    rsi,
    priceVsMA50Pct,
    volumeRatio,
    trend,
    pe,
    roe,
    revenueGrowth,
    atr,
    support,
    resistance
}) {
    const metrics = [];

    if (Number.isFinite(rsi) && rsi > 0) {
        metrics.push(`RSI is ${rsi.toFixed(0)}`);
    }
    if (Number.isFinite(priceVsMA50Pct)) {
        metrics.push(`price is ${priceVsMA50Pct >= 0 ? "above" : "below"} 50DMA by ${Math.abs(priceVsMA50Pct).toFixed(1)}%`);
    }
    if (Number.isFinite(volumeRatio) && volumeRatio > 0) {
        metrics.push(`volume is ${volumeRatio.toFixed(2)}x the 20-day average`);
    }
    if (Number.isFinite(atr) && atr > 0) {
        metrics.push(`ATR is ${atr.toFixed(2)} (${((atr / activePrice) * 100).toFixed(1)}% of price)`);
    }
    if (Number.isFinite(support) && support > 0 && Number.isFinite(resistance) && resistance > 0) {
        metrics.push(`near-term structure spans support at ${formatPrice(support)} and resistance at ${formatPrice(resistance)}`);
    }

    const quality = [];
    if (trend === "BULLISH") quality.push("momentum structure remains positive");
    if (trend === "BEARISH") quality.push("trend structure remains weak");
    if (roe > 18) quality.push(`ROE at ${roe.toFixed(1)}% supports business quality`);
    if (revenueGrowth > 10) quality.push(`revenue growth at ${revenueGrowth.toFixed(1)}% is healthy`);
    if (pe > 0) quality.push(pe < 20 ? `valuation looks reasonable at ${pe.toFixed(1)}x earnings` : `valuation is richer at ${pe.toFixed(1)}x earnings`);

    return `${metrics.slice(0, 3).join(", ")}. ${quality.slice(0, 2).join(". ")}.`.replace(/\.\s*\./g, ".").trim();
}

export async function analyzeEntryTiming({
    stock,
    currentPrice,
    confidenceScore,
    riskLevel,
    valuationScore,
    momentumScore,
    technicalData,
    marketData,
    companyData
}) {
    console.log(`[Entry Timing Agent] Received Price for ${stock}: ₹${currentPrice}`);
    
    try {
        // Fix for missing .NS suffix and price fetch fallback
        let activePrice = Number(currentPrice) || 0;
        let fetchSymbol = (stock || "UNKNOWN").toUpperCase();

        if (!fetchSymbol.includes(".NS") && fetchSymbol !== "UNKNOWN") {
            fetchSymbol = `${fetchSymbol}.NS`;
        }

        if (activePrice <= 0 && fetchSymbol !== "UNKNOWN") {
            console.log("Price is 0, attempting recovery fetch for:", fetchSymbol);
            try {
                const liveData = await getLiveMarketData(fetchSymbol);
                activePrice = liveData?.currentPrice || 0;

                if (activePrice <= 0) {
                    console.log("Price fetch failed for:", fetchSymbol);
                }
            } catch (err) {
                console.log("Price fetch failed for:", fetchSymbol);
            }
        }

        // CRITICAL GUARD: Hard block if price is 0
        if (!activePrice || activePrice <= 0) {
          return {
            stock: stock || "UNKNOWN",
            currentPrice: 0,
            strategy: "NO TRADE",
            idealEntryZone: "N/A",
            stopLoss: "-",
            initialTarget: "-",
            rewardRiskRatio: "-",
            entryUrgency: "LOW",
            reasoning: "⚠ Data Unavailable — Skipping technical execution",
            finalExecutionAdvice: "Market data unavailable. Skipping trade setup."
          };
        }

        // Initialize variables
        let strategy = "AVOID ENTRY";
        let idealEntryZone = "Avoid";
        let stopLoss = "-";
        let initialTarget = "-";
        let rewardRiskRatio = "-";
        let entryUrgency = "VERY LOW";
        let reasoning = "Unable to generate reliable entry signal due to missing or invalid market data.";
        let finalExecutionAdvice = "Maintain caution and monitor price action.";

        if (activePrice > 0) {
            const rsi = Number(technicalData?.rsi || 0);
            const sma20 = Number(technicalData?.sma20 || activePrice);
            const sma50 = Number(technicalData?.sma50 || sma20 || activePrice);
            const atr = Number(technicalData?.atr || activePrice * 0.025);
            const support = Number(technicalData?.support || Math.min(sma20, sma50, activePrice * 0.97));
            const resistance = Number(technicalData?.resistance || Math.max(activePrice * 1.03, sma20, sma50));
            const volumeRatio = Number(
                technicalData?.volumeRatio ||
                (Number(marketData?.averageVolume) > 0
                    ? Number(marketData?.volume || 0) / Number(marketData.averageVolume)
                    : 1)
            );
            const trend = technicalData?.trend || "NEUTRAL";
            const priceVsMA50Pct = sma50 > 0 ? ((activePrice - sma50) / sma50) * 100 : 0;
            const pe = toNumber(companyData?.PERatio);
            const roe = toNumber(companyData?.ReturnOnEquityTTM);
            const revenueGrowth = toNumber(companyData?.QuarterlyRevenueGrowthYOY);

            const setupScore =
                (Number(confidenceScore) * 0.35) +
                (Number(momentumScore) * 0.25) +
                (Number(valuationScore) * 0.15) +
                (trend === "BULLISH" ? 1.0 : -0.5) +
                (volumeRatio > 1.3 ? 0.8 : volumeRatio < 0.9 ? -0.5 : 0) +
                (rsi >= 48 && rsi <= 68 ? 0.8 : rsi > 75 ? -1.2 : rsi < 35 ? -0.4 : 0);

            const stopAnchor = Math.max(
                support,
                sma50 > 0 ? sma50 - (0.4 * atr) : 0,
                activePrice - (2.2 * atr)
            );
            const stopBuffer = Math.max(0.35 * atr, activePrice * 0.004);
            const computedStop = Math.min(activePrice - Math.max(0.8 * atr, activePrice * 0.006), stopAnchor - stopBuffer);
            const validStop = computedStop > 0 && computedStop < activePrice
                ? computedStop
                : activePrice - Math.max(1.2 * atr, activePrice * 0.02);

            const breakoutTarget = resistance > activePrice
                ? resistance
                : activePrice + (2.4 * atr);
            const stretchTarget = activePrice + (3.1 * atr);
            const computedTarget = Math.max(breakoutTarget, stretchTarget);
            const riskPerShare = activePrice - validStop;
            const rewardPerShare = computedTarget - activePrice;
            const rr = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;

            const entryLower = Math.max(validStop + (0.4 * atr), Math.min(activePrice, sma20, sma50) - (0.25 * atr));
            const entryUpper = Math.max(entryLower, Math.min(activePrice + (0.4 * atr), resistance));

            if (setupScore < 4.8 || rr < 1.2 || trend === "BEARISH") {
                strategy = "AVOID ENTRY";
                entryUrgency = "VERY LOW";
                idealEntryZone = "Avoid";
                stopLoss = formatPrice(validStop);
                initialTarget = formatPrice(computedTarget);
                rewardRiskRatio = rr > 0 ? rr.toFixed(2) : "-";
                reasoning = `${buildDeterministicEntryReason({
                    activePrice,
                    rsi,
                    priceVsMA50Pct,
                    volumeRatio,
                    trend,
                    pe,
                    roe,
                    revenueGrowth,
                    atr,
                    support,
                    resistance
                })} Risk-reward is not compelling enough for fresh deployment.`;
                finalExecutionAdvice = `Avoid entry until price reclaims ${formatPrice(Math.max(sma20, sma50))} with better volume support.`;
            }
            else if (setupScore < 6.8 || rr < 2.0) {
                strategy = "CAUTIOUS ENTRY";
                entryUrgency = "MEDIUM";
                idealEntryZone = formatRange(entryLower, entryUpper);
                stopLoss = formatPrice(validStop);
                initialTarget = formatPrice(computedTarget);
                rewardRiskRatio = rr.toFixed(2);
                reasoning = buildDeterministicEntryReason({
                    activePrice,
                    rsi,
                    priceVsMA50Pct,
                    volumeRatio,
                    trend,
                    pe,
                    roe,
                    revenueGrowth,
                    atr,
                    support,
                    resistance
                });
                finalExecutionAdvice = `Accumulate only near ${idealEntryZone} and keep risk defined below ${stopLoss}.`;
            }
            else {
                strategy = "STRONG ENTRY";
                entryUrgency = "HIGH";
                const aggressiveLower = Math.max(validStop + (0.6 * atr), activePrice - (0.35 * atr));
                const aggressiveUpper = Math.max(aggressiveLower, Math.min(activePrice + (0.5 * atr), resistance));
                idealEntryZone = formatRange(aggressiveLower, aggressiveUpper);
                stopLoss = formatPrice(validStop);
                initialTarget = formatPrice(computedTarget);
                rewardRiskRatio = rr.toFixed(2);
                reasoning = buildDeterministicEntryReason({
                    activePrice,
                    rsi,
                    priceVsMA50Pct,
                    volumeRatio,
                    trend,
                    pe,
                    roe,
                    revenueGrowth,
                    atr,
                    support,
                    resistance
                });
                finalExecutionAdvice = `Momentum supports a buy-on-strength approach inside ${idealEntryZone}, with stop discipline at ${stopLoss}.`;
            }
        }

        console.log("--- ENTRY TIMING DEBUG ---");
        console.log("SYMBOL:", fetchSymbol);
        console.log("CURRENT PRICE:", activePrice);
        const safeMarket = safeString(JSON.stringify(marketData));
        console.log("MARKET DATA:", safeSubstring(safeMarket, 200));
        console.log("--------------------------");

        return {
            stock: stock || "UNKNOWN",
            currentPrice: activePrice,
            strategy,
            idealEntryZone,
            stopLoss,
            initialTarget,
            rewardRiskRatio,
            entryUrgency,
            reasoning,
            finalExecutionAdvice
        };

    } catch (error) {
        console.error("Entry Timing Agent Error:", error.message);
        return {
            stock: stock || "UNKNOWN",
            strategy: "AVOID ENTRY",
            currentPrice: 0,
            idealEntryZone: "Avoid",
            stopLoss: "-",
            initialTarget: "-",
            rewardRiskRatio: "-",
            entryUrgency: "VERY LOW",
            reasoning: "Unable to generate reliable entry signal due to internal agent error.",
            finalExecutionAdvice: "Maintain caution and monitor price action."
        };
    }
}
