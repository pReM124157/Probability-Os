import supabase from "../services/supabase.service.js";
import { getLiveMarketData } from "../services/marketData.service.js";

/**
 * performanceTracker.agent.js
 * Tracks the accuracy of previous recommendations and provides a learning boost for future analyses.
 */

/**
 * Logs a new recommendation for future tracking.
 */
export async function logRecommendation({
    symbol,
    decision,
    confidence,
    entryPrice,
    target,
    stopLoss,
    reasoning,
    model = "llama-3.3-70b-versatile",
    sector = null,
    supportingSignals = {},
    marketRegime = null,
    promptContext = null,
    outputPayload = null,
    marketSnapshot = null,
    providerSources = null
}) {
    try {
        const { data, error } = await supabase
            .from("performance_logs")
            .insert([{
                symbol: symbol.toUpperCase(),
                decision: decision.toUpperCase(),
                confidence_score: confidence,
                entry_price: entryPrice,
                target_price: target,
                stop_loss: stopLoss,
                reasoning,
                created_at: new Date()
            }]);

        if (error) throw error;

        console.log(`✅ Recommendation logged for ${symbol}`);
        return data;
    } catch (error) {
        console.error("Error logging recommendation:", error.message);
        return null;
    }
}

/**
 * Updates previous recommendations with current market performance.
 * Checks if targets or stop losses were hit.
 */
export async function updatePerformanceTracking() {
    try {
        // Fetch active logs that haven't been finalized (e.g., from the last 30 days)
        const { data: logs, error } = await supabase
            .from("performance_logs")
            .select("*")
            .is("final_outcome", null)
            .order('created_at', { ascending: false });

        if (error) throw error;
        if (!logs || logs.length === 0) return { updated: 0 };

        let updatedCount = 0;

        for (const log of logs) {
            try {
                const liveData = await getLiveMarketData(log.symbol);
                if (!liveData || !liveData.currentPrice) continue;

                const currentPrice = liveData.currentPrice;
                const returnPct = ((currentPrice - log.entry_price) / log.entry_price) * 100;

                let outcome = "PENDING";
                let isFinal = false;

                // Simple check for success/failure triggers
                if (log.decision === "BUY") {
                    if (currentPrice >= log.target_price) {
                        outcome = "SUCCESS";
                        isFinal = true;
                    } else if (currentPrice <= log.stop_loss) {
                        outcome = "FAILURE";
                        isFinal = true;
                    }
                } else if (log.decision === "SELL") {
                    if (currentPrice <= log.target_price) { // Price went down as expected
                        outcome = "SUCCESS";
                        isFinal = true;
                    } else if (currentPrice >= log.stop_loss) {
                        outcome = "FAILURE";
                        isFinal = true;
                    }
                }

                // Finalize after 30 days regardless
                const daysOld = (new Date() - new Date(log.created_at)) / (1000 * 60 * 60 * 24);
                if (daysOld >= 30 && !isFinal) {
                    outcome = returnPct > 0 ? "SUCCESS" : "FAILURE";
                    isFinal = true;
                }

                if (isFinal || returnPct !== log.return_pct) {
                    const { error: updateError } = await supabase
                        .from("performance_logs")
                        .update({
                            current_price: currentPrice,
                            return_pct: returnPct.toFixed(2),
                            final_outcome: isFinal ? outcome : null,
                            updated_at: new Date()
                        })
                        .eq("id", log.id);

                    if (!updateError) updatedCount++;
                }
            } catch (err) {
                console.error(`Error updating log for ${log.symbol}:`, err.message);
            }
        }

        return { updated: updatedCount };
    } catch (error) {
        console.error("Performance Tracker Error:", error.message);
        return { error: error.message };
    }
}

/**
 * Calculates a 'Learning Boost' score for a specific ticker based on historical performance.
 * Used by decision.agent.js to adjust confidence scores.
 */
export async function getLearningBoost(symbol) {
    try {
        const { data: history, error } = await supabase
            .from("performance_logs")
            .select("final_outcome")
            .eq("symbol", symbol.toUpperCase())
            .not("final_outcome", "is", null);

        if (error || !history || history.length === 0) return 0;

        const successes = history.filter(h => h.final_outcome === "SUCCESS").length;
        const successRate = successes / history.length;

        // Boost logic: 
        // > 70% success rate: +1 boost
        // < 30% success rate: -1 penalty
        if (successRate >= 0.7) return 1;
        if (successRate <= 0.3) return -1;
        return 0;

    } catch (error) {
        return 0;
    }
}
