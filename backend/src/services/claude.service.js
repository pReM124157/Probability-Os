import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const generateInvestmentAnalysis = async (prompt) => {
  const PRIMARY_MODEL = "llama-3.3-70b-versatile";
  const FALLBACK_MODEL = "llama-3.1-8b-instant";

  try {
    const response = await groq.chat.completions.create({
      model: PRIMARY_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1000
    });
    return response.choices[0].message.content;

  } catch (error) {
    console.log(`Primary model (${PRIMARY_MODEL}) failed:`, error.message);

    // Trigger fallback for rate limits or general failures
    const isRateLimit = error.status === 429 || error.message?.includes("rate_limit");
    if (isRateLimit) {
      console.log("Rate limit detected, switching to fallback model...");
    }

    try {
      const response = await groq.chat.completions.create({
        model: FALLBACK_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1000
      });
      return response.choices[0].message.content;

    } catch (fallbackError) {
      console.log(`Fallback model (${FALLBACK_MODEL}) failed:`, fallbackError.message);

      // Final institutional safety response
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
  }
};

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