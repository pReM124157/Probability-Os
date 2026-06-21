# Probability OS - Kalshi BTC 15-Minute Agentic Trading System

This module adapts the existing Finsight AI infrastructure into a Kalshi BTC probability-arbitrage research system.

## Goal

Determine whether a repeatable probability edge exists in Kalshi BTC 15-minute markets before any live capital deployment.

## Core Layers

1. Data Collection
   - Kalshi market probabilities
   - Kalshi order books
   - Coinbase / Kraken / Binance BTC prices
   - Market metadata
   - Settlement outcomes

2. Historical Replay
   - Store timestamped BTC price, market probability, target, time-to-expiry, and settlement outcome.

3. Reachability Engine
   - Estimate whether BTC can realistically move from current price to target within remaining time.

4. Mispricing Engine
   - Compare market implied probability vs model probability.
   - Calculate edge after spread and fees.

5. Paper Trading
   - Simulate trades before live deployment.

6. Risk Engine
   - Position limits
   - Daily loss limits
   - Kill switch
   - Risk-of-ruin controls

7. Execution Engine
   - Paper execution first.
   - Live execution only after validation.

8. Performance Engine
   - ROI
   - Win rate
   - Expected value
   - Sharpe
   - Drawdown
   - Calibration

## Current Status

Finsight provides the base infrastructure:
- Agent orchestration
- Data pipeline pattern
- Schedulers
- Supabase persistence
- Audit logging
- Outcome tracking
- Statistical validation
- Telegram delivery
- Frontend dashboard

Kalshi/BTC-specific components are being added separately under `src/kalshi`.
