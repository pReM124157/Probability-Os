/**
 * LIVE TRIAL: Full Macro Report → Telegram Production Flow
 *
 * Runs the complete pipeline:
 *   macro data collected → AI generates intelligence →
 *   formatted report → Telegram delivery → persistence (if table exists)
 *
 * Usage: node scripts/live-trial-macro.mjs [daily|weekly|risk-alert]
 */

import dotenv from 'dotenv';
dotenv.config();

const mode = process.argv[2] || 'daily';

import {
  generateDailyMacroReport,
  generateWeeklyInstitutionalReport,
  generateMacroRiskAlert
} from '../src/services/macroIntelligence.service.js';
import { deliverMacroReport, buildMacroIdempotencyKey, getRecentMacroDeliveries } from '../src/services/macroDelivery.service.js';
import supabase from '../src/services/supabase.service.js';

console.log('\n╔══════════════════════════════════════════════════╗');
console.log(`║  FINSIGHT MACRO LIVE TRIAL — ${mode.toUpperCase().padEnd(18)} ║`);
console.log('╚══════════════════════════════════════════════════╝\n');

// ── STEP 1: Fetch subscriber count ──────────────────────────────────────────
console.log('── STEP 1: Checking Active Subscribers ─────────────');
const { data: subs, error: subErr } = await supabase
  .from('subscribers')
  .select('telegram_chat_id, is_pro, plan, status, expires_at, subscription_end');

if (subErr) {
  console.error('❌ Subscriber fetch failed:', subErr.message);
  process.exit(1);
}

const now = new Date();
const eligible = (subs || []).filter(u => {
  if (!u?.telegram_chat_id) return false;
  const plan = String(u.plan || '').toLowerCase();
  const isPro = u.is_pro === true || plan === 'pro' || plan === 'premium';
  if (!isPro) return false;
  const status = String(u.status || '').toLowerCase();
  if (status && !['active', 'trialing'].includes(status)) return false;
  const expiry = u.expires_at || u.subscription_end;
  if (expiry && new Date(expiry) < now) return false;
  return true;
});

console.log(`Total subscribers in DB: ${subs?.length ?? 0}`);
console.log(`Eligible Pro subscribers: ${eligible.length}`);
if (eligible.length > 0) {
  eligible.forEach(u => console.log(`  • Chat ID: ${u.telegram_chat_id} | Status: ${u.status}`));
}

// ── STEP 2: Generate Report ──────────────────────────────────────────────────
console.log('\n── STEP 2: Generating Macro Intelligence Report ─────');
let report;
if (mode === 'weekly') {
  report = await generateWeeklyInstitutionalReport();
} else if (mode === 'risk-alert') {
  report = await generateMacroRiskAlert(
    ['RBI policy uncertainty active', 'US bond yield elevated', 'Crude oil instability'],
    'Reduce aggressive exposure. Prioritize capital protection.'
  );
} else {
  report = await generateDailyMacroReport();
}

console.log(`\n✅ Report generated`);
console.log(`   Type:       ${report.reportType}`);
console.log(`   Summary:    ${report.summary}`);
console.log(`   Generated:  ${report.generatedAt}`);
console.log(`\n── Report Text ─────────────────────────────────────`);
console.log(report.reportText);

// ── STEP 3: Idempotency key ──────────────────────────────────────────────────
const idempotencyKey = buildMacroIdempotencyKey(report.reportType, new Date(report.generatedAt));
console.log(`\n── STEP 3: Idempotency Key ──────────────────────────`);
console.log(`   Key: ${idempotencyKey}`);
console.log(`   → Replay of this key will be suppressed automatically`);

// ── STEP 4: Deliver via production flow ─────────────────────────────────────
console.log('\n── STEP 4: Production Telegram Delivery ─────────────');
console.log('Sending through real subscriber fanout...\n');

const result = await deliverMacroReport(report, `manual:live_trial_${mode}`);

console.log(`\n── STEP 4 RESULT ────────────────────────────────────`);
console.log(`   Status:             ${result.status}`);
console.log(`   Idempotency Key:    ${result.idempotencyKey}`);
console.log(`   Sent to:            ${result.sentCount ?? 0} subscribers`);
console.log(`   Failed:             ${result.failedCount ?? 0}`);
console.log(`   Duplicate Suppressed: ${result.duplicateSuppressed ?? 0}`);
if (result.reason) console.log(`   Reason:             ${result.reason}`);

// ── STEP 5: Verify duplicate suppression ────────────────────────────────────
console.log('\n── STEP 5: Duplicate Suppression Verification ───────');
console.log('Replaying same report (should be suppressed)...');
const replay = await deliverMacroReport(report, `manual:live_trial_replay_${mode}`);
console.log(`   Replay Status:       ${replay.status}`);
console.log(`   Duplicate Suppressed: ${replay.duplicateSuppressed ?? 0}`);

if (replay.status === 'SUPPRESSED' && replay.reason === 'ALREADY_CLAIMED') {
  console.log('   ✅ DUPLICATE SUPPRESSION WORKING — same report blocked on replay');
} else if (replay.status === 'SUPPRESSED' && replay.reason === 'NO_ELIGIBLE_SUBSCRIBERS') {
  console.log('   ⚠️  Replay suppressed (no eligible subscribers) — table not yet active');
} else {
  console.log(`   ⚠️  Unexpected replay status: ${replay.status}`);
}

// ── STEP 6: Persistence state ────────────────────────────────────────────────
console.log('\n── STEP 6: Persistence State ────────────────────────');
const recent = await getRecentMacroDeliveries(5);
if (recent.length && recent[0]?.note) {
  console.log('   ⚠️  Table not yet migrated — persistence layer inactive');
  console.log('   📋 Action: Run 202605240001_macro_report_delivery_persistence.sql in Supabase SQL Editor');
} else {
  console.log(`   Recent deliveries: ${recent.length}`);
  recent.forEach(d => {
    console.log(`   • ${d.report_type} | ${d.event_id} | ${d.delivery_status} | chat: ${d.telegram_chat_id ?? 'none'}`);
  });
}

// ── FINAL SUMMARY ────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║              LIVE TRIAL SUMMARY                  ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log(`║  Report Generated:   ✅                          ║`);
console.log(`║  Subscribers Found:  ${String(eligible.length).padEnd(28)}║`);
console.log(`║  Delivery Status:    ${String(result.status).padEnd(28)}║`);
console.log(`║  Sent Count:         ${String(result.sentCount ?? 0).padEnd(28)}║`);
console.log(`║  Duplicate Safe:     ${replay.status === 'SUPPRESSED' ? '✅ YES' : '⚠️  CHECK'} ${' '.repeat(22)}║`);
console.log('╚══════════════════════════════════════════════════╝\n');
