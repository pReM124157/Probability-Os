// backend/src/tools/registry.js

// SAFE TOOL REGISTRY
// Only wraps EXISTING services.
// No orchestration changes.
// No LLM changes yet.

import {
  getLiveMarketData,
  getCompanyOverview
} from '../services/marketData.service.js';

// Simple delay helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const TOOLS = {

  // ✅ Live stock price
  getStockPrice: async ({ ticker }) => {
    try {
      const data = await getLiveMarketData(ticker);

      return {
        ticker,
        price: data?.price ?? null,
        change: data?.change ?? null,
        changePercent: data?.changePercent ?? null,
        source: data?.source || 'yahoo'
      };

    } catch (err) {
      return {
        error: `Price unavailable for ${ticker}`
      };
    }
  },

  // ✅ Fundamentals
  getFinancials: async ({ ticker }) => {
    try {
      const data = await getCompanyOverview(ticker);

      return {
        ticker,
        peRatio: data?.PERatio ?? null,
        marketCap: data?.MarketCapitalization ?? null,
        sector: data?.Sector ?? null,
        roe: data?.ReturnOnEquityTTM ?? null,
        profitMargin: data?.ProfitMargin ?? null,
        debtToEquity: data?.DebtToEquity ?? null,
        revenueGrowth: data?.QuarterlyRevenueGrowthYOY ?? null,
        earningsGrowth: data?.QuarterlyEarningsGrowthYOY ?? null,
        source: data?.source || 'yahoo'
      };

    } catch (err) {
      return {
        error: `Fundamentals unavailable for ${ticker}`
      };
    }
  },

  // ✅ Exact share calculation
  calculateShares: async ({ ticker, allocationAmount }) => {
    try {
      const data = await getLiveMarketData(ticker);

      const livePrice = data?.price;

      if (!livePrice || livePrice <= 0) {
        return {
          error: `Live price unavailable for ${ticker}`
        };
      }

      const shares = Math.floor(allocationAmount / livePrice);
      const actualCost = shares * livePrice;
      const remainder = allocationAmount - actualCost;

      return {
        ticker,
        live_price: livePrice,
        allocation: allocationAmount,
        shares_possible: shares,
        actual_cost: actualCost,
        undeployed_cash: remainder,
        sufficient: shares >= 1,
        source: 'LIVE_CALCULATION'
      };

    } catch (err) {
      return {
        error: `Cannot calculate shares for ${ticker}`
      };
    }
  },

  // ✅ Multi-stock portfolio builder
  buildPortfolio: async ({ totalAmount, allocations }) => {
    try {
      const results = [];

      for (const alloc of allocations) {

        const rupeeAmount =
          (alloc.percentage / 100) * totalAmount;

        const data = await getLiveMarketData(alloc.ticker);

        const livePrice = data?.price;

        if (!livePrice || livePrice <= 0) {
          results.push({
            ticker: alloc.ticker,
            error: 'Price unavailable',
            viable: false
          });

          continue;
        }

        const shares =
          Math.floor(rupeeAmount / livePrice);

        const actualCost =
          shares * livePrice;

        results.push({
          ticker: alloc.ticker,
          allocation_percent: alloc.percentage,
          allocated_amount: rupeeAmount,
          live_price: livePrice,
          shares,
          actual_cost: actualCost,
          undeployed_cash:
            rupeeAmount - actualCost,
          viable: shares >= 1
        });

        // ✅ Prevent API bursts
        await sleep(300);
      }

      const totalDeployed =
        results.reduce(
          (sum, r) => sum + (r.actual_cost || 0),
          0
        );

      return {
        total_budget: totalAmount,
        total_deployed: totalDeployed,
        total_undeployed:
          totalAmount - totalDeployed,
        positions: results,
        source: 'LIVE_PRICES'
      };

    } catch (err) {
      return {
        error: 'Portfolio build failed'
      };
    }
  }
};

// ONLY ENTRY POINT
export async function executeTool(toolName, params = {}) {

  if (!TOOLS[toolName]) {
    return {
      error: `Unknown tool: ${toolName}`,
      availableTools: Object.keys(TOOLS)
    };
  }

  console.log(`🔧 Tool call → ${toolName}`, params);

  try {
    const result =
      await TOOLS[toolName](params);

    console.log(`✅ Tool success → ${toolName}`);

    return result;

  } catch (err) {

    console.error(
      `❌ Tool failure → ${toolName}`,
      err.message
    );

    return {
      error: err.message
    };
  }
}