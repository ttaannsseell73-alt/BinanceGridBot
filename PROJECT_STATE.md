# PROJECT STATE — BinanceGridBot

**Canonical repository:** `ttaannsseell73-alt/BinanceGridBot`  
**Scope:** Binance USDⓈ-M Futures grid bot only. Scalp is a separate project.  
**Operational stage:** TESTNET / SHADOW evidence collection.  
**Mainnet status:** Not approved.  
**Profitability status:** Not proven.

## Locked architecture

- Price Action + Microstructure + Open Interest + Quant.
- No RSI/MACD-style classic-indicator decision layer.
- Deterministic execution and risk controls own the money path.
- Binance Futures symbol configuration is verified as **ISOLATED / 2x** before strategy activity.
- Reconciliation is bounded and fail-closed.
- Grid episodes remain stable between explicit recenter events.
- Price-action breakout blocks new grid exposure.
- Default Quant mode is **SHADOW**.
- Real Quant execution requires an **EXACT** live feature match. Historical PA-only fallback is diagnostic and cannot place orders.

## Current safety stack

- Environment guard prevents mixed testnet/live REST+WS endpoints.
- Mainnet requires explicit live acknowledgement.
- Real-live Quant requires a second explicit Quant acknowledgement.
- Startup synchronizes the real exchange position into RiskGuard.
- Emergency kill switch triggers on:
  - 3% adverse move against open inventory,
  - liquidation distance at or below 5%,
  - 10 consecutive critical-operation failures.
- Emergency exit:
  - cancels all open orders,
  - sends reduce-only market flatten,
  - verifies the position is flat,
  - persists an emergency halt across restart.
- Emergency halt clearing requires explicit acknowledgement.

## Quant state

Base model:
- version: V2 fixed-horizon virtual-grid labels
- training candles: 20,160 x 1m
- historical observations: 1,332
- horizon: 60 closed 1m candles
- training stride: 15 closed 1m candles

Historical kline replay intentionally does not fabricate tick microstructure or Open Interest. Those dimensions remain unavailable in the historical base model.

The historical PA-only model does **not** currently provide a robust executable edge under the production economic gate. Thresholds must not be lowered merely to force trades.

## Live exact-feature collection

SHADOW mode now passively collects mature live:
- Price Action,
- CVD,
- taker imbalance,
- Open Interest delta,
- absorption.

A snapshot is opened every 15 closed 1m candles and labeled after a 60-candle forward horizon using the same virtual-grid outcome model as historical training.

Runtime model:
`data/quant_model_<SYMBOL>.live.json`

Recovery order:
1. runtime model,
2. runtime backup,
3. committed historical base model.

## Promotion gate

Run:

`npm run quant:readiness`

A state is only a candidate when:
- it contains real live exact features (no `UNAVAILABLE` dimensions),
- it is not a breakout state,
- sample count >= 10,
- net expectancy >= 0.001.

Promotion is manual. No code automatically switches SHADOW to REAL_TESTNET.

## Latest deterministic proof

GitHub CI after Quant runtime-store hardening:
- TypeScript build: PASS
- Test files: **23 passed**
- Tests: **95 passed**

## Next evidence gate

The remaining blocker is empirical rather than missing core plumbing:

1. run the current `main` on Binance Futures TESTNET in SHADOW,
2. accumulate live exact-feature observations,
3. audit with `npm run quant:readiness`,
4. only if candidate states survive the gate, promote to REAL_TESTNET,
5. then perform an extended TESTNET execution/restart/recovery run before any mainnet discussion.

Do not claim profitability or mainnet readiness before these steps produce evidence.
