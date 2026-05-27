import dotenv from 'dotenv';
dotenv.config();

import supabase from '../src/services/supabase.service.js';
import { initializeOutcomeForRecommendation, syncRecommendationOutcomes } from '../src/services/recommendationOutcome.service.js';
import * as marketDataService from '../src/services/marketData.service.js';

console.log('=== FINSIGHT TRADE LIFECYCLE INTELLIGENCE LIVE TRIAL ===\n');

// 1. Fetch active subscribers to show fanout context
const { data: subscribers, error: subError } = await supabase
  .from('subscribers')
  .select('telegram_chat_id,status')
  .eq('status', 'active');

if (subError) {
  console.error('❌ Failed to fetch subscribers:', subError.message);
  process.exit(1);
}

const activeSubscribers = (subscribers || []).map(s => s.telegram_chat_id);
console.log('👥 Active subscribers for multi-user fanout:', activeSubscribers);

// 2. Generate a unique test recommendation ID to prevent collision
const uniqueId = `FS-TRIAL-RELIANCE-${Date.now()}`;
const testSymbol = `TRIAL_RELIANCE_${Date.now()}`; // Unique mock symbol

// Dynamic Supabase query interceptor to only track our test recommendation
const originalFrom = supabase.from;
supabase.from = (table) => {
  if (table === 'recommendation_outcomes') {
    return {
      select: (fields) => {
        let chain = originalFrom.call(supabase, table).select(fields).eq('recommendation_id', uniqueId);
        return chain;
      },
      update: (data) => originalFrom.call(supabase, table).update(data),
      delete: () => originalFrom.call(supabase, table).delete(),
      insert: (data) => originalFrom.call(supabase, table).insert(data),
      upsert: (data, opts) => originalFrom.call(supabase, table).upsert(data, opts)
    };
  }
  return originalFrom.call(supabase, table);
};

const testAudit = {
  recommendation_id: uniqueId,
  symbol: testSymbol,
  exchange: 'NSE',
  recommendation_type: 'BUY',
  action: 'BUY',
  entry_price: 2840,
  target_price: 2910,
  stop_loss: 2810,
  horizon: 'SWING',
  confidence: 85,
  conviction: 'HIGH',
  telegram_delivery_status: 'SENT',
  telegram_delivery_message_id: 'initial_signal_message_id',
  created_at: new Date().toISOString()
};

console.log('\n📝 Inserting test recommendation audit record:', uniqueId);
const { error: auditError } = await supabase
  .from('recommendation_audit')
  .insert([testAudit]);

if (auditError) {
  console.error('❌ Failed to insert test audit record:', auditError.message);
  process.exit(1);
}

console.log('🎯 Initializing outcome tracking state in recommendation_outcomes...');
await initializeOutcomeForRecommendation(testAudit);

// Define our mock candles sequence
const candle1 = {
  date: '2026-05-24T10:00:00Z',
  timestamp: new Date('2026-05-24T10:00:00Z'),
  open: 2840,
  high: 2920, // Hits target of 2910
  low: 2830,
  close: 2915
};

const candle2 = {
  date: '2026-05-24T11:00:00Z',
  timestamp: new Date('2026-05-24T11:00:00Z'),
  open: 2915,
  high: 2960, // Hits 2960 (+4.2% return, triggers Trailing stop update)
  low: 2900,
  close: 2955
};

const candle3 = {
  date: '2026-05-24T12:00:00Z',
  timestamp: new Date('2026-05-24T12:00:00Z'),
  open: 2955,
  high: 2955,
  low: 2870, // Drops to 2870 (hits Trailed stop loss: 2840 * 1.015 = 2882.6)
  close: 2875
};

import YahooFinance from 'yahoo-finance2';

// Helper to generate >20 candles to satisfy marketData.service.js validation
function generateCandleHistory(activeCandles) {
  const history = [];
  const baseDate = new Date('2026-05-24T10:00:00Z');
  // Generate 22 baseline historical candles
  for (let i = 22; i >= 1; i--) {
    const d = new Date(baseDate.getTime() - i * 24 * 60 * 60 * 1000);
    history.push({
      date: d.toISOString(),
      timestamp: d,
      open: 2840,
      high: 2840,
      low: 2840,
      close: 2840
    });
  }
  // Append our phase-specific candles
  history.push(...activeCandles);
  return history;
}

let currentMockCandles = [];

// Intercept YahooFinance.prototype.historical on the prototype so all instances inherit the mock
const originalHistorical = YahooFinance.prototype.historical;
YahooFinance.prototype.historical = async function(symbol, queryOptions) {
  if (symbol.startsWith('TRIAL_RELIANCE')) {
    console.log(`[MOCK YAHOO] Returning ${currentMockCandles.length} mock candles for ${symbol}`);
    return currentMockCandles;
  }
  return originalHistorical.call(this, symbol, queryOptions);
};

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

try {
  // === PHASE 1: TARGET HIT ===
  console.log('\n--- PHASE 1: TARGET HIT FLOW ---');
  currentMockCandles = generateCandleHistory([candle1]);
  let res1 = await syncRecommendationOutcomes({ limit: 10, onlyOpen: true });
  console.log('Result Phase 1:', res1);

  // === PHASE 2: TRAILING STOP LOSS UPDATE ===
  console.log('\n--- PHASE 2: TRAILING STOP UPDATE FLOW ---');
  currentMockCandles = generateCandleHistory([candle1, candle2]);
  let res2 = await syncRecommendationOutcomes({ limit: 10, onlyOpen: true });
  console.log('Result Phase 2:', res2);

  // === PHASE 3: STOP LOSS HIT & TRADE CLOSED ===
  console.log('\n--- PHASE 3: STOP LOSS HIT & CLOSURE FLOW ---');
  currentMockCandles = generateCandleHistory([candle1, candle2, candle3]);
  let res3 = await syncRecommendationOutcomes({ limit: 10, onlyOpen: true });
  console.log('Result Phase 3:', res3);

  // === PHASE 4: REPLAY SAFETY VERIFICATION (DUPLICATE SAFETY) ===
  console.log('\n--- PHASE 4: REPLAY SAFETY VERIFICATION ---');
  console.log('Rerunning same tracker cycle with fully closed trade...');
  let res4 = await syncRecommendationOutcomes({ limit: 10, onlyOpen: false });
  console.log('Result Phase 4:', res4);

  // ─────────────────────────────────────────────────────────────────────────────
  // VERIFY PERSISTENT STATE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n🔍 Verifying final persistence state in recommendation_outcomes:');
  const { data: finalOutcomes, error: finalError } = await supabase
    .from('recommendation_outcomes')
    .select('recommendation_id,outcome_status,realized_return_pct,provider_metadata')
    .eq('recommendation_id', uniqueId);

  if (finalError) {
    console.error('❌ Failed to fetch final outcome row:', finalError.message);
  } else {
    const row = finalOutcomes[0];
    console.log('• Status:', row.outcome_status);
    console.log('• Realized Return:', row.realized_return_pct, '%');
    console.log('• Sent Events Metadata:', JSON.stringify(row.provider_metadata?.sent_events, null, 2));
    
    const sentEvents = row.provider_metadata?.sent_events || {};
    console.log('\n✅ Verification summary:');
    console.log(`• TARGET_HIT successfully sent: ${sentEvents['TARGET_HIT']?.status === 'SENT'}`);
    console.log(`• TRAILING_SL_UPDATE successfully sent: ${sentEvents['TRAILING_SL_UPDATE']?.status === 'SENT'}`);
    console.log(`• STOP_HIT successfully sent: ${sentEvents['STOP_HIT']?.status === 'SENT'}`);
    console.log(`• TRADE_CLOSED successfully sent: ${sentEvents['TRADE_CLOSED']?.status === 'SENT'}`);
  }

} finally {
  // CLEAN UP TEST DATA
  console.log('\n🧹 Cleaning up test data...');
  const { error: cleanOutError } = await supabase
    .from('recommendation_outcomes')
    .delete()
    .eq('recommendation_id', uniqueId);

  if (cleanOutError) {
    console.log('⚠️ Cleanup warning:', cleanOutError?.message);
  } else {
    console.log('✅ Temporary test data cleaned up successfully!');
  }
}
