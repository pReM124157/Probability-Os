import { classifyIntent } from "./intentClassifier.js";
import { resolveTools } from "./toolPolicy.js";
import { executeTools } from "./toolExecutor.js";
import { callGroq } from "../services/claude.service.js";

export async function processNaturalLanguage(userMessage, userId, conversationHistory = []) {
  const intent = await classifyIntent(userMessage, conversationHistory);
  const tools = resolveTools(intent);
  const toolResults = await executeTools(tools, intent, userId);
  const context = buildContext(userMessage, intent, toolResults);
  const response = await callGroq(context, { maxTokens: 500 });

  return {
    response,
    intent,
    toolsUsed: tools,
    data: toolResults
  };
}

function buildContext(userMessage, intent, toolResults) {
  let context = `You are Finsight, an institutional financial AI assistant for Indian markets.
User question: "${String(userMessage || "")}"
Intent: ${intent?.intent || "financial_analysis"}

`;

  if (toolResults.marketData) {
    const md = toolResults.marketData;
    context += `Live Market Data:
Price: ₹${md.currentPrice ?? "N/A"}
Change: ${Number.isFinite(md.change) ? md.change.toFixed(2) : "N/A"}%
Market Open: ${md.isMarketOpen ?? "N/A"}
Trend: ${md.trend || "N/A"}
RSI: ${md.rsi || "N/A"}
Volume Ratio: ${md.volumeRatio || "N/A"}

`;
  }

  if (toolResults.portfolio && toolResults.portfolio.length > 0) {
    context += `User Portfolio:
${JSON.stringify(toolResults.portfolio, null, 2)}

`;
  }

  if (toolResults.news) {
    context += `Latest News Sentiment: ${toolResults.news.sentiment || "NEUTRAL"}

`;
  }

  if (toolResults.scanner) {
    const s = toolResults.scanner;
    if (s.status === "POST_MARKET_CONTEXT" && s.lastSignal) {
      context += `Last Scanner Signal:
Symbol: ${s.lastSignal.symbol}
Action: ${s.lastSignal.action}
Confidence: ${s.lastSignal.confidence}%
Entry: ₹${s.lastSignal.entry_price}
Stop Loss: ₹${s.lastSignal.stop_loss}
Target: ₹${s.lastSignal.target_price}

`;
    }
  }

  context += `Answer the user's question using the data above. Be concise, institutional, and direct.
If data is unavailable, say so honestly.
End with: "⚠️ Educational only. Not SEBI registered advice."`;

  return context;
}
