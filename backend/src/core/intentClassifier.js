import { callGroq } from "../services/claude.service.js";

const INTENT_SCHEMA = `
Return ONLY valid JSON. No explanation.
{
  "intent": "financial_analysis" | "portfolio_query" | "market_question" | "education" | "scanner_request" | "news_query",
  "entities": ["TICKER1", "TICKER2"],
  "needsLiveData": true/false,
  "needsPortfolio": true/false,
  "needsNews": true/false,
  "needsTechnicals": true/false,
  "needsHistorical": true/false,
  "confidence": 0-100
}
`;

export async function classifyIntent(userMessage, conversationHistory = []) {
  const historyText = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-5).map((m) => String(m)).join("\n")
    : "";

  const prompt = `
You are a financial intent classifier.
Analyze this user message and classify it.

Message: "${String(userMessage || "")}"
Recent conversation:
${historyText || "N/A"}

${INTENT_SCHEMA}

Examples:
"Should I buy Reliance?" → financial_analysis, entities: ["RELIANCE"], needsLiveData: true, needsTechnicals: true
"How is my portfolio?" → portfolio_query, needsPortfolio: true
"What is RSI?" → education, no tools needed
"Scan the market" → scanner_request
"Latest news on TCS?" → news_query, entities: ["TCS"], needsNews: true
`;

  try {
    const response = await callGroq(prompt, { maxTokens: 200 });
    const clean = String(response || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      intent: parsed.intent || "financial_analysis",
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      needsLiveData: Boolean(parsed.needsLiveData),
      needsPortfolio: Boolean(parsed.needsPortfolio),
      needsNews: Boolean(parsed.needsNews),
      needsTechnicals: Boolean(parsed.needsTechnicals),
      needsHistorical: Boolean(parsed.needsHistorical),
      confidence: Number(parsed.confidence) || 50
    };
  } catch {
    return {
      intent: "financial_analysis",
      entities: [],
      needsLiveData: false,
      needsPortfolio: false,
      needsNews: false,
      needsTechnicals: false,
      needsHistorical: false,
      confidence: 50
    };
  }
}
