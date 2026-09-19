# Scalp V1 overlay

Purpose: add a fast, testable Futures scalp decision subsystem next to the existing grid system without changing grid behavior.

Locked decision path:

`Radar -> 5m trend structure -> 1m confirmed break -> order flow -> LONG/SHORT/PASS -> existing RiskGuard/ExecutionEngine -> staged exit`

Core files:
- `FuturesRadarEngine.ts`: rolling impulse/volume/trade-rate/taker-flow radar.
- `TrendBreakEngine.ts`: 5m descending/ascending structure + 1m breakout/volume confirmation.
- `OrderFlowEngine.ts`: 15s taker buy/sell, CVD, spread gate; OI delta is supported as input.
- `ScalpSignalEngine.ts`: strict 3-of-3 decision gate.
- `ScalpRiskPolicy.ts`: $1,000 reference capital; $5/trade risk; $15 max open risk; $25 daily loss stop; 3x default, 5x cap.
- `FastExitEngine.ts`: 50% at 1R, 50% at 1.8R, breakeven+buffer after TP1, time-stop, reduce-only semantics.
- `ScalpCoordinator.ts`: event-driven decision coordinator; intentionally does not submit orders itself.

Safety boundary: this overlay is designed for TESTNET/replay first. It contains no live-mainnet enable switch and does not claim profitability.
