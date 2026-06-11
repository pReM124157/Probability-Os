/**
 * Hermes Intent Router for Finsight
 * Purpose:
 * - Classify user message
 * - Extract stock symbol / action / timeframe / alert condition
 * - Return strict JSON only
 *
 * Safety:
 * - Does NOT fetch prices
 * - Does NOT make trade decisions
 * - Does NOT bypass market validation
 * - Falls back to deterministic regex if Hermes is disabled/unavailable
 */

const INTENTS = {
  STOCK_ANALYSIS: "STOCK_ANALYSIS",
  TRADE_DECISION: "TRADE_DECISION",
  PRICE_CHECK: "PRICE_CHECK",
  PORTFOLIO_REVIEW: "PORTFOLIO_REVIEW",
  ALERT_CREATE: "ALERT_CREATE",
  NEWS_EXPLAIN: "NEWS_EXPLAIN",
  MARKET_OVERVIEW: "MARKET_OVERVIEW",
  COMPARE_STOCKS: "COMPARE_STOCKS",
  POSITION_EXIT: "POSITION_EXIT",
  RISK_EXPLAIN: "RISK_EXPLAIN",
  EDUCATIONAL_QUERY: "EDUCATIONAL_QUERY",
  SUBSCRIPTION_BUY: "SUBSCRIPTION_BUY",
  SUBSCRIPTION_CANCEL: "SUBSCRIPTION_CANCEL",
  SUBSCRIPTION_STATUS: "SUBSCRIPTION_STATUS",
  BILLING_HELP: "BILLING_HELP",
  CASUAL_CHAT: "CASUAL_CHAT",
  UNKNOWN: "UNKNOWN"
};

function safeJsonParse(text) {
  try {
    const cleaned = String(text || "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");

    if (first === -1 || last === -1) return null;

    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

function normalizeSymbol(raw) {
  if (!raw) return null;

  const value = String(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();

  const aliases = {
    HDFC: "HDFCBANK",
    HDFCBANK: "HDFCBANK",
    HDFCBANKLTD: "HDFCBANK",
    HDFCBANKLIMITED: "HDFCBANK",
    ICICI: "ICICIBANK",
    ICICIBANK: "ICICIBANK",
    AXIS: "AXISBANK",
    AXISBANK: "AXISBANK",
    RELIANCE: "RELIANCE",
    RIL: "RELIANCE",
    TCS: "TCS",
    INFY: "INFY",
    INFOSYS: "INFY",
    SBIN: "SBIN",
    SBI: "SBIN",
    KOTAK: "KOTAKBANK",
    KOTAKBANK: "KOTAKBANK",
    WIPRO: "WIPRO"
  };

  return aliases[value] || value || null;
}

function extractLikelySymbols(message) {
  const text = String(message || "").toUpperCase();

  const known = [
    "RELIANCE",
    "RIL",
    "TCS",
    "INFY",
    "INFOSYS",
    "HDFCBANK",
    "HDFC",
    "ICICIBANK",
    "ICICI",
    "AXISBANK",
    "AXIS",
    "SBIN",
    "SBI",
    "KOTAKBANK",
    "KOTAK",
    "WIPRO"
  ];

  const found = [];

  for (const symbol of known) {
    const pattern = new RegExp(`\\b${symbol}\\b`, "i");
    if (pattern.test(text)) {
      const normalized = normalizeSymbol(symbol);
      if (normalized && !found.includes(normalized)) found.push(normalized);
    }
  }

  return found;
}

function deterministicIntentFallback(message) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const symbols = extractLikelySymbols(text);
  const symbol = symbols[0] || null;

  if (/^(hi|hello|hey|yo|sup)\b/i.test(lower)) {
    return {
      intent: INTENTS.CASUAL_CHAT,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/portfolio|holdings|my stocks|my positions/i.test(lower)) {
    return {
      intent: INTENTS.PORTFOLIO_REVIEW,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/\b(cancel|unsubscribe|stop|end)\b.*\b(subscription|plan|pro)\b|\b(subscription|plan|pro)\b.*\b(cancel|unsubscribe|stop|end)\b/i.test(lower)) {
    return {
      intent: INTENTS.SUBSCRIPTION_CANCEL,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      confidence: 0.95,
      source: "deterministic"
    };
  }

  if (/\b(am i subscribed|is my subscription active|what plan am i on|subscription status|current plan|my plan|am i on pro)\b/i.test(lower)) {
    return {
      intent: INTENTS.SUBSCRIPTION_STATUS,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      confidence: 0.95,
      source: "deterministic"
    };
  }

  if (/\b(refund|invoice|payment failed|charged|billing|payment issue|billing issue)\b/i.test(lower)) {
    return {
      intent: INTENTS.BILLING_HELP,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      confidence: 0.95,
      source: "deterministic"
    };
  }

  if (/\b(buy pro|upgrade|subscribe|activate pro|purchase plan|go pro)\b/i.test(lower)) {
    return {
      intent: INTENTS.SUBSCRIPTION_BUY,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      confidence: 0.95,
      source: "deterministic"
    };
  }

  if (/alert|notify|remind/i.test(lower)) {
    const priceMatch = lower.match(/(?:above|below|crosses|cross|at|near)\s*₹?\s*(\d+(?:\.\d+)?)/i);
    const condition = /below|under|less/i.test(lower) ? "below" : "above";

    return {
      intent: INTENTS.ALERT_CREATE,
      symbol,
      symbols,
      exchange: "NSE",
      condition,
      price: priceMatch ? Number(priceMatch[1]) : null,
      confidence: symbol ? 0.9 : 0.6,
      source: "deterministic"
    };
  }

  if (/vs|compare|better between|which is better/i.test(lower) && symbols.length >= 2) {
    return {
      intent: INTENTS.COMPARE_STOCKS,
      symbol: null,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsFundamentals: true,
      needsTechnical: true,
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/price|trading at|current price|ltp/i.test(lower)) {
    return {
      intent: INTENTS.PRICE_CHECK,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      confidence: symbol ? 0.9 : 0.55,
      source: "deterministic"
    };
  }

  if (/why.*(fall|fell|down|up|rise|rally)|news|reason/i.test(lower)) {
    return {
      intent: INTENTS.NEWS_EXPLAIN,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsNews: true,
      confidence: symbol ? 0.85 : 0.6,
      source: "deterministic"
    };
  }

  if (/exit|sell|stop loss|stoploss|book profit|trim/i.test(lower)) {
    return {
      intent: INTENTS.POSITION_EXIT,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsTechnical: true,
      confidence: symbol ? 0.9 : 0.6,
      source: "deterministic"
    };
  }

  if (/risk|danger|safe|unsafe/i.test(lower)) {
    return {
      intent: INTENTS.RISK_EXPLAIN,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsFundamentals: true,
      confidence: symbol ? 0.85 : 0.6,
      source: "deterministic"
    };
  }

  if (/buy|enter|entry|invest|should i|deploy/i.test(lower) && symbol) {
    return {
      intent: INTENTS.TRADE_DECISION,
      symbol,
      symbols,
      exchange: "NSE",
      actionRequested: /sell|exit/i.test(lower) ? "SELL" : "BUY",
      needsLivePrice: true,
      needsFundamentals: true,
      needsTechnical: true,
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/analyze|analysis|view|opinion|breakdown/i.test(lower) && symbol) {
    return {
      intent: INTENTS.STOCK_ANALYSIS,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsFundamentals: true,
      needsTechnical: true,
      needsNews: false,
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/nifty|sensex|market|index/i.test(lower)) {
    return {
      intent: INTENTS.MARKET_OVERVIEW,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      needsLivePrice: true,
      confidence: 0.85,
      source: "deterministic"
    };
  }

  if (/what is|explain|meaning of|how does/i.test(lower)) {
    return {
      intent: INTENTS.EDUCATIONAL_QUERY,
      symbol,
      symbols,
      exchange: "NSE",
      confidence: 0.8,
      source: "deterministic"
    };
  }

  if (symbol) {
    return {
      intent: INTENTS.STOCK_ANALYSIS,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsFundamentals: true,
      needsTechnical: true,
      confidence: 0.75,
      source: "deterministic"
    };
  }

  return {
    intent: INTENTS.UNKNOWN,
    symbol: null,
    symbols: [],
    exchange: "NSE",
    confidence: 0.4,
    source: "deterministic"
  };
}

function buildHermesPrompt(message) {
  return `
You are Hermes Router, the intent brain for Finsight, an institutional stock intelligence assistant.

Your job:
Understand the user's natural language request and return routing JSON only.

You are NOT allowed to:
- give financial advice
- fetch market data
- invent prices
- generate stock analysis
- hallucinate ticker symbols
- explain your reasoning

You ARE allowed to:
- infer intent from wording
- normalize Indian stock names into NSE symbols
- detect whether the user wants analysis, price, alert, news, comparison, portfolio review, risk, or education
- detect whether the user wants to buy, cancel, check, or get help with a subscription or billing issue
- extract timeframe, condition, target price, and requested action
- decide which backend route should handle the request
- classify billing/subscription intent only; backend must perform billing actions

Available intents:
${Object.values(INTENTS).join(", ")}

Intent definitions:
- STOCK_ANALYSIS: user asks for full analysis/view/breakdown/opinion on a stock.
- TRADE_DECISION: user asks whether to buy/sell/enter/deploy/hold a stock.
- PRICE_CHECK: user asks current price/LTP/where stock is trading.
- PORTFOLIO_REVIEW: user asks about their holdings/portfolio/positions.
- ALERT_CREATE: user asks to alert/notify/remind when stock crosses a price.
- NEWS_EXPLAIN: user asks why a stock moved, fell, rose, or asks for news reason.
- MARKET_OVERVIEW: user asks about Nifty, Sensex, overall market, index view.
- COMPARE_STOCKS: user compares two or more stocks.
- POSITION_EXIT: user asks exit, stop loss, trim, book profit, reduce.
- RISK_EXPLAIN: user asks risk, safety, downside, danger.
- EDUCATIONAL_QUERY: user asks meaning/explanation of a finance concept.
- SUBSCRIPTION_BUY: user wants to buy, upgrade, subscribe, activate Pro, or purchase a plan.
- SUBSCRIPTION_CANCEL: user wants to cancel, stop, unsubscribe, end Pro, or avoid future charges.
- SUBSCRIPTION_STATUS: user asks whether they are subscribed, active, paid, trialing, cancelled, or what plan they have.
- BILLING_HELP: user asks about payment, invoice, refund, billing issue, failed payment, or charge.
- CASUAL_CHAT: greeting/small talk.
- UNKNOWN: unsupported, unclear, or no actionable financial intent.

Symbol normalization examples:
- reliance, ril -> RELIANCE
- tcs -> TCS
- infosys, infy -> INFY
- hdfc bank, hdfc -> HDFCBANK
- icici, icici bank -> ICICIBANK
- axis, axis bank -> AXISBANK
- sbi, state bank -> SBIN
- kotak, kotak bank -> KOTAKBANK

Output JSON schema:
{
  "intent": "ONE_INTENT",
  "symbol": "SYMBOL_OR_NULL",
  "symbols": ["SYMBOLS_IF_ANY"],
  "exchange": "NSE",
  "timeframe": "string_or_null",
  "actionRequested": "BUY|SELL|HOLD|EXIT|WATCH|null",
  "condition": "above|below|null",
  "price": number_or_null,
  "needsLivePrice": true_or_false,
  "needsFundamentals": true_or_false,
  "needsTechnical": true_or_false,
  "needsNews": true_or_false,
  "confidence": number_between_0_and_1
}

Decision rules:
- If user asks "should I buy", "entry", "invest", "deploy" -> TRADE_DECISION.
- If user asks "analyze", "view", "breakdown", "opinion" -> STOCK_ANALYSIS.
- If user asks only "price", "ltp", "current price" -> PRICE_CHECK.
- If user asks "alert", "notify", "remind", "crosses", "above", "below" with price -> ALERT_CREATE.
- If user asks "why did it fall/rise" -> NEWS_EXPLAIN.
- If user mentions "vs", "compare", "which is better" with 2 stocks -> COMPARE_STOCKS.
- If user asks "portfolio", "holdings", "positions" -> PORTFOLIO_REVIEW.
- If user asks "stop loss", "exit", "sell", "trim", "book profit" -> POSITION_EXIT.
- If user says "buy pro", "upgrade", "subscribe", "activate pro" -> SUBSCRIPTION_BUY.
- If user says "cancel subscription", "unsubscribe", "stop pro", "end my plan" -> SUBSCRIPTION_CANCEL.
- If user asks "am I subscribed", "what plan am I on", "is my subscription active" -> SUBSCRIPTION_STATUS.
- If user asks "refund", "invoice", "payment failed", "charged", "billing" -> BILLING_HELP.
- If multiple intents are possible, choose the intent that best matches the user's action request.
- If no ticker is present but intent needs one, return symbol null and lower confidence.
- Never claim a subscription was bought, cancelled, refunded, upgraded, downgraded, or changed. Only classify the intent. Backend must perform billing actions.

Return ONLY JSON. No markdown. No explanation.

User message:
"${message}"
`.trim();
}

export async function classifyIntentWithHermes(message) {
  const fallback = deterministicIntentFallback(message);

  if (process.env.HERMES_ENABLED !== "true") {
    return fallback;
  }

  const baseUrl = process.env.HERMES_BASE_URL;
  const apiKey = process.env.HERMES_API_KEY;
  const model = process.env.HERMES_MODEL || "NousResearch/Hermes-3-Llama-3.1-8B";

  if (!baseUrl) {
    return {
      ...fallback,
      hermesError: "HERMES_BASE_URL missing"
    };
  }

  const hermesController = new AbortController();
  const hermesTimeoutId = setTimeout(() => hermesController.abort(), 2500);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      signal: hermesController.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content: "You are a strict JSON intent classifier for a financial assistant."
          },
          {
            role: "user",
            content: buildHermesPrompt(message)
          }
        ]
      })
    });

    if (!response.ok) {
      return {
        ...fallback,
        hermesError: `Hermes HTTP ${response.status}`
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(content);

    if (!parsed || !parsed.intent) {
      return {
        ...fallback,
        hermesError: "Hermes returned invalid JSON"
      };
    }

    const normalized = {
      intent: parsed.intent || fallback.intent,
      symbol: normalizeSymbol(parsed.symbol) || fallback.symbol,
      symbols: Array.isArray(parsed.symbols)
        ? parsed.symbols.map(normalizeSymbol).filter(Boolean)
        : fallback.symbols || [],
      exchange: parsed.exchange || "NSE",
      timeframe: parsed.timeframe || null,
      actionRequested: parsed.actionRequested || null,
      condition: parsed.condition || null,
      price: parsed.price !== undefined && parsed.price !== null ? Number(parsed.price) : null,
      needsLivePrice: Boolean(parsed.needsLivePrice),
      needsFundamentals: Boolean(parsed.needsFundamentals),
      needsTechnical: Boolean(parsed.needsTechnical),
      needsNews: Boolean(parsed.needsNews),
      confidence: Number(parsed.confidence || fallback.confidence || 0.5),
      source: "hermes"
    };

    if (!normalized.symbol && normalized.symbols.length === 1) {
      normalized.symbol = normalized.symbols[0];
    }

    return normalized;
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        ...fallback,
        hermesError: "Hermes timeout (2.5s) — deterministic fallback used"
      };
    }
    return {
      ...fallback,
      hermesError: error?.message || String(error)
    };
  } finally {
    clearTimeout(hermesTimeoutId);
  }
}

export { INTENTS, deterministicIntentFallback };
