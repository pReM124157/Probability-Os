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
        // Fix for missing .NS suffix and price fetch fallback
        let activePrice = currentPrice || 0;
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

        // Initialize variables
        let strategy = "AVOID ENTRY";
        let idealEntryZone = "Avoid";
        let stopLoss = "-";
        let initialTarget = "-";
        let rewardRiskRatio = "-";
        let entryUrgency = "VERY LOW";
        let reasoning = "Unable to generate reliable entry signal due to missing or invalid market data.";
        let finalExecutionAdvice = "Maintain caution and monitor price action.";

        // Success path safety check
        if (activePrice > 0) {
            if (confidenceScore <= 4) {
                strategy = "AVOID ENTRY";
                entryUrgency = "VERY LOW";
                idealEntryZone = "Avoid";
                reasoning = "Weak setup with poor conviction and elevated uncertainty.";
                finalExecutionAdvice = "Avoid entry. Look for better opportunities elsewhere.";
            }
            else if (confidenceScore <= 6) {
                strategy = "CAUTIOUS ENTRY";
                entryUrgency = "MEDIUM";

                const lower = Math.round(activePrice * 0.97);
                const upper = Math.round(activePrice * 1.01);

                idealEntryZone = `₹${lower} – ₹${upper}`;
                stopLoss = `₹${Math.round(activePrice * 0.94)}`;
                initialTarget = `₹${Math.round(activePrice * 1.10)}`;
                
                const reward = Math.round(activePrice * 1.10) - activePrice;
                const risk = activePrice - Math.round(activePrice * 0.94);
                if (risk > 0) rewardRiskRatio = (reward / risk).toFixed(2);

                reasoning = "Moderate conviction. Build position gradually on pullbacks.";
                finalExecutionAdvice = `Accumulate gradually near ${idealEntryZone} with strict stop loss.`;
            }
            else {
                strategy = "STRONG ENTRY";
                entryUrgency = "HIGH";

                const lower = Math.round(activePrice * 0.98);
                const upper = Math.round(activePrice * 1.02);

                idealEntryZone = `₹${lower} – ₹${upper}`;
                stopLoss = `₹${Math.round(activePrice * 0.95)}`;
                initialTarget = `₹${Math.round(activePrice * 1.15)}`;

                const reward = Math.round(activePrice * 1.15) - activePrice;
                const risk = activePrice - Math.round(activePrice * 0.95);
                if (risk > 0) rewardRiskRatio = (reward / risk).toFixed(2);

                reasoning = "High conviction setup. Attractive entry levels with solid target potential.";
                finalExecutionAdvice = `Strong buy opportunity. Consider entry within ${idealEntryZone}.`;
            }
        }

        console.log("ENTRY AGENT SYMBOL:", fetchSymbol);
        console.log("ENTRY AGENT PRICE:", activePrice);

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