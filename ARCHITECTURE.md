# Architecture

The system is designed with a uni-directional data flow, centering around the **IntentJournal**. The database is the single source of truth; the exchange is a secondary reality that we attempt to align with.

## Components

### 1. Gateways
- **BinanceMarketGateway**: Subscribes to the `@bookTicker` WebSocket stream for real-time BBA (Best Bid/Ask) updates.
- **BinanceUserGateway**: Manages the user data stream via listenKey. Receives `ORDER_TRADE_UPDATE` events.
- **BinanceRestClient**: Provides methods for executing REST operations (`POST /fapi/v1/order`, `DELETE /fapi/v1/order`, `GET /fapi/v1/openOrders`) with HMAC SHA256 signing.

### 2. Core Engine
- **IntentJournal**: SQLite database in WAL mode. Tracks the lifecycle of every order.
- **RiskGuard**: Validates and reserves exposure limits (MAX_LONG, MAX_SHORT, MAX_NOTIONAL) atomically before allowing the Strategy to submit orders.
- **ExecutionEngine**: Reads reserved intents and executes them against `BinanceRestClient`.
- **OrderTracker**: Listens to WS updates from `BinanceUserGateway` and transitions intents in the journal based on real-time fills and cancellations.
- **Reconciler**: Periodically fetches the true state from the exchange via REST and compares it against the `IntentJournal`. If an inconsistency (e.g., `OWNERSHIP_VIOLATION`) is detected, it halts the system.
- **Watchdog**: Ensures market and user data are fresh. Emits `stale_market` or `stale_user` if no messages are received within a threshold.

### 3. Strategy
- **StrategyEngine**: Evaluates current price and risk position. Generates a set of desired grid intents.

## Data Flow

1. Strategy queries price and risk.
2. Strategy proposes `OrderIntent`.
3. `RiskGuard` checks if intent violates limits. If not, reserves risk and saves to `IntentJournal` as `INIT`.
4. `ExecutionEngine` attempts to submit order. Journal moves to `SUBMIT_UNKNOWN`.
5. REST response comes back. If success, Journal moves to `ACKNOWLEDGED`.
6. WebSocket stream pushes fill. `OrderTracker` moves Journal to `PARTIALLY_FILLED` or `FILLED`. Risk is updated.
7. `Reconciler` periodically sweeps to catch anything the WS missed.
