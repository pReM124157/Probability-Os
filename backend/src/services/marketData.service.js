import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

const indianStocks = [
  "TCS",
  "INFY",
  "RELIANCE",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "ITC",
  "LT",
  "ASIANPAINT",
  "SUNPHARMA",
  "WIPRO",
  "HCLTECH",
  "TECHM",
  "TATAMOTORS",
  "BAJFINANCE"
];

export async function getCompanyOverview(symbol) {
  try {
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");

    const fetchSymbol = upperSymbol.includes(".")
      ? upperSymbol
      : `${upperSymbol}.NS`;

    console.log("FETCH SYMBOL (Overview):", fetchSymbol);

    const result = await yahooFinance.quote(fetchSymbol);

    console.log("RAW YAHOO RESULT:", result);

    const companyOverview = {
      Symbol: fetchSymbol,
      Name:
        result?.longName ||
        result?.shortName ||
        fetchSymbol,

      MarketCapitalization: result?.marketCap ?? null,
      PERatio: result?.trailingPE ?? null,
      ProfitMargin: result?.profitMargins ?? null,
      ReturnOnEquityTTM: result?.returnOnEquity ?? null,
      DebtToEquityRatio: result?.debtToEquity ?? null,
      QuarterlyEarningsGrowthYOY: result?.earningsQuarterlyGrowth ?? null,
      QuarterlyRevenueGrowthYOY: result?.revenueQuarterlyGrowth ?? null,
      PriceToBookRatio: result?.priceToBook ?? null,
      Beta: result?.beta ?? null,
      Sector: result?.sector ?? null
    };

    console.log(
      "COMPANY OVERVIEW:",
      companyOverview
    );

    return companyOverview;

  } catch (error) {
    console.error("Yahoo Finance Error:", error.message);
    
    // Return at least the symbol to prevent downstream "UNKNOWN" errors
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
    return {
      Symbol: upperSymbol.includes(".") ? upperSymbol : `${upperSymbol}.NS`
    };
  }
}

export async function getLiveMarketData(symbol) {
  try {
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
    
    const fetchSymbol = upperSymbol.includes(".")
      ? upperSymbol
      : `${upperSymbol}.NS`;

    console.log("FETCH SYMBOL (Live):", fetchSymbol);

    const result = await yahooFinance.quote(fetchSymbol);
    console.log("RAW YAHOO RESULT (Live):", JSON.stringify(result).substring(0, 500));
    
    const currentPrice = 
      result?.regularMarketPrice ||
      result?.currentPrice ||
      result?.regularMarketPreviousClose ||
      result?.previousClose ||
      0;

    console.log("EXTRACTED PRICE:", currentPrice);
    
    const liveMarketData = {
      symbol: fetchSymbol,
      currentPrice: currentPrice,
      previousClose:
        result?.regularMarketPreviousClose ||
        result?.previousClose ||
        0,
      open: result?.regularMarketOpen || 0,
      dayHigh: result?.regularMarketDayHigh || 0,
      dayLow: result?.regularMarketDayLow || 0,
      fiftyTwoWeekHigh: result?.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: result?.fiftyTwoWeekLow || 0,
      volume: result?.regularMarketVolume || 0,
      averageVolume: result?.averageDailyVolume3Month || 0,
      marketCap: result?.marketCap || 0,
      currency: result?.currency || "INR"
    };
    console.log(
      "FINAL LIVE MARKET DATA OBJECT:",
      liveMarketData
    );
    return liveMarketData;
  } catch (error) {
    console.error(
      "Live Market Data Error:",
      error.message
    );
    return {
      currentPrice: 0
    };
  }
}