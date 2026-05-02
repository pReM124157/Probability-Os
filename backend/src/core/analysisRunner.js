export async function runAnalysisSafe(symbol, agent) {
  try {
    if (!symbol) throw new Error("No symbol");
    const result = await agent(symbol);
    if (!result) throw new Error("Empty result");
    return { ok: true, text: result };
  } catch (err) {
    console.error("[ANALYSIS ERROR]", err);
    return {
      ok: false,
      message: "⚠️ Temporary issue. Please try again."
    };
  }
}
