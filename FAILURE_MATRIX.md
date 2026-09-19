# Failure Matrix

The bot is designed to handle a deterministic set of network and logical failure scenarios. These are actively verified via the `FailureMatrix.test.ts` suite.

## Scenarios Covered

1. **Happy Path (Normal Fill)**
   - `INIT` -> `SUBMIT_UNKNOWN` -> `ACKNOWLEDGED` (REST) -> `PARTIALLY_FILLED` (WS) -> `FILLED` (WS)
2. **Post-But-Dropped Response**
   - The REST POST request fires but the response is dropped due to network failure.
   - Journal stays in `SUBMIT_UNKNOWN`.
   - The WS receives a `NEW` event, safely transitioning the order to `ACKNOWLEDGED`.
3. **Partial Fills Processing**
   - The WS stream pushes multiple `TRADE` events.
   - The system accurately updates `remainingQuantity` and transitions to `PARTIALLY_FILLED` until it reaches 0, where it becomes `FILLED`.
4. **Duplicate Events**
   - The WS stream pushes the exact same fill event twice.
   - The database prevents duplicate execution via unique constraints on `(intentId, fillId)`.
5. **Reconciliation Sync**
   - An order is placed and acknowledged, but the WS stream is entirely silent.
   - The `Reconciler` fetches REST open orders, matches the order, and prevents drift.
6. **Reconciler Ownership Violation**
   - A manual order is placed directly via the Binance UI, bypassing the bot.
   - The `Reconciler` detects a foreign order that is not in the `IntentJournal`.
   - System triggers a **FATAL HALT** to prevent unpredictable state.
7. **Fail-Closed on Missing Order**
   - The journal says an order is `ACKNOWLEDGED`, but it is completely missing from the exchange (not in open orders).
   - System triggers a **FATAL HALT** because reality diverges critically from the journal.

This matrix ensures the system does not bleed funds due to network timeouts or missing webhooks.
