# Testnet Runbook

This guide explains how to safely configure and run the bot on Binance Futures Testnet. **The bot defaults to Testnet mode and should NEVER be run on production without explicitly changing the configuration.**

## Prerequisites

1. Node.js v18+
2. A Binance Futures Testnet Account
   - Create an account at [testnet.binancefuture.com](https://testnet.binancefuture.com/)
   - Generate API keys in the testnet dashboard.

## Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your Testnet API Key and Secret:
   ```env
   BINANCE_API_KEY=your_testnet_key
   BINANCE_API_SECRET=your_testnet_secret
   ```
3. Verify the URLs point to Testnet:
   ```env
   BINANCE_FUTURES_URL=https://testnet.binancefuture.com
   BINANCE_FUTURES_WS_URL=wss://stream.binancefuture.com
   ```
4. Configure your risk limits in the `.env` (e.g., `MAX_LONG_EXPOSURE`, `MAX_SHORT_EXPOSURE`).

## Running the Bot

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the TypeScript code (optional, `ts-node` can also be used):
   ```bash
   npm run build
   ```
3. Start the bot:
   ```bash
   npm start
   ```

## Monitoring

- Watch the console output for `pino` structured logs.
- You will see `Reconciler` kicking off every minute.
- `StrategyEngine` will run its grid calculation every 5 seconds.
- Monitor the `intents.db` SQLite file for a log of all operations.
