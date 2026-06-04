import { afterEach, describe, expect, test, vi } from 'vitest';
import supabase from '../services/supabase.service.js';

const historicalCandlesMock = vi.fn();
const liveMarketDataMock = vi.fn();

vi.mock('../services/marketData.service.js', () => ({
  getHistoricalCandles: historicalCandlesMock,
  getLiveMarketData: liveMarketDataMock
}));

vi.mock('../services/telegram.service.js', () => ({
  default: {
    telegram: {
      sendMessage: vi.fn()
    }
  }
}));

vi.mock('../services/telemetry.service.js', () => ({
  logError: vi.fn(),
  logEvent: vi.fn()
}));

const { syncRecommendationOutcomes } = await import('../services/recommendationOutcome.service.js');

const activeOutcomeIds = new Set();

function isoFromNow({ days = 0, minutes = 0 } = {}) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setMinutes(value.getMinutes() + minutes);
  return value.toISOString();
}

function buildSentEvents(statuses) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        status: 'SKIPPED_NO_SUBSCRIBERS',
        sent_at: new Date().toISOString(),
        sent_count: 0,
        failed_count: 0,
        details: {}
      }
    ])
  );
}

async function ensureAuditRow({ recommendationId, symbol, createdAt, entryPrice, targetPrice, stopLoss }) {
  const { data: existing, error: existingError } = await supabase
    .from('recommendation_audit')
    .select('recommendation_id')
    .eq('recommendation_id', recommendationId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from('recommendation_audit')
    .insert({
      recommendation_id: recommendationId,
      symbol,
      exchange: 'NSE',
      recommendation_type: 'SWING',
      action: 'BUY',
      confidence: 82,
      conviction: 'HIGH',
      entry_price: entryPrice,
      stop_loss: stopLoss,
      target_price: targetPrice,
      rr_ratio: 2,
      horizon: 'SWING',
      sector: 'TECH',
      market_regime: 'BULL',
      risk_score: 2,
      volatility_score: 1.5,
      provider_metadata: { source: 'scenario-runner' },
      generated_by: 'signal.engine',
      created_at: createdAt
    })
    .select('recommendation_id')
    .single();

  if (error) throw error;
  return data;
}

async function seedOutcomeRow({ recommendationId, symbol, createdAt, expiryAt, latestPrice, entryPrice, stopLoss, sentEventStatuses = [] }) {
  activeOutcomeIds.add(recommendationId);

  const { data, error } = await supabase
    .from('recommendation_outcomes')
    .upsert({
      recommendation_id: recommendationId,
      symbol,
      entry_price: entryPrice,
      recommendation_created_at: createdAt,
      latest_price: latestPrice,
      latest_price_at: createdAt,
      outcome_status: 'OPEN',
      candles_processed: 0,
      expiry_at: expiryAt,
      provider_metadata: {
        current_stop_loss: stopLoss,
        previous_stop_loss: null,
        sent_events: buildSentEvents(sentEventStatuses)
      }
    }, { onConflict: 'recommendation_id' })
    .select('recommendation_id')
    .single();

  if (error) throw error;
  return data;
}

async function fetchOutcomeStatus(recommendationId) {
  const { data, error } = await supabase
    .from('recommendation_outcomes')
    .select('outcome_status')
    .eq('recommendation_id', recommendationId)
    .single();

  if (error) throw error;
  return data.outcome_status;
}

afterEach(async () => {
  for (const recommendationId of activeOutcomeIds) {
    await supabase
      .from('recommendation_outcomes')
      .delete()
      .eq('recommendation_id', recommendationId);
  }

  activeOutcomeIds.clear();
  historicalCandlesMock.mockReset();
  liveMarketDataMock.mockReset();
});

describe('Outcome Lifecycle Engine', () => {
  test('should close recommendation when price hits target', async () => {
    const recommendationId = 'LIFECYCLE_ALPHA_TARGET';
    const createdAt = isoFromNow({ minutes: 2 });
    const expiryAt = isoFromNow({ days: 30 });

    await ensureAuditRow({
      recommendationId,
      symbol: 'ALPHA.NS',
      createdAt,
      entryPrice: 90,
      targetPrice: 100,
      stopLoss: 85
    });

    await seedOutcomeRow({
      recommendationId,
      symbol: 'ALPHA.NS',
      createdAt,
      expiryAt,
      latestPrice: 90,
      entryPrice: 90,
      stopLoss: 85,
      sentEventStatuses: ['TARGET_HIT']
    });

    historicalCandlesMock.mockImplementation(async (symbol) => {
      if (symbol === 'ALPHA.NS') {
        return [{ timestamp: isoFromNow({}), high: 101, low: 96, close: 101 }];
      }
      return [{ timestamp: isoFromNow({}), high: 100, low: 100, close: 100 }];
    });

    await syncRecommendationOutcomes({ limit: 1 });

    expect(await fetchOutcomeStatus(recommendationId)).toBe('TARGET_HIT');
  });

  test('should close recommendation when price hits stop loss', async () => {
    const recommendationId = 'LIFECYCLE_BETA_STOP';
    const createdAt = isoFromNow({ minutes: 3 });
    const expiryAt = isoFromNow({ days: 30 });

    await ensureAuditRow({
      recommendationId,
      symbol: 'BETA.NS',
      createdAt,
      entryPrice: 90,
      targetPrice: 100,
      stopLoss: 85
    });

    await seedOutcomeRow({
      recommendationId,
      symbol: 'BETA.NS',
      createdAt,
      expiryAt,
      latestPrice: 90,
      entryPrice: 90,
      stopLoss: 85,
      sentEventStatuses: ['STOP_HIT', 'TRADE_CLOSED']
    });

    historicalCandlesMock.mockImplementation(async (symbol) => {
      if (symbol === 'BETA.NS') {
        return [{ timestamp: isoFromNow({}), high: 95, low: 84, close: 84 }];
      }
      return [{ timestamp: isoFromNow({}), high: 100, low: 100, close: 100 }];
    });

    await syncRecommendationOutcomes({ limit: 1 });

    expect(await fetchOutcomeStatus(recommendationId)).toBe('STOP_HIT');
  });

  test('should auto-expire recommendation after 30 days', async () => {
    const recommendationId = 'LIFECYCLE_GAMMA_EXPIRE';
    const createdAt = isoFromNow({ minutes: 4 });
    const expiryAt = isoFromNow({ days: -1 });

    await ensureAuditRow({
      recommendationId,
      symbol: 'GAMMA.NS',
      createdAt,
      entryPrice: 90,
      targetPrice: 100,
      stopLoss: 85
    });

    await seedOutcomeRow({
      recommendationId,
      symbol: 'GAMMA.NS',
      createdAt,
      expiryAt,
      latestPrice: 90,
      entryPrice: 90,
      stopLoss: 85,
      sentEventStatuses: ['TRADE_CLOSED']
    });

    historicalCandlesMock.mockImplementation(async (symbol) => {
      if (symbol === 'GAMMA.NS') {
        return [{ timestamp: isoFromNow({}), high: 92, low: 92, close: 92 }];
      }
      return [{ timestamp: isoFromNow({}), high: 100, low: 100, close: 100 }];
    });

    await syncRecommendationOutcomes({ limit: 1 });

    expect(await fetchOutcomeStatus(recommendationId)).toBe('EXPIRED');
  });
});
