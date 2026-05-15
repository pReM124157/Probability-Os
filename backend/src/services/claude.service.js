import Groq from "groq-sdk";
import dotenv from "dotenv";
import { getOrPopulateSharedCache, getSharedCache, setSharedCache } from "./sharedCache.service.js";
import { logError } from "./telemetry.service.js";

dotenv.config();

const primaryGroq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const backupGroq = new Groq({
  apiKey: process.env.GROQ_API_KEY_BACKUP,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Low-level caller for Groq API with 4-layer fallback and retry delays.
 */
// ─────────────────────────────────────────────
// TIER SYSTEM PROMPTS
// ─────────────────────────────────────────────

const PRO_SYSTEM_PROMPT = `
You are FinSight — an institutional-grade stock analysis AI.
Provide:
- Entry zones with specific price levels
- Stop loss levels
- Profit targets
- Risk level (LOW/MEDIUM/HIGH)
- Clear BUY / HOLD / AVOID signal
- Structured, data-driven output
Be precise, concise, and professional.
Always end with: ⚠️ Educational only. Not financial advice.
`.trim();

const FREE_SYSTEM_PROMPT = `
You are FinSight FREE version.
STRICT RULES — follow without exception:
- No entry price
- No stop loss
- No targets
- No buy/sell/hold recommendations
- No actionable advice of any kind
- Maximum 2-3 sentences only
Only give high-level market context or general sentiment.
End EXACTLY with this line (no variation):
"💎 Upgrade to Pro for full analysis → /subscribe"
`.trim();

/**
 * Tiered LLM call — Pro gets full response, Free gets restricted overview with upsell.
 */
export const generateTieredAnalysis = async (userPrompt, isPro) => {
  const systemPrompt = isPro ? PRO_SYSTEM_PROMPT : FREE_SYSTEM_PROMPT;
  const maxTokens = isPro ? 1200 : 250;

  try {
    const response = await primaryGroq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature: isPro ? 0.1 : 0.3
    });
    return response.choices[0].message.content;
  } catch (err) {
    console.error('[TIERED LLM] Primary failed, falling back:', err.message);
    try {
      const response = await backupGroq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature: isPro ? 0.1 : 0.3
      });
      return response.choices[0].message.content;
    } catch (err2) {
      return isPro
        ? handleFinalFallback(userPrompt)
        : "Market data is currently being processed.\n\n💎 For full analysis with entry zones, targets & stop loss → /subscribe (₹599/month)";
    }
  }
};

export const generateInvestmentAnalysis = async (prompt) => {
  const PRIMARY_MODEL = "llama-3.3-70b-versatile";
  const FALLBACK_MODEL = "llama-3.1-8b-instant";

  const isRateLimit = (err) => err.status === 429 || err.message?.toLowerCase().includes("rate_limit") || err.message?.toLowerCase().includes("quota");

  // LAYER 1: Primary Model + Primary Key
  try {
    const response = await primaryGroq.chat.completions.create({
      model: PRIMARY_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1, // Lower temperature for more deterministic financial analysis
      max_tokens: 800   // Reduced to save tokens
    });
    return response.choices[0].message.content;

  } catch (error) {
    console.log(`[LEVEL 1] Primary model (${PRIMARY_MODEL}) on Primary Key failed:`, error.message);

    if (isRateLimit(error)) {
      console.log("Rate limit/Quota hit on Primary Key. Waiting 3s...");
      await sleep(3000);
      console.log("Moving to LEVEL 2 (Fallback Model + Primary Key)...");
      
      // LAYER 2: Fallback Model + Primary Key
      try {
        const response = await primaryGroq.chat.completions.create({
          model: FALLBACK_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 800
        });
        return response.choices[0].message.content;

      } catch (error2) {
        console.log(`[LEVEL 2] Fallback model (${FALLBACK_MODEL}) on Primary Key failed:`, error2.message);
        
        if (isRateLimit(error2)) {
          console.log("⚠️ Primary API Key fully exhausted. Switching to Backup API Key...");
          
          // LAYER 3: Primary Model + Backup Key
          try {
            console.log(`[LEVEL 3] Using Primary Model (${PRIMARY_MODEL}) on Backup Key...`);
            const response = await backupGroq.chat.completions.create({
              model: PRIMARY_MODEL,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.1,
              max_tokens: 800
            });
            return response.choices[0].message.content;

          } catch (error3) {
            console.log(`[LEVEL 3] Primary model on Backup Key failed:`, error3.message);
            
            if (isRateLimit(error3)) {
              console.log("Rate limit hit on Primary Model/Backup Key. Waiting 3s...");
              await sleep(3000);
              console.log("Moving to LEVEL 4 (Fallback Model + Backup Key)...");
              
              // LAYER 4: Fallback Model + Backup Key
              try {
                const response = await backupGroq.chat.completions.create({
                  model: FALLBACK_MODEL,
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.1,
                  max_tokens: 800
                });
                return response.choices[0].message.content;

              } catch (error4) {
                console.log(`[LEVEL 4] Fallback model on Backup Key failed:`, error4.message);
                return handleFinalFallback(prompt);
              }
            } else {
              return handleFinalFallback(prompt);
            }
          }
        } else {
          return handleFinalFallback(prompt);
        }
      }
    } else {
      // Non-rate limit error (e.g. invalid request) - move to fallback model or safety
      try {
        const response = await primaryGroq.chat.completions.create({
          model: FALLBACK_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 800
        });
        return response.choices[0].message.content;
      } catch (e) {
        return handleFinalFallback(prompt);
      }
    }
  }
};

const llmCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const getInstitutionalAnalysis = async (data) => {
  const ticker = data.Symbol || "UNKNOWN";
  
  // Strong Cache Key including fundamentals and technicals to prevent collisions
  const cacheKey = JSON.stringify({
    symbol: ticker,
    price: data.currentPrice,
    rsi: data.rsi,
    trend: data.trend,
    roe: data.ReturnOnEquityTTM,
    debt: data.DebtToEquityRatio,
    revenueGrowth: data.QuarterlyRevenueGrowthYOY,
    earningsGrowth: data.QuarterlyEarningsGrowthYOY
  });
  
  if (llmCache.has(cacheKey)) {
    const cached = llmCache.get(cacheKey);
    const age = Date.now() - cached.timestamp;
    
    // Regime Change Invalidation: Bypass cache if technical structure shifted significantly
    const rsiShift = Math.abs((data.rsi || 50) - (cached.data.rsi || 50));
    const trendChanged = data.trend !== cached.data.trend;

    if (age < CACHE_DURATION && rsiShift <= 10 && !trendChanged) {
      console.log(`[CACHE HIT] Returning cached LLM analysis for ${ticker}`);
      return cached.data;
    } else if (age < CACHE_DURATION) {
      console.log(`[CACHE BYPASS] Regime change detected (RSI shift: ${rsiShift}, Trend flip: ${trendChanged}). Forcing fresh analysis.`);
    }
  }

  try {
    const shared = await getSharedCache(`INSTITUTIONAL_ANALYSIS_${cacheKey}`);
    if (shared) {
      llmCache.set(cacheKey, {
        data: shared,
        timestamp: Date.now()
      });
      return shared;
    }
  } catch (error) {
    logError("llm.shared_cache.read_error", error, { ticker });
  }

  const prompt = `
You are a hedge fund equity analyst. 
Make strict, data-driven decisions using ONLY provided numbers. 
No hallucinations. No generic fluff.

STOCK: ${data.Name || data.Symbol} (${data.Symbol}) | SECTOR: ${data.Sector || "N/A"}

CORE METRICS:
- MCAP: ${data.MarketCapitalization ?? "N/A"} | PE: ${data.PERatio ?? "N/A"} | PB: ${data.PriceToBookRatio ?? "N/A"}
- MARGIN: ${data.ProfitMargin ?? "N/A"} | ROE: ${data.ReturnOnEquityTTM ?? "N/A"} | D/E: ${data.DebtToEquityRatio ?? "N/A"}
- REV GROWTH: ${data.QuarterlyRevenueGrowthYOY ?? "N/A"} | EARN GROWTH: ${data.QuarterlyEarningsGrowthYOY ?? "N/A"}

LIVE DATA:
- PRICE: ₹${data.currentPrice ?? "N/A"} | HIGH/LOW: ${data.dayHigh}/${data.dayLow}
- 52W H/L: ${data.fiftyTwoWeekHigh}/${data.fiftyTwoWeekLow} | VOL: ${data.volume} (AVG: ${data.averageVolume})

TECHNICALS:
- RSI: ${data.rsi ?? "N/A"} | 50DMA: ${data.above50DMA} | 200DMA: ${data.above200DMA}
- MOMENTUM: ${data.momentumScore}/10 | BREAKOUT: ${data.breakoutStrength}/10

RULES:
BUY: Strong fundamentals, healthy growth, attractive valuation.
HOLD: Mixed setup, neutral valuation, wait for confirmation.
SELL: Weak quality, poor growth, overvaluation.

FORMAT:
Final Decision: BUY/HOLD/SELL
Confidence Score: X/10
Risk Level: LOW/MEDIUM/HIGH
Priority Level: LOW/MEDIUM/HIGH
Rank Score: X/10
Suggested Allocation: X%
Reason: (2-line max, data-based)
Recommended Action: (Short instruction)
`.trim();

  const result = await getOrPopulateSharedCache(
    `INSTITUTIONAL_ANALYSIS_${cacheKey}`,
    "institutional_analysis",
    Math.floor(CACHE_DURATION / 1000),
    async () => {
      const response = await generateInvestmentAnalysis(prompt);

      // Parse result
      const decision = response.match(/Final Decision:\s*(.*)/i)?.[1] || "HOLD";
      const confidence = parseInt(response.match(/Confidence Score:\s*(\d+)/i)?.[1]) || 5;
      const risk = response.match(/Risk Level:\s*(.*)/i)?.[1] || "MEDIUM";
      const priority = response.match(/Priority Level:\s*(.*)/i)?.[1] || "MEDIUM";
      const rank = parseInt(response.match(/Rank Score:\s*(\d+)/i)?.[1]) || 5;
      const allocation = response.match(/Suggested Allocation:\s*(.*)/i)?.[1] || "0%";
      const reason = response.match(/Reason:\s*([\s\S]*?)(?=Recommended Action:|$)/i)?.[1]?.trim() || "No reason.";
      const action = response.match(/Recommended Action:\s*([\s\S]*?)$/i)?.[1]?.trim() || "Monitor.";

      return {
        finalDecision: decision.toUpperCase(),
        finalConfidenceScore: confidence,
        riskLevel: risk.toUpperCase(),
        priorityLevel: priority.toUpperCase(),
        rankScore: rank,
        suggestedAllocation: allocation,
        reason: reason,
        recommendation: action
      };
    },
    {
      lockOwner: `llm:${ticker}`,
      fillLockTtlSeconds: 30,
      waitMs: 5000
    }
  );

  llmCache.set(cacheKey, {
    data: result,
    timestamp: Date.now()
  });

  try {
    await setSharedCache(`INSTITUTIONAL_ANALYSIS_${cacheKey}`, "institutional_analysis", result, Math.floor(CACHE_DURATION / 1000));
  } catch (error) {
    logError("llm.shared_cache.write_error", error, { ticker });
  }

  return result;
};

/**
 * Institutional Safety Response
 */
function handleFinalFallback(prompt) {
  const isJsonRequest = prompt.toLowerCase().includes("json");

  if (isJsonRequest) {
    return JSON.stringify({
      finalVerdict: "HOLD",
      finalDecision: "HOLD",
      finalConfidenceScore: 4,
      reason: "Analysis temporarily limited due to model capacity constraints. Conservative HOLD stance applied for safety.",
      stockFundamentals: "Market analysis is currently undergoing scheduled maintenance or experiencing high demand. Please try again later for a deep dive."
    });
  }

  return "I am currently experiencing unusually high demand. To ensure accuracy, I am limiting complex analyses at this moment. Please try again in a few minutes.";
}

export const analyzeStock = async (stock) => {
  const prompt = `Analyze the stock: ${stock}. 
  Return ONLY a JSON object with the following structure:
  {
    "finalVerdict": "BUY" | "HOLD" | "SELL",
    "stockFundamentals": "summary text"
  }`;
  
  const response = await generateInvestmentAnalysis(prompt);
  try {
    // Try to extract JSON if it's wrapped in markdown
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : response);
  } catch (e) {
    return { finalVerdict: "HOLD", stockFundamentals: response };
  }
};
