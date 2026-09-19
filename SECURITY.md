# Security

Security is critical when dealing with automated trading systems. This project enforces several security principles to protect your API keys and prevent catastrophic loss.

## Principle of Least Privilege

- API keys provided to this bot must **ONLY** have "Futures Trading" enabled.
- Do **NOT** enable "Withdrawals" on your API key.
- Do **NOT** enable "Spot Trading" unless specifically modifying the bot for spot.
- Use IP restriction on your Binance API keys whenever possible.

## Key Management

- API keys are managed strictly through environment variables.
- `.env` is included in `.gitignore` to prevent accidental commits to GitHub.
- Keys are never logged to the console by the `logger`.

## Trading Safety

- **Fail-Closed Execution**: If any network anomaly is detected, the bot will halt process execution instead of retrying blindly.
- **Atomic Risk Verification**: It is mathematically impossible for the bot to place an order that exceeds the configured `MAX_TOTAL_NOTIONAL` or exposure limits, even if a loop runs out of control.
- **Ownership Verification**: If someone logs into the Binance UI and places a manual order, the bot will immediately detect it via the `Reconciler` and **HALT**. It refuses to manage a state it did not create.

## Cryptography

- All REST API calls are authenticated using `HMAC SHA256` signatures built into the `BinanceRestClient`.

Do not disable these security checks.
