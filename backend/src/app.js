import express from "express";
import cors from "cors";
import "./services/telegram.service.js";
import supabase from "./services/supabase.service.js";
import { getCompanyOverview } from "./services/marketData.service.js";
import { generateInvestmentAnalysis } from "./services/claude.service.js";
import { masterAgent } from "./agents/master.agent.js";


const app = express();

app.get("/", (req, res) => {
  return res.status(200).send("FinSight Backend Live");
});


app.use(cors({
  origin: "*"
}));
app.use(express.json());



/*
Supabase Test Route
*/
app.get("/test-db", async (req, res) => {
  try {
    const response = await supabase
      .from("test_table")
      .select("*");

    console.log("SUPABASE RESPONSE:", response);

    return res.json(response);
  } catch (error) {
    console.log("FULL ERROR:", error);

    return res.status(500).json({
      error: error.message
    });
  }
});

/*
Stock Data Test Route
*/
app.get("/test-stock", async (req, res) => {
  try {
    const data = await getCompanyOverview("AAPL");

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/*
Multi-Agent Stock Analysis Route
*/
app.get("/analyze-stock", async (req, res) => {
  try {
    const companyData = await getCompanyOverview("AAPL");
    const fullAnalysis = await generateInvestmentAnalysis(companyData);

    return res.json({
      success: true,
      symbol: "AAPL",

      agents: {
        research:
          "Strong financials, premium valuation, and strong long-term profitability.",
        risk:
          "Moderate risk due to regulation, competition, and supply chain dependency.",
        portfolio:
          "Suitable for long-term diversified growth allocation.",
        news:
          "Positive analyst sentiment and strong institutional confidence.",
        decision:
          "BUY"
      },

      analysis: fullAnalysis
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.post("/api/analyze", async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: "Stock symbol is required"
      });
    }
    const companyData = await getCompanyOverview(symbol);
    const multiAgentAnalysis = await masterAgent(companyData);
    return res.json({
      success: true,
      stock: symbol,
      decision: {
        finalAction: multiAgentAnalysis.decision?.finalDecision || "HOLD",
        confidenceScore: multiAgentAnalysis.decision?.finalConfidenceScore || 0,
        reasoning: multiAgentAnalysis.decision?.reason || "No reasoning available"
      },
      risk: {
        riskLevel: multiAgentAnalysis.risk?.riskLevel || "N/A",
        riskScore: multiAgentAnalysis.risk?.riskScore || 0,
        majorRisks: multiAgentAnalysis.risk?.majorRisks || []
      },
      learning: {
        confidenceBoost: multiAgentAnalysis.learning?.learningBoost || 0,
        learningInsight: multiAgentAnalysis.learning?.learningInsight || "N/A"
      },
      performance: {
        performanceScore: multiAgentAnalysis.performance?.performanceScore || 0,
        performanceInsight: multiAgentAnalysis.performance?.performanceInsight || "N/A"
      },
      rebalancing: {
        rebalancingAdvice: multiAgentAnalysis.rebalancing?.rebalancingAdvice || "No rebalancing needed"
      },
      portfolio: {
        healthScore: multiAgentAnalysis.portfolio?.healthScore || 0,
        dominantSector: multiAgentAnalysis.portfolio?.dominantSector || "Unknown"
      },
      analysis: {
        stockFundamentals: multiAgentAnalysis.analysis?.stockFundamentals || "No research analysis available"
      }
    });
  } catch (error) {
    console.error("Analysis Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to analyze stock"
    });
  }
});



export default app;