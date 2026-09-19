# Testing

The project employs a robust deterministic testing strategy. Instead of mocking network requests via libraries like `nock`, it implements a full fake exchange.

## FakeBinanceExchange

`FakeBinanceExchange` is an in-memory event-loop driven simulator that mimics Binance Futures.

- It maintains its own order book and open orders list.
- It validates GTX (Post-Only) rules: If a BUY crosses the ask, or a SELL crosses the bid, it immediately expires the order.
- It simulates network latency via `setImmediate`, allowing exact modeling of asynchronous WS vs REST race conditions.
- It exposes a `simulateNetworkDrop()` flag, dropping REST responses while still processing the order internally, allowing tests to simulate edge cases.

## Test Suite

Tests are executed using `Vitest`.

Run the suite with:
```bash
npm test
```

The core failure scenarios are defined in `src/tests/FailureMatrix.test.ts`. This file runs 7 specific scenarios against the `FakeBinanceExchange` to prove the `IntentJournal`, `ExecutionEngine`, `OrderTracker`, and `Reconciler` handle edge cases identically to production.
