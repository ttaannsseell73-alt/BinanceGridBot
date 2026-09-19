# Binance Futures Grid Bot

A high-frequency grid trading bot for Binance Futures, engineered with an **"Inventory-Skews-Order"** (ISO) strategy and a deterministic state-machine architecture to ensure 100% data integrity and fail-closed safety.

## Overview

This project implements the canonical architecture specification v2.1. It is designed to be highly reliable, resilient against network failures, and fail-closed by default. It guarantees no duplicate order executions and strictly tracks risk exposure through an immutable intent journal (SQLite WAL mode).

## Features

- **Intent Journal**: Immutable ledger recording all state transitions of an order, guaranteeing zero-loss state tracking.
- **Atomic RiskGuard**: All orders reserve risk *before* being sent to the exchange, preventing over-exposure.
- **Fail-Closed Reconciler**: Tri-way reconciliation (Journal vs WS vs REST). If drift is detected or a foreign order is found, the system halts immediately.
- **Watchdog**: Monitors WebSocket latency for both market data and user stream. Stops trading if data is stale.
- **Deterministic Test Suite**: Complete test coverage for critical network failure scenarios (dropped POST responses, partial fills, sequence drift).

## Current Checkpoint

- **Scope:** Grid bot only. Scalp code is intentionally kept out of this repository.
- **Environment:** Binance Futures **TESTNET**. Mainnet is not enabled by this checkpoint.
- **Quant:** V2 fixed-horizon model remains **SHADOW** by default. SHADOW passively records mature live PA + microstructure + OI states, labels them after the same fixed horizon used by training, and persists them to `data/quant_model_<SYMBOL>.live.json`. Real execution requires an `EXACT` live-feature match; historical PA-only fallback is diagnostic only.
- **Price Action warm-start:** 1000 closed 1m candles are loaded before live scoring so market structure is mature at startup.
- **Execution:** Grid episodes remain stable between recenter events; inventory fills do not continuously re-price resting orders.
- **Reconciliation:** Uses bounded exchange history to avoid per-intent REST bursts.
- **Open Interest:** Live OI delta is tracked while duplicate snapshots are ignored.
- **Emergency risk:** 3% adverse-move, 5% liquidation-distance, and 10-consecutive-critical-error kill switches cancel resting orders, flatten inventory, verify flat, and persist a halt across restart.

## Quant Promotion Gate

Run `npm run quant:readiness` to audit the persisted live model. Promotion is not automatic: a non-breakout exact feature state needs at least 10 observations and net expectancy of at least 0.001 before it is even considered a candidate. Until then, SHADOW remains fail-closed and places no new grid exposure.

## Getting Started

Refer to the [TESTNET_RUNBOOK.md](./TESTNET_RUNBOOK.md) for detailed instructions on how to set up, test, and run the bot safely on Binance Testnet.

## Documentation Index

1. [ARCHITECTURE.md](./ARCHITECTURE.md) - High-level system design and components.
2. [STATE_MACHINE.md](./STATE_MACHINE.md) - Lifecycle states of an order intent.
3. [RISK_MODEL.md](./RISK_MODEL.md) - How risk is tracked, reserved, and freed.
4. [FAILURE_MATRIX.md](./FAILURE_MATRIX.md) - Deterministic failure scenarios handled by the system.
5. [TESTING.md](./TESTING.md) - Testing strategy and fake exchange details.
6. [TESTNET_RUNBOOK.md](./TESTNET_RUNBOOK.md) - How to safely run the bot.
7. [SECURITY.md](./SECURITY.md) - API key management and security principles.
