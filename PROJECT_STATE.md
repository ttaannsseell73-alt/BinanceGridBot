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
- TESTNET Quant uses the locked **BALANCED_TESTNET** live-state profile; REAL_LIVE remains **STRICT_LIVE / EXACT-only**. Historical PA-only fallback is diagnostic and cannot place orders.

## Current safety stack

- Environment guard prevents mixed testnet/live REST+WS endpoints.
- Mainnet requires explicit live acknowledgement.
- Real-live Quant requires a second explicit Quant acknowledgement.
- TESTNET startup may normalize Hedge Mode to **ONE_WAY** and verifies the result before continuing; REAL_LIVE never auto-changes account position mode.
- Startup synchronizes the real exchange position into RiskGuard.
- Binance `ACCOUNT_UPDATE` is the live absolute inventory authority after the user stream connects.
- Strategy execution is fail-closed until the user stream is connected and absolute position state is synchronized.
- A fill newer than the last absolute position snapshot immediately closes the execution gate until `ACCOUNT_UPDATE` or a sufficiently new REST position snapshot catches up.
- User-stream disconnect/listen-key expiry invalidates risk synchronization and queues cancellation of resting grid orders.
- Order fills are journaled without additively mutating RiskGuard, preventing ACCOUNT_UPDATE + fill double counting.
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

Two profiles are locked:

**BALANCED_TESTNET** — used by SHADOW and REAL_TESTNET:
- every contributing observation must still contain real live Price Action + CVD + taker imbalance + Open Interest + absorption; historical `UNAVAILABLE` observations never enter the bucket,
- nearby exact states are grouped by range/trend regime + order-flow bias + OI building/not-building + breakout flag,
- liquidity-sweep direction and absorption value remain observed but do not split the TESTNET bucket,
- breakout buckets remain non-executable,
- sample count >= 6,
- fee/slippage-adjusted net expectancy >= 0.0006,
- StrategyEngine economic safety multiplier = 1.3.

**STRICT_LIVE** — used only by REAL_LIVE:
- exact live feature hash only,
- sample count >= 10,
- net expectancy >= 0.001,
- StrategyEngine economic safety multiplier = 1.5.

Promotion remains manual. No code automatically switches SHADOW to REAL_TESTNET or REAL_LIVE.

## Latest deterministic proof

GitHub CI on canonical main (2026-09-21):
- current safety/bootstrap SHA: `75c5edf4ea9d793418bcdba39b01ddf6f8c66ecf`
- balanced TESTNET profile implementation SHA: `ad5bec6a94bfa77a9c0082537af97423e6a40220`
- TypeScript build: **PASS**
- Test files: **PASS**
- Breakout re-entry regression: **PASS** — breakout flags clear after a candle closes back inside the remembered range; the observed live breakout state is not a sticky-state bug.
- Idle reconciliation regression: **PASS** — `getAllOrders` is skipped when there are no local open intents.
- User-risk ordering regression: **PASS** — execution stays blocked across fill/account-update ordering gaps until a fresh absolute position state catches up.
- External position authority regression: **PASS** — fills are persisted without double-incrementing RiskGuard.
- TESTNET position-mode bootstrap: **PASS** — Hedge Mode can be normalized to ONE_WAY on TESTNET and verified; REAL_LIVE remains fail-closed with no automatic account-mode mutation.
- Bounded GitHub SHADOW evidence workflow: **PASS** and testnet-only.

## Latest long SHADOW evidence

GitHub Actions `Shadow Evidence` run `35587463053` on 2026-09-21 completed **SUCCESS** against Binance Futures TESTNET in `SHADOW` mode after the TESTNET ONE_WAY bootstrap fix.

`npm run quant:readiness` reported under the locked **BALANCED_TESTNET** profile:
- source: **RUNTIME**
- state mode: **BALANCED**
- minimum samples: **6**
- minimum net expectancy: **0.0006**
- total observations: **1,368**
- live exact observations: **36**
- balanced live states: **9**
- executable states: **0**
- readiness: **NOT_READY**

Most mature balanced buckets:
- non-breakout / RANGE / SELL / OI-building: **7 samples**, expectancy **-0.002560** — sample gate passed but edge is negative,
- non-breakout / RANGE / BUY / OI-building: **7 samples**, expectancy **-0.002574** — sample gate passed but edge is negative,
- breakout / RANGE / SELL / OI-building: **7 samples**, expectancy **-0.000498** — breakout-blocked and negative,
- breakout / RANGE / BUY / OI-building: **5 samples**, expectancy **+0.000827** — positive but breakout-blocked and below the 6-sample gate.

No non-breakout bucket satisfies both sample count >= 6 and net expectancy >= 0.0006. Therefore there is still **no REAL_TESTNET candidate**. The important new evidence is that two non-breakout buckets have now reached the sample-count gate, but both currently show materially negative expectancy; more data is required rather than further threshold relaxation.

The workflow verified testnet credentials, restored the accumulated runtime evidence cache, built successfully, collected another bounded 5.5-hour live window, ran readiness, uploaded artifact `shadow-evidence-35587463053`, and persisted the updated Quant runtime cache. Mainnet and real execution remain disabled.

## Next evidence gate

The remaining blocker is empirical rather than missing core plumbing:

1. continue canonical `main` on Binance Futures TESTNET in SHADOW,
2. accumulate additional real live evidence until at least one **non-breakout** BALANCED_TESTNET bucket has sample count >= 6 and fee/slippage-adjusted net expectancy >= 0.0006,
3. do **not** lower the locked Quant thresholds merely to manufacture a candidate,
4. only if a non-breakout balanced candidate survives the gate, promote manually to REAL_TESTNET,
5. then perform an extended TESTNET execution/restart/recovery run before any mainnet discussion.

Current blocker: **SHADOW evidence / positive non-breakout expectancy**. Do not claim profitability or mainnet readiness before this gate is satisfied.
