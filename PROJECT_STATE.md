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
- Idle reconciliation skips weighted order-history polling when there are no local open intents.
- Binance REST request weight is tracked; 429/418 responses trigger backoff. Automatic retries are GET-only so order/cancel writes are never blindly duplicated.
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

Each matured live observation now logs:
- its full exact feature hash,
- live exact-observation count,
- live exact-state count,
- executable-state count,
- current readiness (`NOT_READY` / `CANDIDATE_FOUND`).

This is observability only. It does not auto-promote execution mode.

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

GitHub CI on current canonical main (2026-09-20):
- main SHA: `c727a3bbf7a53f1011005e7333c56f6e0bc7db70`
- TypeScript build: **PASS**
- Test files: **25 passed**
- Tests: **103 passed**
- Breakout re-entry regression: **PASS** — breakout flags clear after a candle closes back inside the remembered range; the observed live breakout state is not a sticky-state bug.
- Idle reconciliation regression: **PASS** — `getAllOrders` is skipped when there are no local open intents.
- Bounded GitHub SHADOW smoke workflow: **READY** and testnet-only.
- GitHub repository testnet secrets are currently absent, so cloud SHADOW execution is intentionally skipped rather than weakening safety or failing canonical CI.

## Next evidence gate

The remaining blocker is empirical rather than missing core plumbing:

1. continue the current `main` on Binance Futures TESTNET in SHADOW,
2. accumulate enough real live exact-feature observations for at least one state to reach the locked sample gate,
3. use the automatic runtime readiness fields and `npm run quant:readiness` as independent checks,
4. only if candidate states survive the gate, promote manually to REAL_TESTNET,
5. then perform an extended TESTNET execution/restart/recovery run before any mainnet discussion.

Cloud SHADOW smoke can run from `.github/workflows/shadow-smoke.yml` once the repository has testnet-only `BINANCE_API_KEY` and `BINANCE_API_SECRET` secrets. Their absence does not alter the trading code or promotion gate.

Do not claim profitability or mainnet readiness before these steps produce evidence.
