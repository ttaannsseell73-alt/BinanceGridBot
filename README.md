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
- **Quant:** V2 fixed-horizon model drives **TESTNET** decisions by default via `REAL_TESTNET`. `SHADOW` blocks exposure, `SMOKE_TESTNET` is explicit connectivity-only mode, and `REAL_LIVE` remains double-acknowledgement gated.
- **Price Action warm-start:** 1000 closed 1m candles are loaded before live scoring so market structure is mature at startup.
- **Execution:** Grid episodes remain stable between recenter events; inventory fills do not continuously re-price resting orders.
- **Reconciliation:** Uses bounded exchange history to avoid per-intent REST bursts.
- **Open Interest:** Live OI delta is tracked while duplicate snapshots are ignored.
- **Emergency risk:** 3% adverse-move, 5% liquidation-distance, and 10-consecutive-critical-error kill switches cancel resting orders, flatten inventory, verify flat, and persist a halt across restart.

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
