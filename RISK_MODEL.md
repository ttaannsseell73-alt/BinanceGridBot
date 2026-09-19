# Risk Model

Risk is strictly managed preemptively via the **RiskGuard** component. The system never relies on the exchange to prevent over-exposure; it tracks exposure locally based on intents.

## Core Rules

1. **Atomic Reservation**: Before any order is sent to the exchange, it must secure risk capacity.
2. **Double-Spend Prevention**: Risk is tracked against `remainingQuantity`, not `originalQuantity`, to prevent double-counting as fills arrive.
3. **Fail-Safe Release**: Risk is only released when an order reaches a terminal un-filled state (`CANCELED`, `CONFIRMED_REJECTED`).

## Risk Limits

- `MAX_LONG_EXPOSURE`: The maximum long position size (in base asset) the bot will allow.
- `MAX_SHORT_EXPOSURE`: The maximum short position size (in base asset) the bot will allow.
- `MAX_TOTAL_NOTIONAL`: The maximum notional value (base * price) of all active and filled positions.

## Calculation

At any given time:

- **Pending Longs** = Sum of `remainingQuantity` for all `BUY` intents that are NOT terminal.
- **Pending Shorts** = Sum of `remainingQuantity` for all `SELL` intents that are NOT terminal.
- **Current Position** = Total executed quantity of `BUY` orders minus total executed quantity of `SELL` orders.

The **RiskGuard** ensures that:
- `Current Position + Pending Longs + New Buy Intent <= MAX_LONG_EXPOSURE`
- `Current Position - Pending Shorts - New Sell Intent >= -MAX_SHORT_EXPOSURE`
- `(Current Position * Price) + Notional of Pending Orders <= MAX_TOTAL_NOTIONAL`

If any of these constraints are violated, the intent is rejected and never hits the journal.
