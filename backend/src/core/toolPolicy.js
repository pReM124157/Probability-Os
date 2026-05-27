export function resolveTools(intent) {
  const tools = [];

  if (intent?.needsLiveData) tools.push("marketData");
  if (intent?.needsTechnicals) tools.push("technicals");
  if (intent?.needsNews) tools.push("news");
  if (intent?.needsPortfolio) tools.push("portfolio");
  if (intent?.needsHistorical) tools.push("historical");

  switch (intent?.intent) {
    case "scanner_request":
      return ["scanner"];
    case "education":
      return [];
    case "portfolio_query":
      return ["portfolio", "marketData"];
    case "news_query":
      return ["news"];
    default:
      return tools.length > 0 ? [...new Set(tools)] : ["marketData"];
  }
}
