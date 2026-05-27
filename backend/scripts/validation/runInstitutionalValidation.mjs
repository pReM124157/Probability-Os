import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = path.basename(process.cwd()) === "backend" ? process.cwd() : path.resolve(process.cwd(), "backend");
const OUT_DIR = path.join(ROOT, "artifacts", "validation");
const RUN_TS = new Date().toISOString();

function run(cmd, { allowFail = false } = {}) {
  try {
    const out = execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8" });
    return { ok: true, cmd, out };
  } catch (err) {
    const out = `${err?.stdout || ""}\n${err?.stderr || ""}`.trim();
    if (allowFail) return { ok: false, cmd, out };
    return { ok: false, cmd, out };
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function statusFromChecks(checks) {
  if (checks.some((c) => c.status === "FAIL")) return "FAIL";
  if (checks.some((c) => c.status === "MANUAL_REQUIRED")) return "MANUAL_REQUIRED";
  return "PASS";
}

function c(name, status, evidence = "") {
  return { name, status, evidence };
}

const phaseReports = [];

// Phase 1
const p1Checks = [];
const invRun = run("node scripts/validation/generatePhase1Inventory.mjs", { allowFail: true });
p1Checks.push(c("inventory_generation", invRun.ok ? "PASS" : "FAIL", invRun.cmd));
let inv = null;
if (invRun.ok) {
  inv = readJson(path.join(OUT_DIR, "phase1_inventory.json"));
  p1Checks.push(c("routes_documented", inv.routes?.length > 0 ? "PASS" : "FAIL", `routes=${inv.routes?.length || 0}`));
  p1Checks.push(c("schedulers_documented", inv.schedulers?.length > 0 ? "PASS" : "FAIL", `schedulers=${inv.schedulers?.length || 0}`));
  p1Checks.push(c("telegram_actions_documented", inv.telegramHandlers?.length > 0 ? "PASS" : "FAIL", `telegramHandlers=${inv.telegramHandlers?.length || 0}`));
  p1Checks.push(c("db_tables_documented", inv.dbTablesReferenced?.length > 0 ? "PASS" : "FAIL", `dbTables=${inv.dbTablesReferenced?.length || 0}`));
  p1Checks.push(c("ai_agents_documented", inv.agents?.length > 0 ? "PASS" : "FAIL", `agents=${inv.agents?.length || 0}`));
  p1Checks.push(c("env_keys_documented", inv.envKeysReferenced?.length > 0 ? "PASS" : "FAIL", `envKeys=${inv.envKeysReferenced?.length || 0}`));
  p1Checks.push(c("dependency_graph_extracted", inv.dependencyEdges?.length > 0 ? "PASS" : "FAIL", `edges=${inv.dependencyEdges?.length || 0}`));
}
phaseReports.push({ phase: 1, title: "Static Feature Inventory", checks: p1Checks, status: statusFromChecks(p1Checks) });

// Phase 2
const p2Checks = [];
const appFile = fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8");
p2Checks.push(c("health_endpoint_present", appFile.includes('app.get("/"') ? "PASS" : "FAIL", "src/app.js"));
p2Checks.push(c("request_tracing_present", appFile.includes("x-trace-id") ? "PASS" : "FAIL", "src/app.js"));
p2Checks.push(c("rate_limit_present", appFile.includes("RATE_LIMIT_PER_MIN") ? "PASS" : "FAIL", "src/app.js"));
p2Checks.push(c("config_loader_env_usage", fs.existsSync(path.join(ROOT, "src", "services", "supabase.service.js")) ? "PASS" : "FAIL", "src/services/supabase.service.js"));
p2Checks.push(c("structured_logging_hooks", fs.existsSync(path.join(ROOT, "src", "services", "telemetry.service.js")) ? "PASS" : "FAIL", "src/services/telemetry.service.js"));
phaseReports.push({ phase: 2, title: "Simplest Features Validation", checks: p2Checks, status: statusFromChecks(p2Checks) });

// Phase 3
const p3Checks = [];
const mig = run("npx vitest run tests/integration/migrations.integration.test.js --reporter=verbose", { allowFail: true });
p3Checks.push(c("schema_integrity_tests", mig.ok ? "PASS" : "FAIL", "migrations.integration.test.js"));
const webhook = run("npx vitest run tests/integration/webhook-signature.integration.test.js --reporter=verbose", { allowFail: true });
p3Checks.push(c("subscription_idempotency_webhook", webhook.ok ? "PASS" : "FAIL", "webhook-signature.integration.test.js"));
phaseReports.push({ phase: 3, title: "Database Validation", checks: p3Checks, status: statusFromChecks(p3Checks) });

// Phase 4
const p4Checks = [];
const tg1 = run("npx vitest run tests/integration/recommendation-delivery.integration.test.js --reporter=verbose", { allowFail: true });
p4Checks.push(c("telegram_delivery_integration", tg1.ok ? "PASS" : "FAIL", "recommendation-delivery.integration.test.js"));
const tg2 = run("npx vitest run tests/integration/pipeline.integration.test.js --reporter=verbose", { allowFail: true });
p4Checks.push(c("telegram_lifecycle_notifications", tg2.ok ? "PASS" : "FAIL", "pipeline.integration.test.js"));
phaseReports.push({ phase: 4, title: "Telegram System Validation", checks: p4Checks, status: statusFromChecks(p4Checks) });

// Phase 5
const p5Checks = [];
const pr = run("npx vitest run tests/integration/provider-resilience.integration.test.js tests/integration/provider-normalization.integration.test.js tests/integration/provider-failover.integration.test.js --reporter=verbose", { allowFail: true });
p5Checks.push(c("provider_integrity_and_failover", pr.ok ? "PASS" : "FAIL", "provider-*.integration.test.js"));
phaseReports.push({ phase: 5, title: "Market Data Validation", checks: p5Checks, status: statusFromChecks(p5Checks) });

// Phase 6
const p6Checks = [];
const sf = run("npx vitest run tests/integration/scanner-formatter.integration.test.js tests/integration/elitescanner.guardrail.test.js --reporter=verbose", { allowFail: true });
p6Checks.push(c("signal_guardrails_and_formatter", sf.ok ? "PASS" : "FAIL", "scanner-formatter + elitescanner guardrail"));
phaseReports.push({ phase: 6, title: "Signal Engine Validation", checks: p6Checks, status: statusFromChecks(p6Checks) });

// Phase 7
const p7Checks = [];
const ai1 = run("npx vitest run tests/integration/institutional-output.integration.test.js tests/integration/recommendation-audit-guardrail.test.js tests/integration/presentation-abstraction.integration.test.js --reporter=verbose", { allowFail: true });
p7Checks.push(c("ai_output_guardrails", ai1.ok ? "PASS" : "FAIL", "institutional-output + audit guardrail"));
phaseReports.push({ phase: 7, title: "AI Decision Engine Validation", checks: p7Checks, status: statusFromChecks(p7Checks) });

// Phase 8
const p8Checks = [];
const scn = run("npx vitest run tests/integration/scanner-formatter.integration.test.js tests/integration/pipeline.integration.test.js --reporter=verbose", { allowFail: true });
p8Checks.push(c("universe_scan_pipeline", scn.ok ? "PASS" : "FAIL", "scanner + pipeline integration"));
phaseReports.push({ phase: 8, title: "Scanner Engine Validation", checks: p8Checks, status: statusFromChecks(p8Checks) });

// Phase 9
const p9Checks = [];
const alt = run("npx vitest run tests/integration/recommendation-delivery.integration.test.js tests/integration/webhook-signature.integration.test.js --reporter=verbose", { allowFail: true });
p9Checks.push(c("alert_delivery_dedup", alt.ok ? "PASS" : "FAIL", "delivery + webhook idempotency"));
phaseReports.push({ phase: 9, title: "Alert Engine Validation", checks: p9Checks, status: statusFromChecks(p9Checks) });

// Phase 10
const p10Checks = [];
const perfLite = run("npx vitest run tests/integration/pipeline-regression.integration.test.js tests/integration/scheduler-lease.integration.test.js --reporter=verbose", { allowFail: true });
p10Checks.push(c("stability_regression_suite", perfLite.ok ? "PASS" : "FAIL", "pipeline-regression + scheduler-lease"));
p10Checks.push(c("long_duration_6h_24h_72h_7d", "MANUAL_REQUIRED", "Requires soak environment and profiler collection"));
phaseReports.push({ phase: 10, title: "Performance Validation", checks: p10Checks, status: statusFromChecks(p10Checks) });

// Phase 11
const p11Checks = [];
const fin = run("npx vitest run tests/integration/fundamental-normalization.integration.test.js tests/integration/backtesting.routes.js --reporter=verbose", { allowFail: true });
if (!fin.ok && String(fin.out).includes("No test files found")) {
  const fin2 = run("npx vitest run tests/integration/fundamental-normalization.integration.test.js --reporter=verbose", { allowFail: true });
  p11Checks.push(c("historical_financial_correctness_partial", fin2.ok ? "PASS" : "FAIL", "fundamental-normalization.integration.test.js"));
  p11Checks.push(c("historical_replay_metrics", "MANUAL_REQUIRED", "Dedicated replay harness not present yet"));
} else {
  p11Checks.push(c("financial_correctness_suite", fin.ok ? "PASS" : "FAIL", "fundamental normalization + backtesting route tests"));
}
phaseReports.push({ phase: 11, title: "Financial Correctness Validation", checks: p11Checks, status: statusFromChecks(p11Checks) });

// Phase 12
const p12Checks = [];
const adv = run("npx vitest run tests/integration/webhook-signature.integration.test.js tests/integration/provider-resilience.integration.test.js tests/integration/recommendation-audit-guardrail.test.js --reporter=verbose", { allowFail: true });
p12Checks.push(c("malicious_input_and_outage_resilience", adv.ok ? "PASS" : "FAIL", "webhook tamper + provider outage + audit guardrail"));
p12Checks.push(c("chaos_db_redis_network_partition_clock_drift", "MANUAL_REQUIRED", "Requires dedicated chaos harness and infra controls"));
phaseReports.push({ phase: 12, title: "Adversarial System Testing", checks: p12Checks, status: statusFromChecks(p12Checks) });

// Phase 13
const p13Checks = [];
p13Checks.push(c("institutional_benchmark_live_compare", "MANUAL_REQUIRED", "Requires live TradingView/Zerodha/pro scanner side-by-side runbook"));
phaseReports.push({ phase: 13, title: "Production-Grade Institutional Validation", checks: p13Checks, status: statusFromChecks(p13Checks) });

// Phase 14
const p14Checks = [];
const allNoFail = phaseReports.slice(0, 13).every((p) => p.status === "PASS");
if (allNoFail) {
  p14Checks.push(c("deployment_gate", "PASS", "All prior phases PASS"));
} else {
  p14Checks.push(c("deployment_gate", "FAIL", "One or more prior phases are FAIL/MANUAL_REQUIRED"));
}
phaseReports.push({ phase: 14, title: "Final Deployment Gate", checks: p14Checks, status: statusFromChecks(p14Checks) });

const overall = phaseReports.every((p) => p.status === "PASS") ? "PASS" : "BLOCKED";
const report = {
  generatedAt: RUN_TS,
  overallStatus: overall,
  phases: phaseReports
};

write(path.join(OUT_DIR, "institutional_validation_report.json"), JSON.stringify(report, null, 2));

const lines = [];
lines.push("# Institutional Validation Report");
lines.push("");
lines.push(`Generated: ${RUN_TS}`);
lines.push(`Overall: ${overall}`);
lines.push("");
for (const p of phaseReports) {
  lines.push(`## Phase ${p.phase} — ${p.title} — ${p.status}`);
  for (const chk of p.checks) {
    lines.push(`- [${chk.status}] ${chk.name}${chk.evidence ? ` (${chk.evidence})` : ""}`);
  }
  lines.push("");
}
write(path.join(OUT_DIR, "institutional_validation_report.md"), `${lines.join("\n")}\n`);

console.log(JSON.stringify({ overall, phaseStatuses: phaseReports.map((p) => ({ phase: p.phase, status: p.status })) }, null, 2));
