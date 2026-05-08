import { runMorningScannerPipeline } from "./scanner.agent.js";

export async function sectorScannerAgent() {
  try {
    console.log("📊 Running Sector Rotation Scanner...");
    const packet = await runMorningScannerPipeline(5);
    return (packet?.report?.sectorRotation || []).map((sector) => ({
      sector: sector.sector,
      avgScore: sector.avgConviction,
      sectorScore: sector.sectorScore,
      bias: sector.bias,
      leaders: sector.leaders
    }));

  } catch (error) {
    console.log("Sector Scanner Error:", error.message);
    return [];
  }
}
