/**
 * agents/positionSizing.agent.js
 * Calculates intelligent capital allocation based on confidence, risk, and portfolio constraints.
 */

export async function calculatePositionSize({
    stock,
    confidenceScore = 5,
    riskLevel = "MEDIUM",
    rewardRiskRatio = 0,
    entryUrgency = "MEDIUM",
    volatility = "MEDIUM", // Expected volatility level
    sectorExposure = 0,    // Current weight in this sector (%)
    portfolioRisk = 5      // Current total portfolio risk (1-10)
}) {
    try {
        let allocationPercent = 0;
        const confidence = Number(confidenceScore);
        const rrRatio = Number(rewardRiskRatio);

        // 1. Base Allocation Logic (Conviction-based)
        if (confidence >= 9) {
            allocationPercent = 15;
        } else if (confidence >= 8) {
            allocationPercent = 12;
        } else if (confidence >= 7) {
            allocationPercent = 10;
        } else if (confidence >= 6) {
            allocationPercent = 7;
        } else if (confidence >= 5) {
            allocationPercent = 5;
        } else {
            allocationPercent = 3;
        }

        // 2. Risk Level Modifiers
        if (riskLevel === "LOW") {
            allocationPercent *= 1.2; // 20% boost for safety
        } else if (riskLevel === "HIGH") {
            allocationPercent *= 0.7; // 30% reduction for high risk
        }

        // 3. Reward/Risk Ratio Modifiers
        if (rrRatio >= 3.5) {
            allocationPercent += 2; // Extra weight for asymmetric setups
        } else if (rrRatio > 0 && rrRatio < 1.5) {
            allocationPercent -= 2; // Reduce weight for poor R/R
        }

        // 4. Constraints (Safety Caps)
        // Never exceed 20% for a single position unless institutional override
        allocationPercent = Math.min(allocationPercent, 20);

        // Sector concentration check
        if (sectorExposure > 25) {
            allocationPercent *= 0.6; // Heavy reduction if sector is already overweight
        }

        // Volatility adjustment
        if (volatility === "HIGH") {
            allocationPercent *= 0.8;
        }

        // Final Rounding
        allocationPercent = Math.round(allocationPercent);
        
        // Final fallback
        if (allocationPercent < 2) allocationPercent = 2;

        let capitalAction = "Accumulate gradually";
        let conviction = "MODERATE";

        if (confidence >= 8) {
            conviction = "HIGH";
            capitalAction = entryUrgency === "HIGH" || entryUrgency === "VERY HIGH" 
                ? "Deploy capital aggressively" 
                : "Accumulate on dips";
        } else if (confidence <= 4) {
            conviction = "LOW";
            capitalAction = "Avoid or keep position minimal";
        }

        const reason = generateSizingReason({
            confidence,
            riskLevel,
            rrRatio,
            sectorExposure,
            volatility
        });

        return {
            stock: stock || "UNKNOWN",
            allocation: `${allocationPercent}%`,
            capitalAction,
            conviction,
            reason
        };

    } catch (error) {
        console.error("Position Sizing Agent Error:", error.message);
        return {
            allocation: "5%",
            capitalAction: "Maintain cautious sizing",
            conviction: "MODERATE",
            reason: "Default sizing applied due to internal calculation error."
        };
    }
}

function generateSizingReason({ confidence, riskLevel, rrRatio, sectorExposure, volatility }) {
    let reasons = [];

    if (confidence >= 8) reasons.push("strong conviction in thesis");
    if (riskLevel === "LOW") reasons.push("favorable low-risk profile");
    if (rrRatio >= 3) reasons.push("excellent asymmetric risk-reward");
    if (volatility === "HIGH") reasons.push("high volatility dampening position size");
    if (sectorExposure > 20) reasons.push("sector concentration constraints");

    if (reasons.length === 0) {
        return `Standard ${riskLevel.toLowerCase()}-risk allocation based on current market dynamics.`;
    }

    return `Position sized for ${reasons.join(", ")}.`.replace(/, ([^,]*)$/, " and $1");
}
