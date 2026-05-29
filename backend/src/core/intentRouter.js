const INTENT_TYPES = {
  CASUAL_CHAT: "CASUAL_CHAT",
  STOCK_ANALYSIS: "STOCK_ANALYSIS",
  PORTFOLIO_REVIEW: "PORTFOLIO_REVIEW",
  PORTFOLIO_OPTIMIZATION: "PORTFOLIO_OPTIMIZATION",
  MARKET_OVERVIEW: "MARKET_OVERVIEW",
  MACRO_QUERY: "MACRO_QUERY",
  BACKTEST_QUERY: "BACKTEST_QUERY",
  PERFORMANCE_QUERY: "PERFORMANCE_QUERY",
  SUBSCRIPTION_OR_ACCOUNT: "SUBSCRIPTION_OR_ACCOUNT",
  UNKNOWN: "UNKNOWN"
};

const SYMBOL_ALIASES = {
  TCS: "TCS",
  "TATA CONSULTANCY": "TCS",
  "TATA CONSULTANCY SERVICES": "TCS",
  RELIANCE: "RELIANCE",
  "RELIANCE INDUSTRIES": "RELIANCE",
  INFY: "INFY",
  INFOSYS: "INFY",
  "HDFC BANK": "HDFCBANK",
  HDFCBANK: "HDFCBANK",
  "ICICI BANK": "ICICIBANK",
  ICICIBANK: "ICICIBANK",
  SBIN: "SBIN",
  SBI: "SBIN",
  "SUN PHARMA": "SUNPHARMA",
  SUNPHARMA: "SUNPHARMA",
  BAJFINANCE: "BAJFINANCE",
  "BAJAJ FINANCE": "BAJFINANCE",
  "AXIS BANK": "AXISBANK",
  AXISBANK: "AXISBANK",
  NESTLE: "NESTLEIND",
  NESTLEIND: "NESTLEIND",
  POWERGRID: "POWERGRID",
  "COAL INDIA": "COALINDIA",
  ADANIPORTS: "ADANIPORTS",
  "ADANI PORTS": "ADANIPORTS",
  TITAN: "TITAN",
  NIFTY: "NIFTY",
  SENSEX: "SENSEX",
  BANKNIFTY: "BANKNIFTY"
};

const SYMBOL_STOPWORDS = new Set([
  "A",
  "ADD",
  "AFTER",
  "ALL",
  "AM",
  "AN",
  "AND",
  "ARE",
  "AT",
  "BE",
  "BRO",
  "BUY",
  "CAN",
  "DO",
  "FOR",
  "GOOD",
  "HAVE",
  "HELLO",
  "HOLD",
  "HOW",
  "I",
  "IN",
  "IS",
  "IT",
  "MARKET",
  "ME",
  "MY",
  "OF",
  "ON",
  "OR",
  "OUR",
  "PLEASE",
  "PORTFOLIO",
  "REVIEW",
  "SELL",
  "SHOULD",
  "STOCK",
  "TARGET",
  "THANKS",
  "THE",
  "THIS",
  "TO",
  "TODAY",
  "WATCH",
  "WHAT",
  "WHY",
  "WIN",
  "RATE"
]);

const CASUAL_PATTERNS = [
  /^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening)\b/i,
  /^(thanks|thank you|thx)\b/i,
  /^(what are you doing|who are you|explain yourself)\b/i
];

const PORTFOLIO_PHRASES = [
  "i have",
  "i hold",
  "my portfolio has",
  "my portfolio is",
  "portfolio:",
  "i own",
  "my holdings are",
  "holding"
];

const PORTFOLIO_BOUNDARY_MARKERS = [
  " should ",
  " is ",
  " do ",
  " can ",
  " what ",
  " how ",
  " why ",
  " whether ",
  "?",
  ".",
  " but ",
  " and should "
];

const MARKET_KEYWORDS = [
  "market",
  "nifty",
  "sensex",
  "bank nifty",
  "bullish",
  "bearish",
  "market mood",
  "market risky"
];

const MACRO_KEYWORDS = [
  "macro",
  "rbi",
  "inflation",
  "fed",
  "interest rate",
  "bond yield",
  "crude",
  "global risk",
  "us fed"
];

const PERFORMANCE_KEYWORDS = [
  "win rate",
  "sharpe",
  "expectancy",
  "performance",
  "hit rate",
  "accuracy",
  "how did our recommendations perform"
];

const BACKTEST_KEYWORDS = [
  "backtest",
  "historical replay",
  "strategy test",
  "replay strategy"
];

const SUBSCRIPTION_KEYWORDS = [
  "subscription",
  "renew plan",
  "payment failed",
  "payment issue",
  "trial",
  "billing",
  "refund",
  "invoice",
  "plan"
];

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\.NS$/i, "")
    .replace(/\.BO$/i, "")
    .replace(/[^A-Z0-9]/g, "");
}

function pushUnique(list, value) {
  if (!value || list.includes(value)) return;
  list.push(value);
}

function extractTimeframe(message) {
  const lower = message.toLowerCase();
  if (/\btoday\b/.test(lower)) return "today";
  if (/\bthis week\b/.test(lower)) return "this_week";
  if (/\bthis month\b/.test(lower)) return "this_month";
  if (/\blong term\b/.test(lower)) return "long_term";
  if (/\bshort term\b/.test(lower)) return "short_term";
  if (/\bintraday\b/.test(lower)) return "intraday";
  return null;
}

function includesAny(text, keywords = []) {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function isCasualMessage(message) {
  const lower = message.toLowerCase();
  return CASUAL_PATTERNS.some((pattern) => pattern.test(lower));
}

function extractAliasSymbols(message) {
  const upper = message.toUpperCase();
  const entries = Object.entries(SYMBOL_ALIASES)
    .sort((a, b) => b[0].length - a[0].length);
  const found = [];

  for (const [alias, symbol] of entries) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const pattern = new RegExp(`(^|[^A-Z0-9])(${escaped})(?=[^A-Z0-9]|$)`, "gi");
    let match;

    while ((match = pattern.exec(upper)) !== null) {
      found.push({
        symbol,
        index: match.index + match[1].length,
        length: match[2].length
      });
      pattern.lastIndex = match.index + match[0].length;
    }
  }

  return found;
}

function extractTickerLikeSymbols(message, knownMatches = []) {
  const matches = [...message.matchAll(/\b([A-Z]{2,15}(?:\.(?:NS|BO))?)\b/g)];
  const found = [...knownMatches];

  for (const match of matches) {
    const normalized = cleanToken(match[1]);
    if (!normalized || SYMBOL_STOPWORDS.has(normalized)) continue;
    found.push({
      symbol: normalized,
      index: match.index,
      length: match[1].length
    });
  }

  return found;
}

function collectAllSymbols(message) {
  const aliasMatches = extractAliasSymbols(message);
  const mergedMatches = extractTickerLikeSymbols(message, aliasMatches)
    .sort((left, right) => {
      if (left.index !== right.index) return left.index - right.index;
      return right.length - left.length;
    });
  const orderedSymbols = [];

  for (const match of mergedMatches) {
    pushUnique(orderedSymbols, match.symbol);
  }

  return orderedSymbols;
}

function extractPortfolioSymbols(message) {
  const lower = message.toLowerCase();
  const extracted = [];

  for (const phrase of PORTFOLIO_PHRASES) {
    const index = lower.indexOf(phrase);
    if (index === -1) continue;

    const start = index + phrase.length;
    const remainder = message.slice(start);
    let endIndex = remainder.length;

    for (const marker of PORTFOLIO_BOUNDARY_MARKERS) {
      const markerIndex = remainder.toLowerCase().indexOf(marker);
      if (markerIndex !== -1 && markerIndex < endIndex) {
        endIndex = markerIndex;
      }
    }

    const segment = remainder.slice(0, endIndex);
    const symbols = collectAllSymbols(segment);
    symbols.forEach((symbol) => pushUnique(extracted, symbol));
  }

  return extracted;
}

function extractCandidateSymbol(message, allSymbols, portfolioSymbols) {
  const lower = message.toLowerCase();
  const actionPattern = /\b(?:buy|add|sell|analyze|review|accumulate|reduce|trim|exit|target)\b/i;
  const actionMatch = actionPattern.exec(message);

  if (actionMatch) {
    const trailingSymbols = collectAllSymbols(message.slice(actionMatch.index + actionMatch[0].length));
    const preferred = trailingSymbols.find((symbol) => !portfolioSymbols.includes(symbol));
    if (preferred) return preferred;
    if (trailingSymbols[0]) return trailingSymbols[0];
  }

  const symbolNearWhatAbout = /\bwhat about\b/i.test(lower)
    ? collectAllSymbols(message.replace(/\bwhat about\b/i, ""))
    : [];
  const nonPortfolioWhatAbout = symbolNearWhatAbout.find((symbol) => !portfolioSymbols.includes(symbol));
  if (nonPortfolioWhatAbout) return nonPortfolioWhatAbout;

  const nonPortfolioSymbols = allSymbols.filter((symbol) => !portfolioSymbols.includes(symbol));
  if (nonPortfolioSymbols.length) {
    return nonPortfolioSymbols[nonPortfolioSymbols.length - 1];
  }

  if (portfolioSymbols.length && /\b(sell|hold|keep|reduce|trim|exit)\b/i.test(lower)) {
    return portfolioSymbols[portfolioSymbols.length - 1];
  }

  if (allSymbols.length === 1) {
    return allSymbols[0];
  }

  return null;
}

function buildExtractedPortfolio(portfolioSymbols) {
  return portfolioSymbols.map((symbol) => ({ symbol }));
}

function buildRoute(intent) {
  const base = {
    handler: "UNKNOWN",
    shouldCallMasterAgent: false,
    shouldCallPortfolioOptimizer: false,
    shouldCallPortfolioReview: false,
    shouldCallMacro: false,
    shouldReplyCasually: false
  };

  switch (intent) {
    case INTENT_TYPES.CASUAL_CHAT:
      return { ...base, handler: "CASUAL_REPLY", shouldReplyCasually: true };
    case INTENT_TYPES.STOCK_ANALYSIS:
      return { ...base, handler: "MASTER_AGENT", shouldCallMasterAgent: true };
    case INTENT_TYPES.PORTFOLIO_OPTIMIZATION:
      return {
        ...base,
        handler: "MASTER_AGENT",
        shouldCallMasterAgent: true,
        shouldCallPortfolioOptimizer: true
      };
    case INTENT_TYPES.PORTFOLIO_REVIEW:
      return { ...base, handler: "PORTFOLIO_REVIEW", shouldCallPortfolioReview: true };
    case INTENT_TYPES.MARKET_OVERVIEW:
    case INTENT_TYPES.MACRO_QUERY:
      return { ...base, handler: "MACRO", shouldCallMacro: true };
    case INTENT_TYPES.BACKTEST_QUERY:
      return { ...base, handler: "BACKTEST" };
    case INTENT_TYPES.PERFORMANCE_QUERY:
      return { ...base, handler: "PERFORMANCE" };
    case INTENT_TYPES.SUBSCRIPTION_OR_ACCOUNT:
      return { ...base, handler: "SUBSCRIPTION" };
    default:
      return base;
  }
}

function createResult({
  intent,
  confidence,
  requiresFinancialData,
  requiresPortfolio,
  requiresCandidateStock,
  symbols,
  candidateSymbol,
  portfolioSymbols,
  timeframe,
  userQuestion,
  reason
}) {
  return {
    intent,
    confidence: Number(confidence.toFixed(2)),
    requiresFinancialData,
    requiresPortfolio,
    requiresCandidateStock,
    symbols,
    candidateSymbol,
    portfolioSymbols,
    extractedPortfolio: buildExtractedPortfolio(portfolioSymbols),
    timeframe,
    userQuestion,
    route: buildRoute(intent),
    reason,
    version: "intent-router-v1"
  };
}

export function classifyUserIntent(message, options = {}) {
  const userQuestion = normalizeText(message);
  const normalizedOptions = options || {};
  const fallbackPortfolioSymbols = Array.isArray(normalizedOptions.portfolioSymbols)
    ? normalizedOptions.portfolioSymbols.map(cleanToken).filter(Boolean)
    : [];

  if (!userQuestion) {
    return createResult({
      intent: INTENT_TYPES.UNKNOWN,
      confidence: 0.15,
      requiresFinancialData: false,
      requiresPortfolio: false,
      requiresCandidateStock: false,
      symbols: [],
      candidateSymbol: null,
      portfolioSymbols: [],
      timeframe: null,
      userQuestion,
      reason: "Message is empty, so no reliable intent could be inferred."
    });
  }

  const symbols = collectAllSymbols(userQuestion);
  const extractedPortfolioSymbols = extractPortfolioSymbols(userQuestion);
  const portfolioSymbols = extractedPortfolioSymbols.length
    ? extractedPortfolioSymbols
    : fallbackPortfolioSymbols;
  const candidateSymbol = extractCandidateSymbol(userQuestion, symbols, portfolioSymbols);
  const lower = userQuestion.toLowerCase();
  const timeframe = extractTimeframe(userQuestion);
  const hasPortfolioContext = extractedPortfolioSymbols.length > 0 || /\bportfolio\b|\bholdings\b|\bi hold\b|\bi own\b|\bi have\b/i.test(userQuestion);
  const hasStockAction = /\b(buy|sell|add|analyze|target|good|what about|should i|accumulate|reduce|trim|exit)\b/i.test(userQuestion);

  if (isCasualMessage(userQuestion) && !symbols.length && !includesAny(userQuestion, MARKET_KEYWORDS) && !includesAny(userQuestion, MACRO_KEYWORDS)) {
    return createResult({
      intent: INTENT_TYPES.CASUAL_CHAT,
      confidence: 0.98,
      requiresFinancialData: false,
      requiresPortfolio: false,
      requiresCandidateStock: false,
      symbols: [],
      candidateSymbol: null,
      portfolioSymbols: [],
      timeframe,
      userQuestion,
      reason: "Message is conversational and does not request market, stock, or portfolio analysis."
    });
  }

  if (includesAny(userQuestion, SUBSCRIPTION_KEYWORDS)) {
    return createResult({
      intent: INTENT_TYPES.SUBSCRIPTION_OR_ACCOUNT,
      confidence: 0.94,
      requiresFinancialData: false,
      requiresPortfolio: false,
      requiresCandidateStock: false,
      symbols,
      candidateSymbol: null,
      portfolioSymbols,
      timeframe,
      userQuestion,
      reason: "Message is about billing, subscription, plan, or account support rather than market analysis."
    });
  }

  if (includesAny(userQuestion, BACKTEST_KEYWORDS) || lower.startsWith("/backtest")) {
    return createResult({
      intent: INTENT_TYPES.BACKTEST_QUERY,
      confidence: 0.95,
      requiresFinancialData: false,
      requiresPortfolio: false,
      requiresCandidateStock: false,
      symbols,
      candidateSymbol,
      portfolioSymbols,
      timeframe,
      userQuestion,
      reason: "User is explicitly asking for a backtest or historical strategy replay."
    });
  }

  if (includesAny(userQuestion, PERFORMANCE_KEYWORDS)) {
    return createResult({
      intent: INTENT_TYPES.PERFORMANCE_QUERY,
      confidence: 0.93,
      requiresFinancialData: false,
      requiresPortfolio: false,
      requiresCandidateStock: false,
      symbols,
      candidateSymbol,
      portfolioSymbols,
      timeframe,
      userQuestion,
      reason: "Message asks about recommendation performance metrics such as win rate or Sharpe."
    });
  }

  if (hasPortfolioContext && (candidateSymbol || symbols.length) && (/\b(buy|add|sell|reduce|trim|exit|good for my portfolio|for my portfolio)\b/i.test(userQuestion) || lower.includes("should i"))) {
    return createResult({
      intent: INTENT_TYPES.PORTFOLIO_OPTIMIZATION,
      confidence: candidateSymbol ? 0.95 : 0.82,
      requiresFinancialData: true,
      requiresPortfolio: true,
      requiresCandidateStock: Boolean(candidateSymbol),
      symbols,
      candidateSymbol,
      portfolioSymbols,
      timeframe,
      userQuestion,
      reason: candidateSymbol
        ? `User provided portfolio context and asked about ${candidateSymbol} as a portfolio decision.`
        : "User provided portfolio context and asked for a portfolio-specific buy or sell decision."
    });
  }

  if (hasPortfolioContext || /\b(review my portfolio|how is my portfolio|portfolio health|portfolio risky|my holdings|reduce from my holdings)\b/i.test(userQuestion)) {
    return createResult({
      intent: INTENT_TYPES.PORTFOLIO_REVIEW,
      confidence: 0.92,
      requiresFinancialData: true,
      requiresPortfolio: true,
      requiresCandidateStock: false,
      symbols,
      candidateSymbol: null,
      portfolioSymbols,
      timeframe,
      userQuestion,
      reason: "Message asks for portfolio status, health, or holdings review rather than a single-stock answer."
    });
  }

  if (includesAny(userQuestion, MACRO_KEYWORDS)) {
    return createResult({
      intent: INTENT_TYPES.MACRO_QUERY,
      confidence: 0.91,
      requiresFinancialData: true,
      requiresPortfolio: false,
      requiresCandidateStock: false,
      symbols,
      candidateSymbol: null,
      portfolioSymbols,
      timeframe,
      userQuestion,
      reason: "Message is about macro drivers such as RBI, inflation, Fed policy, or global risk."
    });
  }

  if (includesAny(userQuestion, MARKET_KEYWORDS)) {
    return createResult({
      intent: INTENT_TYPES.MARKET_OVERVIEW,
      confidence: 0.9,
      requiresFinancialData: true,
      requiresPortfolio: false,
      requiresCandidateStock: false,
      symbols,
      candidateSymbol: null,
      portfolioSymbols,
      timeframe,
      userQuestion,
      reason: "Message asks about the broader market tone, trend, or index direction."
    });
  }

  if ((candidateSymbol || symbols.length) && (hasStockAction || lower.startsWith("/analyze") || /^[A-Z]{2,15}$/.test(userQuestion))) {
    const resolvedCandidate = candidateSymbol || symbols[0] || null;
    return createResult({
      intent: INTENT_TYPES.STOCK_ANALYSIS,
      confidence: resolvedCandidate ? 0.94 : 0.76,
      requiresFinancialData: true,
      requiresPortfolio: false,
      requiresCandidateStock: Boolean(resolvedCandidate),
      symbols,
      candidateSymbol: resolvedCandidate,
      portfolioSymbols,
      timeframe,
      userQuestion,
      reason: resolvedCandidate
        ? `User is asking for a stock-specific decision or analysis on ${resolvedCandidate}.`
        : "Message appears stock-specific and should use the live analysis flow."
    });
  }

  return createResult({
    intent: INTENT_TYPES.UNKNOWN,
    confidence: 0.35,
    requiresFinancialData: false,
    requiresPortfolio: false,
    requiresCandidateStock: false,
    symbols,
    candidateSymbol: null,
    portfolioSymbols,
    timeframe,
    userQuestion,
    reason: "No strong deterministic signal matched a supported finance or casual intent."
  });
}

export { INTENT_TYPES };
