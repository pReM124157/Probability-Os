import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();

async function test() {
  try {
    const symbols = ["TCS.NS", "M&M.NS"];
    for (const symbol of symbols) {
      console.log("\nFetching quote for:", symbol);
      const result = await yahooFinance.quote(symbol);
      console.log("Result keys:", Object.keys(result));
      console.log("regularMarketPrice:", result.regularMarketPrice);
      console.log("currentPrice:", result.currentPrice);
      console.log("previousClose:", result.regularMarketPreviousClose);
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

test();
