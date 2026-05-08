import { runMorningScannerPipeline } from "../agents/scanner.agent.js";

export function getMorningScheduleConfig() {
  return {
    timezone: "Asia/Kolkata",
    runAt: "07:30",
    cron: "0 2 * * *",
    steps: [
      "fetch_global_and_local_market_state",
      "compute_sector_rotation",
      "rank_conviction_opportunities",
      "build_institutional_briefing",
      "publish_telegram_briefing",
      "refresh_cache_and_dashboard"
    ]
  };
}

export function buildMorningAutomationPayload(report) {
  return {
    schedule: getMorningScheduleConfig(),
    report
  };
}

export async function runMorningBriefing() {
  const packet = await runMorningScannerPipeline();
  return buildMorningAutomationPayload(packet);
}
