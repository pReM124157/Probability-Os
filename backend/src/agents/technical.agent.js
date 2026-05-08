import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export async function technicalAgent(symbol) {
  try {
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
    const symbolsToTry = upperSymbol.includes(".")
      ? [upperSymbol]
      : [`${upperSymbol}.NS`, `${upperSymbol}.BO`, upperSymbol];

    const period2 = new Date();
    const period1 = new Date();
    period1.setDate(period2.getDate() - 320);

    const queryOptions = {
      period1: period1.toISOString().split('T')[0],
      period2: period2.toISOString().split('T')[0],
      interval: '1d'
    };

    let history = null;
    let fetchSymbol = "";

    for (const sym of symbolsToTry) {
        try {
            console.log(`FETCH ATTEMPT (Technical): ${sym}`);
            const tempHistory = await yahooFinance.historical(sym, queryOptions);
            if (tempHistory && tempHistory.length >= 20) {
                history = tempHistory;
                fetchSymbol = sym;
                break;
            }
        } catch (e) {
            console.warn(`[FAIL] technical historical for ${sym}: ${e.message}`);
        }
    }

    if (!history) {
        throw new Error(`Failed to fetch historical data for ${upperSymbol} after trying: ${symbolsToTry.join(", ")}`);
    }

    console.log("FETCH SUCCESS (Technical):", fetchSymbol);
    
    if (!history || !history.length || history.length < 20) {
      console.warn(`Insufficient history for ${symbol}`);
      return { 
        score: 5, 
        rsi: 50, 
        trend: "NEUTRAL", 
        message: "Insufficient data",
        currentPrice: 0 
      };
    }

    const candles = history.filter(
      (h) =>
        h?.close != null &&
        h?.high != null &&
        h?.low != null
    );
    const prices = candles.map((h) => h.close).filter((p) => p != null);
    const latestPrice = prices[prices.length - 1];
    
    if (!latestPrice || latestPrice === 0) {
      throw new Error(`Invalid latest price (₹${latestPrice}) derived from history for ${fetchSymbol}`);
    }

    const currentPrice = latestPrice;
    
    // Simple Moving Averages
    const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = prices.length >= 50 
      ? prices.slice(-50).reduce((a, b) => a + b, 0) / 50 
      : sma20;
    const sma200 = prices.length >= 200
      ? prices.slice(-200).reduce((a, b) => a + b, 0) / 200
      : sma50;

    // RSI Calculation (14 periods)
    let gains = 0;
    let losses = 0;
    for (let i = prices.length - 14; i < prices.length; i++) {
      const diff = prices[i] - prices[i-1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    const rs = avgGain / (avgLoss || 1);
    const rsi = 100 - (100 / (1 + rs));

    // ATR and structure levels
    let atr = 0;
    if (candles.length >= 15) {
      const trs = [];
      for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previousClose = candles[i - 1].close;
        const trueRange = Math.max(
          current.high - current.low,
          Math.abs(current.high - previousClose),
          Math.abs(current.low - previousClose)
        );
        trs.push(trueRange);
      }
      const atrWindow = trs.slice(-14);
      atr =
        atrWindow.reduce((sum, value) => sum + value, 0) /
        Math.max(atrWindow.length, 1);
    }

    const recentWindow = candles.slice(-20);
    const support =
      recentWindow.length > 0
        ? Math.min(...recentWindow.map((candle) => candle.low))
        : latestPrice * 0.97;
    const resistance =
      recentWindow.length > 0
        ? Math.max(...recentWindow.map((candle) => candle.high))
        : latestPrice * 1.03;

    const recentVolume = Number(candles[candles.length - 1]?.volume || 0);
    const avgVolume20 =
      recentWindow.reduce((sum, candle) => sum + Number(candle.volume || 0), 0) /
      Math.max(recentWindow.length, 1);
    const volumeRatio = avgVolume20 > 0 ? recentVolume / avgVolume20 : 1;

    // Momentum Scoring (1-10)
    let score = 5;
    
    // Price vs MAs
    if (latestPrice > sma20) score += 1;
    if (latestPrice > sma50) score += 1;
    
    // RSI scoring
    if (rsi < 30) score += 2; // Oversold - potential bounce
    else if (rsi > 70) score -= 2; // Overbought - potential pullback
    else if (rsi >= 40 && rsi <= 60) score += 1; // Stable uptrend
    
    // Trend strength
    if (sma20 > sma50) score += 1; // Golden cross or bullish alignment
    if (latestPrice > sma200) score += 1;
    if (volumeRatio > 1.5) score += 1;

    score = Math.min(Math.max(score, 1), 10);

    return {
      score,
      rsi: Math.round(rsi),
      sma20: Number(sma20.toFixed(2)),
      sma50: Number(sma50.toFixed(2)),
      sma200: Number(sma200.toFixed(2)),
      atr: Number(atr.toFixed(2)),
      support: Number(support.toFixed(2)),
      resistance: Number(resistance.toFixed(2)),
      recentVolume,
      averageVolume20: Math.round(avgVolume20),
      volumeRatio: Number(volumeRatio.toFixed(2)),
      currentPrice,
      trend: latestPrice > sma20 ? "BULLISH" : "BEARISH",
      momentumStrength: score >= 8 ? "STRONG" : score >= 6 ? "MODERATE" : "WEAK",
      volatility: atr > latestPrice * 0.03 ? "HIGH" : atr > latestPrice * 0.015 ? "MEDIUM" : "LOW",
      priceAboveMA200: latestPrice > sma200,
      isVolumeSpike: volumeRatio > 1.5
    };
  } catch (error) {
    console.error("Technical Agent Error:", error.message);
    return { 
      score: 5, 
      rsi: 50, 
      trend: "UNKNOWN", 
      message: error.message 
    };
  }
}
