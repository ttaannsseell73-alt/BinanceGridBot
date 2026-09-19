import { IBinanceClient, SymbolRiskConfig } from '../gateways/IBinanceClient';

export const TARGET_MARGIN_TYPE = 'ISOLATED' as const;
export const TARGET_LEVERAGE = 2;

export async function ensureStartupSymbolRiskConfig(
  client: IBinanceClient,
  symbol: string
): Promise<SymbolRiskConfig> {
  let current = await client.getSymbolRiskConfig(symbol);
  let changed = false;

  if (current.marginType !== TARGET_MARGIN_TYPE) {
    await client.setMarginType(symbol, TARGET_MARGIN_TYPE);
    changed = true;
  }

  if (current.leverage !== TARGET_LEVERAGE) {
    await client.setLeverage(symbol, TARGET_LEVERAGE);
    changed = true;
  }

  if (changed) {
    current = await client.getSymbolRiskConfig(symbol);
  }

  if (
    current.marginType !== TARGET_MARGIN_TYPE ||
    current.leverage !== TARGET_LEVERAGE
  ) {
    throw new Error(
      `Binance symbol risk configuration verification failed for ${symbol}: ` +
      `marginType=${current.marginType}, leverage=${current.leverage}`
    );
  }

  return current;
}
