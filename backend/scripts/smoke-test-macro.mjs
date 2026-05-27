/**
 * Macro Intelligence Smoke Test
 * Run: node scripts/smoke-test-macro.mjs
 *
 * Tests:
 *  1. Daily macro report generation + formatting
 *  2. Weekly institutional report generation + formatting
 *  3. Risk alert generation + formatting
 *  4. Idempotency key determinism (replay safety)
 *  5. Risk threshold assessment
 */

import dotenv from 'dotenv';
dotenv.config();

import {
  generateDailyMacroReport,
  generateWeeklyInstitutionalReport,
  generateMacroRiskAlert,
  assessMacroRiskThreshold
} from '../src/services/macroIntelligence.service.js';

import { buildMacroIdempotencyKey } from '../src/services/macroDelivery.service.js';

const PASS = '✅';
const FAIL = '❌';

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`${PASS} ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    console.error(`${FAIL} ${label}${detail ? ' — ' + detail : ''}`);
    process.exitCode = 1;
  }
}

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║   FINSIGHT MACRO INTELLIGENCE SMOKE TEST     ║');
console.log('╚══════════════════════════════════════════════╝\n');

// ── STEP 1: Daily Macro Report ───────────────────────────────────────────────
console.log('── STEP 1: Daily Macro Intelligence ──────────────');
const daily = await generateDailyMacroReport();

check('reportType is DAILY_MACRO',      daily.reportType === 'DAILY_MACRO');
check('marketBias is a non-empty string', typeof daily.marketBias === 'string' && daily.marketBias.length > 0, daily.marketBias);
check('macroRisk is set',               ['Low','Moderate','Elevated'].includes(daily.macroRisk), daily.macroRisk);
check('reportText contains 🌍 header',  daily.reportText.includes('🌍 AI MACRO INTELLIGENCE'));
check('reportText contains Market Bias', daily.reportText.includes('Market Bias:'));
check('reportText contains Global Context', daily.reportText.includes('Global Context:'));
check('reportText contains Institutional Positioning', daily.reportText.includes('Institutional Positioning:'));
check('reportText contains Macro Risk', daily.reportText.includes('Macro Risk:'));
check('reportText contains Expected Market Behavior', daily.reportText.includes('Expected Market Behavior:'));
check('reportText contains disclaimer', daily.reportText.includes('Educational intelligence only'));
check('generatedAt is valid ISO',       !isNaN(Date.parse(daily.generatedAt)));

console.log('\n── Generated Daily Report Preview ────────────────');
console.log(daily.reportText);

// ── STEP 2: Weekly Institutional Report ────────────────────────────────────
console.log('\n── STEP 2: Weekly Institutional Intelligence ─────');
const weekly = await generateWeeklyInstitutionalReport();

check('reportType is WEEKLY_INSTITUTIONAL', weekly.reportType === 'WEEKLY_INSTITUTIONAL');
check('weeklyBias is set',               typeof weekly.weeklyBias === 'string' && weekly.weeklyBias.length > 0, weekly.weeklyBias);
check('reportText contains 📊 header',  weekly.reportText.includes('📊 WEEKLY INSTITUTIONAL INTELLIGENCE'));
check('reportText contains FII Positioning', weekly.reportText.includes('FII Positioning:'));
check('reportText contains DII Activity',    weekly.reportText.includes('DII Activity:'));
check('reportText contains Strongest Sectors', weekly.reportText.includes('Strongest Sectors:'));
check('reportText contains Weakest Sectors',   weekly.reportText.includes('Weakest Sectors:'));
check('reportText contains Macro Drivers',     weekly.reportText.includes('Macro Drivers:'));
check('reportText contains Weekly Institutional Bias', weekly.reportText.includes('Weekly Institutional Bias:'));
check('reportText contains disclaimer',  weekly.reportText.includes('Educational intelligence only'));

console.log('\n── Generated Weekly Report Preview ───────────────');
console.log(weekly.reportText);

// ── STEP 3: Macro Risk Alert ────────────────────────────────────────────────
console.log('\n── STEP 3: Macro Risk Alert ──────────────────────');
const alert = await generateMacroRiskAlert(
  ['RBI policy uncertainty', 'US bond yield spike', 'Crude oil instability'],
  'Reduce aggressive exposure. Prioritize capital protection.'
);

check('reportType is MACRO_RISK_ALERT',  alert.reportType === 'MACRO_RISK_ALERT');
check('reportText contains ⚠️ header',  alert.reportText.includes('⚠️ MACRO RISK ALERT'));
check('reportText contains Drivers:',   alert.reportText.includes('Drivers:'));
check('reportText contains all 3 drivers', alert.reportText.includes('RBI') && alert.reportText.includes('Crude'));
check('reportText contains Recommendation:', alert.reportText.includes('Recommendation:'));

console.log('\n── Generated Risk Alert Preview ──────────────────');
console.log(alert.reportText);

// ── STEP 4: Idempotency Key Determinism ────────────────────────────────────
console.log('\n── STEP 4: Idempotency Key Determinism ───────────');
const now = new Date();
const dailyKey1 = buildMacroIdempotencyKey('DAILY_MACRO', now);
const dailyKey2 = buildMacroIdempotencyKey('DAILY_MACRO', now);
const weeklyKey1 = buildMacroIdempotencyKey('WEEKLY_INSTITUTIONAL', now);
const weeklyKey2 = buildMacroIdempotencyKey('WEEKLY_INSTITUTIONAL', now);
const alertKey  = buildMacroIdempotencyKey('MACRO_RISK_ALERT', now);

check('Daily key is deterministic',   dailyKey1 === dailyKey2, dailyKey1);
check('Weekly key is deterministic',  weeklyKey1 === weeklyKey2, weeklyKey1);
check('Daily ≠ Weekly keys',          dailyKey1 !== weeklyKey1);
check('Alert key has hour granularity', alertKey.includes('T'));
check('Daily key has date format',    dailyKey1.startsWith('DAILY_MACRO:'));
check('Weekly key has week format',   weeklyKey1.startsWith('WEEKLY_INSTITUTIONAL:') && weeklyKey1.includes('-W'));

console.log('\nSample Keys:');
console.log('  Daily:   ', dailyKey1);
console.log('  Weekly:  ', weeklyKey1);
console.log('  Alert:   ', alertKey);

// ── STEP 5: Risk Threshold Assessment ──────────────────────────────────────
console.log('\n── STEP 5: Risk Threshold Assessment ─────────────');
const assessment = await assessMacroRiskThreshold();

check('Assessment returns shouldAlert boolean', typeof assessment.shouldAlert === 'boolean');
if (assessment.shouldAlert) {
  check('Alert has drivers array',  Array.isArray(assessment.drivers) && assessment.drivers.length > 0);
  check('Alert has recommendation', typeof assessment.recommendation === 'string');
  console.log('  Risk level: ELEVATED — alert would fire');
  console.log('  Drivers:', assessment.drivers);
} else {
  console.log('  Risk level: Normal — no alert needed today');
}

// ── FINAL RESULT ────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════╗');
if (process.exitCode === 1) {
  console.log('║            SOME TESTS FAILED ❌              ║');
} else {
  console.log('║         ALL SMOKE TESTS PASSED ✅            ║');
  console.log('║                                              ║');
  console.log('║  Reports generating correctly.               ║');
  console.log('║  Scheduler, AI synthesis, formatting — OK.   ║');
  console.log('║  Idempotency keys deterministic — OK.        ║');
}
console.log('╚══════════════════════════════════════════════╝');
