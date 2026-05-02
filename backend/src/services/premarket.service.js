export function generatePreMarketInsight(data) {
  const {
    previousClose,
    currentPrice,
    sector,
    globalSentiment = "neutral"
  } = data;
  
  if (!previousClose || !currentPrice) return null;
  
  const gap = ((currentPrice - previousClose) / previousClose) * 100;
  let gapType = "flat";
  if (gap > 0.5) gapType = "gap up";
  else if (gap < -0.5) gapType = "gap down";
  
  let bias = "neutral";
  if (gapType === "gap up") bias = "bullish open likely";
  if (gapType === "gap down") bias = "weak open likely";
  
  return {
    gap: gap.toFixed(2),
    gapType,
    bias,
    note: `Expected ${gapType} (${gap.toFixed(2)}%) → ${bias}`
  };
}
