import { classifyUserIntent } from "../src/core/intentRouter.js";

const testCases = [
  {
    name: "Casual chat",
    message: "hi bro",
    expect: {
      intent: "CASUAL_CHAT",
      requiresFinancialData: false
    }
  },
  {
    name: "Stock analysis buy question",
    message: "Should I buy TCS?",
    expect: {
      intent: "STOCK_ANALYSIS",
      candidateSymbol: "TCS",
      shouldCallMasterAgent: true
    }
  },
  {
    name: "Stock analysis company alias",
    message: "Analyze Reliance",
    expect: {
      intent: "STOCK_ANALYSIS",
      candidateSymbol: "RELIANCE"
    }
  },
  {
    name: "Portfolio optimization with candidate",
    message: "I have RELIANCE and INFY, should I buy TCS?",
    expect: {
      intent: "PORTFOLIO_OPTIMIZATION",
      candidateSymbol: "TCS",
      portfolioSymbols: ["RELIANCE", "INFY"],
      shouldCallMasterAgent: true,
      shouldCallPortfolioOptimizer: true
    }
  },
  {
    name: "Portfolio optimization with portfolio phrase",
    message: "My portfolio has HDFCBANK and ICICIBANK. Should I add TCS?",
    expect: {
      intent: "PORTFOLIO_OPTIMIZATION",
      candidateSymbol: "TCS",
      portfolioSymbols: ["HDFCBANK", "ICICIBANK"]
    }
  },
  {
    name: "Portfolio review",
    message: "How is my portfolio?",
    expect: {
      intent: "PORTFOLIO_REVIEW"
    }
  },
  {
    name: "Market overview",
    message: "Is Nifty bullish today?",
    expect: {
      intent: "MARKET_OVERVIEW"
    }
  },
  {
    name: "Macro query",
    message: "What is macro risk today?",
    expect: {
      intent: "MACRO_QUERY"
    }
  },
  {
    name: "Performance query",
    message: "What is our win rate?",
    expect: {
      intent: "PERFORMANCE_QUERY"
    }
  },
  {
    name: "Subscription issue",
    message: "payment failed",
    expect: {
      intent: "SUBSCRIPTION_OR_ACCOUNT"
    }
  },
  {
    name: "Holding sell question",
    message: "I have TCS should I sell it?",
    expect: {
      intent: "PORTFOLIO_OPTIMIZATION",
      candidateSymbol: "TCS",
      requiresFinancialData: true
    }
  },
  {
    name: "Regression - candidate must not become first holding",
    message: "I have RELIANCE and INFY should I buy TCS",
    expect: {
      intent: "PORTFOLIO_OPTIMIZATION",
      candidateSymbol: "TCS",
      portfolioSymbols: ["RELIANCE", "INFY"]
    }
  }
];

function arrayEquals(actual = [], expected = []) {
  if (actual.length !== expected.length) return false;
  return expected.every((item, index) => actual[index] === item);
}

let failed = 0;

for (const testCase of testCases) {
  const result = classifyUserIntent(testCase.message);
  const checks = [];

  if (testCase.expect.intent) {
    checks.push({
      label: "intent",
      pass: result.intent === testCase.expect.intent,
      actual: result.intent,
      expected: testCase.expect.intent
    });
  }

  if ("requiresFinancialData" in testCase.expect) {
    checks.push({
      label: "requiresFinancialData",
      pass: result.requiresFinancialData === testCase.expect.requiresFinancialData,
      actual: result.requiresFinancialData,
      expected: testCase.expect.requiresFinancialData
    });
  }

  if (testCase.expect.candidateSymbol) {
    checks.push({
      label: "candidateSymbol",
      pass: result.candidateSymbol === testCase.expect.candidateSymbol,
      actual: result.candidateSymbol,
      expected: testCase.expect.candidateSymbol
    });
  }

  if (testCase.expect.portfolioSymbols) {
    checks.push({
      label: "portfolioSymbols",
      pass: arrayEquals(result.portfolioSymbols, testCase.expect.portfolioSymbols),
      actual: result.portfolioSymbols,
      expected: testCase.expect.portfolioSymbols
    });
  }

  if ("shouldCallMasterAgent" in testCase.expect) {
    checks.push({
      label: "shouldCallMasterAgent",
      pass: result.route.shouldCallMasterAgent === testCase.expect.shouldCallMasterAgent,
      actual: result.route.shouldCallMasterAgent,
      expected: testCase.expect.shouldCallMasterAgent
    });
  }

  if ("shouldCallPortfolioOptimizer" in testCase.expect) {
    checks.push({
      label: "shouldCallPortfolioOptimizer",
      pass: result.route.shouldCallPortfolioOptimizer === testCase.expect.shouldCallPortfolioOptimizer,
      actual: result.route.shouldCallPortfolioOptimizer,
      expected: testCase.expect.shouldCallPortfolioOptimizer
    });
  }

  const pass = checks.every((check) => check.pass);
  if (!pass) failed += 1;

  console.log(`\n=== ${testCase.name} ===`);
  console.log(`Message: ${testCase.message}`);
  console.log(`Status: ${pass ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify(result, null, 2));

  for (const check of checks.filter((item) => !item.pass)) {
    console.log(`Mismatch: ${check.label} expected=${JSON.stringify(check.expected)} actual=${JSON.stringify(check.actual)}`);
  }
}

console.log(`\nSummary: ${testCases.length - failed}/${testCases.length} passed`);

if (failed > 0) {
  process.exitCode = 1;
}
