const SECTOR_MAP = {
  IT: ["TCS", "INFY", "WIPRO", "HCLTECH"],
  BANKING: ["HDFCBANK", "ICICIBANK", "AXISBANK", "SBIN"],
  ENERGY: ["RELIANCE", "ONGC", "BPCL", "IOC"],
  PHARMA: ["SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB"],
  FMCG: ["ITC", "HINDUNILVR", "NESTLEIND", "BRITANNIA"]
};

export async function sectorScannerAgent() {
  try {
    console.log("📊 Running Sector Rotation Scanner...");

    const sectorScores = [];

    for (const [sector, stocks] of Object.entries(SECTOR_MAP)) {
      let totalScore = 0;
      let validStocks = 0;

      for (const stock of stocks) {
        try {
          // simple scoring proxy for now
          // later can use masterAgent + scanner depth
          totalScore += 7;
          validStocks += 1;
        } catch (error) {
          console.log(`Sector scan failed for ${stock}`);
        }
      }

      const avgScore =
        validStocks > 0 ? (totalScore / validStocks).toFixed(1) : 0;

      sectorScores.push({
        sector,
        avgScore
      });
    }

    sectorScores.sort(
      (a, b) => Number(b.avgScore) - Number(a.avgScore)
    );

    return sectorScores;

  } catch (error) {
    console.log("Sector Scanner Error:", error.message);
    return [];
  }
}