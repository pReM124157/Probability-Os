import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const primaryGroq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const backupGroq = new Groq({
  apiKey: process.env.GROQ_API_KEY_BACKUP,
});

export const generateInvestmentAnalysis = async (prompt) => {
  const PRIMARY_MODEL = "llama-3.3-70b-versatile";
  const FALLBACK_MODEL = "llama-3.1-8b-instant";

  const isRateLimit = (err) => err.status === 429 || err.message?.toLowerCase().includes("rate_limit") || err.message?.toLowerCase().includes("quota");

  // LAYER 1: Primary Model + Primary Key
  try {
    const response = await primaryGroq.chat.completions.create({
      model: PRIMARY_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1000
    });
    return response.choices[0].message.content;

  } catch (error) {
    console.log(`[LEVEL 1] Primary model (${PRIMARY_MODEL}) on Primary Key failed:`, error.message);

    if (isRateLimit(error)) {
      console.log("Rate limit/Quota hit on Primary Key. Moving to LEVEL 2 (Fallback Model + Primary Key)...");
      
      // LAYER 2: Fallback Model + Primary Key
      try {
        const response = await primaryGroq.chat.completions.create({
          model: FALLBACK_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 1000
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
              temperature: 0.3,
              max_tokens: 1000
            });
            return response.choices[0].message.content;

          } catch (error3) {
            console.log(`[LEVEL 3] Primary model on Backup Key failed:`, error3.message);
            
            if (isRateLimit(error3)) {
              console.log("Moving to LEVEL 4 (Fallback Model + Backup Key)...");
              
              // LAYER 4: Fallback Model + Backup Key
              try {
                const response = await backupGroq.chat.completions.create({
                  model: FALLBACK_MODEL,
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.3,
                  max_tokens: 1000
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
          temperature: 0.3,
          max_tokens: 1000
        });
        return response.choices[0].message.content;
      } catch (e) {
        return handleFinalFallback(prompt);
      }
    }
  }
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