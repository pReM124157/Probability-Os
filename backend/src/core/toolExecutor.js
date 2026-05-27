import { getLiveMarketData } from "../services/marketData.service.js";
import { buildTickerNewsIntel } from "../scanner/newsEngine.js";
import supabase from "../services/supabase.service.js";
import { scannerAgent } from "../agents/scanner.agent.js";

function normalizeTicker(entity = "") {
  const clean = String(entity || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!clean) return "";
  if (clean.includes(":")) return clean;
  if (clean.endsWith(".NS") || clean.endsWith(".BO")) return clean;
  return `${clean}.NS`;
}

export async function executeTools(tools, intent, userId) {
  const results = {};
  const entities = Array.isArray(intent?.entities) ? intent.entities : [];
  const primaryTickerRaw = entities[0] || "";
  const primaryTicker = normalizeTicker(primaryTickerRaw);

  for (const tool of tools) {
    try {
      switch (tool) {
        case "marketData":
        case "technicals":
        case "historical":
          if (primaryTicker) {
            const md = await getLiveMarketData(primaryTicker);
            results.marketData = md;
            if (tool === "technicals") {
              results.technicals = {
                trend: md?.trend || "N/A",
                rsi: md?.rsi ?? "N/A",
                volumeRatio: md?.volumeRatio ?? "N/A"
              };
            }
          }
          break;

        case "news":
          if (primaryTickerRaw) {
            results.news = await buildTickerNewsIntel({
              ticker: String(primaryTickerRaw).toUpperCase(),
              companyName: String(primaryTickerRaw).toUpperCase()
            });
          }
          break;

        case "portfolio":
          if (userId) {
            const { data } = await supabase
              .from("holdings")
              .select("*")
              .eq("user_id", userId);
            results.portfolio = data || [];
          }
          break;

        case "scanner":
          results.scanner = await scannerAgent();
          break;

        default:
          break;
      }
    } catch (e) {
      results[tool] = { error: e?.message || "tool execution failed" };
    }
  }

  return results;
}
