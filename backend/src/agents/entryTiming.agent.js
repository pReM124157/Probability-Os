// agents/entryTiming.agent.js
import { getLiveMarketData } from "../services/marketData.service.js";

export async function analyzeEntryTiming({
    stock,
    currentPrice,
    confidenceScore,
    riskLevel,
    valuationScore,
    momentumScore
}) {
    try {
        let strategy = "WAIT";
        let entryZone = "";
        let stopLoss = 0;
        let target = 0;
        let rewardRiskRatio = 0;
        let urgency = "LOW";
        let reason = "";

        // Fix for missing .NS suffix and price fetch fallback
        let activePrice = currentPrice;
        let fetchSymbol = stock.toUpperCase();

        if (!fetchSymbol.includes(".NS")) {
            fetchSymbol = `${fetchSymbol}.NS`;
        }

        if (!activePrice || activePrice <= 0) {
            console.log("Price is 0, attempting recovery fetch for:", fetchSymbol);
            try {
                const liveData = await getLiveMarketData(fetchSymbol);
                activePrice = liveData.currentPrice;

                if (!activePrice || activePrice <= 0) {
                    console.log("Price fetch failed for:", fetchSymbol);
                }
            } catch (err) {
                console.log("Price fetch failed for:", fetchSymbol);
            }
        }

        /*
        Strategy Logic
        */

        if (confidenceScore <= 4 || activePrice <= 0) {
            strategy = "AVOID ENTRY";
            urgency = "VERY LOW";

            entryZone = "Avoid";
            stopLoss = 0;
            target = 0;

            reason = "Weak setup or invalid price data. Elevated uncertainty makes entry risky.";
        }
        else if (confidenceScore <= 6) {
            strategy = "CAUTIOUS ENTRY";
            urgency = "MEDIUM";

            const lower = Math.round(activePrice * 0.97);
            const upper = Math.round(activePrice * 1.01);

            entryZone = `₹${lower} – ₹${upper}`;
            stopLoss = Math.round(activePrice * 0.94);
            target = Math.round(activePrice * 1.10);

            reason = "Moderate conviction. Build position gradually on pullbacks.";
        }
        else {
            strategy = "STRONG ENTRY";
            urgency = "HIGH";

            const lower = Math.round(activePrice * 0.98);
            const upper = Math.round(activePrice * 1.02);

            entryZone = `₹${lower} – ₹${upper}`;
            stopLoss = Math.round(activePrice * 0.95);
            target = Math.round(activePrice * 1.15);

            reason = "High conviction setup. Attractive entry levels with solid target potential.";
        }

        /*
        Reward Risk Calculation
        */

        if (stopLoss > 0 && target > 0) {
            const reward = target - activePrice;
            const risk = activePrice - stopLoss;

            if (risk > 0) {
                rewardRiskRatio = (reward / risk).toFixed(2);
            }
        }

        return {
            stock,
            currentPrice: activePrice,
            strategy,
            entryZone,
            stopLoss,
            target,
            rewardRiskRatio,
            urgency,
            reason
        };
    } catch (error) {
        console.error("Entry Timing Agent Error:", error.message);

        return {
            stock,
            strategy: "ERROR",
            reason: error.message
        };
    }
}